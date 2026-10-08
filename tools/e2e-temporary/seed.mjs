import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Refusing non-emulated data');
const res = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
  method: 'POST', headers: {'content-type':'application/json'},
  body: JSON.stringify({email:'qa-e2e@example.test',password:'LocalEmulatorPass123!',returnSecureToken:true}),
});
const body = await res.json();
if (!res.ok || !body.localId) throw new Error('Auth seed failed: '+JSON.stringify(body));
const db = getFirestore(initializeApp({projectId:'demo-bem-feito'}));
const audit = {createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),createdBy:body.localId,updatedBy:body.localId};
const batch=db.batch();
batch.set(db.doc('users/'+body.localId),{email:'qa-e2e@example.test',role:'owner',active:true,displayName:'QA Browser'});
batch.set(db.doc('units/u'),{name:'un',active:true,...audit});
batch.set(db.doc('units/ml'),{name:'ml',active:true,...audit});
batch.set(db.doc('collections/qa-c'),{name:'Clássico QA',active:true,costComponents:[],...audit});
batch.set(db.doc('fragrances/qa-f'),{name:'Lavanda QA',collectionId:'qa-c',active:true,costComponents:[],...audit});
batch.set(db.doc('formats/qa-format'),{name:'Florzinha QA',approximateWeightGrams:5,active:true,costComponents:[],...audit});
batch.set(db.doc('formatPrices/qa-price'),{collectionId:'qa-c',formatId:'qa-format',priceCents:999,active:true,...audit});
for (const [id,name,mode,stock,unit,cost] of [
  ['qa-packaging','Embalagem QA','exact',8,'u',100],
  ['qa-essence','Essência QA','estimated',5.5,'ml',50],
  ['qa-tape','Fita QA','untracked',0,'u',50],
]) batch.set(db.doc('inputs/'+id),{
  code:id,name,unitId:unit,active:true,trackingMode:mode,stock,minimumStock:1,
  minimumStockConfigured:mode!=='untracked',averageUnitCostCents:cost,stockStatus:'ok',...audit,
});
for(const [id,name,cost] of [
  ['qa-product','TESTE QA - Produto 1',100],
  ['qa-product-2','TESTE QA - Produto 2',100],
  ['qa-product-3','TESTE QA - Produto 3',100],
])batch.set(db.doc('products/'+id),{
  code:id,displayName:name,collectionId:'qa-c',fragranceId:'qa-f',formatId:'qa-format',
  active:true,stock:100,minimumStock:1,stockStatus:'ok',salePriceCents:1000,
  additionalCostCents:0,averageUnitCostCents:cost,
  recipe:id==='qa-product-3'?[]:[{inputId:'qa-packaging',unitId:'u',quantity:1}],...audit,
});
batch.set(db.doc('kits/qa-kit'),{name:'TESTE QA - Kit 100',active:true,priceCents:5000,
 components:[{id:'k1',formatId:'qa-format',quantity:100,order:1}],...audit});
batch.set(db.doc('paymentMethods/qa-pix'),{name:'Pix',active:true,...audit});
batch.set(db.doc('expenseCategories/qa-other'),{name:'Outras',active:true,...audit});
await batch.commit();
console.log('Seeded three products, 100-unit kit, exact/estimated/untracked inputs and references in demo-bem-feito.');
