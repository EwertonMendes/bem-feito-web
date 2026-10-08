import { inject, Injectable } from '@angular/core';
import {
  collection,
  doc,
  documentId,
  DocumentSnapshot,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
} from 'firebase/firestore';
import { productCostComponents, standardCostForProduct, trackingModeForInput } from '../../domain/logic/costing';
import { productStockStatus, stockStatusForInput } from '../../domain/logic/stock-status';
import { CollectionDefinition, FormatDefinition, FragranceDefinition, InputItem, Product } from '../../domain/models/catalog.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { Production, ProductionConsumption, ProductionDraftItem, ProductionItem } from '../../domain/models/production.model';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { entityCode } from '../utils/ids';
import { ProductionCreateResult } from './mutation-results';
import { BusinessDateCursor, PageResult } from './pagination';

@Injectable({ providedIn: 'root' })
export class ProductionRepository {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly revisions = inject(DataRevisionService);

  async page(pageSize = 40, cursor?: BusinessDateCursor | null): Promise<PageResult<Production>> {
    const constraints = [
      orderBy('businessDate', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(cursor ? [startAfter(cursor.businessDate, cursor.id)] : []),
      limit(pageSize + 1),
    ];
    const snapshot = await getDocs(query(collection(this.firestore, 'productions'), ...constraints));
    const hasMore = snapshot.docs.length > pageSize;
    const docs = snapshot.docs.slice(0, pageSize);
    const items = docs.map((item) => ({ id: item.id, ...item.data() }) as Production);
    const last = items.at(-1);
    return { items, hasMore, nextCursor: hasMore && last ? { businessDate: last.businessDate, id: last.id } : null };
  }


  /**
   * One atomic transaction per submission, regardless of the number of products.
   * Deduplicates reads and updates by entity ID to minimize Firestore operations.
   */
  async createBatch(lines: readonly ProductionDraftItem[], businessDate: string, notes?: string): Promise<ProductionCreateResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(businessDate)) throw new Error('Data de produção inválida.');
    if (!lines.length || lines.length > 60) throw new Error('Informe de 1 a 60 produtos por lançamento.');
    const quantities = new Map<string, number>();
    for (const line of lines) {
      if (!line.productId || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
        throw new Error('Selecione o produto e informe uma quantidade inteira positiva.');
      }
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
    }

    return runTransaction(this.firestore, async (transaction) => {
      const counterRef = doc(this.firestore, 'counters', 'production');
      const counterSnapshot = await transaction.get(counterRef);
      const productRefs = [...quantities.keys()].map((id) => doc(this.firestore, 'products', id));
      const productSnapshots = await Promise.all(productRefs.map((ref) => transaction.get(ref)));
      const products = new Map<string, Product>();
      for (const snapshot of productSnapshots) {
        if (!snapshot.exists()) throw new Error('Produto não encontrado.');
        const product = { id: snapshot.id, ...snapshot.data() } as Product;
        if (!product.active) throw new Error('O produto está inativo.');
        products.set(product.id, product);
      }

      const collectionIds = new Set([...products.values()].map((item) => item.collectionId));
      const fragranceIds = new Set([...products.values()].map((item) => item.fragranceId));
      const formatIds = new Set([...products.values()].map((item) => item.formatId));
      const readMap = async (name: string, ids: Set<string>) => {
        const result = new Map<string, DocumentSnapshot>();
        const snapshots = await Promise.all([...ids].map((id) => transaction.get(doc(this.firestore, name, id))));
        for (const snapshot of snapshots) result.set(snapshot.id, snapshot);
        return result;
      };
      const collections = await readMap('collections', collectionIds);
      const fragrances = await readMap('fragrances', fragranceIds);
      const formats = await readMap('formats', formatIds);
      const referenceFor = (product: Product) => ({
        collection: collections.get(product.collectionId)?.exists()
          ? ({ id: product.collectionId, ...collections.get(product.collectionId)!.data() } as CollectionDefinition) : undefined,
        fragrance: fragrances.get(product.fragranceId)?.exists()
          ? ({ id: product.fragranceId, ...fragrances.get(product.fragranceId)!.data() } as FragranceDefinition) : undefined,
        format: formats.get(product.formatId)?.exists()
          ? ({ id: product.formatId, ...formats.get(product.formatId)!.data() } as FormatDefinition) : undefined,
      });
      const inputIds = new Set<string>();
      for (const product of products.values()) {
        for (const component of productCostComponents(product, referenceFor(product))) inputIds.add(component.inputId);
      }
      const inputSnapshots = await readMap('inputs', inputIds);
      const inputs = new Map<string, InputItem>();
      for (const [id, snapshot] of inputSnapshots) {
        if (!snapshot.exists()) throw new Error('A composição contém um insumo inválido.');
        inputs.set(id, { id, ...snapshot.data() } as InputItem);
      }

      const items: ProductionItem[] = [];
      const consumptionByInput = new Map<string, ProductionConsumption>();
      let totalCostCents = 0;
      let costPending = false;
      let totalQuantity = 0;
      for (const [productId, quantity] of quantities) {
        const product = products.get(productId)!;
        const cost = standardCostForProduct(product, referenceFor(product), inputs);
        const consumptions = cost.components.map((component) => ({
          inputId: component.inputId,
          unitId: component.unitId,
          quantity: component.quantity * quantity,
          unitCostCents: component.unitCostCents,
          totalCostCents: component.totalCostCents * quantity,
        }));
        for (const consumption of consumptions) {
          const previous = consumptionByInput.get(consumption.inputId);
          if (previous) {
            if (previous.unitId !== consumption.unitId) throw new Error('Unidades incompatíveis para o mesmo insumo.');
            previous.quantity += consumption.quantity;
            previous.totalCostCents += consumption.totalCostCents;
          } else consumptionByInput.set(consumption.inputId, { ...consumption });
        }
        const itemCost = cost.unitCostCents * quantity;
        items.push({
          productId, productName: product.displayName, quantity,
          unitCostCents: cost.unitCostCents, totalCostCents: itemCost,
          costPending: cost.costPending, consumptions,
        });
        totalCostCents += itemCost;
        totalQuantity += quantity;
        costPending ||= cost.costPending;
      }

      for (const consumption of consumptionByInput.values()) {
        const input = inputs.get(consumption.inputId)!;
        if (trackingModeForInput(input) === 'exact' && input.stock < consumption.quantity) {
          throw new Error('Estoque insuficiente de ' + input.name + '.');
        }
      }

      // All reads completed. Write one balance update and one stock movement per affected entity.
      const sequence = Number(counterSnapshot.data()?.['value'] ?? 0) + 1;
      const productionRef = doc(collection(this.firestore, 'productions'));
      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });
      const stockChanges: ProductionCreateResult['stockChanges'] = [];
      const movement = (itemType: 'product' | 'input', itemId: string, delta: number, unitCostCents: number) => {
        const ref = doc(collection(this.firestore, 'stockMovements'));
        transaction.set(ref, {
          itemType, itemId, quantityDelta: delta, unitCostCents,
          totalCostCents: Math.round(Math.abs(delta) * unitCostCents),
          sourceType: 'production', sourceId: productionRef.id, businessDate,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          createdBy: userId, updatedBy: userId,
        } satisfies Omit<StockMovement, 'id'>);
      };

