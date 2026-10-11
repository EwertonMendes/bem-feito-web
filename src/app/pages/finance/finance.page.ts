import { ExpenseCreateResult } from '../../core/repositories/mutation-results';
import { BfLoadingButton } from '../../shared/ui/button/loading-button';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { FinanceStore } from '../../features/finance/finance.store';
import { BfFinanceDialogs } from '../../features/finance/components/finance-dialogs';
import { SalesStore } from '../../features/sales/sales.store';
import { SettingsStore } from '../../features/settings/settings.store';
import { Expense, ExpenseKind, fundingPartyOf, fundingTypeOf } from '../../domain/models/finance.model';
import { todayBusinessDate, formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfListSkeleton, BfSkeleton, BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';
@Component({
 selector: 'bf-finance-page',
 imports: [BfLoadingButton, BfIcon, BfDialog, BfEmptyState, BfPageRefresh, BfListSkeleton, BfSkeleton, BfTableSkeleton, BfFinanceDialogs],
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
 private readonly dialogs = viewChild.required<BfFinanceDialogs>('financeDialogs');
 private readonly expenseDetailDialog = viewChild.required<BfDialog>('expenseDetailDialog');
 private readonly expenseCancelDialog = viewChild.required<BfDialog>('expenseCancelDialog');
 readonly selectedExpense = signal<Expense | null>(null);
 readonly cancelReason = signal('');
 readonly cancellingExpense = signal(false);
 readonly receivingPurchase = signal(false);
 readonly reversingPaymentId = signal('');
 readonly overdueOnly = signal(false);
 readonly tab = signal<'expenses' | 'receivables' | 'payments'>('expenses');
 async receiveSelectedPurchase(): Promise<void> {
   if (this.receivingPurchase()) return;
   const selected = this.selectedExpense();
   if (!selected || selected.receiptStatus !== 'pending') return;
   this.receivingPurchase.set(true);
   try {
     const result = await this.store.receivePurchase(selected.id);
     if (!result) return;
     this.catalog.applyStockChanges(result.stockChanges ?? []);
     this.selectedExpense.set(result.expense);
   } finally {
     this.receivingPurchase.set(false);
   }
 }
 readonly fundingParty = fundingPartyOf;
 readonly fundingType = fundingTypeOf;
 readonly currency = formatCurrency;
 readonly date = formatBusinessDate;
 readonly totalReceivable = this.sales.receivableTotalCents;
 readonly totalOut = this.store.totalOutCents;
 readonly summaryInitialized = computed(() => this.store.summaryInitialized() && this.sales.receivableSummaryInitialized());
 readonly refreshing = computed(() => this.summaryInitialized() && (
   this.store.summaryLoading() || this.store.expensesLoading() || this.store.paymentsLoading() ||
   this.sales.receivablesLoading() || this.sales.receivableSummaryLoading()
 ));
 readonly visibleReceivables = computed(() => this.sales.openSales().filter(sale =>
   !this.overdueOnly() || (!!sale.dueDate && sale.dueDate < todayBusinessDate())));
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
   const ready = Promise.all([this.catalog.load(), this.references.load(), this.store.loadExpenses(),
     this.store.loadSummary(), this.sales.loadReceivableSummary(), this.settings.load()]);
   if (this.tab() !== 'expenses') void ready.then(() => this.selectTab(this.tab()));
   const receipt = params.get('receber');
   const shortcut = params.get('novo');
   if (receipt || shortcut) {
     // Consume legacy deep links before opening: refresh never replays a dismissed dialog.
     void this.router.navigate([], { relativeTo: this.route,
        queryParams: { receber: null, novo: null }, queryParamsHandling: 'merge', replaceUrl: true })
       .then(() => ready)
       .then(async () => {
         if (receipt) { await this.selectTab('receivables'); void this.openReceipt(receipt); }
         else if (shortcut === 'compra' || shortcut === '1') this.openExpense(shortcut === 'compra' ? 'input-purchase' : 'operating-expense');
       });
   }
 }
 onExpenseChanged(result: ExpenseCreateResult): void {
   this.catalog.applyStockChanges(result.stockChanges ?? []);
   this.selectedExpense.set(result.expense);
 }
 editSelectedExpense(): void {
   const expense = this.selectedExpense();
   if (!expense || expense.status === 'cancelled') return;
   this.expenseDetailDialog().close();
   void this.dialogs().openEditExpense(expense);
 }
 showCancelExpense(): void {
   if (!this.selectedExpense() || this.selectedExpense()?.status === 'cancelled') return;
   this.cancelReason.set('');
   this.expenseDetailDialog().close();
   this.expenseCancelDialog().open();
 }
 async cancelSelectedExpense(): Promise<void> {
   const expense = this.selectedExpense();
   if (!expense || this.cancellingExpense()) return;
   this.cancellingExpense.set(true);
   try {
     const result = await this.store.cancelExpense(expense.id, this.cancelReason());
     if (!result) return;
     this.catalog.applyStockChanges(result.stockChanges ?? []);
     this.selectedExpense.set(result.expense);
     this.expenseCancelDialog().closeAfterSuccess();
   } finally { this.cancellingExpense.set(false); }
 }
 openExpenseDetails(expense: Expense): void {
   if (this.receivingPurchase()) return;
   this.selectedExpense.set(expense);
   this.expenseDetailDialog().open();
 }
 purchaseDescription(expense: Expense): string { return expense.items?.length ? expense.items.length+' insumo(s)' : this.inputName(expense.inputId); }
 purchaseUnit(inputId: string): string {
   const input = this.catalog.inputs().find(item => item.id === inputId);
   return input ? this.references.units().find(unit => unit.id === input.unitId)?.name ?? '' : '';
 }
 openExpense(kind: ExpenseKind = 'operating-expense'): void { void this.dialogs().openExpense(kind); }
 openReceipt(saleId: string): void { void this.dialogs().openReceipt(saleId); }
 async selectTab(tab: 'expenses' | 'receivables' | 'payments'): Promise<void> {
   this.tab.set(tab);
   if (tab === 'payments') await this.store.loadPayments();
   if (tab === 'expenses') await this.store.loadExpenses();
   if (tab === 'receivables') await Promise.all([this.sales.loadReceivables(), this.sales.loadReceivableSummary()]);
 }
 async reversePayment(paymentId: string): Promise<void> {
   if (this.reversingPaymentId()) return;
   if (!window.confirm('Estornar este recebimento? O saldo da venda será reaberto.')) return;
   this.reversingPaymentId.set(paymentId);
   try {
     const result = await this.sales.reversePayment(paymentId);
     if (result) this.store.applyPaymentReversal(result.payment);
   } finally {
     this.reversingPaymentId.set('');
   }
 }
 paymentName(id: string): string { return this.settings.paymentMethods().find(x => x.id === id)?.name ?? 'Outro'; }
 categoryName(id?: string): string { return id ? this.settings.expenseCategories().find(x => x.id === id)?.name ?? '—' : '—'; }
 inputName(id?: string): string { return id ? this.catalog.inputs().find(x => x.id === id)?.name ?? '—' : '—'; }
}
