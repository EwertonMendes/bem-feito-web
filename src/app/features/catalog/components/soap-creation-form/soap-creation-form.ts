import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { BfCheckbox } from '../../../../shared/ui/checkbox/checkbox';
import { BfIcon } from '../../../../shared/ui/icon/icon';
import { BfNumberInput } from '../../../../shared/ui/number-input/number-input';
import { BfMultiSelect } from '../../../../shared/ui/multi-select/multi-select';
import { BfSelect, BfSelectOption } from '../../../../shared/ui/select/select';
import { BfSelectSearch } from '../../../../shared/ui/select-search/select-search';
import { Product, RecipeComponent } from '../../../../domain/models/catalog.model';
import { standardCostForProduct } from '../../../../domain/logic/costing';
import { buildSoapCandidates, SoapCandidate, SoapCreationSelection, formatPriceForSelection } from '../../../../domain/logic/soap-product-builder';
import { formatCurrency, fromCents, toCents } from '../../../../core/utils/money';
import { ProductRepository } from '../../../../core/repositories/catalog.repository';
import { CatalogReferenceStore } from '../../catalog-reference.store';
import { CatalogStore } from '../../catalog.store';

@Component({
  selector: 'bf-soap-creation-form',
  imports: [BfCheckbox, BfIcon, BfNumberInput, BfMultiSelect, BfSelect, BfSelectSearch],
  templateUrl: './soap-creation-form.html',
  styleUrl: './soap-creation-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SoapCreationForm {
  readonly references = inject(CatalogReferenceStore);
  readonly store = inject(CatalogStore);
  private readonly repository = inject(ProductRepository);
  readonly createReference = output<'collection' | 'fragrance' | 'format'>();
  readonly currency = formatCurrency;

  readonly collectionId = signal('');
  readonly fragranceIds = signal<string[]>([]);
  readonly formatIds = signal<string[]>([]);
  readonly customPricesCents = signal<Record<string, number>>({});
  readonly minimumStock = signal(0);
  readonly additionalCost = signal(0);
  readonly active = signal(true);
  readonly recipe = signal<RecipeComponent[]>([]);
  readonly advancedExpanded = signal(false);

  readonly collectionOptions = computed<BfSelectOption[]>(() => [
    {value:'',label:'Selecione uma coleção'},
    ...this.references.collections().filter(item => item.active).map(item => ({value:item.id,label:item.name})),
  ]);
  readonly fragranceOptions = computed<BfSelectOption[]>(() => this.references.fragrances()
    .filter(item => item.active && item.collectionId === this.collectionId())
    .map(item => ({value:item.id,label:item.name})));
  readonly formatOptions = computed<BfSelectOption[]>(() => this.references.formats()
    .filter(item => item.active).map(item => ({
      value:item.id,
      label:item.approximateWeightGrams ? item.name + ' · ' + item.approximateWeightGrams + ' g' : item.name,
    })));
  readonly activeInputOptions = computed<BfSelectOption[]>(() => this.store.inputs()
    .filter(item=>item.active).map(item=>({value:item.id,label:item.name})));

  private readonly selection = computed<SoapCreationSelection>(() => ({
    collectionId:this.collectionId(),
    fragranceIds:this.fragranceIds(),
    formatIds:this.formatIds(),
    customPricesCents:this.customPricesCents(),
  }));
  readonly rows = computed(() => {
    const rows = buildSoapCandidates(this.selection(),this.references.collections(),this.references.fragrances(),
      this.references.formats(),this.references.formatPrices(),this.store.products());
    const collection = this.references.collections().find(item=>item.id===this.collectionId());
    const fragranceMap = new Map(this.references.fragrances().map(item=>[item.id,item]));
    const formatMap = new Map(this.references.formats().map(item=>[item.id,item]));
    const inputs = new Map(this.store.inputs().map(item=>[item.id,item]));
    return rows.map(row => {
      try {
        const cost = standardCostForProduct(
          {recipe:this.validRecipe(),additionalCostCents:toCents(this.additionalCost()),averageUnitCostCents:0},
          {collection,fragrance:fragranceMap.get(row.fragranceId),format:formatMap.get(row.formatId)},inputs);
        return {...row,costCents:cost.unitCostCents,costPending:cost.costPending};
      } catch {
        return {...row,costCents:0,costPending:true};
      }
    });
  });
  readonly freshRows = computed(() => this.rows().filter(row => !row.duplicate));
  readonly duplicateCount = computed(() => this.rows().filter(row => row.duplicate).length);
  readonly missingPrices = computed(() => this.freshRows().filter(row => row.priceCents === null).length);
  readonly candidateCount = computed(() => this.fragranceIds().length * this.formatIds().length);
  readonly canSave = computed(() =>
    !!this.collectionId() && this.fragranceIds().length > 0 && this.formatIds().length > 0 &&
    this.rows().length === this.candidateCount() && this.freshRows().length > 0 &&
    this.freshRows().length <= 30 && this.missingPrices() === 0 &&
    Number.isSafeInteger(this.minimumStock()) && this.minimumStock() >= 0 &&
    Number.isFinite(this.additionalCost()) && this.additionalCost() >= 0 &&
    this.freshRows().every(row=>row.priceCents !== null && Number.isSafeInteger(row.priceCents) && row.priceCents >= 0));
  readonly validRecipe = computed(() => this.recipe().filter(item => item.inputId && item.unitId && item.quantity > 0));

  setCollection(collectionId:string):void {
    if(this.collectionId()===collectionId) return;
    this.collectionId.set(collectionId);
    this.fragranceIds.set([]);
    this.customPricesCents.set({});
  }
  onReferenceSaved(kind:'collections'|'fragrances'|'formats',id:string):void {
    if(kind==='collections') this.setCollection(id);
    if(kind==='fragrances') this.fragranceIds.update(old=>[...new Set([...old,id])]);
    if(kind==='formats') this.formatIds.update(old=>[...new Set([...old,id])]);
  }
  priceFor(formatId:string):number {
    const price = formatPriceForSelection(this.collectionId(),formatId,this.references.formatPrices(),this.customPricesCents());
    return fromCents(price.cents ?? 0);
  }
  priceSource(formatId:string):'default'|'custom'|'missing' {
    return formatPriceForSelection(this.collectionId(),formatId,this.references.formatPrices(),this.customPricesCents()).source;
  }
  setPrice(formatId:string,value:number):void {
    if(!Number.isFinite(value)) return;
    this.customPricesCents.update(old=>({...old,[formatId]:toCents(value)}));
  }
  restorePrice(formatId:string):void {
    this.customPricesCents.update(old=>{const result={...old};delete result[formatId];return result;});
  }
  formatName(id:string):string {
    return this.references.formats().find(item=>item.id===id)?.name ?? 'Formato';
  }
  inputUnitName(inputId:string):string {
    const input = this.store.inputs().find(item=>item.id===inputId);
    return this.references.units().find(item=>item.id===input?.unitId)?.name ?? '—';
  }
  addComponent():void {
    const input = this.store.inputs().find(item=>item.active);
    if(input) this.recipe.update(old=>[...old,{inputId:input.id,unitId:input.unitId,quantity:0}]);
  }
  changeComponent(index:number,patch:Partial<RecipeComponent>):void {
    this.recipe.update(old=>old.map((item,i)=>i===index?{...item,...patch}:item));
  }
  changeComponentInput(index:number,id:string):void {
    const input=this.store.inputs().find(item=>item.id===id);
    this.changeComponent(index,{inputId:id,unitId:input?.unitId??''});
  }
  removeComponent(index:number):void {
    this.recipe.update(old=>old.filter((_,i)=>i!==index));
  }
  previewMargin(row:{priceCents:number|null;costCents:number;costPending:boolean}):number|null {
    if(row.costPending || row.priceCents===null || row.priceCents<=0) return null;
    return Math.round(((row.priceCents-row.costCents)/row.priceCents)*100);
  }
  private validate(candidates:readonly SoapCandidate[]):void {
    if(!this.canSave()) throw new Error('Revise coleção, fragrâncias, formatos, preços e limites do cadastro.');
    if(candidates.length !== this.candidateCount()) throw new Error('Uma das referências selecionadas não está mais disponível. Revise o cadastro.');
    if(candidates.some(row => !row.duplicate && (row.priceCents === null || !Number.isSafeInteger(row.priceCents) || row.priceCents < 0)))
      throw new Error('Há formatos sem preço válido. Configure o preço antes de continuar.');
  }
  async save():Promise<number> {
    this.validate(this.rows());
    // Releitura autoritativa para impedir salvar sobre um catálogo desatualizado.
    const existing = await this.repository.all();
    const current = buildSoapCandidates(this.selection(),this.references.collections(),this.references.fragrances(),
      this.references.formats(),this.references.formatPrices(),existing);
    this.validate(current);
    const candidates=current.filter(row=>!row.duplicate);
    if(!candidates.length) throw new Error('Todas as combinações já estão cadastradas.');
    if(candidates.length > 30) throw new Error('O limite por cadastro é de 30 produtos.');
    const products:Product[] = candidates.map(row=>({
      id:'',code:'',categoryId:'soap',active:this.active(),
      collectionId:this.collectionId(),fragranceId:row.fragranceId,formatId:row.formatId,
      displayName:row.displayName,salePriceCents:row.priceCents!,
      additionalCostCents:toCents(this.additionalCost()),averageUnitCostCents:0,
      stock:0,minimumStock:this.minimumStock(),recipe:this.validRecipe().map(item=>({...item})),
    }));
    await this.store.createProductVariations(products);
    return products.length;
  }
}
