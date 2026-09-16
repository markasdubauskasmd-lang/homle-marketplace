import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {serveStatic,launchBrowser,resolveChromiumPath} from '../tools/browser-harness.mjs';

const paymentId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',bookingId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',commandId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const command={commandId,kind:'refund',status:'provider-pending',recoveryRequired:true,recoveryReason:'awaiting-signed-evidence',checkedAt:null};
const base={paymentId,bookingId,paymentStatus:'captured',bookingStatus:'completed',scheduledStartAt:'2026-09-15T09:00:00Z',scheduledEndAt:'2026-09-15T12:00:00Z',updatedAt:'2026-09-16T12:00:00Z',amountPence:10000,amountCapturedPence:10000,amountRefundedPence:0,cleanerPayPence:7000,currency:'gbp',payoutReady:true,canCapture:false,canCancel:false,canRefund:true,canTransfer:true,awaitingProvider:false};
let held=true,queueFails=false,role='administrator',outcome='pending',gate=null;
const calls=[];
const current=()=>held?{...base,reconciliationReviewRequired:true,recoveryCommands:[command]}:{...base,paymentStatus:'partially-refunded',amountRefundedPence:2000,canTransfer:false,recoveryCommands:[]};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
if(!resolveChromiumPath()) console.log('Browser administrator payment recovery SKIPPED: Chromium unavailable.');
else {
 const server=await serveStatic({extraFiles:{
  '/admin/payments':await readFile(new URL('../public/admin-payments.html',import.meta.url),'utf8'),
  '/api/marketplace/account':()=>({body:{ok:true,account:{userId:bookingId,roles:[role],selectedRole:role}}}),
  '/api/marketplace/auth/session':()=>({body:{ok:true,csrfToken:'synthetic_csrf_token_at_least_20_characters'}}),
  '/api/marketplace/admin/payments':()=>queueFails?{status:503,body:{error:'Synthetic queue failure'}}:{body:{ok:true,payments:[current()],limit:50,offset:0,testMode:true}},
  ['/api/marketplace/admin/payment-commands/'+commandId+'/recover']:async request=>{
   calls.push(request);const waiting=gate;if(waiting)await waiting.promise;
   if(outcome==='error')return {status:503,body:{error:'Synthetic provider check failure'}};
   if(outcome==='settled')held=false;
   return {body:{ok:true,recovery:{commandId,paymentId,kind:'refund',status:held?'provider-pending':'reconciled',recoveryRequired:held,recoveryReason:held?'awaiting-signed-evidence':null,signedEventsReplayed:held?0:1}}};
  }
 }});
 const browser=await launchBrowser(),captures=new URL('../test-artifacts/admin-payment-recovery/',import.meta.url);
 await mkdir(captures,{recursive:true});
 const wait=async(code)=>{const until=Date.now()+12000;while(!await browser.evaluate(code)){if(Date.now()>until)throw Error('Not ready: '+code);await new Promise(r=>setTimeout(r,40));}};
 const clickCheck=()=>browser.evaluate(`const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Check provider outcome');if(!button)throw Error('Missing recovery control');button.click();button.click();return true;`);
 try {
  for(const width of [390,1280]) {
   held=true;queueFails=false;outcome='pending';role='administrator';gate=deferred();
   await browser.setViewport({width,height:844,mobile:width===390});await browser.goto(server.origin+'/admin/payments');
   await wait(`Boolean(document.querySelector('.admin-payment-recovery button'))`);
   assert(await browser.evaluate(`![...document.querySelectorAll('.admin-payment-card button')].some(b=>['Issue refund','Pay Cleaner','Capture completed clean','Cancel authorization'].includes(b.textContent))`),'Held queue offered a monetary action');
   const before=calls.length;await clickCheck();
   await wait(`document.querySelector('.admin-payment-recovery button')?.textContent==='Checking provider…'`);
   assert(await browser.evaluate(`document.querySelector('.admin-payment-recovery button').disabled`));
   while(calls.length===before)await new Promise(r=>setTimeout(r,20));
   assert.equal(calls.length,before+1,'Double click repeated recovery');
   assert.equal(calls.at(-1).method,'POST');assert.equal(calls.at(-1).body,'{}');assert.match(calls.at(-1).headers['x-csrf-token'],/^synthetic_/);
   gate.resolve();gate=null;
   await wait(`document.querySelector('.admin-payment-recovery button')?.disabled===false && document.querySelector('[data-admin-payments-feedback]').textContent.includes('Waiting for verified')`);
   assert(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth`),'Payment recovery overflows mobile');
   await browser.evaluate(`document.querySelector('.admin-payment-recovery').scrollIntoView({behavior:'instant',block:'center'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;`);
   await writeFile(new URL('held-'+width+'.png',captures),await browser.screenshot());
   outcome='error';await clickCheck();await wait(`document.querySelector('[data-admin-payments-feedback]').dataset.kind==='error'`);
   assert(await browser.evaluate(`Boolean(document.querySelector('.admin-payment-warning'))`),'Failed check lost uncertainty');
   outcome='pending';queueFails=true;await clickCheck();await wait(`document.querySelector('.admin-payment-recovery button')?.disabled===false`);
   assert(await browser.evaluate(`Boolean(document.querySelector('.admin-payment-warning'))`),'Failed refresh unlocked payment');
   queueFails=false;outcome='settled';await clickCheck();
   await wait(`document.querySelector('[data-admin-payments-feedback]').textContent.includes('Verified payment evidence reconciled')`);
   assert(await browser.evaluate(`!document.querySelector('.admin-payment-recovery') && document.querySelector('.admin-payment-card').textContent.includes('£20.00')`),'Signed result did not refresh ledger');
   assert(await browser.evaluate(`[...document.querySelectorAll('.admin-payment-card button')].some(b=>b.textContent==='Issue refund'&&!b.disabled)`),'Eligible action stayed disabled after recovery finished');
   await browser.goto(server.origin+'/admin/payments');await wait(`document.querySelector('.admin-payment-card')?.textContent.includes('£20.00')`);
  }
  role='landlord';await browser.goto(server.origin+'/admin/payments');await wait(`document.querySelector('[data-admin-payments-gate-title]').textContent==='Administrator account required'`);
  assert(await browser.evaluate(`document.querySelector('[data-admin-payments-workspace]').hidden`));
  console.log('Administrator browser recovery passed:390/1280 layout, exact empty/CSRF request, double click, pending/error/failed refresh, reconciled balances, reload and role gate; synthetic APIs only.');
 } finally {gate?.resolve();await browser.close();await server.close();}
}


