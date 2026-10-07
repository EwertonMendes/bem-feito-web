import { effect, inject, Injectable, signal } from '@angular/core';
import { ExpenseCategory, ExpenseType, PaymentMethod } from '../../domain/models/catalog.model';
import { ExpenseCategoryRepository, ExpenseTypeRepository, PaymentMethodRepository } from '../../core/repositories/settings.repository';
import { DataRevisionService } from '../../core/firebase/data-revision.service';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';
import { AsyncLoadGate } from '../../core/state/async-load-gate';

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly paymentMethodRepository = inject(PaymentMethodRepository);
  private readonly expenseCategoryRepository = inject(ExpenseCategoryRepository);
  private readonly expenseTypeRepository = inject(ExpenseTypeRepository);
  private readonly revisions = inject(DataRevisionService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly gate = new AsyncLoadGate();
  private readonly remoteRevision = this.revisions.revision('settings');
  private lastRemoteRevision = 0;
  private activeConsumers = 0;

  private readonly paymentMethodsState = signal<PaymentMethod[]>([]);
  private readonly expenseCategoriesState = signal<ExpenseCategory[]>([]);
  private readonly expenseTypesState = signal<ExpenseType[]>([]);
  private readonly loadingState = signal(false);
  private readonly initializedState = signal(false);

  readonly paymentMethods = this.paymentMethodsState.asReadonly();
  readonly expenseCategories = this.expenseCategoriesState.asReadonly();
  readonly expenseTypes = this.expenseTypesState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly initialized = this.initializedState.asReadonly();

  constructor() {
    effect(() => {
      const revision = this.remoteRevision();
      if (revision === this.lastRemoteRevision) return;
      this.lastRemoteRevision = revision;
      const refresh = this.activeConsumers > 0 && this.gate.isLoaded;
      this.gate.invalidate();
      if (refresh) void this.load();
    });
  }

  activate(): () => void {
    this.activeConsumers += 1;
    return () => { this.activeConsumers = Math.max(0, this.activeConsumers - 1); };
  }

  load(force = false): Promise<void> {
    return this.gate.run(async () => {
      this.loadingState.set(true);
      try {
        const [paymentMethods, expenseCategories, expenseTypes] = await Promise.all([
          this.paymentMethodRepository.list(),
          this.expenseCategoryRepository.list(),
          this.expenseTypeRepository.list(),
        ]);
        this.paymentMethodsState.set(paymentMethods);
        this.expenseCategoriesState.set(expenseCategories);
        this.expenseTypesState.set(expenseTypes);
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      } finally {
        this.initializedState.set(true);
        this.loadingState.set(false);
      }
    }, force).catch(() => undefined);
  }

  async savePaymentMethod(item: PaymentMethod): Promise<void> {
    await this.save(item, this.paymentMethodRepository, this.paymentMethodsState);
  }

  async saveExpenseCategory(item: ExpenseCategory): Promise<void> {
    await this.save(item, this.expenseCategoryRepository, this.expenseCategoriesState);
  }

  async saveExpenseType(item: ExpenseType): Promise<void> {
    await this.save(item, this.expenseTypeRepository, this.expenseTypesState);
  }

  private async save<T extends { id: string }>(
    item: T,
    repository: { create(value: Omit<T, 'id'>): Promise<string>; replace(value: T): Promise<void> },
    state: { update(updater: (items: T[]) => T[]): void },
  ): Promise<void> {
    const id = item.id || await repository.create(this.withoutId(item));
    if (item.id) await repository.replace(item);
    const saved = { ...item, id };
    state.update((items) => items.some((existing) => existing.id === id)
      ? items.map((existing) => existing.id === id ? saved : existing)
      : [...items, saved]);
  }

  private withoutId<T extends { id: string }>(value: T): Omit<T, 'id'> {
    const { id: _id, ...data } = value;
    return data;
  }
}
