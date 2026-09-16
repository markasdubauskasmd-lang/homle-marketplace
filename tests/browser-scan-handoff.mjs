import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,resolveChromiumPath,serveStatic} from '../tools/browser-harness.mjs';
import {defaultPricingConfig} from '../public/pricing-config.js';
if(!resolveChromiumPath()){if(process.env.CI)throw Error('Scanner handoff requires Chromium');process.exit(0);}
const owner='11111111-1111-4111-8111-111111111111';
const account={userId:owner,roles:['landlord'],selectedRole:'landlord',displayName:'Synthetic reviewer'};
let pricingReleased=false,releasePricing,pricingRequests=0;
const pricingGate=new Promise(resolve=>{releasePricing=()=>{pricingReleased=true;resolve();};});
const config={...defaultPricingConfig,premiumItems:{...defaultPricingConfig.premiumItems,oven:{...defaultPricingConfig.premiumItems.oven,pence:6700}}};
const server=await serveStatic({extraFiles:{
 '/seed':'<!doctype html><title>Synthetic setup</title>',
 '/landlord/book':await readFile(new URL('../public/landlord-journey.html',import.meta.url),'utf8'),
 // Only the camera's return value is synthetic. Production journey, editors,
 // persistence, pricing and assessment orchestration run unchanged.
 '/room-scan-overlay.js':'export function warmRoomScanDetector(){} export function openRoomScan(){return new Promise(resolve=>{window.finishSyntheticScan=resolve;});}',
 '/api/marketplace/account':()=>({body:{ok:true,account}}),
 '/api/marketplace/auth/session':()=>({body:{ok:true,account,csrfToken:'synthetic-csrf'}}),
 '/api/marketplace/properties':()=>({body:{ok:true,properties:[{propertyId:owner,propertyType:'house',exactAddress:{line1:'Synthetic home',city:'London',postcode:'SW1A 1AA'}}]}}),
 '/api/health':()=>({body:{ok:true,marketplace:{ready:true,matchingReady:false,mediaReady:false}}}),
 '/api/marketplace/pricing/config':async()=>{pricingRequests++;await pricingGate;return {body:{ok:true,config}};},
 '/api/marketplace/landlord/scan-preview':()=>({status:503,body:{error:'Synthetic unavailable assessment'}})
}});
const browser=await launchBrowser();
const captures=new URL('../test-artifacts/scanner-handoff/',import.meta.url);await mkdir(captures,{recursive:true});
async function waitFor(code){const until=Date.now()+12000;while(!await browser.evaluate(code)){if(Date.now()>until)throw Error('Not ready: '+code+' '+JSON.stringify(browser.pageErrors));await new Promise(resolve=>setTimeout(resolve,50));}}
const saved=()=>browser.evaluate('return JSON.parse(sessionStorage.getItem("homle_journey_draft"))?.draft;');
try {
 for(const width of [390,1280]){
  await browser.setViewport({width,height:844,mobile:width===390});
  await browser.goto(server.origin+'/seed');
  const draft={propertyId:owner,serviceCode:'regular-domestic',durationMinutes:120,tasks:[],rooms:[]};
  await browser.evaluate(`sessionStorage.clear();const now=Date.now();sessionStorage.setItem('homle_journey_draft',JSON.stringify({ownerId:${JSON.stringify(owner)},savedAt:now,expiresAt:now+1800000,step:'service',draft:${JSON.stringify(draft)}}));return true;`);
  await browser.goto(server.origin+'/landlord/book');
  await waitFor('document.querySelector("[data-access-gate]")?.hidden && !document.querySelector("[data-scan-link]")?.disabled');
  await browser.evaluate('document.querySelector("[data-scan-link]").click();return true;');
  await waitFor('typeof window.finishSyntheticScan==="function"');
  const result={rooms:[{name:'Kitchen',objects:[{inventoryKey:'oven',label:'Oven',quantity:1,condition:'',confidenceCondition:0}],tasks:['Wipe the oven exterior']}],tasks:['Kitchen: Wipe the oven exterior'],photos:[],transcript:''};
  await browser.evaluate(`window.finishSyntheticScan(${JSON.stringify(result)});return true;`);
  await waitFor(`document.querySelector('[data-step=results]')?.hidden===false && document.querySelector('[aria-label="Quantity of Oven"]')`);
  assert.equal((await saved()).rooms[0].objects[0].quantity,1);
  if(width===390)assert.equal(pricingReleased,false,'Fixture accidentally allowed pricing before review');
  await browser.evaluate(`const quantity=document.querySelector('[aria-label="Quantity of Oven"]');quantity.value='2';quantity.dispatchEvent(new Event('change',{bubbles:true}));const extra=document.querySelector('[data-premium-choice]');extra.checked=true;extra.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
  assert.equal((await saved()).rooms[0].objects[0].quantity,2);
  assert.equal((await saved()).scanPremiumSelected.length,1);
  assert(await browser.evaluate('return document.documentElement.scrollWidth<=innerWidth+1;'));
  await browser.evaluate('document.querySelector("[data-review-rooms]")?.scrollIntoView({behavior:"instant"});return true;');
  await browser.evaluate('await Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{})));return true;');
  // Capture the review while the first pricing request is deliberately pending.
  await writeFile(new URL(`review-${width}.png`,captures),await browser.screenshot());
  releasePricing();
  await waitFor('document.querySelector("[data-review-status-message]")?.textContent.includes("unavailable")');
  assert.equal((await saved()).rooms[0].objects[0].quantity,2,'Late settings overwrote quantity correction');
  assert.equal((await saved()).scanPremiumSelected.length,1,'Late settings dropped specialist consent');
  const choices=await browser.evaluate('return document.querySelector("[data-scan-premium-choices]").textContent;');
  assert(choices.includes('£67'),'Specialist price did not update: '+choices);
  await browser.goto(server.origin+'/landlord/book');
  await waitFor(`document.querySelector('[aria-label="Quantity of Oven"]')?.value==="2"`);
 }
 assert(pricingRequests>0);
 assert.deepEqual(browser.pageErrors.filter(error=>!/favicon|manifest/i.test(error)),[]);
 console.log('Browser handoff passed at390/1280: editable saved results before pricing, edits/consent survive late settings and failed assessment, reload stable. Synthetic scan/API only.');
} finally {releasePricing();await browser.close();await server.close();}
