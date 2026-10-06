import { effect, inject, Injectable, signal } from '@angular/core';
import { Expense, ExpenseDraft } from '../../domain/models/finance.model';
import { Payment } from '../../domain/models/sales.model';
import { DataRevisionService } from '../../core/firebase/data-revision.service';
import { FinanceRepository } from '../../core/repositories/finance.repository';
import { ExpenseCreateResult } from '../../core/repositories/mutation-results';
import { BusinessDateCursor } from '../../core/repositories/pagination';
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
  private readonly summaryGate = new AsyncLoadGate();
  private readonly remoteRevision = this.revisions.revision('finance');
  private lastRemoteRevision = 0;
  private activeConsumers = 0;
  private expenseCursor: BusinessDateCursor | null = null;
  private paymentCursor: BusinessDateCursor | null = null;

  private readonly expensesState = signal<Expense[]>([]);
  private readonly paymentsState = signal<Payment[]>([]);
  private readonly totalOutState = signal(0);
  private readonly paymentCountState = signal(0);
  private readonly expensesLoadingState = signal(false);
  private readonly paymentsLoadingState = signal(false);
  private readonly expenseHasMoreState = signal(false);
  private readonly paymentHasMoreState = signal(false);

  readonly expenses = this.expensesState.asReadonly();
  readonly payments = this.paymentsState.asReadonly();
  readonly totalOutCents = this.totalOutState.asReadonly();
  readonly paymentCount = this.paymentCountState.asReadonly();
  readonly expensesLoading = this.expensesLoadingState.asReadonly();
  readonly paymentsLoading = this.paymentsLoadingState.asReadonly();
  readonly expenseHasMore = this.expenseHasMoreState.asReadonly();
  readonly paymentHasMore = this.paymentHasMoreState.asReadonly();

  constructor() {
    effect(() => {
      const revision = this.remoteRevision();
      if (revision === this.lastRemoteRevision) return;
      this.lastRemoteRevision = revision;
      const refreshExpenses = this.activeConsumers > 0 && this.expensesGate.isLoaded;
      const refreshPayments = this.activeConsumers > 0 && this.paymentsGate.isLoaded;
      const refreshSummary = this.activeConsumers > 0 && this.summaryGate.isLoaded;
      this.expensesGate.invalidate();
      this.paymentsGate.invalidate();
      this.summaryGate.invalidate();
      if (refreshExpenses) void this.loadExpenses();
      if (refreshPayments) void this.loadPayments();
      if (refreshSummary) void this.loadSummary();
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
        this.paymentsLoadingState.set(false);
      }
    }, force).catch(() => undefined);
  }

  loadSummary(force = false): Promise<void> {
    return this.summaryGate.run(async () => {
      try {
        const [totalOut, paymentCount] = await Promise.all([
          this.financeRepository.totalExpensesCents(),
          this.salesRepository.paymentCount(),
        ]);
        this.totalOutState.set(totalOut);
        this.paymentCountState.set(paymentCount);
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      }
    }, force).catch(() => undefined);
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

  async createExpense(draft: ExpenseDraft): Promise<ExpenseCreateResult | null> {
    try {
      const result = await this.financeRepository.createExpense(draft);
      if (this.expensesGate.isLoaded) {
        this.expensesState.update((items) => [result.expense, ...items.filter((item) => item.id !== result.expense.id)]);
      }
      if (this.summaryGate.isLoaded) this.totalOutState.update((value) => value + result.expense.amountCents);
      this.toast.success(draft.kind === 'input-purchase'
        ? 'Compra registrada e estoque atualizado.'
        : 'Saída registrada com sucesso.');
      return result;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return null;
    }
  }

  applyPayments(payments: readonly Payment[]): void {
    if (!payments.length) return;
    if (this.paymentsGate.isLoaded) {
      const ids = new Set(payments.map((item) => item.id));
      this.paymentsState.update((items) => [...payments, ...items.filter((item) => !ids.has(item.id))]);
    }
    if (this.summaryGate.isLoaded) this.paymentCountState.update((value) => value + payments.length);
  }

  applyPayment(payment: Payment): void {
    this.applyPayments([payment]);
  }

  applyPaymentReversal(payment: Payment): void {
    if (!this.paymentsGate.isLoaded) return;
    this.paymentsState.update((items) => items.map((item) => item.id === payment.id ? payment : item));
  }

  markPaymentsReversed(paymentIds: readonly string[]): void {
    if (!this.paymentsGate.isLoaded || !paymentIds.length) return;
    const ids = new Set(paymentIds);
    this.paymentsState.update((items) => items.map((item) =>
      ids.has(item.id) ? { ...item, status: 'reversed' as const } : item
    ));
  }
}
