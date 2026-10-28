import { inject, Injectable } from '@angular/core';
import {
  collection, doc, getDocs, query, runTransaction, serverTimestamp, where,
  DocumentSnapshot, Transaction,
} from 'firebase/firestore';
import { productCostComponents, standardCostForProduct, trackingModeForInput } from '../../domain/logic/costing';
import { productStockStatus, stockStatusForInput } from '../../domain/logic/stock-status';
import {
  aggregateProductionConsumptions, inputCorrectionDelta, normalizeProductionDraft,
  productionItems, productionQuantityDeltas, roundQuantity, scaleHistoricProductionItem,
} from '../../domain/logic/production-correction';
import { CollectionDefinition, FormatDefinition, FragranceDefinition, InputItem, Product } from '../../domain/models/catalog.model';
import { StockMovement } from '../../domain/models/inventory.model';
import {
  Production, ProductionCorrectionDraft, ProductionCorrectionHistory, ProductionCorrectionImpact,
  ProductionCorrectionPreview, ProductionItem,
} from '../../domain/models/production.model';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { ProductionCorrectionResult, StockChange } from './mutation-results';

type SnapshotMap = Map<string, DocumentSnapshot>;
type DraftContext = {
  original: Production;
  before: ProductionItem[];
  after: ProductionItem[];
  corrected: Production;
  impacts: ProductionCorrectionImpact[];
  stockChanges: StockChange[];
  changes: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }>;
  movementWrites: Array<{ itemType: 'product' | 'input'; itemId: string; delta: number; unitCostCents: number }>;
};

@Injectable({ providedIn: 'root' })
export class ProductionCorrectionRepository {
  private readonly db = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly revisions = inject(DataRevisionService);

  async history(productionId: string): Promise<ProductionCorrectionHistory[]> {
    const snapshot = await getDocs(query(collection(this.db, 'productionCorrections'), where('productionId', '==', productionId)));
    return snapshot.docs.map(row => ({ id: row.id, ...row.data() }) as ProductionCorrectionHistory)
      .sort((a, b) => Number((b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0)
        - Number((a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0));
  }

  preview(productionId: string, draft: ProductionCorrectionDraft): Promise<ProductionCorrectionPreview> {
    return this.execute(productionId, draft, false) as Promise<ProductionCorrectionPreview>;
  }

  apply(productionId: string, draft: ProductionCorrectionDraft): Promise<ProductionCorrectionResult> {
    return this.execute(productionId, draft, true) as Promise<ProductionCorrectionResult>;
  }

  private async execute(productionId: string, draft: ProductionCorrectionDraft, persist: boolean):
    Promise<ProductionCorrectionPreview | ProductionCorrectionResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.businessDate) || !Number.isFinite(Date.parse(draft.businessDate + 'T12:00:00')))
      throw new Error('Data de produção inválida.');
    if (!Number.isInteger(draft.expectedVersion) || draft.expectedVersion < 0) throw new Error('Versão de edição inválida.');
    const reason = draft.reason.trim().slice(0, 500);
    if (!reason) throw new Error('Informe o motivo da correção.');
    const notes = draft.notes.trim().slice(0, 1000);
    const lines = draft.cancel ? [] : normalizeProductionDraft(draft.lines);
    const productionRef = doc(this.db, 'productions', productionId);

