import { Injectable, inject } from '@angular/core';
import { collection, doc, orderBy, serverTimestamp, writeBatch } from 'firebase/firestore';
import { FIREBASE_AUTH } from '../firebase/firebase.providers';
import { DataRevisionService } from '../firebase/data-revision.service';
import { catalogEntityCode } from '../utils/ids';
import { stockStatusForProduct } from '../../domain/logic/stock-status';
import {
  Addition, CollectionDefinition, FormatDefinition, FormatPrice, FragranceDefinition,
  InputItem, Kit, Product, UnitDefinition,
} from '../../domain/models/catalog.model';
import { FirestoreRepository } from '../firebase/firestore.repository';

@Injectable({ providedIn: 'root' })
export class ProductRepository extends FirestoreRepository<Product> {
  private readonly authForBatch = inject(FIREBASE_AUTH);
  private readonly revisionsForBatch = inject(DataRevisionService);

  constructor() { super('products', 'catalog'); }
  all(): Promise<Product[]> { return this.list([orderBy('displayName')]); }

  /** Saves new variants with a single batch and just one cross-session revision stamp. */
  async createMany(products: readonly Product[]): Promise<Product[]> {
    const actor = this.authForBatch.currentUser?.uid;
    if (!actor) throw new Error('Sessão inválida.');
    if (!products.length || products.length > 30 || products.some(product => product.id)) {
      throw new Error('Informe de 1 a 30 novos produtos para cadastro em lote.');
    }
    const seen = new Set<string>();
    const batch = writeBatch(this.firestore);
    const created: Product[] = [];
    for (const product of products) {
      const uniqueKey = [product.collectionId,product.fragranceId,product.formatId].join(':');
      if (seen.has(uniqueKey)) throw new Error('Há produtos repetidos no lote.');
      seen.add(uniqueKey);
      const target = doc(collection(this.firestore, 'products'));
      const saved: Product = {
        ...product, id: target.id, code: catalogEntityCode('PROD', target.id),
        stockStatus: stockStatusForProduct(product),
      };
      const { id: _id, ...data } = saved;
      batch.set(target, {
        ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        createdBy: actor, updatedBy: actor,
      });
      created.push(saved);
    }
    this.revisionsForBatch.touchBatch(batch, 'catalog');
    await batch.commit();
    return created;
  }
}

@Injectable({ providedIn: 'root' })
export class InputRepository extends FirestoreRepository<InputItem> {
  constructor() { super('inputs', 'catalog'); }
  all(): Promise<InputItem[]> { return this.list([orderBy('name')]); }
}

@Injectable({ providedIn: 'root' })
export class KitRepository extends FirestoreRepository<Kit> {
  constructor() { super('kits', 'catalog'); }
  all(): Promise<Kit[]> { return this.list([orderBy('name')]); }
}

@Injectable({ providedIn: 'root' })
export class AdditionRepository extends FirestoreRepository<Addition> {
  constructor() { super('additions', 'catalog'); }
  all(): Promise<Addition[]> { return this.list([orderBy('name')]); }
}

@Injectable({ providedIn: 'root' })
export class CollectionRepository extends FirestoreRepository<CollectionDefinition> {
  constructor() { super('collections', 'references'); }
}

@Injectable({ providedIn: 'root' })
export class FragranceRepository extends FirestoreRepository<FragranceDefinition> {
  constructor() { super('fragrances', 'references'); }
}

@Injectable({ providedIn: 'root' })
export class FormatRepository extends FirestoreRepository<FormatDefinition> {
  constructor() { super('formats', 'references'); }
}

@Injectable({ providedIn: 'root' })
export class FormatPriceRepository extends FirestoreRepository<FormatPrice> {
  constructor() { super('formatPrices', 'references'); }
}

@Injectable({ providedIn: 'root' })
export class UnitRepository extends FirestoreRepository<UnitDefinition> {
  constructor() { super('units', 'references'); }
}
