import { Injectable, inject, signal } from '@angular/core';
import { ProductionCorrectionRepository } from '../../core/repositories/production-correction.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';
import {
  ProductionCorrectionDraft, ProductionCorrectionHistory, ProductionCorrectionPreview,
} from '../../domain/models/production.model';
import { CatalogStore } from '../catalog/catalog.store';
import { ProductionStore } from './production.store';

/** Kept in the lazily-loaded Production feature, not the application shell bundle. */
@Injectable({ providedIn: 'root' })
export class ProductionCorrectionService {
  private readonly repository = inject(ProductionCorrectionRepository);
  private readonly production = inject(ProductionStore);
  private readonly catalog = inject(CatalogStore);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly errorState = signal('');
  readonly error = this.errorState.asReadonly();

  history(id: string): Promise<ProductionCorrectionHistory[]> {
    return this.repository.history(id);
  }
  preview(id: string, draft: ProductionCorrectionDraft): Promise<ProductionCorrectionPreview> {
    return this.repository.preview(id, draft);
  }
  async apply(id: string, draft: ProductionCorrectionDraft): Promise<boolean> {
    this.errorState.set('');
    try {
      const result = await this.repository.apply(id, draft);
      this.production.applyCorrection(result.production);
      this.catalog.applyStockChanges(result.stockChanges);
      this.toast.success(draft.cancel ? 'Produção cancelada e estoque reconciliado.' : 'Produção corrigida com sucesso.');
      return true;
    } catch (error) {
      const message = this.errors.message(error);
      this.errorState.set(message);
      this.toast.error(message);
      return false;
    }
  }
}
