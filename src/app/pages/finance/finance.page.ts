import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
  imports: [FormField, BfIcon, BfDialog, BfEmptyState],
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
  readonly selectedReceivable = computed(() => this.sales.openSales().find((sale) => sale.id === this.receiptModel().saleId));

  constructor() {
    void Promise.all([
      this.catalog.load(),
      this.references.load(),
      this.store.loadExpenses(),
      this.store.loadSummary(),
      this.sales.loadReceivables(),
      this.settings.load(),
    ]).then(() => {
      if (this.route.snapshot.queryParamMap.get('novo') === '1') this.openExpense();
    });
  }

  async selectTab(tab: 'expenses' | 'receivables' | 'payments'): Promise<void> {
    this.tab.set(tab);
    if (tab === 'payments') await this.store.loadPayments();
    if (tab === 'expenses') await this.store.loadExpenses();
    if (tab === 'receivables') await this.sales.loadReceivables();
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
