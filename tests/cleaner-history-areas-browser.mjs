import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {serveStatic,launchBrowser} from '../tools/browser-harness.mjs';
import {normalizedCleanerOnboardingInput} from '../src/marketplace/cleaner-onboarding.mjs';
const account={userId:'11111111-1111-4111-8111-111111111111',displayName:'Demo',roles:['cleaner'],selectedRole:'cleaner'};
let profile={yearsExperience:1,serviceAreas:[{outwardPostcode:'SW1A',latitude:51.5,longitude:-0.14,role:'primary'},{outwardPostcode:'SW2',latitude:51.45,longitude:-0.12,role:'secondary'},{outwardPostcode:'SW3',latitude:51.49,longitude:-0.16,role:'excluded'}],services:[],travelRadiusKm:20};
const sections={experience:{data:{serviceType:'cleaner',yearsExperience:'1',specialisms:['regular-domestic'],employmentHistory:[]}},business:{data:{serviceType:'cleaner'}},areas:{data:{workZones:[]}}};
let saves=0;
// Count the synchronous guard separately from the later asynchronous save handler.
// Also observe every mutating request, including unexpected endpoints.
const instrumentation = `<script>
window.__testSubmitListeners = new WeakMap();
window.__testWrites = [];
const originalAdd = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function(type, ...args) {
 const result = originalAdd.call(this, type, ...args);
 if (type === "submit" && this instanceof HTMLFormElement) {
  window.__testSubmitListeners.set(this, (window.__testSubmitListeners.get(this) || 0) + 1);
 }
 return result;
};
const originalFetch = window.fetch;
window.fetch = function(input, options) {
 const method = String(options?.method || input?.method || "GET").toUpperCase();
 if (!["GET", "HEAD", "OPTIONS"].includes(method)) window.__testWrites.push(method);
 return originalFetch.call(this, input, options);
};
</script>`;
const page = (await readFile('public/cleaner-registration.html', 'utf8')).replace('<head>', '<head>' + instrumentation);
let releaseProfile;
let delayedProfile = true;
let failProfile = false;
let releaseDocuments;
let delayedDocuments = true;
let navigation = 0;
const extraFiles=Object.fromEntries(['/cleaner/experience','/cleaner/work-areas','/cleaner/onboarding','/cleaner/insurance'].map(path=>[path,page]));
Object.assign(extraFiles,{
 '/api/marketplace/account':()=>({body:{account}}),
 '/api/marketplace/cleaner/profile':async({method,body})=>{
  if (method === 'PUT') profile = {...profile, ...JSON.parse(body)};
  if (method === 'GET' && delayedProfile) await new Promise(resolve => { releaseProfile = resolve; });
  if (failProfile) return {status:503, body:{error:'Synthetic profile unavailable'}};
  return {body:{ok:true,profile}};
 },
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
async function navigate(path) {
 const target = server.origin + path + '?testNavigation=' + (++navigation);
 await browser.goto(target);
 await waitFor('location.href===' + JSON.stringify(target));
 return target;
}
async function waitForGate(getGate, label) {
 for (let i = 0; i < 100 && !getGate(); i++) await new Promise(resolve => setTimeout(resolve, 50));
 assert.equal(typeof getGate(), 'function', label + ' did not reach the deterministic gate');
}
async function assertBlocked(target, label) {
 const beforeSaves = saves;
 const state = await browser.evaluate(`
  const form = document.querySelector('[data-experience-form]');
  const button = form.querySelector('button[type="submit"]');
  return {listeners:window.__testSubmitListeners.get(form) || 0, disabled:button.disabled};
 `);
 assert.deepEqual(state, {listeners:1, disabled:true}, label + ': only the synchronous guard should be installed');
 // Test the cancelable event directly so browser constraint validation cannot
 // conceal a missing guard. requestSubmit below separately uses native submit.
 assert.equal(await browser.evaluate(`
  const form = document.querySelector('[data-experience-form]');
  return form.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}));
 `), false, label + ': native submission must be cancelled');
 for (const action of ['click', 'requestSubmit']) {
  await run(`{
   const form = document.querySelector('[data-experience-form]');
   const originalNoValidate = form.noValidate;
   form.noValidate = true;
   ${action === 'click' ? "form.querySelector('button[type=submit]').click()" : 'form.requestSubmit()'};
   form.noValidate = originalNoValidate;
  }`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await browser.evaluate('location.href'), target, label + ': ' + action + ' must not navigate or add form values to the query');
  assert.deepEqual(await browser.evaluate('window.__testWrites'), [], label + ': ' + action + ' must not write');
  assert.equal(saves, beforeSaves, label + ': no saved changes');
 }
}
async function open(path, ready) {
 await navigate(path);
 await waitFor(ready);
 const form = path === '/cleaner/experience' ? '[data-experience-form]' : '[data-work-form]';
 const count = path === '/cleaner/experience' ? 2 : 1;
 await waitFor(`(window.__testSubmitListeners.get(document.querySelector(${JSON.stringify(form)})) || 0) >= ${count} && !document.querySelector(${JSON.stringify(form)}).querySelector('button[type="submit"]').disabled`);
 await browser.evaluate("sessionStorage.setItem('tideway_csrf','expired-test-csrf')");
}
try {
 const target = await navigate('/cleaner/experience');
 await waitForGate(() => releaseProfile, 'Profile request');
 await assertBlocked(target, 'Delayed profile');
 delayedProfile = false;
 releaseProfile();
 await waitFor("document.querySelector('[data-employment-row]')");
 await waitForGate(() => releaseDocuments, 'Document request');
 await assertBlocked(target, 'Delayed documents');
 delayedDocuments = false;
 releaseDocuments();
 await waitFor("(window.__testSubmitListeners.get(document.querySelector('[data-experience-form]')) || 0) >= 2 && !document.querySelector('[data-experience-form] button[type=submit]').disabled");

 failProfile = true;
 const failedTarget = await navigate('/cleaner/experience');
 await waitFor("document.body.textContent.includes('Skills and Experience could not be loaded. Nothing was changed.')");
 await assertBlocked(failedTarget, 'Failed profile initialization');
 failProfile = false;
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
} finally {
 delayedProfile = false;
 delayedDocuments = false;
 releaseProfile?.();
 releaseDocuments?.();
 await browser.close();
 await server.close();
}
