import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser, resolveChromiumPath, serveStatic} from '../tools/browser-harness.mjs';
if (!resolveChromiumPath()) { if(process.env.CI)throw Error('Property recovery requires Chromium'); process.exit(0); }
let owner='11111111-1111-4111-8111-111111111111';
const account=()=>({userId:owner,roles:['landlord'],selectedRole:'landlord',displayName:'Synthetic property reviewer'});
const records=[],writes=[];let failWrite=false,failRead=false;
const pages={
 '/landlord/properties':await readFile(new URL('../public/landlord-dashboard.html',import.meta.url),'utf8'),
 '/api/marketplace/account':()=>({body:{account:account()}}),
 '/api/marketplace/auth/session':()=>({body:{account:account(),csrfToken:'synthetic'}}),
 '/api/marketplace/landlord/bootstrap':()=>({body:{account:account(),properties:records,archivedProperties:[],cleaningRequests:[],bookings:[],supportRequests:[],profile:{},unavailable:[]}}),
 '/api/marketplace/landlord/favourite-cleaners':JSON.stringify({cleaners:[]}),
 '/api/health':JSON.stringify({marketplace:{ready:true,mediaReady:false,matchingReady:false}}),
 '/api/marketplace/properties':({method,body})=>{
   if(method==='GET'){if(failRead)return {status:503,body:{error:'Synthetic lookup unavailable'}};return {body:{properties:records}};}
   const value=JSON.parse(body);writes.push({...value,method});
   const project=(value,id)=>({propertyId:id,name:value.name||'Flat in London',propertyType:value.propertyType,bedrooms:value.bedrooms??null,bathrooms:value.bathrooms??null,approximateSizeSqM:value.approximateSizeSqM??null,
    accessInstructions:value.accessInstructions||'',parkingInstructions:value.parkingInstructions||'',cleaningPreferences:value.cleaningPreferences||'',savedChecklist:value.savedChecklist||[],specialNotes:value.specialNotes||'',
    exactAddress:{addressLine1:value.addressLine1,addressLine2:value.addressLine2||'',locality:value.locality,postcode:value.postcode}});
   const property=project(value,value.id);
   if(!records.some(p=>p.propertyId===value.id))records.push(property);
   pages['/api/marketplace/properties/'+value.id]=({method,body})=>{const updated=JSON.parse(body);writes.push({...updated,id:value.id,method});const record=project(updated,value.id);records.splice(records.findIndex(p=>p.propertyId===value.id),1,record);return {body:{property:record}};};
   if(failWrite)return {status:503,body:{error:'Synthetic uncertain response'}};
   return {body:{property}};
 }
};
for(const path of ['/landlord/account','/landlord/messages','/landlord/home','/landlord/requests'])pages[path]=pages['/landlord/properties'];
const server=await serveStatic({extraFiles:pages});
const browser=await launchBrowser();
const captures=new URL('../test-artifacts/property-form-draft/',import.meta.url);
await mkdir(captures,{recursive:true});
async function wait(code){const until=Date.now()+10000;while(!await browser.evaluate(code)){if(Date.now()>until)throw Error('Property recovery not ready: '+code);await new Promise(r=>setTimeout(r,40));}}
async function goto(path='/landlord/properties'){await browser.goto(server.origin+path);await wait('document.querySelector("[data-landlord-workspace]")?.hidden===false && document.querySelector("[data-landlord-workspace]")?.getAttribute("aria-busy")!=="true"');}
async function fill(fields){await browser.evaluate(`const form=document.querySelector('[data-property-form]');for(const [key,value] of Object.entries(${JSON.stringify(fields)})){form.elements[key].value=value;form.elements[key].dispatchEvent(new Event('input',{bubbles:true}));}return true;`);}
const values=()=>browser.evaluate(`const form=document.querySelector('[data-property-form]');return {hidden:form.hidden,address:form.elements.addressLine1.value,type:form.elements.propertyType.value,access:form.elements.accessInstructions.value,notes:form.elements.specialNotes.value};`);
try {
 for(const width of [390,1280]){
  records.length=0;writes.length=0;failWrite=false;failRead=false;
  await browser.setViewport({width,height:844,mobile:width===390});await goto();
  await browser.evaluate('sessionStorage.clear();return true;');await goto();
  await browser.evaluate(`document.querySelector('[data-toggle-property-form]').click();return true;`);
  await fill({propertyType:'flat',addressLine1:'11 Example Road',locality:'London',postcode:'SW1A 1AA',accessInstructions:'Door code 4321',specialNotes:'Keys under the mat'});
  await goto();
  const restored=await values();assert.equal(restored.hidden,false,'Refresh lost the unfinished property form');
  assert.equal(restored.address,'11 Example Road');assert.equal(restored.type,'flat');assert.equal(restored.access,'');assert.equal(restored.notes,'');
  await wait('document.querySelector("[data-property-dialog]")?.matches(":modal") && getComputedStyle(document.querySelector("[data-property-dialog]")).opacity==="1"');
  await browser.evaluate('return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))));');
  await writeFile(new URL('restored-'+width+'.png',captures),await browser.screenshot());
  assert(!await browser.evaluate('return JSON.stringify(sessionStorage).includes("4321") || JSON.stringify(sessionStorage).includes("under the mat");'));
  failWrite=true;failRead=true;
  await browser.evaluate(`document.querySelector('[data-property-form]').requestSubmit();return true;`);
  await wait('document.querySelector("[data-save-property]").disabled===false');assert.equal(writes.length,1);
  await goto();
  await browser.evaluate(`document.querySelector('[data-property-form]').requestSubmit();return true;`);
  await wait('document.querySelector("[data-save-property]").disabled===false');
  assert.equal(writes.length,1,'Unavailable reconciliation silently created another property');
  failRead=false;failWrite=false;
  await browser.evaluate(`document.querySelector('[data-property-form]').requestSubmit();return true;`);
  await wait('document.querySelector("[data-save-property]").disabled===false');
  assert.equal(writes.length,1,'Known saved property was recreated after refresh');
  assert.equal((await values()).hidden,false,'Recovered property skipped explicit review');
  await browser.evaluate(`document.querySelector('[data-property-form]').requestSubmit();return true;`);
  await wait('document.querySelector("[data-property-form]").hidden===true');assert.equal(writes.at(-1).method,'PUT');
  assert.equal(records.length,1);
  assert.equal(await browser.evaluate('return sessionStorage.getItem("homlePropertyFormDraftV1");'),null);
  // A saved property's protected editor is never replaced by a new-form draft.
  await browser.evaluate(`document.querySelector('[data-toggle-property-form]').click();return true;`);
  await fill({propertyType:'house',addressLine1:'Unfinished second property'});
  for(const path of ['/landlord/account','/landlord/messages','/landlord/home','/landlord/requests?start=booking']){
   await goto(path);assert.equal((await values()).hidden,true,'Unfinished property stole navigation to '+path);
   assert(await browser.evaluate('return Boolean(sessionStorage.getItem("homlePropertyFormDraftV1"));'),'Navigation discarded the unfinished property');
  }
  await goto();assert.equal((await values()).address,'Unfinished second property');
  await browser.evaluate(`window.confirm=()=>true;[...document.querySelectorAll('.landlord-property-actions-secondary button')].find(b=>b.textContent==='Add access details').click();return true;`);
  assert.equal((await values()).address,'11 Example Road');
  assert.equal(await browser.evaluate('return sessionStorage.getItem("homlePropertyFormDraftV1");'),null);
  await browser.evaluate(`document.querySelector('[data-close-property-form]').click();document.querySelector('[data-toggle-property-form]').click();return true;`);
  await fill({propertyType:'flat',addressLine1:'Discard me'});
  await browser.evaluate(`document.querySelector('[data-close-property-form]').click();return true;`);
  await goto();assert.equal((await values()).hidden,true,'Explicit discard returned after reload');
  await browser.evaluate(`document.querySelector('[data-toggle-property-form]').click();return true;`);await fill({propertyType:'flat',addressLine1:'Owner A only'});
  owner='22222222-2222-4222-8222-222222222222';await goto();assert.equal((await values()).hidden,true,'An account change restored another owner location');
  assert.equal(await browser.evaluate('return sessionStorage.getItem("homlePropertyFormDraftV1");'),null);
  owner='11111111-1111-4111-8111-111111111111';
  await goto();await browser.evaluate(`document.querySelector('[data-toggle-property-form]').click();return true;`);
  await fill({propertyType:'flat',addressLine1:'12 Example Road',locality:'London',postcode:'SW1A 1AA',accessInstructions:'Door code 9876',parkingInstructions:'Protected parking plan',specialNotes:'Keep this saved note'});
  failWrite=true;
  await browser.evaluate(`document.querySelector('[data-property-form]').requestSubmit();return true;`);
  await wait('document.querySelector("[data-save-property]").disabled===false');
  const uncertainId=writes.at(-1).id, writesBeforeEdit=writes.length;await goto();
  await fill({addressLine1:'13 Example Road'});failWrite=false;
  await browser.evaluate(`document.querySelector('[data-property-form]').requestSubmit();return true;`);
  await wait('document.querySelector("[data-save-property]").disabled===false');
  assert.equal(writes.length,writesBeforeEdit,'Editing a restored uncertain form created a duplicate property');
  assert.equal((await values()).address,'13 Example Road','Recovering the saved identity discarded newer location edits');
  assert.equal((await values()).access,'Door code 9876');assert.equal((await values()).notes,'Keep this saved note');
  assert(!await browser.evaluate('return JSON.stringify(sessionStorage).includes("9876");'),'Recovered protected details entered draft storage');
  // A second reload before explicit review/save must still keep the edited location.
  await goto();assert.equal((await values()).address,'13 Example Road');
  await browser.evaluate(`document.querySelector('[data-property-form]').requestSubmit();return true;`);await wait('document.querySelector("[data-save-property]").disabled===false');
  await browser.evaluate(`document.querySelector('[data-property-form]').requestSubmit();return true;`);await wait('document.querySelector("[data-property-form]").hidden===true');
  assert.equal(writes.at(-1).method,'PUT');assert.equal(writes.at(-1).id,uncertainId);assert.equal(writes.at(-1).addressLine1,'13 Example Road');assert.equal(writes.at(-1).accessInstructions,'Door code 9876');assert.equal(writes.at(-1).parkingInstructions,'Protected parking plan');
  assert.equal(records.length,2,'Edited uncertain property created a second record');
  await browser.evaluate(`document.querySelector('[data-toggle-property-form]').click();return true;`);await fill({addressLine1:'Reset me'});
  await browser.evaluate(`document.querySelector('[data-property-form]').reset();return true;`);
  assert.equal(await browser.evaluate('return sessionStorage.getItem("homlePropertyFormDraftV1");'),null);
  await fill({addressLine1:'Sign out removes this'});
  await browser.evaluate(`document.querySelector('[data-account-sign-out]').click();return true;`);
  assert.equal(await browser.evaluate('return sessionStorage.getItem("homlePropertyFormDraftV1");'),null);
 }
}finally{await browser.close();await server.close();}
console.log('Property form browser recovery passed at390/1280: refresh, private-field exclusion, uncertain response, failed lookup, safe retry and successful clearing; synthetic records only.');

