import { ChangeDetectionStrategy, Component, computed, inject, output, signal, viewChild } from '@angular/core';
import { standardCostForProduct, productCostComponents, trackingModeForInput } from '../../../domain/logic/costing';
import { Addition, InputItem, Product } from '../../../domain/models/catalog.model';
import { CatalogImageEntityKind } from '../../../domain/models/image.model';
import { formatCurrency } from '../../../core/utils/money';
import { ModalActions } from '../../../core/services/modal-actions.service';
import { CatalogStore } from '../../../features/catalog/catalog.store';
import { CatalogReferenceStore } from '../../../features/catalog/catalog-reference.store';
import { CatalogImage } from '../../../shared/media/catalog-image/catalog-image';
import { BfDialog } from '../../../shared/ui/dialog/dialog';
import { BfIcon } from '../../../shared/ui/icon/icon';
import { catalogProfit } from '../catalog-query';

@Component({
  selector: 'bf-catalog-details',
  imports: [BfDialog, BfIcon, CatalogImage],
  templateUrl: './catalog-details.html',
  styleUrl: './catalog-details.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogDetails {
  readonly store = inject(CatalogStore);
  readonly refs = inject(CatalogReferenceStore);
  readonly modals = inject(ModalActions);
  readonly currency = formatCurrency;
  readonly editRequested = output<{ kind: CatalogImageEntityKind; id: string }>();
  private readonly dialog = viewChild.required<BfDialog>('detailsDialog');
  readonly kind = signal<CatalogImageEntityKind>('products');
  readonly selectedId = signal('');
  readonly product = computed(() => this.store.products().find(v => v.id === this.selectedId()) ?? null);
  readonly input = computed(() => this.store.inputs().find(v => v.id === this.selectedId()) ?? null);
  readonly addition = computed(() => this.store.additions().find(v => v.id === this.selectedId()) ?? null);
  readonly cost = computed(() => {
    const p = this.product();
    if (!p || this.kind() !== 'products') return null;
    try {
      return standardCostForProduct(p, {
        collection: this.refs.collections().find(v => v.id === p.collectionId),
        fragrance: this.refs.fragrances().find(v => v.id === p.fragranceId),
        format: this.refs.formats().find(v => v.id === p.formatId),
      }, new Map(this.store.inputs().map(v => [v.id,v])));
    } catch { return null; }
  });
  readonly profitability = computed(() => {
    const p = this.product(), c = this.cost();
    return p ? catalogProfit(p.salePriceCents, c?.unitCostCents ?? null, !c || c.costPending)
      : {profitCents: null, marginPercent: null};
  });
  readonly additionCost = computed(() => {
    const a = this.addition();
    if (!a || this.kind() !== 'additions') return null;
    const map = new Map(this.store.inputs().map(v => [v.id,v]));
    let cents = 0, pending = a.components.length === 0;
    const components = a.components.map(part => {
      const input = map.get(part.inputId);
      if (!input || input.unitId !== part.unitId || input.averageUnitCostCents <= 0) pending = true;
      const unitCostCents = input && input.unitId === part.unitId ? Math.max(0,input.averageUnitCostCents) : 0;
      const totalCostCents = Math.round(part.quantity * unitCostCents);
      cents += totalCostCents;
      return { ...part, totalCostCents };
    });
    return {unitCostCents:cents,costPending:pending,components};
  });
  readonly additionProfit = computed(() => {
    const a=this.addition(), c=this.additionCost();
    return a ? catalogProfit(a.priceCents, c?.unitCostCents ?? null, !c || c.costPending)
      : {profitCents:null,marginPercent:null};
  });
  readonly usedByProducts = computed(() => {
    const input=this.input();
    if (!input || this.kind() !== 'inputs') return [];
    return this.store.products().filter(product => {
      const recipe = productCostComponents(product, {
        collection: this.refs.collections().find(v => v.id === product.collectionId),
        fragrance: this.refs.fragrances().find(v => v.id === product.fragranceId),
        format: this.refs.formats().find(v => v.id === product.formatId),
      });
      return recipe.some(component => component.inputId === input.id);
    });
  });
  readonly usedByAdditions = computed(() => {
    const input=this.input();
    return input && this.kind() === 'inputs'
      ? this.store.additions().filter(item => item.components.some(c => c.inputId === input.id)) : [];
  });

  open(kind: CatalogImageEntityKind, id: string): void {
    this.kind.set(kind);
    this.selectedId.set(id);
    this.dialog().open();
  }
  close(): void { this.dialog().close(); }
  edit(): void { const kind=this.kind(),id=this.selectedId();this.close();this.editRequested.emit({kind,id}); }
  produce(product: Product): void { this.close();this.modals.openProduction(product.id); }
  sell(product: Product): void { this.close();this.modals.openSale(product.id); }
  collectionName(p: Product): string { return this.refs.collections().find(v=>v.id===p.collectionId)?.name??'Linha não cadastrada'; }
  fragranceName(p: Product): string { return this.refs.fragrances().find(v=>v.id===p.fragranceId)?.name??'Fragrância não cadastrada'; }
  formatName(p: Product): string { return this.refs.formats().find(v=>v.id===p.formatId)?.name??'Formato não cadastrado'; }
  weight(p: Product): number | null { return this.refs.formats().find(v=>v.id===p.formatId)?.approximateWeightGrams??null; }
  inputName(id: string): string { return this.store.inputs().find(v=>v.id===id)?.name??'Insumo não encontrado'; }
  unitName(id: string): string { return this.refs.units().find(v=>v.id===id)?.name??'un.'; }
  percent(value: number | null): string { return value === null ? 'Indisponível' : value.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'; }
  quantity(value: number): string { return value.toLocaleString('pt-BR',{maximumFractionDigits:3}); }
  availableStock(p: Product): number { return Math.max(0, p.stock - (p.reservedPhysicalStock ?? 0)); }
  tracking(input: InputItem): string {
    const type = trackingModeForInput(input);
    return type === 'exact' ? 'Controlado' : type === 'estimated' ? 'Estimado' : 'Não controlar';
  }
}
