import { describe, expect, it } from 'vitest';
import { buildSoapCandidates, formatPriceForSelection } from './soap-product-builder';
import { Product, CollectionDefinition, FragranceDefinition, FormatDefinition, FormatPrice } from '../models/catalog.model';

const collections = [{id:'collection',name:'Mais Aroma',active:true}] as CollectionDefinition[];
const fragrances = [{id:'ocean',collectionId:'collection',name:'Ocean',active:true},{id:'tropical',collectionId:'collection',name:'Tropical',active:true}] as FragranceDefinition[];
const formats = [{id:'bar',name:'Barra',active:true},{id:'paw',name:'Patinha',active:true}] as FormatDefinition[];
const prices = [{id:'p',collectionId:'collection',formatId:'bar',active:true,priceCents:1700}] as FormatPrice[];
const selection = {collectionId:'collection',fragranceIds:['ocean','tropical'],formatIds:['bar','paw'],customPricesCents:{paw:800}};
describe('soap creation matrix',()=>{
  it('builds one independent price per fragrance × format',()=>{
    const result = buildSoapCandidates(selection,collections,fragrances,formats,prices,[]);
    expect(result).toHaveLength(4);
    expect(result.map(row=>row.priceCents)).toEqual([1700,800,1700,800]);
    expect(result.every(row=>!row.duplicate)).toBe(true);
  });
  it('does not fall back to invented prices',()=>{
    expect(formatPriceForSelection('collection','paw',prices,{})).toEqual({cents:null,source:'missing'});
    expect(formatPriceForSelection('collection','paw',prices,{paw:0})).toEqual({cents:0,source:'custom'});
  });
  it('flags existing identities including inactive products',()=>{
    const current = [{id:'old',categoryId:'soap',collectionId:'collection',fragranceId:'ocean',formatId:'bar',active:false}] as Product[];
    const result = buildSoapCandidates(selection,collections,fragrances,formats,prices,current);
    expect(result.filter(row=>row.duplicate).map(row=>row.displayName)).toEqual(['Mais Aroma · Ocean · Barra']);
  });
  it('deduplicates selections and rejects incompatible fragrance references',()=>{
    const result = buildSoapCandidates({...selection,fragranceIds:['ocean','ocean','missing']},collections,fragrances,formats,prices,[]);
    expect(result).toHaveLength(2);
  });
});
