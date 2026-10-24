import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { BfCheckbox } from '../../../../shared/ui/checkbox/checkbox';
import { BfIcon } from '../../../../shared/ui/icon/icon';
import { BfMultiSelect } from '../../../../shared/ui/multi-select/multi-select';
import { BfNumberInput } from '../../../../shared/ui/number-input/number-input';
import { BfSelect, BfSelectOption } from '../../../../shared/ui/select/select';
import { BfSelectSearch } from '../../../../shared/ui/select-search/select-search';
import { CandleModelRepository, ProductRepository } from '../../../../core/repositories/catalog.repository';
import { CandleModel, Product, RecipeComponent } from '../../../../domain/models/catalog.model';
import { buildCandleCandidates } from '../../../../domain/logic/candle-variation-builder';
import { candleSourceValid, DEFAULT_CANDLE_MODEL } from '../../../../domain/logic/candle-model';
import { standardCostForProduct } from '../../../../domain/logic/costing';
import { formatCurrency, fromCents, toCents } from '../../../../core/utils/money';
import { CatalogReferenceStore } from '../../catalog-reference.store';
import { CatalogStore } from '../../catalog.store';

@Component({
  selector: 'bf-candle-creation-form',
  imports: [BfCheckbox, BfIcon, BfMultiSelect, BfNumberInput, BfSelect, BfSelectSearch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './candle-creation-form.html',
  styleUrls: ['../soap-creation-form/soap-creation-form.scss', './candle-creation-form.scss'],
})
export class CandleCreationForm {
  readonly references = inject(CatalogReferenceStore);
  readonly store = inject(CatalogStore);
  private readonly products = inject(ProductRepository);
  private readonly modelsRepository = inject(CandleModelRepository);
  readonly createFragrance = output<string>();
  readonly currency = formatCurrency;

  readonly modelId = signal(DEFAULT_CANDLE_MODEL.id);
  readonly fragranceIds = signal<string[]>([]);
  readonly customPriceCents = signal<number | null>(null);
  readonly minimumStock = signal(0);
  readonly additionalCost = signal(0);
  readonly active = signal(true);
  readonly recipe = signal<RecipeComponent[]>([]);
  readonly advancedExpanded = signal(false);

  readonly modelOptions = computed<BfSelectOption[]>(() => this.references.candleModels()
    .filter(item => item.active).map(item => ({value:item.id,label:item.name,description:formatCurrency(item.priceCents)})));
  readonly model = computed<CandleModel | undefined>(() =>
    this.references.candleModels().find(item => item.active && item.id === this.modelId()));
  readonly collection = computed(() => this.references.collections().find(item => item.id === this.model()?.sourceCollectionId));
  readonly sourceValid = computed(() => {
    const model=this.model(); return !!model && candleSourceValid(model,this.references.collections());
  });
  readonly fragranceOptions = computed<BfSelectOption[]>(() => {
    if (!this.sourceValid()) return [];
    return this.references.fragrances().filter(item => item.active && item.collectionId === this.model()?.sourceCollectionId)
      .map(item => ({value:item.id,label:item.name}));
  });
  readonly inputOptions = computed<BfSelectOption[]>(() => this.store.activeInputs().map(item => ({value:item.id,label:item.name})));
  readonly priceCents = computed(() => this.customPriceCents() ?? this.model()?.priceCents ?? null);
  fromPrice():number {return fromCents(this.priceCents() ?? 0);}
  readonly rows = computed(() => buildCandleCandidates(this.model(),this.fragranceIds(),
    this.references.fragrances(),this.references.collections(),this.store.products()));
  readonly freshRows = computed(() => this.rows().filter(item => !item.duplicate));
  readonly duplicateCount = computed(() => this.rows().filter(item => item.duplicate).length);
  readonly invalidRecipe = computed(() => this.recipe().some(item => !item.inputId || !item.unitId || !Number.isFinite(item.quantity) || item.quantity <= 0));
  readonly cost = computed(() => {
    if (!this.recipe().length) return null;
    try {
      return standardCostForProduct({recipe:this.recipe(),additionalCostCents:toCents(this.additionalCost()),averageUnitCostCents:0},
        {},new Map(this.store.inputs().map(item=>[item.id,item])));
    } catch {return null;}
  });
  readonly canSave = computed(() => {
    const price=this.priceCents();
    return this.references.initialized() && !this.references.loading() && this.store.initialized() &&
      this.sourceValid() && !!this.model() && this.fragranceIds().length > 0 &&
      this.fragranceIds().length <= 30 && this.rows().length === this.fragranceIds().length &&
      this.freshRows().length > 0 && price !== null && Number.isSafeInteger(price) && price >= 0 &&
      Number.isSafeInteger(this.minimumStock()) && this.minimumStock() >= 0 &&
      Number.isFinite(this.additionalCost()) && this.additionalCost() >= 0 && !this.invalidRecipe();
  });

  selectModel(id:string):void {
    if(this.modelId()===id) return;
    this.modelId.set(id);
    this.fragranceIds.set([]);
    this.customPriceCents.set(null);
  }
  setPrice(value:number):void {
    if (Number.isFinite(value) && value >= 0) this.customPriceCents.set(toCents(value));
  }
  addNewFragrance():void {
    const collectionId=this.model()?.sourceCollectionId;
    if(collectionId) this.createFragrance.emit(collectionId);
  }
  onFragranceSaved(id:string):void {
    if(this.references.fragrances().some(f=>f.id===id && f.collectionId===this.model()?.sourceCollectionId)) {
      this.fragranceIds.update(values=>[...new Set([...values,id])]);
    }
  }
  inputUnit(id:string):string {
    const input=this.store.inputs().find(item=>item.id===id);
    return this.references.units().find(item=>item.id===input?.unitId)?.name ?? '—';
  }
  addComponent():void {
    const input=this.store.activeInputs()[0];
    if(input) this.recipe.update(items=>[...items,{inputId:input.id,unitId:input.unitId,quantity:0}]);
  }
  updateComponent(index:number,patch:Partial<RecipeComponent>):void {
    this.recipe.update(items=>items.map((item,i)=>i===index?{...item,...patch}:item));
  }
  updateInput(index:number,id:string):void {
    const input=this.store.inputs().find(item=>item.id===id);
    this.updateComponent(index,{inputId:id,unitId:input?.unitId??''});
  }
  removeComponent(index:number):void {this.recipe.update(items=>items.filter((_,i)=>i!==index));}

  async save():Promise<{createdCount:number;singleProductId?:string}> {
    if(!this.canSave()) throw new Error('Revise o modelo, os aromas e o preço antes de cadastrar.');
    const model=this.model()!;
    const price=this.priceCents()!;
    // Reload authoritative references and products immediately before batch generation.
    const [currentProducts,storedModel] = await Promise.all([
      this.products.all(), this.modelsRepository.get(model.id),
    ]);
    // Built-in preset exists only in code until it is explicitly customized.
    if (model.id === DEFAULT_CANDLE_MODEL.id && !storedModel) {
      if (model.priceCents !== DEFAULT_CANDLE_MODEL.priceCents || model.volumeMl !== DEFAULT_CANDLE_MODEL.volumeMl)
        throw new Error('A configuração de vela mudou. Atualize a página.');
    } else if (!storedModel || !storedModel.active || storedModel.priceCents !== model.priceCents ||
        storedModel.volumeMl !== model.volumeMl || storedModel.sourceCollectionId !== model.sourceCollectionId ||
        storedModel.name !== model.name) {
      throw new Error('A configuração deste modelo mudou. Atualize o catálogo antes de salvar.');
    }
    const current = buildCandleCandidates(model,this.fragranceIds(),this.references.fragrances(),
      this.references.collections(),currentProducts);
    if(current.length !== this.fragranceIds().length || !this.sourceValid())
      throw new Error('Um dos aromas selecionados não está mais disponível.');
    const fresh=current.filter(item=>!item.duplicate);
    if(!fresh.length) throw new Error('Todas as velas selecionadas já estão cadastradas.');
    if(fresh.length>30) throw new Error('O limite de cadastro em lote é de 30 velas.');
    const result=await this.store.createProductVariations(fresh.map(row=>({
      id:'',code:'',active:this.active(),categoryId:'scented-candle',
      modelName:model.name,variantName:row.aroma,candleFragranceId:row.fragranceId,volumeMl:model.volumeMl,
      collectionId:'',fragranceId:'',formatId:'',displayName:row.displayName,
      salePriceCents:price,additionalCostCents:toCents(this.additionalCost()),averageUnitCostCents:0,
      stock:0,minimumStock:this.minimumStock(),recipe:this.recipe().map(part=>({...part})),
    } satisfies Product)));
    return {createdCount:result.length,singleProductId:result.length===1?result[0]?.id:undefined};
  }
}
