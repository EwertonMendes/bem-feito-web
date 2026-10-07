import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormField, form, min, required } from '@angular/forms/signals';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { FinanceStore } from '../../features/finance/finance.store';
import { SalesStore } from '../../features/sales/sales.store';
import { SettingsStore } from '../../features/settings/settings.store';
import { ExpenseDraft, ExpenseKind } from '../../domain/models/finance.model';
import { formatBusinessDate, todayBusinessDate } from '../../core/utils/date';
import { formatCurrency, fromCents, toCents } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfListSkeleton, BfSkeleton, BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';
import { BfSelect, BfSelectOption } from '../../shared/ui/select/select';
import { paymentMethodIcon } from '../../shared/ui/select/payment-method-icon';

interface ReceiptFormModel {
  saleId: string;
  businessDate: string;
  methodId: string;
  amount: number;
}

interface ExpenseFormModel {
  businessDate: string;
  kind: ExpenseKind;
  categoryId: string;
  inputId: string;
  quantity: number;
  unitId: string;
  amount: number;
  paymentMethodId: string;
  notes: string;
  link: string;
}

@Component({
  selector: 'bf-finance-page',
  imports: [FormField, BfIcon, BfDialog, BfEmptyState, BfPageRefresh, BfListSkeleton, BfSkeleton, BfTableSkeleton, BfSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './finance.page.html',
  styleUrl: './finance.page.scss',
})
export class FinancePage {
  readonly catalog = inject(CatalogStore);
  readonly references = inject(CatalogReferenceStore);
  readonly store = inject(FinanceStore);
  readonly sales = inject(SalesStore);
  readonly settings = inject(SettingsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required<BfDialog>('expenseDialog');
  private readonly receiptDialog = viewChild.required<BfDialog>('receiptDialog');

  readonly tab = signal<'expenses' | 'receivables' | 'payments'>('expenses');
  readonly currency = formatCurrency;
  readonly date = formatBusinessDate;
  readonly model = signal<ExpenseFormModel>({
    businessDate: todayBusinessDate(),
    kind: 'operating-expense',
    categoryId: '',
    inputId: '',
    quantity: 1,
    unitId: '',
    amount: 0,
    paymentMethodId: '',
    notes: '',
    link: '',
  });
  readonly expenseForm = form(this.model, (p) => {
    required(p.businessDate);
    required(p.kind);
    min(p.amount, 0.01);
  });
  readonly totalReceivable = this.sales.receivableTotalCents;
  readonly totalOut = this.store.totalOutCents;
  readonly receiptModel = signal<ReceiptFormModel>({ saleId: '', businessDate: todayBusinessDate(), methodId: '', amount: 0 });
  readonly receiptForm = form(this.receiptModel, (p) => {
    required(p.saleId);
    required(p.businessDate);
    required(p.methodId);
    min(p.amount, 0.01);
  });
  readonly inputOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.catalog.activeInputs().map((item) => ({ value: item.id, label: item.name })),
  ]);
  readonly unitOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.references.units().map((item) => ({ value: item.id, label: item.name })),
  ]);
  readonly expenseCategoryOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Sem categoria' },
    ...this.settings.expenseCategories()
      .filter((category) => category.active)
      .map((category) => ({ value: category.id, label: category.name })),
  ]);
  readonly paymentMethodOptions = computed<BfSelectOption[]>(() =>
    this.settings.paymentMethods()
      .filter((method) => method.active)
      .map((method) => ({
        value: method.id,
        label: method.name,
        icon: paymentMethodIcon(method.name),
      })),
  );
  readonly optionalPaymentMethodOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Não informado' },
    ...this.paymentMethodOptions(),
  ]);
  readonly requiredPaymentMethodOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.paymentMethodOptions(),
  ]);
  readonly selectedReceivable = computed(() => this.sales.openSales().find((sale) => sale.id === this.receiptModel().saleId));
  readonly summaryInitialized = computed(() => this.store.summaryInitialized() && this.sales.receivableSummaryInitialized());
  readonly refreshing = computed(() =>
    this.summaryInitialized() && (
      this.store.summaryLoading() ||
      this.store.expensesLoading() ||
      this.store.paymentsLoading() ||
      this.sales.receivablesLoading() ||
      this.sales.receivableSummaryLoading()
    )
  );

  constructor() {
    this.destroyRef.onDestroy(this.catalog.activate());
    this.destroyRef.onDestroy(this.references.activate());
    this.destroyRef.onDestroy(this.store.activate());
    this.destroyRef.onDestroy(this.sales.activateReceivables());
    this.destroyRef.onDestroy(this.settings.activate());
    const ready = Promise.all([
      this.catalog.load(),
      this.references.load(),
      this.store.loadExpenses(),
      this.store.loadSummary(),
      this.sales.loadReceivableSummary(),
      this.settings.load(),
    ]);

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const shortcut = params.get('novo');
        if (!shortcut) return;
        void ready.then(() => this.consumeExpenseShortcut(shortcut));
      });
  }

  private async consumeExpenseShortcut(shortcut: string): Promise<void> {
    const kind: ExpenseKind | null =
      shortcut === 'compra'
        ? 'input-purchase'
        : shortcut === '1'
          ? 'operating-expense'
          : null;

    if (!kind) return;

    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { novo: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    this.openExpense(kind);
  }

  async selectTab(tab: 'expenses' | 'receivables' | 'payments'): Promise<void> {
    this.tab.set(tab);
    if (tab === 'payments') await this.store.loadPayments();
    if (tab === 'expenses') await this.store.loadExpenses();
    if (tab === 'receivables') {
      await Promise.all([
        this.sales.loadReceivables(),
        this.sales.loadReceivableSummary(),
      ]);
    }
  }

  openExpense(kind: ExpenseKind = 'operating-expense'): void {
    this.model.set({
      businessDate: todayBusinessDate(),
      kind,
      categoryId: this.settings.expenseCategories().find((item) => item.active)?.id ?? '',
      inputId: this.catalog.activeInputs()[0]?.id ?? '',
      quantity: 1,
      unitId: this.references.units().find((item) => item.active)?.id ?? '',
      amount: 0,
      paymentMethodId: this.settings.paymentMethods().find((item) => item.active)?.id ?? '',
      notes: '',
      link: '',
    });
    this.dialog().open();
  }

  openReceipt(saleId: string): void {
    const sale = this.sales.openSales().find((item) => item.id === saleId);
    if (!sale) return;
    this.receiptModel.set({
      saleId: sale.id,
      businessDate: todayBusinessDate(),
      methodId: this.settings.paymentMethods().find((item) => item.active)?.id ?? '',
      amount: fromCents(sale.balanceCents),
    });
    this.receiptDialog().open();
  }

  async saveReceipt(): Promise<void> {
    if (this.receiptForm().invalid()) return;
    const value = this.receiptModel();
    const result = await this.sales.addPayment(value.saleId, value.businessDate, value.methodId, toCents(value.amount));
    if (result) {
      this.store.applyPayment(result.payment);
      this.receiptDialog().close();
    }
  }

  async reversePayment(paymentId: string): Promise<void> {
    if (!window.confirm('Estornar este recebimento? O saldo da venda será reaberto.')) return;
    const result = await this.sales.reversePayment(paymentId);
    if (result) this.store.applyPaymentReversal(result.payment);
  }

  async save(): Promise<void> {
    if (this.expenseForm().invalid()) return;
    const value = this.model();
    const draft: ExpenseDraft = {
      businessDate: value.businessDate,
      kind: value.kind,
      categoryId: value.categoryId || undefined,
      inputId: value.kind === 'input-purchase' ? value.inputId : undefined,
      quantity: value.kind === 'input-purchase' ? value.quantity : undefined,
      unitId: value.kind === 'input-purchase' ? value.unitId : undefined,
      amountCents: toCents(value.amount),
      paymentMethodId: value.paymentMethodId || undefined,
      notes: value.notes.trim() || undefined,
      link: value.link.trim() || undefined,
    };
    const result = await this.store.createExpense(draft);
    if (result) {
      if (result.stockChange) this.catalog.applyStockChanges([result.stockChange]);
      this.dialog().close();
    }
  }

  paymentName(id: string): string {
    return this.settings.paymentMethods().find((item) => item.id === id)?.name ?? 'Outro';
  }

  categoryName(id?: string): string {
    return id ? this.settings.expenseCategories().find((item) => item.id === id)?.name ?? '—' : '—';
  }

  inputName(id?: string): string {
    return id ? this.catalog.inputs().find((item) => item.id === id)?.name ?? '—' : '—';
  }
}
