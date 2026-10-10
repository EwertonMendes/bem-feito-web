import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { PurchaseBatchDraft, Expense, ExpenseDraft } from '../../domain/models/finance.model';
import { Payment } from '../../domain/models/sales.model';
import { DataRevisionService } from '../../core/firebase/data-revision.service';
import { FinanceRepository } from '../../core/repositories/finance.repository';
import { ExpenseCreateResult } from '../../core/repositories/mutation-results';
import { BusinessDateCursor, compareBusinessDateDesc } from '../../core/repositories/pagination';
import { SalesRepository } from '../../core/repositories/sales.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';
import { AsyncLoadGate } from '../../core/state/async-load-gate';

const PAGE_SIZE = 40;

@Injectable({ providedIn: 'root' })
export class FinanceStore {
  private readonly financeRepository = inject(FinanceRepository);
  private readonly salesRepository = inject(SalesRepository);
  private readonly revisions = inject(DataRevisionService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);

  private readonly expensesGate = new AsyncLoadGate();
  private readonly paymentsGate = new AsyncLoadGate();
  private readonly expenseSummaryGate = new AsyncLoadGate();
  private readonly paymentSummaryGate = new AsyncLoadGate();

  private readonly remoteExpenseRevision = this.revisions.revision('expenses');
  private readonly remotePaymentRevision = this.revisions.revision('payments');
  private readonly localExpenseRevision = this.revisions.localRevision('expenses');
  private readonly localPaymentRevision = this.revisions.localRevision('payments');

  private lastRemoteExpenseRevision = 0;
  private lastRemotePaymentRevision = 0;
  private lastLocalExpenseRevision = 0;
  private lastLocalPaymentRevision = 0;
  private activeConsumers = 0;
  private expenseCursor: BusinessDateCursor | null = null;
  private paymentCursor: BusinessDateCursor | null = null;

  private readonly expensesState = signal<Expense[]>([]);
  private readonly paymentsState = signal<Payment[]>([]);
  private readonly totalOutState = signal(0);
  private readonly paymentCountState = signal(0);
  private readonly expensesLoadingState = signal(false);
  private readonly expensesInitializedState = signal(false);
  private readonly paymentsLoadingState = signal(false);
  private readonly paymentsInitializedState = signal(false);
  private readonly expenseSummaryLoadingState = signal(false);
  private readonly expenseSummaryInitializedState = signal(false);
  private readonly paymentSummaryLoadingState = signal(false);
  private readonly paymentSummaryInitializedState = signal(false);
  private readonly expenseHasMoreState = signal(false);
  private readonly paymentHasMoreState = signal(false);
  private readonly operationErrorState = signal('');

  readonly expenses = this.expensesState.asReadonly();
  readonly payments = this.paymentsState.asReadonly();
  readonly totalOutCents = this.totalOutState.asReadonly();
  readonly paymentCount = this.paymentCountState.asReadonly();
  readonly expensesLoading = this.expensesLoadingState.asReadonly();
  readonly expensesInitialized = this.expensesInitializedState.asReadonly();
  readonly paymentsLoading = this.paymentsLoadingState.asReadonly();
  readonly paymentsInitialized = this.paymentsInitializedState.asReadonly();
  readonly summaryLoading = computed(() => this.expenseSummaryLoadingState() || this.paymentSummaryLoadingState());
  readonly summaryInitialized = computed(() => this.expenseSummaryInitializedState() && this.paymentSummaryInitializedState());
  readonly expenseHasMore = this.expenseHasMoreState.asReadonly();
  readonly paymentHasMore = this.paymentHasMoreState.asReadonly();
  readonly operationError = this.operationErrorState.asReadonly();

