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
import { Production, ProductionConsumption } from '../../domain/models/production.model';
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

  async create(productId: string, quantity: number, businessDate: string, notes?: string): Promise<ProductionCreateResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!productId) throw new Error('Selecione o produto.');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Informe uma quantidade válida.');

    return runTransaction(this.firestore, async (transaction) => {
      const productRef = doc(this.firestore, 'products', productId);
      const counterRef = doc(this.firestore, 'counters', 'production');
      const productSnapshot = await transaction.get(productRef);
      const counterSnapshot = await transaction.get(counterRef);
      if (!productSnapshot.exists()) throw new Error('Produto não encontrado.');
      const product = { id: productSnapshot.id, ...productSnapshot.data() } as Product;
      if (!product.active) throw new Error('O produto está inativo.');

      const [collectionSnapshot, fragranceSnapshot, formatSnapshot] = await Promise.all([
        transaction.get(doc(this.firestore, 'collections', product.collectionId)),
        transaction.get(doc(this.firestore, 'fragrances', product.fragranceId)),
        transaction.get(doc(this.firestore, 'formats', product.formatId)),
      ]);
      const references = {
        collection: collectionSnapshot.exists() ? ({ id: collectionSnapshot.id, ...collectionSnapshot.data() } as CollectionDefinition) : undefined,
        fragrance: fragranceSnapshot.exists() ? ({ id: fragranceSnapshot.id, ...fragranceSnapshot.data() } as FragranceDefinition) : undefined,
        format: formatSnapshot.exists() ? ({ id: formatSnapshot.id, ...formatSnapshot.data() } as FormatDefinition) : undefined,
      };

      const definitions = productCostComponents(product, references);
      const inputSnapshots = new Map<string, DocumentSnapshot>();
      for (const inputId of new Set(definitions.map((component) => component.inputId))) {
        inputSnapshots.set(inputId, await transaction.get(doc(this.firestore, 'inputs', inputId)));
      }
      const inputs = new Map<string, InputItem>();
      for (const [inputId, snapshot] of inputSnapshots) {
        if (!snapshot.exists()) throw new Error('A composição de custo contém um insumo inválido.');
        inputs.set(inputId, { id: snapshot.id, ...snapshot.data() } as InputItem);
      }

      const standardCost = standardCostForProduct(product, references, inputs);
      const consumptions: ProductionConsumption[] = standardCost.components.map((component) => ({
        inputId: component.inputId,
        quantity: component.quantity * quantity,
        unitId: component.unitId,
        unitCostCents: component.unitCostCents,
        totalCostCents: component.totalCostCents * quantity,
      }));
      for (const consumption of consumptions) {
        const input = inputs.get(consumption.inputId);
        if (!input || trackingModeForInput(input) !== 'exact') continue;
        if (input.stock < consumption.quantity) throw new Error(`Estoque insuficiente de ${input.name}.`);
      }

      const sequence = Number(counterSnapshot.data()?.['value'] ?? 0) + 1;
      const productionRef = doc(collection(this.firestore, 'productions'));
      const unitCostCents = standardCost.unitCostCents;
      const totalCostCents = Math.round(unitCostCents * quantity);
      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });

      const stockChanges: ProductionCreateResult['stockChanges'] = [];
      for (const consumption of consumptions) {
        const snapshot = inputSnapshots.get(consumption.inputId);
        const input = inputs.get(consumption.inputId);
        if (!snapshot?.exists() || !input || trackingModeForInput(input) !== 'exact') continue;
        const stock = input.stock - consumption.quantity;
        transaction.update(snapshot.ref, {
          stock,
          stockStatus: stockStatusForInput({ ...input, stock }),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
        stockChanges.push({ itemType: 'input', itemId: input.id, stock });
        const movementRef = doc(collection(this.firestore, 'stockMovements'));
        transaction.set(movementRef, {
          itemType: 'input',
          itemId: input.id,
          quantityDelta: -consumption.quantity,
          unitCostCents: consumption.unitCostCents,
          totalCostCents: consumption.totalCostCents,
          sourceType: 'production',
          sourceId: productionRef.id,
          businessDate,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: userId,
          updatedBy: userId,
        } satisfies Omit<StockMovement, 'id'>);
      }

      const productStock = product.stock + quantity;
      transaction.update(productRef, {
        stock: productStock,
        stockStatus: productStockStatus(productStock, product.minimumStock),
        averageUnitCostCents: unitCostCents,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
      stockChanges.push({ itemType: 'product', itemId: product.id, stock: productStock, averageUnitCostCents: unitCostCents });

      const productMovementRef = doc(collection(this.firestore, 'stockMovements'));
      transaction.set(productMovementRef, {
        itemType: 'product',
        itemId: product.id,
        quantityDelta: quantity,
        unitCostCents,
        totalCostCents,
        sourceType: 'production',
        sourceId: productionRef.id,
        businessDate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<StockMovement, 'id'>);

      const production: Production = {
        id: productionRef.id,
        code: entityCode('PR', sequence, 5),
        businessDate,
        productId: product.id,
        productName: product.displayName,
        quantity,
        unitCostCents,
        totalCostCents,
        costPending: standardCost.costPending,
        consumptions,
        notes: notes?.trim() || undefined,
      };
      transaction.set(productionRef, {
        code: production.code,
        businessDate,
        productId: product.id,
        productName: product.displayName,
        quantity,
        unitCostCents,
        totalCostCents,
        costPending: production.costPending,
        consumptions,
        notes: production.notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<Production, 'id'>);

      this.revisions.touchTransaction(transaction, 'production', 'inventory');
      return { production, stockChanges };
    });
  }
}
