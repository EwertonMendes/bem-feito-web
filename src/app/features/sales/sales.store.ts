import { computed, inject, Injectable, signal } from '@angular/core';
import { Sale, SaleDraft } from '../../domain/models/sales.model';
import { SalesRepository } from '../../core/repositories/sales.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';

@Injectable({ providedIn: 'root' })
export class SalesStore {
  private readonly repository = inject(SalesRepository);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly salesState = signal<Sale[]>([]);
  private readonly loadingState = signal(false);

  readonly sales = this.salesState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly openSales = computed(() => this.salesState().filter((sale) => sale.status === 'active' && sale.balanceCents > 0));

  async load(): Promise<void> {
    this.loadingState.set(true);
    try {
      this.salesState.set(await this.repository.recent(250));
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.loadingState.set(false);
    }
  }

  async create(draft: SaleDraft): Promise<boolean> {
    try {
      await this.repository.create(draft);
      this.toast.success('Venda registrada com sucesso.');
      await this.load();
      return true;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return false;
    }
  }

  async addPayment(saleId: string, businessDate: string, methodId: string, amountReceivedCents: number): Promise<boolean> {
    try {
      await this.repository.addPayment(saleId, businessDate, methodId, amountReceivedCents);
      this.toast.success('Recebimento registrado com sucesso.');
      await this.load();
      return true;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return false;
    }
  }

  async reversePayment(paymentId: string): Promise<boolean> {
    try {
      await this.repository.reversePayment(paymentId);
      this.toast.success('Recebimento estornado.');
      await this.load();
      return true;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return false;
    }
  }

  async cancel(sale: Sale): Promise<void> {
    try {
      await this.repository.cancel(sale.id);
      this.toast.success(`${sale.code} cancelada e estoque revertido.`);
      await this.load();
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }
}