  constructor() {
    effect(() => {
      const revision = this.localExpenseRevision();
      if (revision === this.lastLocalExpenseRevision) return;
      this.lastLocalExpenseRevision = revision;
      if (this.activeConsumers === 0) this.invalidateExpenses();
    });

    effect(() => {
      const revision = this.localPaymentRevision();
      if (revision === this.lastLocalPaymentRevision) return;
      this.lastLocalPaymentRevision = revision;
      if (this.activeConsumers === 0) this.invalidatePayments();
    });

    effect(() => {
      const revision = this.remoteExpenseRevision();
      if (revision === this.lastRemoteExpenseRevision) return;
      this.lastRemoteExpenseRevision = revision;
      const refreshList = this.activeConsumers > 0 && this.expensesGate.isLoaded;
      const refreshSummary = this.activeConsumers > 0 && this.expenseSummaryGate.isLoaded;
      this.invalidateExpenses();
      if (refreshList) void this.loadExpenses();
      if (refreshSummary) void this.loadExpenseSummary();
    });

    effect(() => {
      const revision = this.remotePaymentRevision();
      if (revision === this.lastRemotePaymentRevision) return;
      this.lastRemotePaymentRevision = revision;
      const refreshList = this.activeConsumers > 0 && this.paymentsGate.isLoaded;
      const refreshSummary = this.activeConsumers > 0 && this.paymentSummaryGate.isLoaded;
      this.invalidatePayments();
      if (refreshList) void this.loadPayments();
      if (refreshSummary) void this.loadPaymentSummary();
    });
  }

  activate(): () => void {
    this.activeConsumers += 1;
    return () => { this.activeConsumers = Math.max(0, this.activeConsumers - 1); };
  }

  loadExpenses(force = false): Promise<void> {
    return this.expensesGate.run(async () => {
      this.expensesLoadingState.set(true);
      try {
        const page = await this.financeRepository.expensePage(PAGE_SIZE);
        this.expensesState.set(page.items);
        this.expenseCursor = page.nextCursor;
        this.expenseHasMoreState.set(page.hasMore);
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      } finally {
        this.expensesInitializedState.set(true);
        this.expensesLoadingState.set(false);
      }
    }, force).catch(() => undefined);
  }

  loadPayments(force = false): Promise<void> {
    return this.paymentsGate.run(async () => {
      this.paymentsLoadingState.set(true);
      try {
        const page = await this.salesRepository.paymentPage(PAGE_SIZE);
        this.paymentsState.set(page.items);
        this.paymentCursor = page.nextCursor;
        this.paymentHasMoreState.set(page.hasMore);
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      } finally {
        this.paymentsInitializedState.set(true);
        this.paymentsLoadingState.set(false);
      }
    }, force).catch(() => undefined);
  }

  loadSummary(force = false): Promise<void> {
    return Promise.all([
      this.loadExpenseSummary(force),
      this.loadPaymentSummary(force),
    ]).then(() => undefined);
  }

