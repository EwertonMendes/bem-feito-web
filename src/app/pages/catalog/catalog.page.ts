import { ActivatedRoute } from '@angular/router';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { CatalogImageEntityKind } from '../../domain/models/image.model';
import { Product, Addition, InputItem } from '../../domain/models/catalog.model';
import { standardCostForProduct, trackingModeForInput } from '../../domain/logic/costing';
import { PRODUCT_CATEGORIES, productCategoryId, productCategoryName, ProductCategoryId } from '../../domain/logic/product-category';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { ModalActions } from '../../core/services/modal-actions.service';
import { BfButton } from '../../shared/ui/button/button';
import { formatCurrency } from '../../core/utils/money';
import { CatalogEditor } from '../../features/catalog/components/catalog-editor/catalog-editor';
import { CatalogImage } from '../../shared/media/catalog-image/catalog-image';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfSearchField } from '../../shared/ui/search-field/search-field';
import { BfSelect, BfSelectOption } from '../../shared/ui/select/select';
import { BfSelectSearch } from '../../shared/ui/select-search/select-search';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { CatalogDetails } from './components/catalog-details';
import { CatalogAvailability, catalogProfit, matchesCatalogAvailability, matchesCatalogSearch } from './catalog-query';

type SortMode = 'name' | 'price-asc' | 'price-desc' | 'margin-desc' | 'stock-desc';

