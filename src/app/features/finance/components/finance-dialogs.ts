import { BfLoadingButton } from '../../../shared/ui/button/loading-button';
import { CatalogImage } from '../../../shared/media/catalog-image/catalog-image';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { FormField, form, min, required } from '@angular/forms/signals';
import { CatalogReferenceStore } from '../../catalog/catalog-reference.store';
import { CatalogStore } from '../../catalog/catalog.store';
import { FinanceStore } from '../finance.store';
import { SalesStore } from '../../sales/sales.store';
import { SettingsStore } from '../../settings/settings.store';
import { Sale } from '../../../domain/models/sales.model';
import { Expense, ExpenseDraft, ExpenseKind, PurchaseBatchDraft, FundingType, fundingTypeOf, fundingPartyOf } from '../../../domain/models/finance.model';
import { ExpenseCreateResult } from '../../../core/repositories/mutation-results';
import { todayBusinessDate } from '../../../core/utils/date';
import { formatCurrency, fromCents, toCents } from '../../../core/utils/money';
import { BfIcon } from '../../../shared/ui/icon/icon';
import { BfDialog } from '../../../shared/ui/dialog/dialog';
import { BfCheckbox } from '../../../shared/ui/checkbox/checkbox';
import { BfSelect, BfSelectOption } from '../../../shared/ui/select/select';
import { BfSelectSearch } from '../../../shared/ui/select-search/select-search';
import { paymentMethodIcon } from '../../../shared/ui/select/payment-method-icon';
import { BfNumberInput } from '../../../shared/ui/number-input/number-input';
import { CatalogImageRef } from '../../../domain/models/image.model';
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
  fundingType: FundingType;
  paidBy: string;
  reimbursable: boolean;
  receiptStatus: 'received' | 'pending';
  shipping: number;
  interest: number;
  otherCharge: number;
  otherDescription: string;
  capitalizeOther: boolean;
}
@Component({
 selector: 'bf-finance-dialogs',
 imports: [BfLoadingButton, FormField, BfIcon, BfDialog, BfSelect, BfSelectSearch, CatalogImage, BfCheckbox, BfNumberInput],
 changeDetection: ChangeDetectionStrategy.OnPush,
 templateUrl: './finance-dialogs.html',
 styleUrl: './finance-dialogs.scss',
})
export class BfFinanceDialogs {
 readonly catalog = inject(CatalogStore);
 readonly references = inject(CatalogReferenceStore);
 readonly store = inject(FinanceStore);
 readonly sales = inject(SalesStore);
 readonly settings = inject(SettingsStore);
 private readonly destroyRef = inject(DestroyRef);
 private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
 private readonly dialog = viewChild.required<BfDialog>('expenseDialog');
 private readonly receiptDialog = viewChild.required<BfDialog>('receiptDialog');
 readonly selectedReceiptSale = signal<Sale | null>(null);
 readonly purchaseLines = signal<PurchaseFormLine[]>([]);
 readonly editingExpense = signal<Expense | null>(null);
 readonly revisionReason = signal('');
 readonly expenseChanged = output<ExpenseCreateResult>();
 readonly fundingOptions: BfSelectOption[] = [{value:'business',label:'Recursos do negócio'}, {value:'third-party',label:'Pago por outra pessoa'}, {value:'unverified',label:'Origem a confirmar'}];
 readonly arrivalOptions: BfSelectOption[] = [{value:'received',label:'Já chegaram'}, {value:'pending',label:'Aguardando entrega'}];
 readonly purchaseTotalCents = computed(() => this.purchaseLines().reduce((sum, item) => sum + toCents(item.amount), 0));
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
  readonly expenseSubmitted = signal(false);
  readonly receiptSubmitted = signal(false);
  readonly expenseSaving = signal(false);
  readonly receiptSaving = signal(false);
  readonly expenseFormError = signal('');
  readonly receiptFormError = signal('');
  readonly currency = formatCurrency;
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
    fundingType: 'business', paidBy: '', reimbursable: false, receiptStatus: 'received', shipping: 0, interest: 0,
    otherCharge: 0, otherDescription: '', capitalizeOther: false,
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
  readonly inputImages = computed(() => new Map(this.catalog.inputs().map(item => [item.id, item.image])));
  inputImage(inputId: string): CatalogImageRef | undefined {
    return this.inputImages().get(inputId);
  }

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
  readonly selectedReceivable = computed(() => this.selectedReceiptSale() ?? this.sales.openSales().find((sale) => sale.id === this.receiptModel().saleId));
 constructor() {
    this.destroyRef.onDestroy(this.catalog.activate());
    this.destroyRef.onDestroy(this.references.activate());
    this.destroyRef.onDestroy(this.store.activate());
    this.destroyRef.onDestroy(this.sales.activateReceivables());
    this.destroyRef.onDestroy(this.settings.activate());
 }
  setFundingSource(value: string): void {
    if (value === 'business' || value === 'third-party' || value === 'unverified')
      this.model.update(model => ({ ...model, fundingType: value, paidBy: value === 'third-party' ? model.paidBy : '', reimbursable: value === 'third-party' && model.reimbursable }));
  }
  setPaidBy(paidBy: string): void { this.model.update(model => ({ ...model, paidBy })); }
  setReimbursable(reimbursable: boolean): void { this.model.update(model => ({ ...model, reimbursable })); }
  setReceiptStatus(value: string): void {
    if (value === 'received' || value === 'pending') this.model.update(model => ({ ...model, receiptStatus: value }));
  }
  patchCharge(field: 'shipping' | 'interest' | 'otherCharge', amount: number): void {
    this.model.update(model => ({ ...model, [field]: Math.max(0, amount) }));
  }
  setOtherDescription(description: string): void { this.model.update(model => ({ ...model, otherDescription: description })); }
  setCapitalizeOther(value: boolean): void { this.model.update(model => ({ ...model, capitalizeOther: value })); }
  changeExpenseKind(kind: ExpenseKind): void {
    this.model.update(value => ({ ...value, kind, amount: kind === 'input-purchase' ? fromCents(this.purchaseTotalCents()) : 0 }));
    if (kind === 'input-purchase' && !this.purchaseLines().length) this.newPurchaseLine();
  }

