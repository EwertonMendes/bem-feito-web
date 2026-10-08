import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormField, form, min, required } from '@angular/forms/signals';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { FinanceStore } from '../../features/finance/finance.store';
import { SalesStore } from '../../features/sales/sales.store';
import { SettingsStore } from '../../features/settings/settings.store';
import { Expense, ExpenseDraft, ExpenseKind, PurchaseBatchDraft } from '../../domain/models/finance.model';
import { formatBusinessDate, todayBusinessDate } from '../../core/utils/date';
import { formatCurrency, fromCents, toCents } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfListSkeleton, BfSkeleton, BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';
import { BfSelect, BfSelectOption } from '../../shared/ui/select/select';
import { paymentMethodIcon } from '../../shared/ui/select/payment-method-icon';
import { BfNumberInput } from '../../shared/ui/number-input/number-input';

interface PurchaseFormLine { id: string; inputId: string; quantity: number; amount: number; }

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
  amount: number;
  paymentMethodId: string;
  notes: string;
  link: string;
}

@Component({
  selector: 'bf-finance-page',
  imports: [FormField, BfIcon, BfDialog, BfEmptyState, BfPageRefresh, BfListSkeleton, BfSkeleton, BfTableSkeleton, BfSelect, BfNumberInput],
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly dialog = viewChild.required<BfDialog>('expenseDialog');
  private readonly receiptDialog = viewChild.required<BfDialog>('receiptDialog');
  private readonly expenseDetailDialog = viewChild.required<BfDialog>('expenseDetailDialog');
  readonly selectedExpense = signal<Expense | null>(null);
  readonly purchaseLines = signal<PurchaseFormLine[]>([]);
  readonly purchaseTotalCents = computed(() => this.purchaseLines().reduce((sum, item) => sum + toCents(item.amount), 0));
  readonly overdueOnly = signal(false);
  readonly visibleReceivables = computed(() => this.sales.openSales().filter(sale =>
    !this.overdueOnly() || (!!sale.dueDate && sale.dueDate < todayBusinessDate())));
  newPurchaseLine(): void {
    if (this.purchaseLines().length >= 40) return;
    this.purchaseLines.update(items => [...items, { id: crypto.randomUUID(), inputId: '', quantity: 1, amount: 0 }]);
  }
  patchPurchaseLine(id: string, patch: Partial<Omit<PurchaseFormLine, 'id'>>): void {
    this.purchaseLines.update(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
    this.model.update(value => ({ ...value, amount: fromCents(this.purchaseTotalCents()) }));
  }
  removePurchaseLine(id: string): void {
    this.purchaseLines.update(items => items.filter(item => item.id !== id));
    this.model.update(value => ({ ...value, amount: fromCents(this.purchaseTotalCents()) }));
  }
  purchaseUnit(inputId: string): string {
    const input = this.catalog.inputs().find(item => item.id === inputId);
    return input ? this.references.units().find(unit => unit.id === input.unitId)?.name ?? '' : '';
  }
  openExpenseDetails(expense: Expense): void {
    this.selectedExpense.set(expense);
    this.expenseDetailDialog().open();
  }
  purchaseDescription(expense: Expense): string {
    return expense.items?.length
      ? expense.items.length + ' insumo(s)'
      : this.inputName(expense.inputId);
  }


  readonly tab = signal<'expenses' | 'receivables' | 'payments'>('expenses');
  readonly expenseSubmitted = signal(false);
  readonly receiptSubmitted = signal(false);
  readonly expenseSaving = signal(false);
  readonly receiptSaving = signal(false);
  readonly expenseFormError = signal('');
  readonly receiptFormError = signal('');
  readonly currency = formatCurrency;
  readonly date = formatBusinessDate;
  readonly model = signal<ExpenseFormModel>({
    businessDate: todayBusinessDate(),
    kind: 'operating-expense',
    categoryId: '',
    inputId: '',
    quantity: 1,
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
  readonly expenseErrors = computed(() => {
    const value = this.model();
    return {
      businessDate: value.businessDate ? '' : 'Informe a data.',
      amount: Number.isFinite(value.amount) && value.amount > 0 ? '' : 'Informe um valor maior que zero.',
      inputId: '',
      quantity: '',
    };
  });
  readonly receiptErrors = computed(() => {
    const value = this.receiptModel();
    return {
      saleId: value.saleId ? '' : 'Selecione a venda.',
      businessDate: value.businessDate ? '' : 'Informe a data.',
      methodId: value.methodId ? '' : 'Selecione a forma de pagamento.',
      amount: Number.isFinite(value.amount) && value.amount > 0 ? '' : 'Informe um valor maior que zero.',
    };
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
  readonly selectedInput = computed(() => this.catalog.inputs().find((item) => item.id === this.model().inputId));
  readonly purchaseUnitName = computed(() => {
    const input = this.selectedInput();
    return input ? this.references.units().find((item) => item.id === input.unitId)?.name ?? '' : '';
  });
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
    const params = this.route.snapshot.queryParamMap;
    const tab = params.get('tab');
    if (tab === 'receivables' || tab === 'payments') this.tab.set(tab);
    this.overdueOnly.set(params.get('status') === 'overdue');
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

    if (this.tab() !== 'expenses') void ready.then(() => this.selectTab(this.tab()));
    const requestedReceipt = params.get('receber');
    if (requestedReceipt) void ready.then(async () => {
      await this.selectTab('receivables');
      this.openReceipt(requestedReceipt);
      await this.router.navigate([], { relativeTo: this.route, queryParams: { receber: null }, queryParamsHandling: 'merge', replaceUrl: true });
    });

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
    this.purchaseLines.set([]);
    if (kind === 'input-purchase') this.newPurchaseLine();
    this.expenseSubmitted.set(false);
    this.expenseFormError.set('');
    this.store.clearOperationError();
    this.model.set({
      businessDate: todayBusinessDate(),
      kind,
      categoryId: this.settings.expenseCategories().find((item) => item.active)?.id ?? '',
      inputId: this.catalog.activeInputs()[0]?.id ?? '',
      quantity: 1,
      amount: 0,
      paymentMethodId: this.settings.paymentMethods().find((item) => item.active)?.id ?? '',
      notes: '',
      link: '',
    });
    this.dialog().open();
  }

  openReceipt(saleId: string): void {
    this.receiptSubmitted.set(false);
    this.receiptFormError.set('');
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
    if (this.receiptSaving()) return;
    this.receiptSubmitted.set(true);
    this.receiptFormError.set('');
    const errors = this.receiptErrors();
    if (this.receiptForm().invalid() || Object.values(errors).some(Boolean)) {
      this.focusFirstInvalid('receipt');
      return;
    }

    const value = this.receiptModel();
    this.receiptSaving.set(true);
    try {
      const result = await this.sales.addPayment(value.saleId, value.businessDate, value.methodId, toCents(value.amount));
      if (result) {
        this.store.applyPayment(result.payment);
        this.receiptDialog().close();
      } else {
        this.receiptFormError.set('Não foi possível registrar o recebimento. Revise os dados e tente novamente.');
      }
    } finally {
      this.receiptSaving.set(false);
    }
  }

  async reversePayment(paymentId: string): Promise<void> {
    if (!window.confirm('Estornar este recebimento? O saldo da venda será reaberto.')) return;
    const result = await this.sales.reversePayment(paymentId);
    if (result) this.store.applyPaymentReversal(result.payment);
  }

  async save(): Promise<void> {
    if (this.expenseSaving()) return;
    this.expenseSubmitted.set(true);
    this.expenseFormError.set('');
    this.store.clearOperationError();
    const errors = this.expenseErrors();
    if (this.expenseForm().invalid() || Object.values(errors).some(Boolean)) {
      this.focusFirstInvalid('expense');
      return;
    }

    const value = this.model();
    if (value.kind === 'input-purchase') {
      const lines = this.purchaseLines();
      if (!lines.length || lines.some(item => !item.inputId || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
          !Number.isFinite(item.amount) || toCents(item.amount) <= 0)) {
        this.expenseFormError.set('Informe insumo, quantidade e valor de cada item da compra.');
        return;
      }
      const items = lines.map(item => ({
        inputId: item.inputId, quantity: item.quantity, amountCents: toCents(item.amount),
        unitId: this.catalog.inputs().find(input => input.id === item.inputId)?.unitId ?? '',
      }));
      const draft: PurchaseBatchDraft = {
        businessDate: value.businessDate, items,
        paymentMethodId: value.paymentMethodId || undefined,
        notes: value.notes.trim() || undefined, link: value.link.trim() || undefined,
      };
      this.expenseSaving.set(true);
      try {
        const result = await this.store.createPurchaseBatch(draft);
        if (result) {
          this.catalog.applyStockChanges(result.stockChanges ?? []);
          this.dialog().close();
        } else this.expenseFormError.set(this.store.operationError() || 'Não foi possível registrar a compra.');
      } finally { this.expenseSaving.set(false); }
      return;
    }
    const draft: ExpenseDraft = {
      businessDate: value.businessDate,
      kind: value.kind,
      categoryId: value.categoryId || undefined,
      inputId: value.kind === 'input-purchase' ? value.inputId : undefined,
      quantity: value.kind === 'input-purchase' ? value.quantity : undefined,
      unitId: value.kind === 'input-purchase' ? this.selectedInput()?.unitId : undefined,
      amountCents: toCents(value.amount),
      paymentMethodId: value.paymentMethodId || undefined,
      notes: value.notes.trim() || undefined,
      link: value.link.trim() || undefined,
    };
    this.expenseSaving.set(true);
    try {
      const result = await this.store.createExpense(draft);
      if (result) {
        if (result.stockChange) this.catalog.applyStockChanges([result.stockChange]);
        this.dialog().close();
      } else {
        this.expenseFormError.set(this.store.operationError() || 'Não foi possível registrar a saída.');
      }
    } finally {
      this.expenseSaving.set(false);
    }
  }

  private focusFirstInvalid(scope: 'expense' | 'receipt'): void {
    queueMicrotask(() => {
      const root = this.host.nativeElement.querySelector<HTMLElement>(`[data-form="${scope}"]`);
      root?.querySelector<HTMLElement>('[data-invalid="true"] input, [data-invalid="true"] button')?.focus();
    });
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
