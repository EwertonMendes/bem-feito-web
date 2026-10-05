import { inject, Injectable, signal } from '@angular/core';
import { Expense, ExpenseDraft } from '../../domain/models/finance.model';
import { Payment } from '../../domain/models/sales.model';
import { FinanceRepository } from '../../core/repositories/finance.repository';
import { SalesRepository } from '../../core/repositories/sales.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';

@Injectable({ providedIn: 'root' })
export class FinanceStore {
  private readonly financeRepository = inject(FinanceRepository);
  private readonly salesRepository = inject(SalesRepository);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);

  private readonly expensesState = signal<Expense[]>([]);
  private readonly paymentsState = signal<Payment[]>([]);
  private readonly loadingState = signal(false);

  readonly expenses = this.expensesState.asReadonly();
  readonly payments = this.paymentsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  async load(): Promise<void> {
    this.loadingState.set(true);
    try {
      const [expenses, payments] = await Promise.all([
        this.financeRepository.recentExpenses(250),
        this.salesRepository.payments(300),
      ]);
      this.expensesState.set(expenses);
      this.paymentsState.set(payments);
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.loadingState.set(false);
    }
  }

  async createExpense(draft: ExpenseDraft): Promise<boolean> {
    try {
      await this.financeRepository.createExpense(draft);
      this.toast.success(draft.kind === 'input-purchase' ? 'Compra registrada e estoque atualizado.' : 'Saída registrada com sucesso.');
      await this.load();
      return true;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return false;
    }
  }
}
