import {describe,it,expect} from 'vitest';
import {buildCandleCandidates} from './candle-variation-builder';
import {DEFAULT_CANDLE_MODEL} from './candle-model';
import {Product,CollectionDefinition,FragranceDefinition} from '../models/catalog.model';
const collections=[{id:'ma',name:'Mais Aroma',active:true},{id:'cl',name:'Clássica',active:true}] as CollectionDefinition[];
const fragrances=[{id:'a',collectionId:'ma',name:'Éros',active:true},{id:'b',collectionId:'ma',name:'Ocean',active:true},{id:'c',collectionId:'cl',name:'Mel',active:true}] as FragranceDefinition[];
const model={...DEFAULT_CANDLE_MODEL,sourceCollectionId:'ma'};
const existing=[{id:'legacy',categoryId:'scented-candle',modelName:'Vela 40 ml',variantName:'EROS',volumeMl:40,active:false}] as Product[];
describe('candle variation builder',()=>{
it('generates only fragrances from the configured active collection',()=>{
 const rows=buildCandleCandidates(model,['a','b','a','c'],fragrances,collections,[]);
 expect(rows.map(x=>x.aroma)).toEqual(['Éros','Ocean']);
});
it('detects an existing inactive legacy candle case/accent-insensitively',()=>{
 const rows=buildCandleCandidates(model,['a','b'],fragrances,collections,existing);
 expect(rows.map(x=>x.duplicate)).toEqual([true,false]);
});
it('uses stable aroma ids after renaming',()=>{
 const old=[{...existing[0],variantName:'Antigo nome',candleFragranceId:'a'}] as Product[];
 expect(buildCandleCandidates(model,['a'],fragrances,collections,old)[0]?.duplicate).toBe(true);
});
it('requires active source and valid volume',()=>{
 expect(buildCandleCandidates({...model,sourceCollectionId:'x'},['a'],fragrances,collections,[])).toEqual([]);
 expect(buildCandleCandidates({...model,active:false},['a'],fragrances,collections,[])).toEqual([]);
});
});
