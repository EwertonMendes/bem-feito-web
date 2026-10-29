import {describe,expect,it} from 'vitest';
import type { AdvancedSaleLineDraft } from '../../../../domain/logic/advanced-sale-edit';
import { orderSaleCorrectionLines } from './sale-correction-lines';
const item=(id:string):AdvancedSaleLineDraft=>({
  id,kind:'product',sourceId:id,quantity:1,unitPriceCents:100,
});
describe('sale editor display ordering',()=>{
  it('shows newest added items first and keeps historic items in their order',()=>{
    const existing=[item('historic-1'),item('historic-2')];
    const added=[item('new-1'),item('new-2')];
    const draft=[...existing,...added];
    expect(orderSaleCorrectionLines(draft,existing).map(x=>x.id))
      .toEqual(['new-2','new-1','historic-1','historic-2']);
    expect(draft.map(x=>x.id)).toEqual(['historic-1','historic-2','new-1','new-2']);
  });
  it('handles removing a line without changing the draft or original ordering',()=>{
    const old=[item('original-1'),item('original-2')];
    expect(orderSaleCorrectionLines([old[1]!,item('new')],old).map(x=>x.id))
      .toEqual(['new','original-2']);
  });
  it('keeps a restored historical item in the historical group',()=>{
    const old=[item('original')];
    expect(orderSaleCorrectionLines([item('fresh'),old[0]!],old).map(x=>x.id))
      .toEqual(['fresh','original']);
  });
});