  async loadMoreExpenses(): Promise<void> {
    if (!this.expenseHasMoreState() || !this.expenseCursor) return;
    try {
      const page = await this.financeRepository.expensePage(PAGE_SIZE, this.expenseCursor);
      const known = new Set(this.expensesState().map((item) => item.id));
      this.expensesState.update((items) => [...items, ...page.items.filter((item) => !known.has(item.id))]);
      this.expenseCursor = page.nextCursor;
      this.expenseHasMoreState.set(page.hasMore);
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  async loadMorePayments(): Promise<void> {
    if (!this.paymentHasMoreState() || !this.paymentCursor) return;
    try {
      const page = await this.salesRepository.paymentPage(PAGE_SIZE, this.paymentCursor);
      const known = new Set(this.paymentsState().map((item) => item.id));
      this.paymentsState.update((items) => [...items, ...page.items.filter((item) => !known.has(item.id))]);
      this.paymentCursor = page.nextCursor;
      this.paymentHasMoreState.set(page.hasMore);
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  clearOperationError(): void {
    this.operationErrorState.set('');
  }

  async createExpense(draft: ExpenseDraft): Promise<ExpenseCreateResult | null> {
    this.operationErrorState.set('');
    try {
      const result = await this.financeRepository.createExpense(draft);
      if (this.expensesGate.isLoaded) {
        this.expensesState.update((items) =>
          [result.expense, ...items.filter((item) => item.id !== result.expense.id)]
            .sort(compareBusinessDateDesc)
        );
      }
      if (this.expenseSummaryGate.isLoaded) {
        this.totalOutState.update((value) => value + result.expense.amountCents);
      }
      this.toast.success(draft.kind === 'input-purchase'
        ? 'Compra registrada e estoque atualizado.'
        : 'Saída registrada com sucesso.');
      return result;
    } catch (error) {
      const message = this.errors.message(error);
      this.operationErrorState.set(message);
      this.toast.error(message);
      return null;
    }
  }


  async createPurchaseBatch(draft: PurchaseBatchDraft): Promise<ExpenseCreateResult | null> {
    this.operationErrorState.set('');
    try {
      const result = await this.financeRepository.createPurchaseBatch(draft);
      if (this.expensesGate.isLoaded) this.expensesState.update(items =>
        [result.expense, ...items.filter(item => item.id !== result.expense.id)].sort(compareBusinessDateDesc));
      if (this.expenseSummaryGate.isLoaded) this.totalOutState.update(value => value + result.expense.amountCents);
      this.toast.success(draft.receiptStatus === 'pending' ? 'Compra registrada aguardando entrega.' : 'Compra registrada com custos e estoque atualizados.');
      return result;
    } catch (error) {
      const message = this.errors.message(error);
      this.operationErrorState.set(message);
      this.toast.error(message);
      return null;
    }
  }

  async receivePurchase(expenseId: string): Promise<ExpenseCreateResult | null> {
    try {
      const result = await this.financeRepository.receivePurchase(expenseId);
      if (this.expensesGate.isLoaded) this.expensesState.update(items => items.map(item => item.id === expenseId ? result.expense : item));
      this.toast.success('Materiais recebidos e estoque atualizado.');
      return result;
    } catch (error) { this.toast.error(this.errors.message(error)); return null; }
  }

  applyPayments(payments: readonly Payment[]): void {
    if (!payments.length) return;
    if (this.paymentsGate.isLoaded) {
      const ids = new Set(payments.map((item) => item.id));
      this.paymentsState.update((items) =>
        [...payments, ...items.filter((item) => !ids.has(item.id))]
          .sort(compareBusinessDateDesc)
      );
    }
    if (this.paymentSummaryGate.isLoaded) {
      this.paymentCountState.update((value) => value + payments.length);
    }
  }

  applyPayment(payment: Payment): void {
    this.applyPayments([payment]);
  }

  applyPaymentReversal(payment: Payment): void {
    if (!this.paymentsGate.isLoaded) return;
    this.paymentsState.update((items) =>
      items.map((item) => item.id === payment.id ? payment : item)
    );
  }

  private loadExpenseSummary(force = false): Promise<void> {
    return this.expenseSummaryGate.run(async () => {
      this.expenseSummaryLoadingState.set(true);
      try {
        this.totalOutState.set(await this.financeRepository.totalExpensesCents());
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      } finally {
        this.expenseSummaryInitializedState.set(true);
        this.expenseSummaryLoadingState.set(false);
      }
    }, force).catch(() => undefined);
  }

  private loadPaymentSummary(force = false): Promise<void> {
    return this.paymentSummaryGate.run(async () => {
      this.paymentSummaryLoadingState.set(true);
      try {
        this.paymentCountState.set(await this.salesRepository.paymentCount());
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      } finally {
        this.paymentSummaryInitializedState.set(true);
        this.paymentSummaryLoadingState.set(false);
      }
    }, force).catch(() => undefined);
  }

  private invalidateExpenses(): void {
    this.expensesGate.invalidate();
    this.expenseSummaryGate.invalidate();
  }

  private invalidatePayments(): void {
    this.paymentsGate.invalidate();
    this.paymentSummaryGate.invalidate();
  }
}
