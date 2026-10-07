import { inject, Injectable } from '@angular/core';
import {
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
} from 'firebase/firestore';
import { trackingModeForInput } from '../../domain/logic/costing';
import { productStockStatus, stockStatusForInput } from '../../domain/logic/stock-status';
import { InputItem, Product } from '../../domain/models/catalog.model';
import { StockAdjustment, StockMovement } from '../../domain/models/inventory.model';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { entityCode } from '../utils/ids';
import { StockAdjustmentResult } from './mutation-results';
import { BusinessDateCursor, PageResult } from './pagination';

@Injectable({ providedIn: 'root' })
export class InventoryRepository {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly revisions = inject(DataRevisionService);

  async movementPage(
    itemId: string,
    pageSize = 40,
    cursor?: BusinessDateCursor | null,
  ): Promise<PageResult<StockMovement>> {
    const constraints = [
      where('itemId', '==', itemId),
      orderBy('businessDate', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(cursor ? [startAfter(cursor.businessDate, cursor.id)] : []),
      limit(pageSize + 1),
    ];
    const snapshot = await getDocs(query(collection(this.firestore, 'stockMovements'), ...constraints));
    const hasMore = snapshot.docs.length > pageSize;
    const docs = snapshot.docs.slice(0, pageSize);
    const items = docs.map((item) => ({ id: item.id, ...item.data() }) as StockMovement);
    const last = items.at(-1);
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? { businessDate: last.businessDate, id: last.id } : null,
    };
  }

  async adjust(
    itemType: 'product' | 'input',
    itemId: string,
    quantityDelta: number,
    reason: string,
    businessDate: string,
  ): Promise<StockAdjustmentResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!Number.isFinite(quantityDelta) || quantityDelta === 0) throw new Error('Informe uma quantidade diferente de zero.');
    if (!reason.trim()) throw new Error('Informe o motivo do ajuste.');

    return runTransaction(this.firestore, async (transaction) => {
      const counterRef = doc(this.firestore, 'counters', 'stockAdjustment');
      const itemRef = doc(this.firestore, itemType === 'product' ? 'products' : 'inputs', itemId);
      const counterSnapshot = await transaction.get(counterRef);
      const itemSnapshot = await transaction.get(itemRef);
      if (!itemSnapshot.exists()) throw new Error('Item não encontrado.');

      const sequence = Number(counterSnapshot.data()?.['value'] ?? 0) + 1;
      const adjustmentRef = doc(collection(this.firestore, 'stockAdjustments'));
      const movementRef = doc(collection(this.firestore, 'stockMovements'));
      const currentStock = Number(itemSnapshot.data()['stock'] ?? 0);
      const stock = currentStock + quantityDelta;
      const unitCostCents = Number(itemSnapshot.data()['averageUnitCostCents'] ?? 0);
      const item = { id: itemSnapshot.id, ...itemSnapshot.data() } as Product | InputItem;
      if (itemType === 'input' && trackingModeForInput(item as InputItem) === 'untracked') {
        throw new Error('Este insumo não controla saldo. Altere o modo de estoque no Catálogo para ajustar quantidades.');
      }
      if (stock < 0) {
        const itemName = itemType === 'product' ? (item as Product).displayName : (item as InputItem).name;
        throw new Error(`Estoque insuficiente de ${itemName}. Ajuste o saldo disponível antes de registrar a saída.`);
      }
      const stockStatus = itemType === 'product'
        ? productStockStatus(stock, (item as Product).minimumStock)
        : stockStatusForInput({ ...(item as InputItem), stock });

      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });
      transaction.update(itemRef, {
        stock,
        stockStatus,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });

      const adjustment: StockAdjustment = {
        id: adjustmentRef.id,
        code: entityCode('AJ', sequence, 5),
        businessDate,
        itemType,
        itemId,
        quantityDelta,
        reason: reason.trim(),
      };

      transaction.set(adjustmentRef, {
        code: adjustment.code,
        businessDate,
        itemType,
        itemId,
        quantityDelta,
        reason: adjustment.reason,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<StockAdjustment, 'id'>);
      const movement: StockMovement = {
        id: movementRef.id,
        itemType,
        itemId,
        quantityDelta,
        unitCostCents,
        totalCostCents: Math.round(Math.abs(quantityDelta) * unitCostCents),
        sourceType: 'adjustment',
        sourceId: adjustmentRef.id,
        businessDate,
      };
      transaction.set(movementRef, {
        itemType: movement.itemType,
        itemId: movement.itemId,
        quantityDelta: movement.quantityDelta,
        unitCostCents: movement.unitCostCents,
        totalCostCents: movement.totalCostCents,
        sourceType: movement.sourceType,
        sourceId: movement.sourceId,
        businessDate: movement.businessDate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<StockMovement, 'id'>);

      this.revisions.touchTransaction(transaction, 'inventory');

      return {
        adjustment,
        movement,
        stockChange: { itemType, itemId, stock },
      };
    });
  }
}
