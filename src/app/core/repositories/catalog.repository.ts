import { Injectable } from '@angular/core';
import { orderBy } from 'firebase/firestore';
import {
  Addition, CollectionDefinition, FormatDefinition, FormatPrice, FragranceDefinition,
  InputItem, Kit, Product, UnitDefinition,
} from '../../domain/models/catalog.model';
import { FirestoreRepository } from '../firebase/firestore.repository';

@Injectable({ providedIn: 'root' })
export class ProductRepository extends FirestoreRepository<Product> {
  constructor() { super('products'); }
  all(): Promise<Product[]> { return this.list([orderBy('displayName')]); }
}

@Injectable({ providedIn: 'root' })
export class InputRepository extends FirestoreRepository<InputItem> {
  constructor() { super('inputs'); }
  all(): Promise<InputItem[]> { return this.list([orderBy('name')]); }
}

@Injectable({ providedIn: 'root' })
export class KitRepository extends FirestoreRepository<Kit> {
  constructor() { super('kits'); }
  all(): Promise<Kit[]> { return this.list([orderBy('name')]); }
}

@Injectable({ providedIn: 'root' })
export class AdditionRepository extends FirestoreRepository<Addition> {
  constructor() { super('additions'); }
  all(): Promise<Addition[]> { return this.list([orderBy('name')]); }
}

@Injectable({ providedIn: 'root' })
export class CollectionRepository extends FirestoreRepository<CollectionDefinition> {
  constructor() { super('collections'); }
}

@Injectable({ providedIn: 'root' })
export class FragranceRepository extends FirestoreRepository<FragranceDefinition> {
  constructor() { super('fragrances'); }
}

@Injectable({ providedIn: 'root' })
export class FormatRepository extends FirestoreRepository<FormatDefinition> {
  constructor() { super('formats'); }
}

@Injectable({ providedIn: 'root' })
export class FormatPriceRepository extends FirestoreRepository<FormatPrice> {
  constructor() { super('formatPrices'); }
}

@Injectable({ providedIn: 'root' })
export class UnitRepository extends FirestoreRepository<UnitDefinition> {
  constructor() { super('units'); }
}
