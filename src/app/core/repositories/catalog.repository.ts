import { Injectable } from '@angular/core';
import { orderBy } from 'firebase/firestore';
import {
  Addition, CollectionDefinition, FormatDefinition, FormatPrice, FragranceDefinition,
  InputItem, Kit, Product, UnitDefinition,
} from '../../domain/models/catalog.model';
import { FirestoreRepository } from '../firebase/firestore.repository';

@Injectable({ providedIn: 'root' })
export class ProductRepository extends FirestoreRepository<Product> {
  constructor() { super('products', 'catalog'); }
  all(): Promise<Product[]> { return this.list([orderBy('displayName')]); }
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
