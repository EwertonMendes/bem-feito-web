import { describe, expect, it } from 'vitest';
import { allocateKitStock, availableKitCount } from './kit-stock';
import { Kit, Product } from '../models/catalog.model';

const product = (id: string, stock: number, fragranceId = id): Product => ({
  id, code: id, active: true, collectionId: 'classic', fragranceId, formatId: 'mini',
  displayName: id, salePriceCents: 100, additionalCostCents: 0, averageUnitCostCents: 0,
  stock, minimumStock: 0, recipe: [],
});
const kit = (rules: { quantity: number; fragranceId?: string }[]): Kit => ({
  id: 'kit', name: 'Kit Mini', active: true, priceCents: 1500,
  components: rules.map((rule, order) => ({
    id: String(order), order, formatId: 'mini', collectionId: 'classic',
    fragranceId: rule.fragranceId, quantity: rule.quantity,
  })),
});

describe('kit inventory availability', () => {
 it('supports a 100-unit kit distributed across three different fragrances', () => {
  const items = [product('a',35), product('b',35), product('c',30)];
  const value = kit([{quantity:100}]);
  expect(availableKitCount(value,items)).toBe(1);
  const allocation=allocateKitStock(value,items);
  expect(allocation?.length).toBe(100);
  expect(allocation?.filter(id=>id==='a').length).toBe(35);
  expect(allocation?.filter(id=>id==='b').length).toBe(35);
  expect(allocation?.filter(id=>id==='c').length).toBe(30);
 });
 it('resolves overlapping flexible and fixed requirements without allocating twice', () => {
  const value=kit([{quantity:2},{quantity:2,fragranceId:'a'}]);
  const items=[product('a',2),product('b',2)];
  expect(availableKitCount(value,items)).toBe(1);
  expect(allocateKitStock(value,items)?.sort()).toEqual(['a','a','b','b']);
 });
 it('detects insufficient items even when one type has stock', () => {
  const value=kit([{quantity:2,fragranceId:'missing'}]);
  expect(availableKitCount(value,[product('a',12)])).toBe(0);
  expect(allocateKitStock(value,[product('a',12)])).toBeNull();
 });
 it('counts the number of kits supported by available units', () => {
  expect(availableKitCount(kit([{quantity:2}]),[product('a',5),product('b',1)])).toBe(3);
 });
 it('excludes reserved units and inactive products', () => {
  const value=kit([{quantity:2}]);
  const items=[product('a',2),{...product('b',100),active:false}];
  expect(allocateKitStock(value,items,1,new Map([['a',1]]))).toBeNull();
 });
});
