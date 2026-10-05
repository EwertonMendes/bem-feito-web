import { inject, Injectable } from '@angular/core';
import { collection, doc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp } from 'firebase/firestore';
import { InputItem, Product } from '../../domain/models/catalog.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { Production, ProductionConsumption } from '../../domain/models/production.model';
import { AuthService } from '../auth/auth.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { entityCode } from '../utils/ids';
import { aggregateRecipe } from '../utils/recipe';

@Injectable({ providedIn: 'root' })
export class ProductionRepository {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);

  async recent(max = 100): Promise<Production[]> {
    const snapshot = await getDocs(query(collection(this.firestore, 'productions'), orderBy('businessDate', 'desc'), limit(max)));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Production);
  }

  async create(productId: string, quantity: number, businessDate: string, notes?: string): Promise<string> {
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

      for (let index = 0; index < consumptions.length; index++) {
        const consumption = consumptions[index];
        const snapshot = inputSnapshots[index];
        if (!consumption || !snapshot?.exists()) continue;
        const input = { id: snapshot.id, ...snapshot.data() } as InputItem;

        transaction.update(snapshot.ref, {
          stock: input.stock - consumption.quantity,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });

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

      transaction.update(productRef, {
        stock: product.stock + quantity,
        averageUnitCostCents: newAverage,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
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

      transaction.set(productionRef, {
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<Production, 'id'>);

      return productionRef.id;
    });
  }
}
