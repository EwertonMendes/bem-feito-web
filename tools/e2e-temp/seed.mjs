import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const app=initializeApp({projectId:'demo-bem-feito'});
const auth=getAuth(app);
const uid='e2e-browser-user';
await auth.createUser({uid,email:'e2e@example.test',password:'E2ePassword!2026',displayName:'Conta E2E'});
const db=getFirestore(app),at=Timestamp.now(),aud={createdAt:at,updatedAt:at,createdBy:uid,updatedBy:uid};
const batch=db.batch();
const put=(name,id,body)=>batch.set(db.collection(name).doc(id),{...body,...aud});
put('users',uid,{email:'e2e@example.test',displayName:'Conta E2E',role:'owner',active:true});
put('collections','c',{name:'Clássica',active:true});
put('fragrances','f',{name:'Lavanda',collectionId:'c',active:true});
put('formats','fmt',{name:'Barra',active:true});
put('units','u',{name:'un',active:true});
put('paymentMethods','pix',{name:'PIX',active:true});
put('inputs','i',{code:'I1',name:'Embalagem',active:true,unitId:'u',stock:25,minimumStock:0,
  minimumStockConfigured:true,trackingMode:'exact',averageUnitCostCents:40,stockStatus:'ok'});
for(const [id,label,stock] of [['p','Lavanda Barra',8],['p2','Broto Barra',8]]){
  put('products',id,{code:id,displayName:label,active:true,collectionId:'c',fragranceId:'f',
    formatId:'fmt',salePriceCents:1000,additionalCostCents:0,averageUnitCostCents:200,
    stock,stockStatus:'ok',minimumStock:0,recipe:[]});
}
put('additions','a',{name:'Embalagem presente',active:true,category:'Embalagem',priceCents:200,
  components:[{id:'c1',inputId:'i',unitId:'u',quantity:1,order:1}]});
const customer='Cliente E2E', customerSearchPrefixes=['cliente e2e'];
for(const part of ['cliente e2e','cliente','e2e']){
  for(let k=2;k<=part.length;k++)customerSearchPrefixes.push(part.slice(0,k));
}
put('sales','e2e-sale-1',{
  code:'V00001',businessDate:'2026-10-12',customerName:customer,
  customerSearchKey:'cliente e2e',customerSearchPrefixes:[...new Set(customerSearchPrefixes)],
  productIds:['p'],discountCents:0,subtotalCents:2000,totalCents:2000,
  receivedCents:0,tipCents:0,balanceCents:2000,paymentStatus:'pending',
  status:'active',fulfillmentStatus:'delivered',stockApplied:true,notes:'Venda browser E2E',
  items:[{id:'old-1',kind:'product',sourceId:'p',name:'Lavanda Barra',
    collectionId:'c',fragranceId:'f',formatId:'fmt',quantity:2,
    unitPriceCents:1000,unitCostCents:200,totalCents:2000,totalCostCents:400,
    stockEffects:[{itemType:'product',itemId:'p',quantityDelta:-2,unitCostCents:200}]}],
  paymentIds:[],stockEffects:[{itemType:'product',itemId:'p',quantityDelta:-2,unitCostCents:200}],
  analyticsVersion:1,cogsCents:400,itemsSold:2,missingCostItems:0,
});
await batch.commit();
process.stdout.write('Seeded ephemeral E2E environment with user '+uid+'\n');
