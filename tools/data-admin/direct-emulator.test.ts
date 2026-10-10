import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
import {hash} from './schema.ts';
import {apply} from './engine.ts';
import {prepareDirect,validateDirectRequest} from './direct-gateway.ts';
import type {Archive} from './storage.ts';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080','Must run in isolated Firestore emulator');
const app=initializeApp({projectId:'demo-bem-feito'},'direct-gateway-emulator');
const db=getFirestore(app);
const archive:Archive={
  async put(prefix:string,value:unknown){return hash(value);},
  async get(){throw Error('Not needed for fresh test');},
  async assertAccess(){throw Error('Not called by emulator unit tests');},
} as any;
const actor={login:'tester',id:'123',requestSha:'a'.repeat(40),trustedSha:'b'.repeat(40),
  runId:'direct-emulator',commentId:''};
const base={schemaVersion:1,environment:'dev',projectId:'bem-feito-dev'};
const req=(payload:any)=>validateDirectRequest(JSON.stringify({...base,...payload}));
const clean=new Set<string>();
const tracked=(path:string)=>{clean.add(path);return db.doc(path);};
async function run(input:ReturnType<typeof req>) {
  const {request,plan}=await prepareDirect(input,db);
  const outcome=await apply(request,plan,db,archive,{...actor,approvedPlan:hash(plan)});
  assert.equal(outcome.validation,'readback-verified');
  tracked('dataAdminOperations/'+input.id);
  return {request,plan};
}
after(async()=>{for(const path of clean)await db.doc(path).delete();await deleteApp(app);});
test('one dispatch applies generic create, patch and delete without code tied to document ID',async()=>{
  const id='smoke-direct-fixture-317';
  const ref=tracked('dataAdminSmoke/'+id);
  await run(req({id:'direct-create-317',action:'create',collection:'dataAdminSmoke',documentId:id,values:{value:10}}));
  assert.equal((await ref.get()).data()?.value,10);
  await run(req({id:'direct-patch-317',action:'patch',collection:'dataAdminSmoke',documentId:id,
    expected:{value:10},values:{value:20}}));
  assert.equal((await ref.get()).data()?.value,20);
  await assert.rejects(prepareDirect(req({id:'direct-stale-317',action:'patch',collection:'dataAdminSmoke',
    documentId:id,expected:{value:10},values:{value:30}}),db),/precondition/);
  await run(req({id:'direct-delete-317',action:'delete',collection:'dataAdminSmoke',documentId:id}));
  assert.equal((await ref.get()).exists,false);
});
test('reverses arbitrary multi-movement production and preserves earlier stock changes',async()=>{
  const pid='direct-production-317', productId='direct-product-317', inputId='direct-input-317';
  const production=tracked('productions/'+pid),product=tracked('products/'+productId),
    input=tracked('inputs/'+inputId),movement=tracked('stockMovements/direct-movement-317'),
    consumed=tracked('stockMovements/direct-consumed-317'),prior=tracked('stockMovements/direct-prior-317');
  const now=Timestamp.now(),old=new Timestamp(now.seconds-200,0);
  await production.set({businessDate:'2026-10-10',productId,quantity:5,consumptions:[{inputId,quantity:10}],
    items:[{productId,quantity:5,consumptions:[{inputId,quantity:10}]}]});
  await product.set({stock:7,reservedPhysicalStock:0,minimumStock:0,stockStatus:'ok'});
  await input.set({stock:10,minimumStock:0,minimumStockConfigured:true,trackingMode:'exact'});
  await movement.set({sourceType:'production',sourceId:pid,businessDate:'2026-10-10',itemType:'product',
    itemId:productId,quantityDelta:5,createdAt:now});
  await consumed.set({sourceType:'production',sourceId:pid,businessDate:'2026-10-10',itemType:'input',
    itemId:inputId,quantityDelta:-10,createdAt:now});
  await prior.set({sourceType:'adjustment',sourceId:'previous',businessDate:'2026-10-09',
    itemType:'product',itemId:productId,quantityDelta:2,createdAt:old});
  await run(req({id:'direct-reverse-317',action:'reverseProduction',documentId:pid}));
  assert.equal((await production.get()).exists,false);
  assert.equal((await movement.get()).exists,false);
  assert.equal((await consumed.get()).exists,false);
  assert.equal((await prior.get()).exists,true);
  assert.equal((await product.get()).data()?.stock,2);
  assert.equal((await input.get()).data()?.stock,20);
});
test('reversal refuses downstream stock activity instead of corrupting a sale',async()=>{
  const pid='direct-production-blocked-317',itemId='direct-product-blocked-317';
  const production=tracked('productions/'+pid),product=tracked('products/'+itemId),
    movement=tracked('stockMovements/direct-source-blocked-317'),
    newer=tracked('stockMovements/direct-newer-blocked-317');
  const now=Timestamp.now();
  await production.set({businessDate:'2026-10-10',productId:itemId,quantity:3,consumptions:[]});
  await product.set({stock:4,minimumStock:0,reservedPhysicalStock:0});
  await movement.set({sourceType:'production',sourceId:pid,businessDate:'2026-10-10',
    itemType:'product',itemId,quantityDelta:3,createdAt:now});
  await newer.set({sourceType:'sale',sourceId:'real-sale',businessDate:'2026-10-10',
    itemType:'product',itemId,quantityDelta:-1,createdAt:new Timestamp(now.seconds+200,0)});
  await assert.rejects(prepareDirect(req({id:'blocked-317',action:'reverseProduction',documentId:pid}),db),
    /Subsequent stock movement/);
  assert.equal((await production.get()).exists,true);
});
test('stock adjustment atomically writes consistent balance, counter and movement',async()=>{
  const id='direct-product-adjust-317',operation='direct-adjust-317';
  const product=tracked('products/'+id),adjustment=tracked('stockAdjustments/admin-'+operation),
    movement=tracked('stockMovements/admin-'+operation);
  const counter=tracked('counters/stockAdjustment');
  const previous=await counter.get();
  await product.set({stock:4,minimumStock:0,reservedPhysicalStock:0,averageUnitCostCents:150});
  try {
    await run(req({id:operation,action:'adjustStock',itemType:'product',itemId:id,quantityDelta:2,
      reason:'Inventory count',businessDate:'2026-10-10'}));
    assert.equal((await product.get()).data()?.stock,6);
    assert.equal((await adjustment.get()).data()?.quantityDelta,2);
    assert.equal((await movement.get()).data()?.sourceType,'adjustment');
  } finally {
    if(previous.exists)await counter.set(previous.data()!);
    else await counter.delete();
    clean.delete('counters/stockAdjustment');
  }
});