@Component({
  selector: 'bf-catalog-page',
  imports: [BfButton, BfIcon, BfSearchField, BfSelect, BfSelectSearch, CatalogImage, CatalogEditor, CatalogDetails, BfEmptyState, BfPageRefresh],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.page.html',
  styleUrl: './catalog.page.scss',
})
export class CatalogPage {
  readonly store = inject(CatalogStore);
  readonly refs = inject(CatalogReferenceStore);
  readonly modals = inject(ModalActions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly editor = viewChild.required<CatalogEditor>('editor');
  private readonly details = viewChild.required<CatalogDetails>('details');
  readonly currency = formatCurrency;
  readonly skeletonItems = [1,2,3,4,5,6,7,8];
  readonly tab = signal<CatalogImageEntityKind>('products');
  readonly search = signal('');
  readonly showFilters = signal(false);
  readonly viewMode = signal<'grid'|'list'>('grid');
  readonly sort = signal<SortMode>('name');
  readonly categoryFilter = signal('');
  readonly categoryOptions = [{value:'',label:'Todas as categorias'},...PRODUCT_CATEGORIES.map(c=>({value:c.id,label:c.label}))];
  readonly categoryName = (item: Product) => productCategoryName(productCategoryId(item));
  readonly collectionFilter = signal('');
  readonly fragranceFilter = signal('');
  readonly formatFilter = signal('');
  readonly productAvailability = signal<CatalogAvailability>('all');
  readonly inputTrackingFilter = signal('');
  readonly inputAvailability = signal<CatalogAvailability>('all');
  readonly additionCategoryFilter = signal('');
  readonly additionStatus = signal('all');

  readonly collectionOptions = computed<BfSelectOption[]>(() => [
    {value:'',label:'Todas as linhas'},
    ...this.refs.collections().map(v=>({value:v.id,label:v.name})).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR')),
  ]);
  readonly fragranceOptions = computed<BfSelectOption[]>(() => [
    {value:'',label:'Todas as fragrâncias'},
    ...this.refs.fragrances().filter(v=>!this.collectionFilter() || v.collectionId===this.collectionFilter())
      .map(v=>({value:v.id,label:v.name})).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR')),
  ]);
  readonly formatOptions = computed<BfSelectOption[]>(() => [
    {value:'',label:'Todos os formatos'},
    ...this.refs.formats().map(v=>({value:v.id,label:v.name})).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR')),
  ]);
  readonly additionCategoryOptions = computed<BfSelectOption[]>(() => [
    {value:'',label:'Todas as categorias'},
    ...[...new Set(this.store.additions().map(item=>item.category).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'pt-BR')).map(v=>({value:v,label:v})),
  ]);
  readonly availabilityOptions: BfSelectOption[] = [
    {value:'all',label:'Qualquer disponibilidade'},
    {value:'available',label:'Em estoque'},
    {value:'unavailable',label:'Sem estoque'},
    {value:'low',label:'Estoque baixo'},
    {value:'inactive',label:'Inativos'},
  ];
  readonly inputTrackingOptions: BfSelectOption[] = [
    {value:'',label:'Todos os controles'},
    {value:'exact',label:'Controlado'},
    {value:'estimated',label:'Estimado'},
    {value:'untracked',label:'Não controlar'},
  ];
  readonly additionStatusOptions: BfSelectOption[] = [
    {value:'all',label:'Todos os adicionais'},
    {value:'active',label:'Ativos'},
    {value:'inactive',label:'Inativos'},
  ];
  readonly sortOptions: BfSelectOption[] = [
    {value:'name',label:'Nome (A–Z)'},
    {value:'price-asc',label:'Menor preço'},
    {value:'price-desc',label:'Maior preço'},
    {value:'margin-desc',label:'Maior margem disponível'},
    {value:'stock-desc',label:'Maior estoque'},
  ];
  readonly collectionNames = computed(() => new Map(this.refs.collections().map(v=>[v.id,v.name])));
  readonly fragranceNames = computed(() => new Map(this.refs.fragrances().map(v=>[v.id,v.name])));
  readonly formatNames = computed(() => new Map(this.refs.formats().map(v=>[v.id,v.name])));
  readonly formatWeights = computed(() => new Map(this.refs.formats().map(v=>[v.id,v.approximateWeightGrams])));
  readonly productFinancials = computed(() => {
    const inputs = new Map(this.store.inputs().map(i=>[i.id,i]));
    const collections = new Map(this.refs.collections().map(i=>[i.id,i]));
    const fragrances = new Map(this.refs.fragrances().map(i=>[i.id,i]));
    const formats = new Map(this.refs.formats().map(i=>[i.id,i]));
    const result = new Map<string, {costCents:number|null;profitCents:number|null;marginPercent:number|null;incomplete:boolean}>();
    for (const p of this.store.products()) {
      try {
        const cost = standardCostForProduct(p, {
          collection:collections.get(p.collectionId),fragrance:fragrances.get(p.fragranceId),format:formats.get(p.formatId),
        },inputs);
        const profit=catalogProfit(p.salePriceCents,cost.unitCostCents,cost.costPending);
        result.set(p.id,{costCents:cost.unitCostCents,...profit,incomplete:cost.costPending});
      } catch {
        result.set(p.id,{costCents:null,profitCents:null,marginPercent:null,incomplete:true});
      }
    }
    return result;
  });
  readonly additionFinancials = computed(() => {
    const inputs=new Map(this.store.inputs().map(i=>[i.id,i]));
    const result=new Map<string,{costCents:number|null;marginPercent:number|null;incomplete:boolean}>();
    for(const item of this.store.additions()){
      const costs=item.components.map(component=>{
        const input=inputs.get(component.inputId);
        return input && input.unitId===component.unitId && input.averageUnitCostCents>0
          ? Math.round(input.averageUnitCostCents*component.quantity) : null;
      });
      const incomplete=!costs.length||costs.some(v=>v===null);
      const costCents=costs.reduce<number>((acc,v)=>acc+(v??0),0);
      const profit=catalogProfit(item.priceCents,costCents,incomplete);
      result.set(item.id,{costCents,marginPercent:profit.marginPercent,incomplete});
    }
    return result;
  });
  readonly filteredProducts = computed(() => {
    const products=this.store.products().filter(p=>
      matchesCatalogSearch(this.search(),p.displayName,p.code,this.categoryName(p),p.modelName,p.variantName,this.collectionNames().get(p.collectionId),
        this.fragranceNames().get(p.fragranceId),this.formatNames().get(p.formatId)) &&
      (!this.categoryFilter() || productCategoryId(p)===this.categoryFilter()) &&
      (productCategoryId(p)!=='soap' || (!this.collectionFilter() || p.collectionId===this.collectionFilter())) &&
      (productCategoryId(p)!=='soap' || (!this.fragranceFilter() || p.fragranceId===this.fragranceFilter())) &&
      (productCategoryId(p)!=='soap' || (!this.formatFilter() || p.formatId===this.formatFilter())) &&
      matchesCatalogAvailability(p,this.productAvailability()));
    return this.sortItems(products,p=>p.salePriceCents,p=>p.stock,p=>this.productFinancials().get(p.id)?.marginPercent??null,p=>p.displayName);
  });
  readonly filteredInputs = computed(() => {
    const inputs=this.store.inputs().filter(p=>
      matchesCatalogSearch(this.search(),p.name,p.code) &&
      (!this.inputTrackingFilter() || trackingModeForInput(p)===this.inputTrackingFilter()) &&
      (this.inputAvailability()==='all' ||
       (this.inputAvailability()==='inactive' ? !p.active :
       trackingModeForInput(p)==='untracked' ? false : matchesCatalogAvailability(p,this.inputAvailability()))));
    return this.sortItems(inputs,p=>p.averageUnitCostCents,p=>p.stock,()=>null,p=>p.name);
  });
  readonly filteredAdditions = computed(() => {
    const additions=this.store.additions().filter(p=>
      matchesCatalogSearch(this.search(),p.name,p.category,p.notes) &&
      (!this.additionCategoryFilter() || p.category===this.additionCategoryFilter()) &&
      (this.additionStatus()==='all' || (this.additionStatus()==='active'?p.active:!p.active)));
    return this.sortItems(additions,p=>p.priceCents,()=>0,p=>this.additionFinancials().get(p.id)?.marginPercent??null,p=>p.name);
  });
  readonly count = computed(() => this.tab()==='products'?this.filteredProducts().length:
    this.tab()==='inputs'?this.filteredInputs().length:this.filteredAdditions().length);
  readonly filterCount = computed(() => {
    if (this.tab()==='products') return [this.categoryFilter(),this.collectionFilter(),this.fragranceFilter(),this.formatFilter(),
      this.productAvailability()==='all'?'':this.productAvailability()].filter(Boolean).length;
    if(this.tab()==='inputs')return [this.inputTrackingFilter(),this.inputAvailability()==='all'?'':this.inputAvailability()].filter(Boolean).length;
    return [this.additionCategoryFilter(),this.additionStatus()==='all'?'':this.additionStatus()].filter(Boolean).length;
  });

  constructor() {
    const tab=this.route.snapshot.queryParamMap.get('tab');
    if(tab==='inputs'||tab==='additions'||tab==='products')this.tab.set(tab);
    this.destroyRef.onDestroy(this.store.activate());
    this.destroyRef.onDestroy(this.refs.activate());
    void Promise.all([this.store.load(),this.refs.load()]);
  }
  private sortItems<T>(items:T[],price:(v:T)=>number,stock:(v:T)=>number,margin:(v:T)=>number|null,name:(v:T)=>string):T[]{
    const mode=this.sort();
    return [...items].sort((a,b)=>{
      if(mode==='price-asc')return price(a)-price(b)||name(a).localeCompare(name(b),'pt-BR');
      if(mode==='price-desc')return price(b)-price(a)||name(a).localeCompare(name(b),'pt-BR');
      if(mode==='stock-desc')return stock(b)-stock(a)||name(a).localeCompare(name(b),'pt-BR');
      if(mode==='margin-desc')return (margin(b)??-Infinity)-(margin(a)??-Infinity)||name(a).localeCompare(name(b),'pt-BR');
      return name(a).localeCompare(name(b),'pt-BR');
    });
  }
  selectTab(tab: CatalogImageEntityKind): void {
    if(this.tab()===tab)return;
    this.tab.set(tab);this.search.set('');this.showFilters.set(false);this.sort.set('name');
  }
  setCollection(id:string):void{
    this.collectionFilter.set(id);
    if(id && this.refs.fragrances().find(v=>v.id===this.fragranceFilter())?.collectionId!==id)this.fragranceFilter.set('');
  }
  clearFilters():void{
    this.search.set('');
    if(this.tab()==='products'){this.categoryFilter.set('');this.collectionFilter.set('');this.fragranceFilter.set('');this.formatFilter.set('');this.productAvailability.set('all');}
    else if(this.tab()==='inputs'){this.inputTrackingFilter.set('');this.inputAvailability.set('all');}
    else{this.additionCategoryFilter.set('');this.additionStatus.set('all');}
    this.sort.set('name');
  }
  openDetails(kind:CatalogImageEntityKind,id:string):void{this.details().open(kind,id);}
  editFromDetails(event:{kind:CatalogImageEntityKind;id:string}):void{
    if(event.kind==='products'){const found=this.store.products().find(v=>v.id===event.id);if(found)this.editor().editProduct(found);}
    if(event.kind==='inputs'){const found=this.store.inputs().find(v=>v.id===event.id);if(found)this.editor().editInput(found);}
    if(event.kind==='additions'){const found=this.store.additions().find(v=>v.id===event.id);if(found)this.editor().editAddition(found);}
  }
  freeStock(p:Product):number{return Math.max(0,p.stock-(p.reservedPhysicalStock??0));}
  weight(p:Product):number|null{return this.formatWeights().get(p.formatId)??null;}
  margin(v:number|null|undefined):string{return v==null?'—':v.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';}
  inputMode(v:InputItem):string{const type=trackingModeForInput(v);return type==='exact'?'Controlado':type==='estimated'?'Estimado':'Não controlar';}
}
