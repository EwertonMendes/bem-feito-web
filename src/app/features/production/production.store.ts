import { inject, Injectable, signal } from '@angular/core';
import { Production } from '../../domain/models/production.model';
import { ProductionRepository } from '../../core/repositories/production.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';

@Injectable({ providedIn: 'root' })
export class ProductionStore {
  private readonly repository = inject(ProductionRepository);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly itemsState = signal<Production[]>([]);
  private readonly loadingState = signal(false);

  readonly items = this.itemsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  async load(): Promise<void> {
    this.loadingState.set(true);
    try {
      this.itemsState.set(await this.repository.recent(150));
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.loadingState.set(false);
    }
  }

  async create(productId: string, quantity: number, businessDate: string, notes?: string): Promise<boolean> {
    try {
      await this.repository.create(productId, quantity, businessDate, notes);
      this.toast.success('Produção registrada com sucesso.');
      await this.load();
      return true;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return false;
    }
  }
}
