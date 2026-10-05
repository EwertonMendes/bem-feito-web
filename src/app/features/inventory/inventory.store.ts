import { inject, Injectable, signal } from '@angular/core';
import { StockMovement } from '../../domain/models/inventory.model';
import { InventoryRepository } from '../../core/repositories/inventory.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';

@Injectable({ providedIn: 'root' })
export class InventoryStore {
  private readonly repository = inject(InventoryRepository);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly movementsState = signal<StockMovement[]>([]);

  readonly movements = this.movementsState.asReadonly();

  async loadMovements(itemId: string): Promise<void> {
    try {
      this.movementsState.set(await this.repository.movementsFor(itemId));
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  async adjust(itemType: 'product' | 'input', itemId: string, quantity: number, reason: string, date: string): Promise<boolean> {
    try {
      await this.repository.adjust(itemType, itemId, quantity, reason, date);
      this.toast.success('Ajuste registrado com sucesso.');
      await this.loadMovements(itemId);
      return true;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return false;
    }
  }
}
