import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { BfDialog } from '../../../shared/ui/dialog/dialog';
import { BfIcon } from '../../../shared/ui/icon/icon';
import { BfLoadingButton } from '../../../shared/ui/button/loading-button';
import { BfSelectOption } from '../../../shared/ui/select/select';
import { BfSelectSearch } from '../../../shared/ui/select-search/select-search';
import { BfNumberInput } from '../../../shared/ui/number-input/number-input';
import { CatalogImage } from '../../../shared/media/catalog-image/catalog-image';
import { CatalogImageRef } from '../../../domain/models/image.model';
import { CatalogStore } from '../../catalog/catalog.store';
import { CatalogReferenceStore } from '../../catalog/catalog-reference.store';
import { formatCurrency } from '../../../core/utils/money';
import { productionItems } from '../../../domain/logic/production-correction';
import {
  Production, ProductionCorrectionDraft, ProductionCorrectionPreview, ProductionDraftItem,
} from '../../../domain/models/production.model';
import { ProductionCorrectionService } from '../production-correction.service';

interface EditableLine extends ProductionDraftItem { id: string; }

@Component({
  selector: 'bf-production-correction-editor',
  imports: [BfDialog, BfIcon, BfLoadingButton, BfSelectSearch, BfNumberInput, CatalogImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './production-correction-editor.html',
  styleUrl: './production-correction-editor.scss',
})
export class ProductionCorrectionEditor {
  readonly catalog = inject(CatalogStore);
  readonly references = inject(CatalogReferenceStore);
  readonly corrections = inject(ProductionCorrectionService);
  private readonly dialog = viewChild.required<BfDialog>('correctionDialog');
  readonly currency = formatCurrency;
  readonly production = signal<Production | null>(null);
  readonly date = signal('');
  readonly notes = signal('');
  readonly reason = signal('');
  readonly lines = signal<EditableLine[]>([]);
  readonly review = signal<ProductionCorrectionPreview | null>(null);
  readonly reviewedDraft = signal<ProductionCorrectionDraft | null>(null);
  readonly reviewing = signal(false);
  readonly reviewingCancellation = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly busy = computed(() => this.reviewing() || this.saving());
  readonly isCancellation = computed(() => this.reviewedDraft()?.cancel ?? false);
  readonly units = computed(() => this.lines().reduce((total, line) => total + Math.max(0, Number(line.quantity) || 0), 0));
  readonly productOptions = computed<BfSelectOption[]>(() => {
    const historical = new Set(this.lines().map(x => x.productId));
    return [
      { value: '', label: 'Selecione um sabonete' },
      ...this.catalog.products()
        .filter(product => product.active || historical.has(product.id))
        .map(product => ({
          value: product.id, label: product.displayName,
          description: product.active ? 'Estoque atual: ' + product.stock : 'Produto inativo · histórico',
        })),
    ];
  });
  readonly images = computed(() => new Map(this.catalog.products().map(p => [p.id, p.image])));

  productImage(id: string): CatalogImageRef | undefined { return this.images().get(id); }
  inputUnit(id: string): string { return this.references.units().find(x => x.id === id)?.name ?? ''; }

  async open(production: Production): Promise<void> {
    if (this.busy() || production.status === 'cancelled') return;
    await Promise.all([this.catalog.load(), this.references.load()]);
    this.production.set(production);
    this.date.set(production.businessDate);
    this.notes.set(production.notes ?? '');
    this.reason.set('');
    this.lines.set(productionItems(production).map(item => ({
      id: crypto.randomUUID(), productId: item.productId, quantity: item.quantity,
    })));
    this.review.set(null);
    this.reviewedDraft.set(null);
    this.error.set('');
    this.dialog().open();
  }

  changeProduct(id: string, value: string): void {
    this.lines.update(lines => lines.map(line => line.id === id ? { ...line, productId: value } : line));
  }
  changeQuantity(id: string, value: number): void {
    this.lines.update(lines => lines.map(line => line.id === id ? { ...line, quantity: value } : line));
  }
  addLine(): void {
    if (this.lines().length >= 60 || this.busy()) return;
    this.lines.update(items => [...items, { id: crypto.randomUUID(), productId: '', quantity: 1 }]);
  }
  removeLine(id: string): void {
    if (this.lines().length < 2 || this.busy()) return;
    this.lines.update(items => items.filter(item => item.id !== id));
  }
  pickReason(reason: string): void { this.reason.set(reason); }
  back(): void {
    if (this.busy()) return;
    this.review.set(null);
    this.reviewedDraft.set(null);
    this.error.set('');
  }
  async preview(cancel = false): Promise<void> {
    if (this.busy()) return;
    const production = this.production();
    if (!production) return;
    const lines = this.lines().map(({ productId, quantity }) => ({ productId, quantity }));
    if (!cancel && (!lines.length || lines.some(line => !line.productId || !Number.isSafeInteger(line.quantity) || line.quantity <= 0))) {
      this.error.set('Selecione os sabonetes e confira as quantidades.');
      return;
    }
    if (!this.reason().trim()) {
      this.error.set('Informe brevemente por que a produção está sendo corrigida.');
      return;
    }
    const draft: ProductionCorrectionDraft = {
      expectedVersion: production.correctionVersion ?? 0,
      businessDate: this.date(), notes: this.notes(), reason: this.reason().trim(), cancel, lines,
    };
    this.error.set('');
    this.reviewingCancellation.set(cancel);
    this.reviewing.set(true);
    try {
      const result = await this.corrections.preview(production.id, draft);
      this.review.set(result);
      this.reviewedDraft.set(draft);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Não foi possível revisar esta correção.');
    } finally {
      this.reviewing.set(false);
    }
  }
  async confirm(): Promise<void> {
    if (this.busy()) return;
    const production = this.production(), draft = this.reviewedDraft();
    if (!production || !draft) return;
    this.error.set('');
    this.saving.set(true);
    try {
      const saved = await this.corrections.apply(production.id, draft);
      if (!saved) {
        this.error.set(this.corrections.error() || 'Não foi possível aplicar a correção.');
        this.backAfterFailure();
        return;
      }
      this.dialog().closeAfterSuccess();
    } finally {
      this.saving.set(false);
    }
  }
  private backAfterFailure(): void {
    this.review.set(null);
    this.reviewedDraft.set(null);
  }
}
