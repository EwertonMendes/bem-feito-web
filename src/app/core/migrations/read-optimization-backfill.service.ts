import { Injectable, inject } from '@angular/core';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { SaleAnalytics, summarizeSaleItems } from '../../domain/logic/sale-analytics';
import { stockStatusForInput, stockStatusForProduct } from '../../domain/logic/stock-status';
import { InputItem, Product, StockStatus } from '../../domain/models/catalog.model';
import { Sale } from '../../domain/models/sales.model';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';

const READ_OPTIMIZATION_VERSION = 1;
const BATCH_SIZE = 400;

type PendingUpdateData = { stockStatus: StockStatus } | SaleAnalytics;

interface PendingUpdate {
  collectionName: 'products' | 'inputs' | 'sales';
  id: string;
  data: PendingUpdateData;
}

@Injectable({ providedIn: 'root' })
export class ReadOptimizationBackfillService {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly revisions = inject(DataRevisionService);
  private inFlight: Promise<void> | null = null;
  private completed = false;

  ensure(): Promise<void> {
    if (this.completed) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    const user = this.auth.user();
    if (!user || !this.auth.canOperate()) return;

    const markerRef = doc(this.firestore, 'system', 'read-optimization');
    const marker = await getDoc(markerRef);
    if (Number(marker.data()?.['version'] ?? 0) >= READ_OPTIMIZATION_VERSION) {
      this.completed = true;
      return;
    }

    const [productsSnapshot, inputsSnapshot, salesSnapshot] = await Promise.all([
      getDocs(collection(this.firestore, 'products')),
      getDocs(collection(this.firestore, 'inputs')),
      getDocs(collection(this.firestore, 'sales')),
    ]);

    const updates: PendingUpdate[] = [];

    for (const snapshot of productsSnapshot.docs) {
      const product = { id: snapshot.id, ...snapshot.data() } as Product;
      if (product.stockStatus) continue;
      updates.push({
        collectionName: 'products',
        id: product.id,
        data: { stockStatus: stockStatusForProduct(product) },
      });
    }

    for (const snapshot of inputsSnapshot.docs) {
      const input = { id: snapshot.id, ...snapshot.data() } as InputItem;
      if (input.stockStatus) continue;
      updates.push({
        collectionName: 'inputs',
        id: input.id,
        data: { stockStatus: stockStatusForInput(input) },
      });
    }

    for (const snapshot of salesSnapshot.docs) {
      const sale = { id: snapshot.id, ...snapshot.data() } as Sale;
      if (sale.analyticsVersion === 1) continue;
      updates.push({
        collectionName: 'sales',
        id: sale.id,
        data: summarizeSaleItems(sale.items),
      });
    }

    for (let offset = 0; offset < updates.length; offset += BATCH_SIZE) {
      const batch = writeBatch(this.firestore);
      for (const update of updates.slice(offset, offset + BATCH_SIZE)) {
        batch.update(doc(this.firestore, update.collectionName, update.id), {
          ...update.data,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });
      }
      await batch.commit();
    }

    const markerBatch = writeBatch(this.firestore);
    markerBatch.set(markerRef, {
      version: READ_OPTIMIZATION_VERSION,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    });
    this.revisions.touchBatch(markerBatch, 'catalog', 'sales');
    await markerBatch.commit();
    this.completed = true;
  }
}
