import { FinanceCodeSearchRepository } from '../../core/repositories/finance-code-search.repository';
import { FinanceRepository } from '../../core/repositories/finance.repository';
import { SalesRepository } from '../../core/repositories/sales.repository';
import { downloadCsv, exportCents } from '../../core/utils/csv-export';
import { Payment, Sale } from '../../domain/models/sales.model';
import { BfIconName } from '../../shared/ui/icon/icon';
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
import { CashBalanceCheck, CashMovement, CashMovementKind, Expense, ExpenseKind, fundingPartyOf, fundingTypeOf } from '../../domain/models/finance.model';
import { CashManagementRepository, CASH_MOVEMENT_TYPES } from '../../core/repositories/cash-management.repository';
import { toCents } from '../../core/utils/money';
import { BfNumberInput } from '../../shared/ui/number-input/number-input';
import { BfSelect, BfSelectOption } from '../../shared/ui/select/select';
import { ToastService } from '../../core/services/toast.service';
import { ErrorService } from '../../core/services/error.service';
import { todayBusinessDate, formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfListSkeleton, BfSkeleton, BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';
@Component({
 selector: 'bf-finance-page',
 imports: [BfLoadingButton, BfIcon, BfDialog, BfEmptyState, BfPageRefresh, BfListSkeleton, BfSkeleton, BfTableSkeleton, BfFinanceDialogs, BfNumberInput, BfSelect],
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
 private readonly cashRepo = inject(CashManagementRepository);
 private readonly exportExpenses = inject(FinanceRepository);
 private readonly exportSales = inject(SalesRepository);
 readonly exporting = signal(false);
 private readonly codeSearch = inject(FinanceCodeSearchRepository);
 private readonly toast = inject(ToastService);
 private readonly errors = inject(ErrorService);
 readonly capitalMovements = signal<CashMovement[]>([]);
 readonly cashChecks = signal<CashBalanceCheck[]>([]);
 readonly legacyCashCheck = signal<CashBalanceCheck | null>(null);
 readonly cashLoading = signal(false);
 readonly cashLoaded = signal(false);
 readonly cashSaving = signal(false);
 readonly cashError = signal('');
 readonly cashSelected = signal<CashMovement | null>(null);
 readonly cashReverseReason = signal('');
 readonly cashCheckLatest = computed(() => this.cashChecks()[0] ?? this.legacyCashCheck());
 readonly cashMovementTypes = CASH_MOVEMENT_TYPES;
 readonly cashKindOptions: BfSelectOption[] = Object.entries(CASH_MOVEMENT_TYPES).map(([value, definition]) => ({value, label: definition.label}));
 readonly cashDraft = signal({kind: 'contribution' as CashMovementKind, businessDate: todayBusinessDate(), accountName: 'Conta principal', partyName: '', amount: 0, notes: ''});
 readonly cashCheckDraft = signal({businessDate: todayBusinessDate(), accountName: 'Conta principal', balance: 0, note: ''});
 private readonly movementDialog = viewChild.required<BfDialog>('movementDialog');
 private readonly checkBalanceDialog = viewChild.required<BfDialog>('checkBalanceDialog');
 private readonly reverseMovementDialog = viewChild.required<BfDialog>('reverseMovementDialog');
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
 readonly tab = signal<'expenses' | 'receivables' | 'payments' | 'cash'>('expenses');
 readonly searchInput = signal('');
 readonly searchBusy = signal(false);
 readonly searchError = signal('');
 private readonly searchedTab = signal<'expenses' | 'receivables' | 'payments' | null>(null);
 private readonly expenseMatches = signal<Expense[]>([]);
 private readonly paymentMatches = signal<Payment[]>([]);
 private readonly receivableMatches = signal<Sale[]>([]);
 readonly searchActive = computed(() => this.searchedTab() === this.tab());
 readonly visibleExpenses = computed(() => this.searchActive() ? this.expenseMatches() : this.store.expenses());
 readonly visiblePayments = computed(() => this.searchActive() ? this.paymentMatches() : this.store.payments());
 readonly selectedPayment = signal<Payment | null>(null);
 private readonly paymentDetailDialog = viewChild.required<BfDialog>('paymentDetailDialog');
 readonly expenseLabels: Record<ExpenseKind, string> = {
   'input-purchase': 'Compra de insumos',
   'operating-expense': 'Despesa operacional',
   equipment: 'Equipamento',
   other: 'Outra saída',
 };
 readonly expenseIcons: Record<ExpenseKind, BfIconName> = {
   'input-purchase': 'purchase',
   'operating-expense': 'expense',
   equipment: 'equipment',
   other: 'other-expense',
 };
 expenseDescription(expense: Expense): string {
   const explicit = expense.itemName?.trim();
   if (expense.kind === 'input-purchase') {
     if (expense.items?.length === 1) {
       const name = this.inputName(expense.items[0]?.inputId);
       return name === '—' ? explicit || 'Insumo não identificado' : name;
     }
     if (expense.items?.length) return `Compra de ${expense.items.length} insumos`;
     const name = this.inputName(expense.inputId);
     return name === '—' ? explicit || 'Insumo não identificado' : name;
   }
   if (explicit) return explicit;
   const category = this.categoryName(expense.categoryId);
   return category === '—' ? this.expenseLabels[expense.kind] : category;
 }
 paymentIcon(methodId: string): BfIconName {
   const name = this.paymentName(methodId).toLowerCase();
   if (name.includes('pix')) return 'qr-code';
   if (name.includes('dinheiro') || name.includes('espécie')) return 'banknote';
   if (name.includes('cartão')) return 'card';
   return 'payment-other';
 }
 openPaymentDetails(payment: Payment): void {
   this.selectedPayment.set(payment);
   this.paymentDetailDialog().open();
 }
 resetCodeSearch(): void {
   this.searchedTab.set(null);
   this.searchInput.set('');
   this.searchError.set('');
 }
 async exportFinanceCsv(): Promise<void> {
   if(this.exporting())return;
   const kind=this.tab();
   this.exporting.set(true);
   try {
     const rows:(string|number)[][]=[];
     if(kind==='cash'){
       let cursor:{businessDate:string;id:string}|null=null;
       let complete=false;
       for(let i=0;i<1000;i++){
         const page=await this.cashRepo.movementPage(100,cursor);
         for(const item of page.items){
           rows.push([item.businessDate,item.accountName,item.kind,item.partyName??'',
             item.status,exportCents(item.amountCents),exportCents(item.impactCents),item.notes??'']);
         }
         if(!page.hasMore){complete=true;break;}
         if(!page.nextCursor)throw new Error('Paginação incompleta: exportação interrompida.');
         cursor=page.nextCursor;
       }
       if(!complete)throw new Error('Limite seguro da exportação atingido.');
       downloadCsv('bem-feito-caixa-movimentacoes.csv',
         ['Data','Conta','Tipo','Parte','Situação','Valor (R$)','Impacto (R$)','Observações'],rows);
       this.toast.success('Movimentações de caixa exportadas.');
       return;
     }
     let cursor:{businessDate:string;id:string}|null=null;
     let complete=false;
     for(let i=0;i<1000;i++){
       const page=kind==='expenses' ? await this.exportExpenses.expensePage(100,cursor)
         : kind==='payments' ? await this.exportSales.paymentPage(100,cursor)
         : await this.exportSales.receivablePage(100,cursor);
       for(const entry of page.items){
         if(kind==='expenses'){
           const x=entry as Expense;
           rows.push([x.code,x.businessDate,x.itemName??this.expenseDescription(x),x.kind,
             x.status??'active',exportCents(x.amountCents),exportCents(x.bankDebitCents??0),
             x.fundingType??'',x.paidBy??'']);
         }else if(kind==='payments'){
           const x=entry as Payment;
           rows.push([x.code,x.businessDate,x.saleId,x.methodId,x.status,
             exportCents(x.appliedCents),exportCents(x.amountReceivedCents),exportCents(x.tipCents)]);
         }else{
           const x=entry as Sale;
           rows.push([x.code,x.businessDate,x.customerName??'',x.paymentStatus,x.dueDate??'',
             exportCents(x.totalCents),exportCents(x.receivedCents),exportCents(x.balanceCents)]);
         }
       }
       if(!page.hasMore){complete=true;break;}
       if(!page.nextCursor)throw new Error('Paginação incompleta: exportação interrompida.');
       cursor=page.nextCursor;
     }
     if(!complete)throw new Error('Limite seguro da exportação atingido.');
     const headers=kind==='expenses'
       ? ['Código','Data','Descrição','Tipo','Situação','Valor (R$)','Débito em conta (R$)','Origem','Pago por']
       : kind==='payments'
       ? ['Código','Data','Venda','Forma','Situação','Aplicado (R$)','Recebido (R$)','Gorjeta (R$)']
       : ['Código','Data','Cliente','Situação','Vencimento','Total (R$)','Recebido (R$)','Saldo (R$)'];
     downloadCsv('bem-feito-'+kind+'.csv',headers,rows);
     this.toast.success('CSV financeiro gerado com o histórico consultado.');
   }catch(error){this.toast.error(this.errors.message(error));}
   finally{this.exporting.set(false);}
 }

 async searchCode(): Promise<void> {
   const tab = this.tab();
   if (tab === 'cash' || this.searchBusy()) return;
   const term = this.searchInput().trim().toUpperCase();
   if (!term) { this.resetCodeSearch(); return; }
   if (!/^[MPV][0-9]{3,8}$/.test(term)) {
     this.searchError.set('Informe um código completo, como M000012, V00024 ou P000025.');
     return;
   }
   const prefix = tab === 'expenses' ? 'M' : tab === 'payments' ? 'P' : 'V';
   if (!term.startsWith(prefix)) {
     this.searchError.set(`Nesta aba, o código deve começar com ${prefix}.`);
     return;
   }
   this.searchBusy.set(true);
   this.searchError.set('');
   try {
     if (tab === 'expenses') this.expenseMatches.set(await this.codeSearch.expenses(term));
     else if (tab === 'payments') this.paymentMatches.set(await this.codeSearch.payments(term));
     else this.receivableMatches.set(await this.codeSearch.receivables(term));
     this.searchedTab.set(tab);
   } catch(error) {
     this.searchError.set(this.errors.message(error));
   } finally { this.searchBusy.set(false); }
 }

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
 readonly visibleReceivables = computed(() =>
   (this.searchActive() ? this.receivableMatches() : this.sales.openSales()).filter(sale =>
     !this.overdueOnly() || (!!sale.dueDate && sale.dueDate < todayBusinessDate())));
 constructor() {
   const params = this.route.snapshot.queryParamMap;
   const tab = params.get('tab');
   if (tab === 'receivables' || tab === 'payments' || tab === 'cash') this.tab.set(tab);
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
   this.expenseMatches.update(items => items.map(item => item.id===result.expense.id ? result.expense : item));
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
     this.expenseMatches.update(items => items.map(item => item.id===result.expense.id ? result.expense : item));
     this.expenseCancelDialog().closeAfterSuccess();
   } finally { this.cancellingExpense.set(false); }
 }
 openExpenseDetails(expense: Expense): void {
   if (this.receivingPurchase()) return;
   this.selectedExpense.set(expense);
   this.expenseDetailDialog().open();
 }
 purchaseDescription(expense: Expense): string { return expense.items?.length ? expense.items.length+' insumo(s)' : this.expenseDescription(expense); }
 purchaseUnit(inputId: string): string {
   const input = this.catalog.inputs().find(item => item.id === inputId);
   return input ? this.references.units().find(unit => unit.id === input.unitId)?.name ?? '' : '';
 }
 openExpense(kind: ExpenseKind = 'operating-expense'): void { void this.dialogs().openExpense(kind); }
 openReceipt(saleId: string): void { void this.dialogs().openReceipt(saleId); }
 async selectTab(tab: 'expenses' | 'receivables' | 'payments' | 'cash'): Promise<void> {
   if (this.tab() !== tab) this.resetCodeSearch();
   this.tab.set(tab);
   if (tab === 'cash') await this.loadCash();
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
     if (result) {
       this.store.applyPaymentReversal(result.payment);
       this.paymentMatches.update(items => items.map(item => item.id===result.payment.id ? result.payment : item));
       if (this.selectedPayment()?.id===result.payment.id) this.selectedPayment.set(result.payment);
     }
   } finally {
     this.reversingPaymentId.set('');
   }
 }
 async loadCash(): Promise<void> {
   if (this.cashLoading()) return;
   this.cashLoading.set(true);
   try {
     const [movements, checks, legacy] = await Promise.all([
       this.cashRepo.movements(), this.cashRepo.balanceChecks(), this.cashRepo.legacyBalance(),
     ]);
     this.capitalMovements.set(movements);
     this.cashChecks.set(checks);
     this.legacyCashCheck.set(legacy);
     this.cashLoaded.set(true);
   } catch (error) { this.toast.error(this.errors.message(error)); }
   finally { this.cashLoading.set(false); }
 }
 openMovement(): void {
   this.cashError.set('');
   this.cashDraft.set({kind:'contribution',businessDate:todayBusinessDate(), accountName:'Conta principal',partyName:'',amount:0,notes:''});
   this.movementDialog().open();
 }
 openCheckBalance(): void {
   this.cashError.set('');
   this.cashCheckDraft.set({businessDate:todayBusinessDate(),accountName:'Conta principal',balance:0,note:''});
   this.checkBalanceDialog().open();
 }
 async saveMovement(): Promise<void> {
   if (this.cashSaving()) return;
   this.cashSaving.set(true);
   this.cashError.set('');
   try {
     const value = this.cashDraft();
     const result = await this.cashRepo.createMovement({...value,amountCents:toCents(value.amount)});
     this.capitalMovements.update(items => [result,...items]);
     this.movementDialog().closeAfterSuccess();
     this.toast.success('Movimentação registrada sem alterar o faturamento.');
   } catch (error) { this.cashError.set(this.errors.message(error)); }
   finally { this.cashSaving.set(false); }
 }
 openReverseMovement(item: CashMovement): void {
   if(item.status==='reversed')return;
   this.cashSelected.set(item);
   this.cashReverseReason.set('');
   this.cashError.set('');
   this.reverseMovementDialog().open();
 }
 async reverseCashMovement(): Promise<void> {
   const selected = this.cashSelected();
   if (!selected || this.cashSaving()) return;
   this.cashSaving.set(true);
   this.cashError.set('');
   try {
     const changed = await this.cashRepo.reverseMovement(selected.id,this.cashReverseReason());
     this.capitalMovements.update(items=>items.map(item=>item.id===changed.id?changed:item));
     this.reverseMovementDialog().closeAfterSuccess();
     this.toast.success('Movimentação estornada com motivo registrado.');
   } catch(error) { this.cashError.set(this.errors.message(error)); }
   finally { this.cashSaving.set(false); }
 }
 async saveBalanceCheck(): Promise<void> {
   if (this.cashSaving()) return;
   this.cashSaving.set(true);
   this.cashError.set('');
   try {
     const value = this.cashCheckDraft();
     const result = await this.cashRepo.confirmBalance({
       businessDate:value.businessDate,accountName:value.accountName,balanceCents:toCents(value.balance), note:value.note,
     });
     this.cashChecks.update(items => [result,...items].sort((a,b)=>b.businessDate.localeCompare(a.businessDate)));
     this.checkBalanceDialog().closeAfterSuccess();
     this.toast.success('Saldo conferido e histórico preservado.');
   } catch(error) { this.cashError.set(this.errors.message(error)); }
   finally { this.cashSaving.set(false); }
 }
 paymentName(id: string): string { return this.settings.paymentMethods().find(x => x.id === id)?.name ?? 'Outro'; }
 categoryName(id?: string): string { return id ? this.settings.expenseCategories().find(x => x.id === id)?.name ?? '—' : '—'; }
 inputName(id?: string): string { return id ? this.catalog.inputs().find(x => x.id === id)?.name ?? '—' : '—'; }
}