    // Firestore single-field index is sufficient; query outside the transaction and
    // guard against concurrent corrections through the production revision.
    const pastMovements = await getDocs(query(collection(this.db, 'stockMovements'), where('sourceId', '==', productionId)));
    const poolDocs = await getDocs(query(collection(this.db, 'inputs'),
      where('costPool', 'in', ['base', 'surfactant', 'fragrance-classic', 'fragrance-premium', 'colorant'])));
    const poolIds = new Set(poolDocs.docs.map(item => item.id));
    return runTransaction(this.db, async tx => {
      const prodSnap = await tx.get(productionRef);
      if (!prodSnap.exists()) throw new Error('Lançamento não encontrado.');
      const original = { id: prodSnap.id, ...prodSnap.data() } as Production;
      if (original.status === 'cancelled') throw new Error('Uma produção cancelada não pode ser editada.');
      if ((original.correctionVersion ?? 0) !== draft.expectedVersion)
        throw new Error('Esta produção foi modificada em outra sessão. Reabra os detalhes antes de corrigir.');

      const before = productionItems(original);
      const oldById = new Map(before.map(item => [item.productId, item]));
      const allProductIds = new Set([...before.map(item => item.productId), ...lines.map(line => line.productId)]);
      const productSnapshots = await this.readMap(tx, 'products', allProductIds);
      const products = new Map<string, Product>();
      for (const [id, snap] of productSnapshots) {
        if (!snap.exists()) throw new Error('Produto do lançamento não encontrado. Contate o suporte antes de corrigir.');
        products.set(id, { id, ...snap.data() } as Product);
      }

      const novel = [...products.values()].filter(p => lines.some(line => line.productId === p.id && !oldById.has(p.id)));
      const collections = await this.readMap(tx, 'collections', new Set(novel.map(x => x.collectionId)));
      const fragrances = await this.readMap(tx, 'fragrances', new Set(novel.map(x => x.fragranceId)));
      const formats = await this.readMap(tx, 'formats', new Set(novel.map(x => x.formatId)));
      const refFor = (product: Product) => ({
        collection: collections.get(product.collectionId)?.exists()
          ? ({ id: product.collectionId, ...collections.get(product.collectionId)!.data() } as CollectionDefinition) : undefined,
        fragrance: fragrances.get(product.fragranceId)?.exists()
          ? ({ id: product.fragranceId, ...fragrances.get(product.fragranceId)!.data() } as FragranceDefinition) : undefined,
        format: formats.get(product.formatId)?.exists()
          ? ({ id: product.formatId, ...formats.get(product.formatId)!.data() } as FormatDefinition) : undefined,
      });
      const inputIds = new Set([...original.consumptions.map(x => x.inputId), ...poolIds]);
      for (const item of before) for (const c of item.consumptions) inputIds.add(c.inputId);
      for (const product of novel) for (const c of productCostComponents(product, refFor(product))) inputIds.add(c.inputId);
      const inputSnapshots = await this.readMap(tx, 'inputs', inputIds);
      const inputs = new Map<string, InputItem>();
      for (const [id, snap] of inputSnapshots) {
        if (!snap.exists()) throw new Error('Insumo histórico não encontrado. Contate o suporte antes de corrigir.');
        inputs.set(id, { id, ...snap.data() } as InputItem);
      }

      const movementSnapshots = await Promise.all(pastMovements.docs.map(x => tx.get(x.ref)));
      const recordedDebits = new Map<string, number>();
      for (const snap of movementSnapshots) {
        if (!snap.exists()) throw new Error('Uma movimentação de estoque foi removida. Atualize a tela.');
        const movement = snap.data() as StockMovement;
        if (movement.sourceType !== 'production' || movement.sourceId !== productionId || movement.itemType !== 'input') continue;
        recordedDebits.set(movement.itemId, roundQuantity((recordedDebits.get(movement.itemId) ?? 0) - movement.quantityDelta));
      }

      const after: ProductionItem[] = [];
      for (const line of lines) {
        const previous = oldById.get(line.productId);
        if (previous) {
          after.push(scaleHistoricProductionItem(previous, line.quantity));
          continue;
        }
        const product = products.get(line.productId)!;
        if (!product.active) throw new Error('Não é possível adicionar um produto inativo.');
        const cost = standardCostForProduct(product, refFor(product), inputs);
        after.push({
          productId: product.id, productName: product.displayName, quantity: line.quantity,
          unitCostCents: cost.unitCostCents,
          totalCostCents: Math.round((cost.model === 'simplified'
            ? cost.unitCostCents * 10 : (product.unitCostDeciCents ?? cost.unitCostCents * 10)) * line.quantity / 10),
          costPending: cost.costPending,
          costingModel: cost.model,
          ...(cost.estimateLines ? { estimatedCosts: cost.estimateLines } : {}),
          ...(cost.missingReferences?.length ? { missingCostReferences: cost.missingReferences } : {}),
          consumptions: cost.components.map(c => ({
            inputId: c.inputId, unitId: c.unitId, quantity: roundQuantity(c.quantity * line.quantity),
            unitCostCents: c.unitCostCents, totalCostCents: c.totalCostCents * line.quantity,
          })),
        });
      }
      const beforeConsumption = aggregateProductionConsumptions(before);
      const afterConsumption = aggregateProductionConsumptions(after);
      const nextRequired = new Map(afterConsumption.map(c => [c.inputId, c.quantity]));
      const oldRequired = new Map(beforeConsumption.map(c => [c.inputId, c.quantity]));
      const impacts: ProductionCorrectionImpact[] = [];
      const stockChanges: StockChange[] = [];
      const changes: DraftContext['changes'] = [];
      const movementWrites: DraftContext['movementWrites'] = [];

      for (const { itemId, quantityDelta } of productionQuantityDeltas(before, after)) {
        const product = products.get(itemId)!;
        const stock = product.stock + quantityDelta;
        const committed = product.committedStock ?? 0;
        const reserved = product.reservedPhysicalStock ?? Math.min(product.stock, committed);
        if (stock < 0 || stock + 1e-6 < reserved)
          throw new Error('Não é possível reduzir ' + product.displayName + ': unidades já foram vendidas ou reservadas. Confira o estoque antes de corrigir.');
        const explicitCommitted = product.explicitCommittedStock ?? 0;
        const explicitAllocated = product.explicitAllocatedStock ?? 0;
        if (explicitCommitted > committed || explicitAllocated > reserved ||
            explicitAllocated > explicitCommitted)
          throw new Error('Reservas de encomendas inconsistentes: corrija antes de alterar a produção.');
        const legacyDemand = committed - explicitCommitted;
        const legacyReserved = reserved - explicitAllocated;
        const nextReserved = quantityDelta > 0
          ? Math.min(stock, reserved + Math.min(quantityDelta, Math.max(0, legacyDemand - legacyReserved))) : reserved;
        const item = after.find(x => x.productId === itemId);
        const cost = quantityDelta > 0 ? (item?.unitCostCents ?? product.averageUnitCostCents) : product.averageUnitCostCents;
        impacts.push({ itemType: 'product', itemId, name: product.displayName, quantityDelta, stockBefore: product.stock, stockAfter: stock, unitLabel: 'un.' });
        stockChanges.push({ itemType: 'product', itemId, stock, reservedPhysicalStock: nextReserved, averageUnitCostCents: cost });
        changes.push({ ref: productSnapshots.get(itemId)!.ref, data: {
          stock, reservedPhysicalStock: nextReserved, averageUnitCostCents: cost,
          stockStatus: productStockStatus(stock, product.minimumStock), updatedAt: serverTimestamp(), updatedBy: userId,
        } });
        movementWrites.push({ itemType: 'product', itemId, delta: quantityDelta, unitCostCents: cost });
      }

      for (const inputId of new Set([...oldRequired.keys(), ...nextRequired.keys()])) {
        const beforeRequired = oldRequired.get(inputId) ?? 0;
        const afterRequired = nextRequired.get(inputId) ?? 0;
        if (Math.abs(beforeRequired - afterRequired) < 1e-6) continue;
        const input = inputs.get(inputId)!;
        const mode = trackingModeForInput(input);
        const debited = Math.max(0, recordedDebits.get(inputId) ?? 0);
        if (mode === 'untracked') {
          // Historical debits are immutable audit evidence. No fictional physical
          // stock is restored for an ingredient whose tracking was retired.
          continue;
        }
        let delta: number;
        try {
          delta = inputCorrectionDelta(beforeRequired, afterRequired, debited, input.stock, mode === 'exact');
        } catch {
          throw new Error('Estoque insuficiente de ' + input.name + ' para corrigir a produção.');
        }
        if (Math.abs(delta) < 1e-6) continue;
        const stock = roundQuantity(input.stock + delta);
        impacts.push({ itemType: 'input', itemId: input.id, name: input.name, quantityDelta: delta, stockBefore: input.stock, stockAfter: stock, unitLabel: input.unitId });
        stockChanges.push({ itemType: 'input', itemId: inputId, stock });
        changes.push({ ref: inputSnapshots.get(inputId)!.ref, data: {
          stock, stockStatus: stockStatusForInput({ ...input, stock }), updatedAt: serverTimestamp(), updatedBy: userId,
        } });
        const previousCost = beforeConsumption.find(c => c.inputId === inputId)?.unitCostCents;
        movementWrites.push({ itemType: 'input', itemId: inputId, delta, unitCostCents: previousCost ?? input.averageUnitCostCents });
      }

      const cancelled = draft.cancel;
      const effective = cancelled ? before : after;
      const quantity = effective.reduce((sum, p) => sum + p.quantity, 0);
      const totalCostCents = effective.reduce((sum, p) => sum + p.totalCostCents, 0);
      const corrected: Production = {
        ...original,
        businessDate: draft.businessDate, notes: notes || undefined,
        status: cancelled ? 'cancelled' : 'active',
        correctionVersion: (original.correctionVersion ?? 0) + 1,
        productId: effective.length === 1 ? effective[0]!.productId : '',
        productName: effective.length === 1 ? effective[0]!.productName : 'Produção do dia',
        quantity, totalCostCents, unitCostCents: Math.round(totalCostCents / quantity),
        costPending: effective.some(x => x.costPending), items: effective,
        costingModel: effective.every(x => x.costingModel === 'simplified') ? 'simplified' : 'legacy',
        missingCostReferences: [...new Set(effective.flatMap(x => x.missingCostReferences ?? []))],
        consumptions: aggregateProductionConsumptions(effective),
      };
      if (!cancelled && !impacts.length && original.businessDate === draft.businessDate
          && (original.notes ?? '') === notes
          && JSON.stringify(before) === JSON.stringify(after)) throw new Error('Nenhuma alteração encontrada.');
      const costDeltaCents = cancelled ? -original.totalCostCents : totalCostCents - original.totalCostCents;
      if (!persist) return { productionId, expectedVersion: draft.expectedVersion, corrected, impacts, costDeltaCents };

      // No transaction writes until *all* snapshots and stock constraints have been read.
      for (const change of changes) tx.update(change.ref, change.data);
      for (const move of movementWrites) {
        const ref = doc(collection(this.db, 'stockMovements'));
        tx.set(ref, {
          itemType: move.itemType, itemId: move.itemId, quantityDelta: move.delta,
          unitCostCents: Math.max(0, Math.round(move.unitCostCents)),
          totalCostCents: Math.round(Math.abs(move.delta) * Math.max(0, move.unitCostCents)),
          sourceType: 'production', sourceId: productionId,
          businessDate: draft.businessDate, createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(), createdBy: userId, updatedBy: userId,
        });
      }
      tx.update(productionRef, {
        businessDate: corrected.businessDate, notes,
        status: corrected.status, correctionVersion: corrected.correctionVersion,
        productId: corrected.productId, productName: corrected.productName,
        quantity: corrected.quantity, unitCostCents: corrected.unitCostCents,
        totalCostCents: corrected.totalCostCents, costPending: corrected.costPending,
        costingModel: corrected.costingModel, missingCostReferences: corrected.missingCostReferences,
        items: corrected.items, consumptions: corrected.consumptions,
        updatedAt: serverTimestamp(), updatedBy: userId,
      });
      const logRef = doc(collection(this.db, 'productionCorrections'));
      tx.set(logRef, {
        productionId, kind: cancelled ? 'cancellation' : 'correction',
        businessDate: draft.businessDate, reason,
        before: { businessDate: original.businessDate, items: before, notes: original.notes ?? '' },
        after: { businessDate: corrected.businessDate, items: after, notes },
        impacts, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        createdBy: userId, updatedBy: userId,
      });
      this.revisions.touchTransaction(tx, 'production', 'inventory');
      return { production: corrected, impacts, stockChanges };
    });
  }

  private async readMap(tx: Transaction, collectionName: string, ids: Set<string>): Promise<SnapshotMap> {
    const snapshots = await Promise.all([...ids].map(id => tx.get(doc(this.db, collectionName, id))));
    return new Map(snapshots.map(x => [x.id, x]));
  }
}
