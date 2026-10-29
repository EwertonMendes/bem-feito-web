import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { Product, Addition } from '../../../../domain/models/catalog.model';
import { AdvancedSaleLineDraft } from '../../../../domain/logic/advanced-sale-edit';
import { SaleLineSnapshot } from '../../../../domain/models/sales.model';
import { matchesCatalogSearch } from '../../../../domain/logic/catalog-search';
import { PRODUCT_CATEGORIES, productCategoryId, productCategoryName } from '../../../../domain/logic/product-category';
import { formatCurrency } from '../../../../core/utils/money';
import { CatalogReferenceStore } from '../../../catalog/catalog-reference.store';
import { CatalogImage } from '../../../../shared/media/catalog-image/catalog-image';
import { BfIcon } from '../../../../shared/ui/icon/icon';
import { BfSearchField } from '../../../../shared/ui/search-field/search-field';
import { BfSelect } from '../../../../shared/ui/select/select';

export type CatalogPickerSelection = {kind: 'product'|'addition'; sourceId: string};

/** Read-only catalog selector. Draft and financial mutations remain owned by the caller. */
@Component({
  selector: 'bf-catalog-item-picker',
  imports: [CatalogImage, BfIcon, BfSearchField, BfSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog-item-picker.html',
  styleUrl: './catalog-item-picker.scss',
})
export class CatalogItemPicker {
  private readonly refs = inject(CatalogReferenceStore);
  private readonly destroyRef = inject(DestroyRef);
  readonly products = input<readonly Product[]>([]);
  readonly additions = input<readonly Addition[]>([]);
  readonly selected = input<readonly AdvancedSaleLineDraft[]>([]);
  readonly baseline = input<readonly SaleLineSnapshot[]>([]);
  readonly allowBackorder = input(false);
  readonly disabled = input(false);
  readonly picked = output<CatalogPickerSelection>();
  readonly kind = signal<'product'|'addition'>('product');
  readonly query = signal('');
  readonly category = signal('');
  readonly visibleLimit = signal(16);
  readonly currency = formatCurrency;
  readonly productCategoryName = (product: Product) => productCategoryName(productCategoryId(product));

  readonly collectionNames = computed(() => new Map(this.refs.collections().map(x=>[x.id,x.name])));
  readonly fragranceNames = computed(() => new Map(this.refs.fragrances().map(x=>[x.id,x.name])));
  readonly formatNames = computed(() => new Map(this.refs.formats().map(x=>[x.id,x.name])));
  readonly categoryOptions = computed(() => this.kind() === 'product'
    ? [{value:'',label:'Todas as categorias'},...PRODUCT_CATEGORIES.map(x=>({value:x.id,label:x.label}))]
    : [{value:'',label:'Todas as categorias'},...[...new Set(this.additions().map(x=>x.category).filter(Boolean))]
        .sort((a,b)=>a.localeCompare(b,'pt-BR')).map(x=>({value:x,label:x}))]);

  readonly filteredProducts = computed(() => this.products().filter(p =>
    p.active && (!this.category() || productCategoryId(p)===this.category()) &&
    matchesCatalogSearch(this.query(),p.displayName,p.code,p.modelName,p.variantName,
      productCategoryName(productCategoryId(p)),this.collectionNames().get(p.collectionId),
      this.fragranceNames().get(p.fragranceId),this.formatNames().get(p.formatId),
      this.fragranceNames().get(p.candleFragranceId ?? ''))
  ).sort((a,b)=>a.displayName.localeCompare(b.displayName,'pt-BR')));

  readonly filteredAdditions = computed(() => this.additions().filter(a =>
    a.active && (!this.category() || a.category===this.category()) &&
    matchesCatalogSearch(this.query(),a.name,a.category,a.notes)
  ).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')));

  readonly visibleProducts = computed(() => this.filteredProducts().slice(0,this.visibleLimit()));
  readonly visibleAdditions = computed(() => this.filteredAdditions().slice(0,this.visibleLimit()));
  readonly resultCount = computed(() => this.kind()==='product'
    ? this.filteredProducts().length : this.filteredAdditions().length);

  constructor() {
    this.destroyRef.onDestroy(this.refs.activate());
    void this.refs.load();
  }

  switchKind(next: 'product'|'addition'): void {
    this.kind.set(next);
    this.category.set('');
    this.visibleLimit.set(16);
  }

  updateQuery(value:string):void {this.query.set(value);this.visibleLimit.set(16);}
  updateCategory(value:string):void {this.category.set(value);this.visibleLimit.set(16);}

  count(kind: 'product'|'addition', sourceId: string): number {
    return this.selected().filter(x=>x.kind===kind && x.sourceId===sourceId)
      .reduce((total,line)=>total+line.quantity,0);
  }

  freeStock(product: Product): number {
    return product.stock - (product.reservedPhysicalStock ?? Math.min(product.stock,product.committedStock??0));
  }

  canPick(product: Product): boolean {
    if(this.disabled())return false;
    if(this.allowBackorder())return true;
    const originallySold=this.baseline().filter(line=>line.kind==='product'&&line.sourceId===product.id)
      .reduce((sum,line)=>sum+line.quantity,0);
    const additional=this.count('product',product.id)-originallySold;
    return this.freeStock(product) >= additional+1;
  }

  pick(kind: 'product'|'addition', sourceId: string): void {
    if(this.disabled())return;
    if(kind==='product'){
      const product=this.products().find(x=>x.id===sourceId && x.active);
      if(!product || !this.canPick(product))return;
    } else if(!this.additions().some(x=>x.id===sourceId && x.active))return;
    this.picked.emit({kind,sourceId});
  }
}
