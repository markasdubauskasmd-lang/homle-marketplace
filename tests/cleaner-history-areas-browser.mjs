import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {serveStatic,launchBrowser} from '../tools/browser-harness.mjs';
import {normalizedCleanerOnboardingInput} from '../src/marketplace/cleaner-onboarding.mjs';
const account={userId:'11111111-1111-4111-8111-111111111111',displayName:'Demo',roles:['cleaner'],selectedRole:'cleaner'};
let profile={yearsExperience:1,serviceAreas:[{outwardPostcode:'SW1A',latitude:51.5,longitude:-0.14,role:'primary'},{outwardPostcode:'SW2',latitude:51.45,longitude:-0.12,role:'secondary'},{outwardPostcode:'SW3',latitude:51.49,longitude:-0.16,role:'excluded'}],services:[],travelRadiusKm:20};
const sections={experience:{data:{serviceType:'cleaner',yearsExperience:'1',specialisms:['regular-domestic'],employmentHistory:[]}},business:{data:{serviceType:'cleaner'}},areas:{data:{workZones:[]}}};
let saves=0;
// Test-only observation of the actual listener boundary. Rows render before
// document hydration finishes; their existence does not mean submit is bound.
const instrumentation = '<script>window.__testSubmitReady=new WeakSet();const originalAdd=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,...args){const result=originalAdd.call(this,type,...args);if(type==="submit"&&this instanceof HTMLFormElement)window.__testSubmitReady.add(this);return result;};</script>';
const page=(await readFile('public/cleaner-registration.html','utf8')).replace('<head>','<head>'+instrumentation);
let releaseDocuments; let delayedDocuments=true; let navigation=0;
const extraFiles=Object.fromEntries(['/cleaner/experience','/cleaner/work-areas','/cleaner/onboarding','/cleaner/insurance'].map(path=>[path,page]));
Object.assign(extraFiles,{
 '/api/marketplace/account':()=>({body:{account}}),
 '/api/marketplace/cleaner/profile':({method,body})=>{if(method==='PUT')profile={...profile,...JSON.parse(body)};return {body:{ok:true,profile}};},
 '/api/marketplace/cleaner/availability':()=>({body:{availability:[]}}),
 '/api/marketplace/cleaner/payout-account':()=>({body:{payout:null}}),
 '/api/marketplace/cleaner/onboarding':()=>({body:{sections:[]}}),
 '/api/marketplace/cleaner/onboarding/documents':async()=>{if(delayedDocuments)await new Promise(resolve=>{releaseDocuments=resolve;});return {body:{documents:[]}};},
 '/api/marketplace/auth/session':()=>({body:{csrfToken:'test-csrf',account}})
});
for(const section of Object.keys(sections)) extraFiles['/api/marketplace/cleaner/onboarding/'+section]=({method,body})=>{if(method==='PUT'){sections[section]=normalizedCleanerOnboardingInput(section,JSON.parse(body));saves++;}return {body:{ok:true,section:sections[section]}};};
const server=await serveStatic({extraFiles});const browser=await launchBrowser();
const run=script=>browser.evaluate(script+'; return true;');
async function waitFor(expression){for(let i=0;i<100;i++){try{if(await browser.evaluate(expression))return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+expression);}
async function open(path,ready){
 const target=server.origin+path+'?testNavigation='+(++navigation);
 await browser.goto(target);
 await waitFor('location.href==='+JSON.stringify(target));
 await waitFor(ready);
 const form=path==='/cleaner/experience'?'[data-experience-form]':'[data-work-form]';
 const bound='window.__testSubmitReady?.has(document.querySelector('+JSON.stringify(form)+'))===true';
 if(delayedDocuments&&path==='/cleaner/experience'){
  assert.equal(await browser.evaluate(bound),false,'Delayed document fixture must expose rows before submit initialization');
  assert.deepEqual(await browser.evaluate("return (()=>{const form=document.querySelector('[data-experience-form]');return {method:form.method,action:form.getAttribute('action'),submitEnabled:!form.querySelector('button[type=submit]').disabled,defaultUnprevented:form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))};})()"),{method:'get',action:null,submitEnabled:true,defaultUnprevented:true},'Fixture must prove the existing pre-handler native-submit window, not merely delay an already-ready form');
  for(let i=0;i<100&&!releaseDocuments;i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(typeof releaseDocuments,'function','Document hydration request did not reach the deterministic gate');
  delayedDocuments=false;releaseDocuments();
 }
 await waitFor(bound);
 await browser.evaluate("sessionStorage.setItem('tideway_csrf','expired-test-csrf')");
}
try{
 await open('/cleaner/experience',"document.querySelector('[data-employment-row]')");
 await run(`{const row=document.querySelector('[data-employment-row]');for(const [key,value] of Object.entries({company:'Demo Previous',startDate:'2020-01',endDate:'2019-01',reasonForLeaving:'Demo move'}))row.querySelector('[data-employment-field="'+key+'"]').value=value;document.querySelector('[data-experience-form]').requestSubmit();}`);
 assert.equal(saves,0,'Invalid chronology must not save');
 await run(`document.querySelector('[data-employment-field="endDate"]').value='2022-01';document.querySelector('[data-employment-add]').click();{const row=document.querySelectorAll('[data-employment-row]')[1];row.querySelector('[data-employment-field="company"]').value='Demo Current';row.querySelector('[data-employment-field="startDate"]').value='2022-02';row.querySelector('[data-employment-field="current"]').click();}document.querySelector('[data-experience-form]').requestSubmit();`);
 await waitFor("location.pathname==='/cleaner/insurance'");assert.equal(await browser.evaluate("sessionStorage.getItem('tideway_csrf')"),'test-csrf');assert.equal(sections.experience.data.employmentHistory.length,2);assert.equal(sections.experience.data.employmentHistory[1].current,true);
 await open('/cleaner/experience',"document.querySelectorAll('[data-employment-row]').length===2");
 assert.equal(await browser.evaluate("document.querySelector('[data-employment-field=company]').value"),'Demo Previous');
 await run("document.querySelector('[data-employment-row] button').click();document.querySelector('[data-experience-form]').requestSubmit()");
 await waitFor("location.pathname==='/cleaner/insurance'");assert.equal(sections.experience.data.employmentHistory.length,1);
 await open('/cleaner/work-areas',"document.querySelector('[aria-label=\"Treatment for SW3\"]')");
 assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"Treatment for SW2\"]').value"),'secondary');
 assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"Treatment for SW3\"]').value"),'excluded');
 await browser.evaluate("document.querySelector('[data-work-form]').requestSubmit()");await waitFor("location.pathname==='/cleaner/experience'");
 assert.deepEqual(profile.serviceAreas.map(a=>a.role),['primary','secondary','excluded']);assert.deepEqual(sections.areas.data.serviceAreas.map(a=>a.role),['primary','secondary','excluded']);
 await open('/cleaner/work-areas',"document.querySelector('[aria-label=\"Treatment for SW3\"]')");assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"Treatment for SW3\"]').value"),'excluded');
 console.log('PASS: employment validation, multi-role save/reload/removal; secondary/excluded save and reload through actual forms.');
}finally{delayedDocuments=false;releaseDocuments?.();await browser.close();await server.close();}
