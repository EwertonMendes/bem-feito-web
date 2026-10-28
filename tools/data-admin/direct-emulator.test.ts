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
test('audited batchPatch changes two costing references in one transaction',async()=>{
  const fmt=tracked('formats/direct-batch-f-317');
  const col=tracked('collections/direct-batch-c-317');
  await fmt.set({name:'Floral',approximateWeightGrams:90,active:true});
  await col.set({name:'Clássica',active:true});
  const changes=[
    {collection:'formats',documentId:fmt.id,expected:{approximateWeightGrams:90},values:{approximateWeightGrams:77.5}},
    {collection:'collections',documentId:col.id,expected:{},expectedAbsent:['fragranceCostPool'],values:{fragranceCostPool:'fragrance-classic'}},
  ];
  await run(req({id:'direct-batch-317',action:'batchPatch',changes}));
  assert.equal((await fmt.get()).data()?.approximateWeightGrams,77.5);
  assert.equal((await col.get()).data()?.fragranceCostPool,'fragrance-classic');
  await assert.rejects(prepareDirect(req({id:'direct-batch-stale-317',action:'batchPatch',changes}),db),/precondition/i);
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

test('generic expense receipt changes only the requested fields and preserves cash records',async()=>{
  const id='direct-equipment-317';
  const ref=tracked('expenses/'+id);
  await ref.set({kind:'equipment',code:'M000013',amountCents:3800,bankDebitCents:3800,
    businessDate:'2026-10-07',receiptStatus:'pending',stockApplied:false,
    notes:'Two mini flower molds',createdBy:'original',extra:{untouched:true}});
  await run(req({id:'direct-receipt-317',action:'patch',collection:'expenses',documentId:id,
    expected:{receiptStatus:'pending'},values:{receiptStatus:'received'}}));
  const after=(await ref.get()).data()!;
  assert.equal(after.receiptStatus,'received');
  assert.equal(after.amountCents,3800);
  assert.equal(after.bankDebitCents,3800);
  assert.equal(after.stockApplied,false);
  assert.deepEqual(after.extra,{untouched:true});
  await assert.rejects(prepareDirect(req({id:'direct-receipt-stale-317',action:'patch',collection:'expenses',
    documentId:id,expected:{receiptStatus:'pending'},values:{receiptStatus:'received'}}),db),/precondition/i);
});

test('delivers a ready order atomically, clears allocations and preserves unpaid balance',async()=>{
  const code='V00981', sid='test-sale-delivery-981';
  const productId='test-delivery-product-981', inputId='test-delivery-input-981';
  const sale=tracked('sales/'+sid), product=tracked('products/'+productId),
    input=tracked('inputs/'+inputId);
  const m1=tracked('stockMovements/admin-delivery-'+code+'-01');
  const m2=tracked('stockMovements/admin-delivery-'+code+'-02');
  await product.set({stock:5,committedStock:2,reservedPhysicalStock:2,
    explicitCommittedStock:2,explicitAllocatedStock:2,minimumStock:0,stockStatus:'ok'});
  await input.set({stock:7,committedStock:5,reservedPhysicalStock:5,
    minimumStock:0,minimumStockConfigured:true,trackingMode:'exact',stockStatus:'ok'});
  await sale.set({code,businessDate:'2026-10-20',status:'active',fulfillmentStatus:'ready',
    stockApplied:false,paymentStatus:'pending',totalCents:3800,receivedCents:0,
    balanceCents:3800,paymentIds:[],
    items:[{id:'line-1',kind:'product',sourceId:productId,quantity:2}],
    orderAllocations:[{lineId:'line-1',productId,quantity:2}],
    stockEffects:[
      {itemType:'product',itemId:productId,quantityDelta:-2,unitCostCents:115},
      {itemType:'input',itemId:inputId,quantityDelta:-5,unitCostCents:20},
    ]});
  await run(req({id:'direct-delivery-981',action:'deliverSale',saleCode:code}));
  const sd=(await sale.get()).data()!,pd=(await product.get()).data()!,ind=(await input.get()).data()!;
  assert.equal(sd.fulfillmentStatus,'delivered');
  assert.equal(sd.stockApplied,true);
  assert.equal(sd.paymentStatus,'pending');
  assert.equal(sd.balanceCents,3800);
  assert.deepEqual(sd.paymentIds,[]);
  assert.deepEqual([pd.stock,pd.committedStock,pd.reservedPhysicalStock,
    pd.explicitCommittedStock,pd.explicitAllocatedStock],[3,0,0,0,0]);
  assert.deepEqual([ind.stock,ind.committedStock,ind.reservedPhysicalStock],[2,0,0]);
  assert.deepEqual([(await m1.get()).data()?.quantityDelta,(await m2.get()).data()?.quantityDelta],[-2,-5]);
  assert.equal((await m1.get()).data()?.sourceId,sid);
  await assert.rejects(prepareDirect(req({id:'direct-delivery-second-981',action:'deliverSale',saleCode:code}),db),
    /Only ready and unfulfilled/);
});
test('delivery refuses inconsistent reservations without changing ledger or finances',async()=>{
  const code='V00982',sid='test-sale-delivery-982',productId='test-delivery-product-982';
  const sale=tracked('sales/'+sid),product=tracked('products/'+productId);
  await product.set({stock:5,committedStock:2,reservedPhysicalStock:1,minimumStock:0});
  await sale.set({code,status:'active',fulfillmentStatus:'ready',stockApplied:false,
    balanceCents:2000,paymentStatus:'pending',items:[{id:'line-1',kind:'product',
      sourceId:productId,quantity:2}],stockEffects:[{itemType:'product',itemId:productId,
      quantityDelta:-2,unitCostCents:100}]});
  await assert.rejects(prepareDirect(req({id:'direct-delivery-blocked-982',action:'deliverSale',saleCode:code}),db),
    /Physical inventory or delivery reservation inconsistent/);
  assert.equal((await sale.get()).data()?.fulfillmentStatus,'ready');
  assert.equal((await product.get()).data()?.stock,5);
});

test('atomic fully paid sale creates receipt, sale, ledger, stock decrement and sequence counters',async()=>{
  const code='V00983',paymentCode='P000983',id='sale-fixture-983',
    productId='paid-product-983',methodId='pix-method-983',itemId='I000983';
  const sc=tracked('counters/sale'),pc=tracked('counters/payment');
  const beforeSC=await sc.get(),beforePC=await pc.get();
  const product=tracked('products/'+productId),method=tracked('paymentMethods/'+methodId),
    sale=tracked('sales/'+code),payment=tracked('payments/'+paymentCode),
    movement=tracked('stockMovements/admin-sale-'+code);
  await sc.set({value:982});
  await pc.set({value:982});
  await product.set({active:true,displayName:'Mais Aroma · Tropical · Floral',
    categoryId:'soap',collectionId:'col1',fragranceId:'fr1',formatId:'fmt1',
    salePriceCents:1600,stock:1,committedStock:0,reservedPhysicalStock:0,
    minimumStock:3,averageUnitCostCents:0,stockStatus:'low'});
  await method.set({name:'Pix',active:true});
  try {
    await run(req({id,action:'recordPaidSale',saleCode:code,paymentCode,
      lineItemId:itemId,productId,paymentMethodId:methodId,quantity:1,
      unitPriceCents:1600,expectedAvailableStock:1,customerName:'Isabele',
      businessDate:'2026-10-21'}));
    const a=(await sale.get()).data()!,p=(await payment.get()).data()!,
      pr=(await product.get()).data()!,m=(await movement.get()).data()!;
    assert.deepEqual([a.code,a.customerName,a.fulfillmentStatus,a.stockApplied,
      a.paymentStatus,a.totalCents,a.receivedCents,a.balanceCents],
      [code,'Isabele','delivered',true,'paid',1600,1600,0]);
    assert.deepEqual(a.paymentIds,[paymentCode]);
    assert.equal(a.items[0].id,itemId);
    assert.equal(a.items[0].sourceId,productId);
    assert.equal(a.items[0].categoryId,'soap');
    assert.equal(a.missingCostItems,1);
    assert.equal(a.customerSearchKey,'isabele');
    assert.equal(a.customerSearchPrefixes.includes('isab'),true);
    assert.deepEqual([p.code,p.methodId,p.appliedCents,p.status,p.saleId],
      [paymentCode,methodId,1600,'active',code]);
    assert.deepEqual([pr.stock,pr.reservedPhysicalStock,pr.committedStock],[0,0,0]);
    assert.deepEqual([m.itemId,m.quantityDelta,m.sourceId,m.sourceType],
      [productId,-1,code,'sale']);
    assert.equal((await sc.get()).data()?.value,983);
    assert.equal((await pc.get()).data()?.value,983);
    await assert.rejects(prepareDirect(req({id:'sale-fixture-983-duplicate',action:'recordPaidSale',
      saleCode:code,paymentCode,lineItemId:itemId,productId,paymentMethodId:methodId,
      quantity:1,unitPriceCents:1600,expectedAvailableStock:1,
      customerName:'Isabele',businessDate:'2026-10-21'}),db),/Spreadsheet codes disagree/);
  } finally {
    if(beforeSC.exists)await sc.set(beforeSC.data()!);else await sc.delete();
    if(beforePC.exists)await pc.set(beforePC.data()!);else await pc.delete();
    clean.delete('counters/sale');clean.delete('counters/payment');
  }
});
test('paid cash sale requires catalog price and writes money plus a single stock movement',async()=>{
  const code='V00985',paymentCode='P000985',id='sale-fixture-cash-985',
    productId='cash-product-985',methodId='cash-method-985',itemId='I000985';
  const sc=tracked('counters/sale'),pc=tracked('counters/payment');
  const beforeSC=await sc.get(),beforePC=await pc.get();
  const product=tracked('products/'+productId),method=tracked('paymentMethods/'+methodId),
    sale=tracked('sales/'+code),payment=tracked('payments/'+paymentCode),
    movement=tracked('stockMovements/admin-sale-'+code);
  await sc.set({value:984}); await pc.set({value:984});
  await product.set({active:true,displayName:'Clássica · Mel · Patinha M',
    categoryId:'soap',collectionId:'col1',fragranceId:'fr1',formatId:'fmt1',
    salePriceCents:600,stock:1,committedStock:0,reservedPhysicalStock:0,
    minimumStock:0,averageUnitCostCents:128,stockStatus:'ok'});
  await method.set({name:'Dinheiro',active:true});
  const params={id,action:'recordPaidSale',saleCode:code,paymentCode,
    lineItemId:itemId,productId,paymentMethodId:methodId,quantity:1,
    unitPriceCents:600,expectedAvailableStock:1,customerName:'Rafael',
    businessDate:'2026-10-22'};
  try {
    await assert.rejects(prepareDirect(req({...params,unitPriceCents:750}),db),/Sale price differs from active catalog/);
    await run(req(params));
    const a=(await sale.get()).data()!,p=(await payment.get()).data()!,
      pr=(await product.get()).data()!,m=(await movement.get()).data()!;
    assert.deepEqual([a.code,a.customerName,a.fulfillmentStatus,a.paymentStatus,a.totalCents,
      a.receivedCents,a.balanceCents,a.stockApplied],
      [code,'Rafael','delivered','paid',600,600,0,true]);
    assert.match(a.notes,/Dinheiro/);
    assert.equal(a.items[0].unitPriceCents,600);
    assert.equal(p.methodId,methodId);
    assert.equal(p.appliedCents,600);
    assert.equal(pr.stock,0);
    assert.equal(pr.salePriceCents,600);
    assert.deepEqual([m.quantityDelta,m.sourceType,m.sourceId],[-1,'sale',code]);
  } finally {
    if(beforeSC.exists)await sc.set(beforeSC.data()!);else await sc.delete();
    if(beforePC.exists)await pc.set(beforePC.data()!);else await pc.delete();
    clean.delete('counters/sale');clean.delete('counters/payment');
  }
});

test('corrects an already recorded cash sale to catalog price atomically without another stock debit',async()=>{
  const code='V00986',paymentCode='P000986',productId='correction-product-986',
    methodId='cash-correction-method-986',id='correct-cash-986';
  const sale=tracked('sales/'+code),receipt=tracked('payments/'+paymentCode),
    product=tracked('products/'+productId),method=tracked('paymentMethods/'+methodId),
    movement=tracked('stockMovements/admin-sale-'+code);
  await product.set({active:true,displayName:'Clássica · Mel · Patinha M',
    salePriceCents:600,stock:0,minimumStock:0,averageUnitCostCents:128,
    committedStock:0,reservedPhysicalStock:0});
  await method.set({name:'Dinheiro',active:true});
  const effect={itemType:'product',itemId:productId,quantityDelta:-1,unitCostCents:128};
  const line={id:'I000986',kind:'product',sourceId:productId,quantity:1,
    unitPriceCents:750,totalCents:750,totalCostCents:128,unitCostCents:128,
    stockEffects:[effect]};
  await sale.set({code,customerName:'Rafael',businessDate:'2026-10-22',
    status:'active',fulfillmentStatus:'delivered',stockApplied:true,paymentStatus:'paid',
    discountCents:0,tipCents:0,balanceCents:0,itemsSold:1,
    subtotalCents:750,totalCents:750,receivedCents:750,
    paymentIds:[paymentCode],items:[line],stockEffects:[effect],cogsCents:128,
    notes:'Preço manual incorreto'});
  await receipt.set({code:paymentCode,saleId:code,businessDate:'2026-10-22',
    methodId,amountReceivedCents:750,appliedCents:750,tipCents:0,status:'active'});
  await movement.set({...effect,sourceType:'sale',sourceId:code,businessDate:'2026-10-22'});
  const params={id,action:'correctPaidSalePrice',saleCode:code,paymentCode,
    productId,paymentMethodId:methodId,customerName:'Rafael',businessDate:'2026-10-22',
    expectedOriginalTotalCents:750,unitPriceCents:600};
  await assert.rejects(prepareDirect(req({...params,expectedOriginalTotalCents:800}),db),
    /Sale state differs/);
  await run(req(params));
  const [a,p,pr,m]=await Promise.all([sale.get(),receipt.get(),product.get(),movement.get()]);
  assert.deepEqual([a.data()!.subtotalCents,a.data()!.totalCents,
    a.data()!.receivedCents,a.data()!.balanceCents,a.data()!.items[0].totalCents,
    a.data()!.items[0].unitPriceCents,p.data()!.amountReceivedCents,p.data()!.appliedCents],
    [600,600,600,0,600,600,600,600]);
  assert.match(a.data()!.notes,/corrigido/);
  assert.deepEqual([pr.data()!.stock,pr.data()!.salePriceCents,m.data()!.quantityDelta],
    [0,600,-1]);
  assert.deepEqual(a.data()!.stockEffects,[effect]);
  assert.equal(a.data()!.cogsCents,128);
  await assert.rejects(prepareDirect(req(params),db),/Sale state differs/);
});

test('paid sale refuses selling a physically reserved unit',async()=>{
  const sc=tracked('counters/sale'),pc=tracked('counters/payment');
  const bsc=await sc.get(),bpc=await pc.get();
  const productId='paid-product-reserved-984',methodId='pix-method-984';
  const product=tracked('products/'+productId),method=tracked('paymentMethods/'+methodId);
  await sc.set({value:983}); await pc.set({value:983});
  await product.set({active:true,displayName:'Floral Tropical',salePriceCents:1600,
    stock:1,committedStock:1,reservedPhysicalStock:1,minimumStock:0,averageUnitCostCents:0});
  await method.set({name:'Pix',active:true});
  try {
    await assert.rejects(prepareDirect(req({id:'sale-fixture-reserved-984',
      action:'recordPaidSale',saleCode:'V00984',paymentCode:'P000984',
      lineItemId:'I000984',productId,paymentMethodId:methodId,quantity:1,
      unitPriceCents:1600,expectedAvailableStock:1,customerName:'Isabele',
      businessDate:'2026-10-21'}),db),/Physical inventory or reserved quantities changed/);
    assert.equal((await product.get()).data()?.stock,1);
    assert.equal((await db.doc('sales/V00984').get()).exists,false);
  } finally {
    if(bsc.exists)await sc.set(bsc.data()!);else await sc.delete();
    if(bpc.exists)await pc.set(bpc.data()!);else await pc.delete();
    clean.delete('counters/sale');clean.delete('counters/payment');
  }
});
