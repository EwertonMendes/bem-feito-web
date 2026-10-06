import { Injectable, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { InventoryRepository } from '../repositories/inventory.repository';
import { ErrorService } from '../services/error.service';
import { ToastService } from '../services/toast.service';
import { todayBusinessDate } from '../utils/date';
import { CatalogStore } from '../../features/catalog/catalog.store';

const REASON = 'Regularização pós-migração: venda registrada antes da entrada física correspondente no estoque legado.';

@Injectable({ providedIn: 'root' })
export class NegativeStockReconciliationService {
  private readonly auth = inject(AuthService);
  private readonly catalog = inject(CatalogStore);
  private readonly repository = inject(InventoryRepository);
  private readonly errors = inject(ErrorService);
  private readonly toast = inject(ToastService);
  private inFlight: Promise<void> | null = null;
  private completed = false;

  ensure(): Promise<void> {
    if (this.completed) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    if (!this.auth.canAdminister()) return;

    await this.catalog.load();
    const targets = [
      ...this.catalog.products().filter((item) => item.stock < 0).map((item) => ({ itemType: 'product' as const, id: item.id })),
      ...this.catalog.inputs().filter((item) => item.stock < 0).map((item) => ({ itemType: 'input' as const, id: item.id })),
    ];

    if (!targets.length) {
      this.completed = true;
      return;
    }

    const stockChanges = [];
    try {
      for (const target of targets) {
        const result = await this.repository.reconcileNegativeToZero(
          target.itemType,
          target.id,
          REASON,
          todayBusinessDate(),
        );
        if (result) stockChanges.push(result.stockChange);
      }

      this.catalog.applyStockChanges(stockChanges);
      this.completed = true;
      if (stockChanges.length) {
        this.toast.success(
          stockChanges.length === 1
            ? '1 saldo negativo legado foi regularizado para zero.'
            : `${stockChanges.length} saldos negativos legados foram regularizados para zero.`,
        );
      }
    } catch (error) {
      this.catalog.applyStockChanges(stockChanges);
      this.toast.error(this.errors.message(error));
    }
  }
}
