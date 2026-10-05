import { inject, Injectable } from '@angular/core';
import { collection, doc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { StockAdjustment, StockMovement } from '../../domain/models/inventory.model';
import { AuthService } from '../auth/auth.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { entityCode } from '../utils/ids';

@Injectable({ providedIn: 'root' })
export class InventoryRepository {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);

  async movementsFor(itemId: string, max = 100): Promise<StockMovement[]> {
    const snapshot = await getDocs(
      query(collection(this.firestore, 'stockMovements'), where('itemId', '==', itemId), orderBy('businessDate', 'desc'), limit(max))
    );
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as StockMovement);
  }

  async adjust(itemType: 'product' | 'input', itemId: string, quantityDelta: number, reason: string, businessDate: string): Promise<string> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!quantityDelta) throw new Error('Informe uma quantidade diferente de zero.');
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
      const unitCostCents = Number(itemSnapshot.data()['averageUnitCostCents'] ?? 0);

      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });
      transaction.update(itemRef, {
        stock: currentStock + quantityDelta,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
      transaction.set(adjustmentRef, {
        code: entityCode('AJ', sequence, 5),
        businessDate,
        itemType,
        itemId,
        quantityDelta,
        reason: reason.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<StockAdjustment, 'id'>);
      transaction.set(movementRef, {
        itemType,
        itemId,
        quantityDelta,
        unitCostCents,
        totalCostCents: Math.round(Math.abs(quantityDelta) * unitCostCents),
        sourceType: 'adjustment',
        sourceId: adjustmentRef.id,
        businessDate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<StockMovement, 'id'>);

      return adjustmentRef.id;
    });
  }
}
