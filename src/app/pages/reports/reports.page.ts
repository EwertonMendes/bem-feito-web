import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ManagementReportsRepository } from '../../core/repositories/management-reports.repository';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { ManagementReport, ReportGroup } from '../../domain/logic/management-report';
import { DashboardPeriodPreset, dashboardPresetDateRange, formatBusinessDate, isValidBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { downloadCsv, exportCents } from '../../core/utils/csv-export';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';

type GroupKind='byProduct'|'byCollection'|'byFragrance'|'byFormat';
@Component({
  selector:'bf-management-reports-page',
  imports:[BfIcon,BfEmptyState],
  changeDetection:ChangeDetectionStrategy.OnPush,
  templateUrl:'./reports.page.html',
  styleUrl:'./reports.page.scss',
})
export class ReportsPage {
  private readonly repository=inject(ManagementReportsRepository);
  readonly references=inject(CatalogReferenceStore);
  private readonly destroyRef=inject(DestroyRef);
  private readonly errors=inject(ErrorService);
  private readonly toast=inject(ToastService);
  readonly money=formatCurrency;
  readonly date=formatBusinessDate;
  private readonly initial=dashboardPresetDateRange('month');
  readonly from=signal(this.initial.startDate);
  readonly to=signal(this.initial.endDate);
  readonly selectedPreset=signal<DashboardPeriodPreset|'custom'>('month');
  readonly selectedGroup=signal<GroupKind>('byProduct');
  readonly report=signal<ManagementReport|null>(null);
  readonly loading=signal(false);
  readonly error=signal('');
  readonly exporting=signal(false);
  readonly groups=computed<ReportGroup[]>(()=>this.report()?.[this.selectedGroup()]??[]);
  readonly maxRevenue=computed(()=>Math.max(1,...this.groups().map(g=>g.revenueCents)));
  readonly groupOptions:{key:GroupKind;label:string}[]=[
    {key:'byProduct',label:'Produtos'},{key:'byCollection',label:'Linhas'},
    {key:'byFragrance',label:'Fragrâncias'},{key:'byFormat',label:'Formatos'},
  ];
  private requestId=0;
  constructor(){
    this.destroyRef.onDestroy(this.references.activate());
    void this.initialize();
  }
  private async initialize():Promise<void>{
    await this.references.load();
    await this.load();
  }
  selectPeriod(preset:DashboardPeriodPreset):void{
    const range=dashboardPresetDateRange(preset);
    this.selectedPreset.set(preset);this.from.set(range.startDate);this.to.set(range.endDate);
    void this.load();
  }
  async load():Promise<void>{
    if(!isValidBusinessDate(this.from())||!isValidBusinessDate(this.to())||this.from()>this.to()){
      this.error.set('Escolha um intervalo válido.');return;
    }
    const id=++this.requestId;
    this.loading.set(true);this.error.set('');
    try{
      const labels={
        collection:new Map(this.references.collections().map(c=>[c.id,c.name])),
        fragrance:new Map(this.references.fragrances().map(c=>[c.id,c.name])),
        format:new Map(this.references.formats().map(c=>[c.id,c.name])),
      };
      const result=await this.repository.load(this.from(),this.to(),labels);
      if(id===this.requestId)this.report.set(result);
    }catch(error){
      if(id===this.requestId){this.error.set(this.errors.message(error));this.report.set(null);}
    }finally{if(id===this.requestId)this.loading.set(false);}
  }
  setCustomDate(field:'from'|'to',value:string):void{
    this.selectedPreset.set('custom');
    if(field==='from')this.from.set(value);else this.to.set(value);
  }
  exportCsv():void{
    if(!this.report())return;
    this.exporting.set(true);
    try{
      downloadCsv('bem-feito-relatorio-'+this.selectedGroup()+'.csv',
        ['Identificação','Categoria','Unidades','Receita (R$)','CMV (R$)','Lucro bruto (R$)','Margem (%)','Itens sem custo'],
        this.groups().map(g=>[g.key,g.label,g.units,exportCents(g.revenueCents),exportCents(g.cogsCents),
          exportCents(g.grossProfitCents),g.marginPercent===null?'Indisponível':g.marginPercent,g.missingCostItems]));
      this.toast.success('Relatório CSV preparado.');
    }finally{this.exporting.set(false);}
  }
}
