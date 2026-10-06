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
} from 'firebase/firestore';
import { inputStockStatus, productStockStatus } from '../../domain/logic/stock-status';
import { InputItem, Product } from '../../domain/models/catalog.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { Production, ProductionConsumption } from '../../domain/models/production.model';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { entityCode } from '../utils/ids';
import { aggregateRecipe } from '../utils/recipe';
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
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? { businessDate: last.businessDate, id: last.id } : null,
    };
  }

  async create(
    productId: string,
    quantity: number,
    businessDate: string,
    notes?: string,
  ): Promise<ProductionCreateResult> {
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

      const recipe = aggregateRecipe(product.recipe);
      const inputSnapshots = [];
      for (const component of recipe) {
        inputSnapshots.push(await transaction.get(doc(this.firestore, 'inputs', component.inputId)));
      }

      const consumptions: ProductionConsumption[] = [];
      let totalCostCents = product.additionalCostCents * quantity;

      for (let index = 0; index < recipe.length; index++) {
        const component = recipe[index];
        const snapshot = inputSnapshots[index];
        if (!component || !snapshot?.exists()) throw new Error('A receita contém um insumo inválido.');
        const input = { id: snapshot.id, ...snapshot.data() } as InputItem;
        if (component.unitId !== input.unitId) throw new Error(`Unidade incompatível para ${input.name}.`);
        const consumedQuantity = component.quantity * quantity;
        if (input.stock < consumedQuantity) throw new Error(`Estoque insuficiente de ${input.name}.`);
        const componentCost = Math.round(consumedQuantity * input.averageUnitCostCents);
        totalCostCents += componentCost;
        consumptions.push({
          inputId: input.id,
          quantity: consumedQuantity,
          unitId: component.unitId,
          unitCostCents: input.averageUnitCostCents,
          totalCostCents: componentCost,
        });
      }

      totalCostCents = Math.round(totalCostCents);
      const sequence = Number(counterSnapshot.data()?.['value'] ?? 0) + 1;
      const productionRef = doc(collection(this.firestore, 'productions'));
      const unitCostCents = Math.round(totalCostCents / quantity);
      const currentPositiveStock = Math.max(0, product.stock);
      const denominator = currentPositiveStock + quantity;
      const newAverage = denominator > 0
        ? Math.round((currentPositiveStock * product.averageUnitCostCents + totalCostCents) / denominator)
        : unitCostCents;

      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });

      const stockChanges: ProductionCreateResult['stockChanges'] = [];
      for (let index = 0; index < consumptions.length; index++) {
        const consumption = consumptions[index];
        const snapshot = inputSnapshots[index];
        if (!consumption || !snapshot?.exists()) continue;
        const input = { id: snapshot.id, ...snapshot.data() } as InputItem;
        const stock = input.stock - consumption.quantity;

        transaction.update(snapshot.ref, {
          stock,
          stockStatus: inputStockStatus(stock, input.minimumStock, input.minimumStockConfigured !== false),
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
        averageUnitCostCents: newAverage,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
      stockChanges.push({
        itemType: 'product',
        itemId: product.id,
        stock: productStock,
        averageUnitCostCents: newAverage,
      });

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
        costPending: product.recipe.length === 0 || consumptions.some((item) => item.unitCostCents <= 0),
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

      this.revisions.touchTransaction(transaction, 'production', 'catalog', 'inventory');
      return { production, stockChanges };
    });
  }
}
