import { Injectable } from '@angular/core';
import { ExpenseCategory, ExpenseType, PaymentMethod } from '../../domain/models/catalog.model';
import { FirestoreRepository } from '../firebase/firestore.repository';

@Injectable({ providedIn: 'root' })
export class PaymentMethodRepository extends FirestoreRepository<PaymentMethod> {
  constructor() { super('paymentMethods', 'settings'); }
}

@Injectable({ providedIn: 'root' })
export class ExpenseCategoryRepository extends FirestoreRepository<ExpenseCategory> {
  constructor() { super('expenseCategories', 'settings'); }
}

@Injectable({ providedIn: 'root' })
export class ExpenseTypeRepository extends FirestoreRepository<ExpenseType> {
  constructor() { super('expenseTypes', 'settings'); }
}
