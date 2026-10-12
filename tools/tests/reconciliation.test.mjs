import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {compareSnapshots} from '../reconciliation/compare-snapshots.mjs';
describe('read-only reconciliation',()=>{
it('ignores audit times, compares all business data',()=>{
 const a={source:'sheet',sales:[{id:'v1',totalCents:1100,createdAt:'old'}]};
 const b={source:'dev',sales:[{id:'v1',totalCents:1100,createdAt:'new'}]};
 const result=compareSnapshots(a,b);
 assert.equal(result.passed,true);
 assert.equal(result.totals.matched,1);
});
it('detects missing and divergent finance values',()=>{
 const result=compareSnapshots({sales:[{id:'a',totalCents:1100},{id:'b',totalCents:2}]},
  {sales:[{id:'a',totalCents:1200}]});
 assert.equal(result.passed,false);
 assert.equal(result.totals.divergent,1);
 assert.equal(result.totals.missing,1);
});
it('fails on duplicate source IDs, never silently combines records',()=>{
 assert.throws(()=>compareSnapshots({sales:[{id:'v1'},{id:'v1'}]},{}),/duplicado/);
});
});
