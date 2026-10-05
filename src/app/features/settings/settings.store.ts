import { inject, Injectable, signal } from '@angular/core';
import { ExpenseCategory, ExpenseType, PaymentMethod } from '../../domain/models/catalog.model';
import { ExpenseCategoryRepository, ExpenseTypeRepository, PaymentMethodRepository } from '../../core/repositories/settings.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly paymentMethodRepository = inject(PaymentMethodRepository);
  private readonly expenseCategoryRepository = inject(ExpenseCategoryRepository);
  private readonly expenseTypeRepository = inject(ExpenseTypeRepository);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);

  private readonly paymentMethodsState = signal<PaymentMethod[]>([]);
  private readonly expenseCategoriesState = signal<ExpenseCategory[]>([]);
  private readonly expenseTypesState = signal<ExpenseType[]>([]);
  private loaded = false;

  readonly paymentMethods = this.paymentMethodsState.asReadonly();
  readonly expenseCategories = this.expenseCategoriesState.asReadonly();
  readonly expenseTypes = this.expenseTypesState.asReadonly();

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    try {
      const [paymentMethods, expenseCategories, expenseTypes] = await Promise.all([
        this.paymentMethodRepository.list(),
        this.expenseCategoryRepository.list(),
        this.expenseTypeRepository.list(),
      ]);
      this.paymentMethodsState.set(paymentMethods);
      this.expenseCategoriesState.set(expenseCategories);
      this.expenseTypesState.set(expenseTypes);
      this.loaded = true;
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  async savePaymentMethod(item: PaymentMethod): Promise<void> {
    if (item.id) await this.paymentMethodRepository.replace(item);
    else await this.paymentMethodRepository.create(this.withoutId(item));
    await this.load(true);
  }

  async saveExpenseCategory(item: ExpenseCategory): Promise<void> {
    if (item.id) await this.expenseCategoryRepository.replace(item);
    else await this.expenseCategoryRepository.create(this.withoutId(item));
    await this.load(true);
  }

  async saveExpenseType(item: ExpenseType): Promise<void> {
    if (item.id) await this.expenseTypeRepository.replace(item);
    else await this.expenseTypeRepository.create(this.withoutId(item));
    await this.load(true);
  }

  private withoutId<T extends { id: string }>(value: T): Omit<T, 'id'> {
    const { id: _id, ...data } = value;
    return data;
  }
}