  async openExpense(kind: ExpenseKind = 'operating-expense'): Promise<void> {
    this.editingExpense.set(null);
    this.revisionReason.set('');
    await Promise.all([this.catalog.load(), this.references.load(), this.settings.load()]);
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
      fundingType: 'business', paidBy: '', reimbursable: false, receiptStatus: 'received', shipping: 0, interest: 0,
      otherCharge: 0, otherDescription: '', capitalizeOther: false,
    });
    this.dialog().open();
  }

  async openEditExpense(expense: Expense): Promise<void> {
    if (expense.status === 'cancelled') return;
    await this.openExpense(expense.kind);
    this.editingExpense.set(expense);
    const charges = expense.charges ?? [];
    const items = expense.items?.length ? expense.items :
      expense.inputId && expense.quantity ? [{ inputId: expense.inputId, quantity: expense.quantity, amountCents: expense.amountCents }] : [];
    this.purchaseLines.set(items.map(item => ({
      id: crypto.randomUUID(), inputId: item.inputId, quantity: item.quantity, amount: fromCents(item.amountCents),
    })));
    this.model.update(model => ({
      ...model, businessDate: expense.businessDate, kind: expense.kind,
      categoryId: expense.categoryId ?? '', amount: fromCents(expense.kind === 'input-purchase'
        ? items.reduce((sum, item) => sum + item.amountCents, 0) : expense.amountCents),
      paymentMethodId: expense.paymentMethodId ?? '', notes: expense.notes ?? '', link: expense.link ?? '',
      fundingType: fundingTypeOf(expense), paidBy: fundingPartyOf(expense),
      reimbursable: expense.reimbursable ?? false, receiptStatus: expense.receiptStatus ?? 'received',
      shipping: fromCents(charges.filter(c => c.kind === 'shipping').reduce((sum,c)=>sum+c.amountCents,0)),
      interest: fromCents(charges.filter(c => c.kind === 'interest').reduce((sum,c)=>sum+c.amountCents,0)),
      otherCharge: fromCents(charges.filter(c => c.kind === 'other').reduce((sum,c)=>sum+c.amountCents,0)),
      otherDescription: charges.find(c=>c.kind==='other')?.description ?? '',
      capitalizeOther: !!charges.find(c=>c.kind==='other')?.capitalized,
    }));
  }

  async openReceipt(saleId: string): Promise<void> {
    await Promise.all([this.sales.loadReceivableSummary(), this.settings.load()]);
    this.receiptSubmitted.set(false);
    this.receiptFormError.set('');
    let sale: Sale | null = null;
    try { sale = await this.sales.findReceivable(saleId); }
    catch { this.receiptFormError.set('Não foi possível consultar essa venda.'); return; }
    if (!sale) return;
    this.selectedReceiptSale.set(sale);
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
        this.receiptDialog().closeAfterSuccess();
      } else {
        this.receiptFormError.set('Não foi possível registrar o recebimento. Revise os dados e tente novamente.');
      }
    } finally {
      this.receiptSaving.set(false);
    }
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
    if (value.fundingType === 'third-party' && !value.paidBy.trim()) {
      this.expenseFormError.set('Informe quem pagou com recursos próprios.');
      return;
    }
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
        fundingType: value.fundingType, paidBy: value.fundingType === 'third-party' ? value.paidBy.trim() : undefined,
        reimbursable: value.fundingType === 'third-party' && value.reimbursable,
        receiptStatus: value.receiptStatus,
        charges: [
          ...(toCents(value.shipping) > 0 ? [{ kind: 'shipping' as const, amountCents: toCents(value.shipping), capitalized: true }] : []),
          ...(toCents(value.interest) > 0 ? [{ kind: 'interest' as const, amountCents: toCents(value.interest), capitalized: false }] : []),
          ...(toCents(value.otherCharge) > 0 ? [{ kind: 'other' as const, amountCents: toCents(value.otherCharge), capitalized: value.capitalizeOther, description: value.otherDescription.trim() || undefined }] : []),
        ],
        paymentMethodId: value.paymentMethodId || undefined,
        notes: value.notes.trim() || undefined, link: value.link.trim() || undefined,
      };
      this.expenseSaving.set(true);
      try {
        const original = this.editingExpense();
        const result = original
          ? await this.store.correctExpense(original.id, draft, this.revisionReason())
          : await this.store.createPurchaseBatch(draft);
        if (result) {
          this.catalog.applyStockChanges(result.stockChanges ?? []);
          if (this.editingExpense()) this.expenseChanged.emit(result);
          this.dialog().closeAfterSuccess();
        } else this.expenseFormError.set(this.store.operationError() || 'Não foi possível registrar a compra.');
      } finally { this.expenseSaving.set(false); }
      return;
    }
    const draft: ExpenseDraft = {
      businessDate: value.businessDate,
      kind: value.kind,
      categoryId: value.categoryId || undefined,
      amountCents: toCents(value.amount),
      paymentMethodId: value.paymentMethodId || undefined,
      fundingType: value.fundingType, paidBy: value.fundingType === 'third-party' ? value.paidBy.trim() : undefined,
      reimbursable: value.fundingType === 'third-party' && value.reimbursable,
      notes: value.notes.trim() || undefined,
      link: value.link.trim() || undefined,
    };
    this.expenseSaving.set(true);
    try {
      const original = this.editingExpense();
      const result = original
        ? await this.store.correctExpense(original.id, draft, this.revisionReason())
        : await this.store.createExpense(draft);
      if (result) {
        if (result.stockChange) this.catalog.applyStockChanges([result.stockChange]);
        if (this.editingExpense()) this.expenseChanged.emit(result);
        this.dialog().closeAfterSuccess();
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
}