      for (const consumption of consumptionByInput.values()) {
        const input = inputs.get(consumption.inputId)!;
        const mode = trackingModeForInput(input);
        if (mode === 'untracked') continue;
        const applied = mode === 'exact'
          ? consumption.quantity
          : Math.min(Math.max(0, input.stock), consumption.quantity);
        if (applied <= 0) continue;
        const stock = Math.max(0, input.stock - applied);
        transaction.update(inputSnapshots.get(input.id)!.ref, {
          stock, stockStatus: stockStatusForInput({ ...input, stock }),
          updatedAt: serverTimestamp(), updatedBy: userId,
        });
        stockChanges.push({ itemType: 'input', itemId: input.id, stock });
        movement('input', input.id, -applied, consumption.unitCostCents);
      }

      for (const item of items) {
        const product = products.get(item.productId)!;
        const stock = product.stock + item.quantity;
        transaction.update(doc(this.firestore, 'products', item.productId), {
          stock, stockStatus: productStockStatus(stock, product.minimumStock),
          averageUnitCostCents: item.unitCostCents,
          updatedAt: serverTimestamp(), updatedBy: userId,
        });
        stockChanges.push({ itemType: 'product', itemId: item.productId, stock, averageUnitCostCents: item.unitCostCents });
        movement('product', item.productId, item.quantity, item.unitCostCents);
      }

      const first = items[0]!;
      const production: Production = {
        id: productionRef.id, code: entityCode('PR', sequence, 5), businessDate,
        productId: items.length === 1 ? first.productId : '',
        productName: items.length === 1 ? first.productName : 'Produção do dia',
        quantity: totalQuantity,
        unitCostCents: Math.round(totalCostCents / totalQuantity),
        totalCostCents, costPending, consumptions: [...consumptionByInput.values()],
        items, notes: notes?.trim() || undefined,
      };
      const { id: _id, ...data } = production;
      transaction.set(productionRef, {
        ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        createdBy: userId, updatedBy: userId,
      } satisfies Omit<Production, 'id'>);
      this.revisions.touchTransaction(transaction, 'production', 'inventory');
      return { production, stockChanges };
    });
  }

  /** Preserves the previous public API for integrations and existing tests. */
  create(productId: string, quantity: number, businessDate: string, notes?: string): Promise<ProductionCreateResult> {
    return this.createBatch([{ productId, quantity }], businessDate, notes);
  }
}
