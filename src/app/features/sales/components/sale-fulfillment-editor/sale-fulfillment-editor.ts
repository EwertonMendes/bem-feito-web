import { ChangeDetectionStrategy,Component,input,output } from '@angular/core';
import {Sale} from '../../../../domain/models/sales.model';
import {FulfillmentStage,currentFulfillmentStage} from '../../../../domain/logic/fulfillment-correction';
import {BfSelect} from '../../../../shared/ui/select/select';
import {BfCheckbox} from '../../../../shared/ui/checkbox/checkbox';
import {BfIcon} from '../../../../shared/ui/icon/icon';

/** Pure presentation. The parent owns edits and the transaction. */
@Component({
  selector:'bf-sale-fulfillment-editor',
  imports:[BfSelect,BfCheckbox,BfIcon],
  changeDetection:ChangeDetectionStrategy.OnPush,
  templateUrl:'./sale-fulfillment-editor.html',
  styleUrl:'./sale-fulfillment-editor.scss',
})
export class SaleFulfillmentEditor {
  readonly sale=input.required<Sale>();
  readonly target=input.required<FulfillmentStage>();
  readonly reason=input.required<string>();
  readonly physicalConfirmed=input.required<boolean>();
  readonly error=input('');
  readonly targetChange=output<FulfillmentStage>();
  readonly reasonChange=output<string>();
  readonly physicalConfirmedChange=output<boolean>();
  readonly options=[
    {value:'in-production',label:'Em produção (encomenda)'},
    {value:'ready',label:'Pronta para entrega'},
    {value:'delivered',label:'Entregue'},
  ];
  readonly currentFulfillmentStage=currentFulfillmentStage;

  label(stage:FulfillmentStage):string {
    return stage==='in-production'?'Em produção':stage==='ready'?'Pronta':'Entregue';
  }
  changeTarget(value:string):void {
    if(value!=='in-production'&&value!=='ready'&&value!=='delivered')return;
    this.targetChange.emit(value);
    this.physicalConfirmedChange.emit(false);
  }
}
