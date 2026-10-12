import { chromium } from 'playwright';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdir } from 'node:fs/promises';

const url='http://127.0.0.1:4200';
const out='tools/e2e-temp/screenshots';
await mkdir(out,{recursive:true});
const db=getFirestore(initializeApp({projectId:'demo-bem-feito',name:'e2e-browser'}));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
async function usePage(size,description){
  const context=await browser.newContext({viewport:size,colorScheme:'light'});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(description+': '+error.message));
  page.on('response',response=>{if(response.status()===404)errors.push(description+': HTTP 404 '+response.url());});
  page.on('console',message=>{if(message.type()==='error'&&!/extension|third.party|Google Drive|Failed to load resource/i.test(message.text()))
    errors.push(description+': '+message.text().slice(0,400));});
  await page.goto(url+'/login',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('button',{name:/Entrar com Google/}).click();
  await page.waitForURL(/dashboard|vendas/, {timeout:45000});
  return {page,context};
}
async function noOverflow(page,label){
  const metrics=await page.evaluate(()=>({
    width:innerWidth,document:document.documentElement.scrollWidth,
    body:document.body.scrollWidth,
    dialogs:[...document.querySelectorAll('dialog[open]')].map(el=>({width:el.scrollWidth,clientWidth:el.clientWidth})),
  }));
  if(metrics.document>metrics.width+3 || metrics.body>metrics.width+3 ||
    metrics.dialogs.some(d=>d.width>d.clientWidth+3))
    throw Error(label+' horizontal page overflow: '+JSON.stringify(metrics));
  process.stdout.write(label+' geometry '+JSON.stringify(metrics)+'\n');
}
try {
  const {page,context}=await usePage({width:1366,height:850},'desktop');
  await page.goto(url+'/vendas',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Vendas'}).waitFor();
  const search=page.locator('input[type="search"]').first();
  await search.fill('Cliente');
  await page.getByRole('button',{name:/Buscar histórico/}).click();
  await page.getByText('V00001').first().waitFor({timeout:25000});
  process.stdout.write('PASS: indexed historical search returned seeded sale\n');
  await noOverflow(page,'desktop-sales');
  await page.screenshot({path:out+'/desktop-sales.png',fullPage:true});
  await page.getByRole('button',{name:/Ver/}).first().click();
  await page.getByRole('button',{name:/Editar venda/}).waitFor();
  await page.getByRole('button',{name:/Editar venda/}).click();
  await page.locator('.advanced-item-row input[type="number"]').first().fill('3');
  await page.locator('.sale-item-correction textarea').fill('Corrigir quantidade no E2E');
  await page.getByText('Conferi o estoque físico').click();
  if(!await page.locator('.advanced-stock-confirm bf-checkbox input').isChecked())
    throw Error('The shared checkbox label did not toggle its state');
  await page.getByRole('button',{name:/Confirmar edição/}).click();
  await page.getByText('3× Lavanda Barra').waitFor({timeout:35000});
  const stored=(await db.doc('sales/e2e-sale-1').get()).data();
  const product=(await db.doc('products/p').get()).data();
  if(stored?.totalCents!==3000||product?.stock!==7)throw Error('Transaction mismatch '+JSON.stringify({stored:stored?.totalCents,stock:product?.stock}));
  process.stdout.write('PASS: real editor wrote atomic Firestore stock and sale corrections\n');
  await page.screenshot({path:out+'/desktop-after-edit.png',fullPage:true});
  await page.goto(url+'/relatorios',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Relatórios'}).waitFor();
  await page.getByText('R$ 30,00').first().waitFor({timeout:35000});
  await noOverflow(page,'desktop-reports');
  await page.screenshot({path:out+'/desktop-reports.png',fullPage:true});
  process.stdout.write('PASS: management reports reflect edited sale\n');
  await context.close();
  const {page:mobile,context:small}=await usePage({width:390,height:844},'mobile');
  await mobile.goto(url+'/relatorios',{waitUntil:'domcontentloaded'});
  await mobile.getByRole('heading',{name:'Relatórios'}).waitFor();
  await mobile.getByText('R$ 30,00').first().waitFor({timeout:35000});
  await noOverflow(mobile,'mobile-reports');
  await mobile.screenshot({path:out+'/mobile-reports.png',fullPage:true});
  await mobile.goto(url+'/vendas',{waitUntil:'domcontentloaded'});
  await mobile.locator('.sales-mobile-list .mobile-card-button').first().waitFor({timeout:35000});
  await noOverflow(mobile,'mobile-sales');
  await mobile.screenshot({path:out+'/mobile-sales.png',fullPage:true});
  await mobile.locator('.mobile-card-button').first().click();
  await mobile.getByRole('button',{name:/Editar venda/}).click();
  await noOverflow(mobile,'mobile-sale-editor');
  await mobile.screenshot({path:out+'/mobile-sale-editor.png'});
  await small.close();
  if(errors.length)throw Error('Browser exceptions: '+errors.join('\n'));
  process.stdout.write('PASS: browser E2E, desktop/mobile layout, no console exceptions\n');
} finally { await browser.close(); }
