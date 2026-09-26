import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizedProperty} from '../src/marketplace/property-service.mjs';
import {landlordRequestDraftLifetimeMs} from '../public/landlord-request-draft.js';
const source=readFileSync(new URL('../public/landlord-dashboard.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const owner='10000000-0000-4000-8000-000000000001', other='20000000-0000-4000-8000-000000000002';
const A='30000000-0000-4000-8000-000000000003',B='40000000-0000-4000-8000-000000000004';
const savedProperty=(propertyId)=>({propertyId,name:'Recovered',bedrooms:2,bathrooms:1,approximateSizeSqM:80,
 accessInstructions:'Keep this protected access',parkingInstructions:'Saved parking',cleaningPreferences:'Saved preference',savedChecklist:[],specialNotes:'Saved note'});
function harness({storage=new Map(),records=new Map(),deferCsrf=false,deferWrite=false,deferRead=false,loseWrite=false,loseRead=false,storageUnavailable=false,restoredId=''}={}) {
 const fields={name:'Fixture property',propertyType:'flat',addressLine1:'1 Example Road',locality:'London',postcode:'SW1A 1AA',accessInstructions:'Private fixture entry note'};
 const writes=[],feedback=[],csrf=[],completions=[],reads=[];let resets=0,navigations=0;
 const controls={};
 const elements=Object.fromEntries(['name','bedrooms','bathrooms','approximateSizeSqM','accessInstructions','parkingInstructions','cleaningPreferences','savedChecklist','specialNotes'].map(name=>[name,{get value(){return fields[name]??'';},set value(value){fields[name]=String(value);}}]));
 const ctx=vm.createContext({crypto:webcrypto,TextEncoder,Date,landlordRequestDraftLifetimeMs,
 propertyCreateRetry:null,propertySavePending:false,propertyEditorRevision:0,propertyEditorInstance:0,propertyViewRevision:0,requestDraftOwner:owner,
 restoredPropertyRetryId:restoredId,propertyAttemptOwner:owner,propertyTouchedFields:new Set(),rememberPropertyFormDraft(){},clearPropertyFormDraft(){},propertyDraftStorage(){return ctx.window.sessionStorage;},
 propertyFeedback:{},propertyForm:{elements,querySelector:()=>({}),reportValidity:()=>true,reset(){resets++;},hidden:false},tasksToLines:tasks=>tasks.map(task=>task.description||task).join('\n'),
 FormData:class {constructor(){this.values={...fields};}get(key){return this.values[key]??'';}},
 isUkPostcode:()=>true,requestTasksFromLines:()=>[],optionalNumber:v=>v?Number(v):null,
 recoverCsrf:(_feedback,_action,options)=>{assert.equal(options.refresh,true);return deferCsrf?new Promise(resolve=>csrf.push(resolve)):Promise.resolve('csrf');},
 propertySave:controls,propertyFormTitle:{},propertyStatus:{},propertyDialog:null,bookingStart:true,editingPropertyId:'',propertyDirty:true,properties:[],
 setPending(button,pending){button.disabled=pending;},renderProperties(){},showFeedback(_target,message){feedback.push(message);},
 selectWorkspaceTab(){navigations++;},propertySelect:{},requestForm:{scrollIntoView(){},elements:{requestedDate:{focus(){}}}},customerScrollBehavior:()=> 'instant',
 window:{sessionStorage:{getItem:k=>{if(storageUnavailable)throw Error('denied');return storage.get(k);},setItem:(k,v)=>{if(storageUnavailable)throw Error('denied');storage.set(k,v);},removeItem:k=>storage.delete(k)}},
 requestJson:async(path,options)=>{
  if(!options){if(loseRead){loseRead=false;throw Object.assign(Error('read lost'),{code:'request-timeout'});}if(deferRead)return new Promise(resolve=>reads.push(resolve));return {properties:[...records.values()]};}
  const body=JSON.parse(options.body),record=normalizedProperty(body,'fixture-encryption-key-over-thirty-two-characters',options.method==='PUT'?path.split('/').at(-1):body.id);
  writes.push({path,method:options.method,body,id:record.id});
  if(options.method==='POST'&&records.has(record.id))throw Object.assign(Error('exists'),{statusCode:409});
  const property={propertyId:record.id,name:record.name,bedrooms:record.bedrooms,bathrooms:record.bathrooms,approximateSizeSqM:record.approximateSizeSqM,
   accessInstructions:body.accessInstructions||'',parkingInstructions:body.parkingInstructions||'',cleaningPreferences:body.cleaningPreferences||'',savedChecklist:body.savedChecklist||[],specialNotes:body.specialNotes||'',exactAddress:{addressLine1:record.addressLine1,postcode:record.postcode}};
  records.set(record.id,property);
  if(loseWrite){loseWrite=false;throw Object.assign(Error('write response lost'),{code:'request-timeout'});}
  if(deferWrite)return new Promise(resolve=>completions.push(()=>resolve({property})));
  return {property};
 }});
 vm.runInContext(section('function reviewRecoveredProperty(', 'function openNewRequestPhotoDialog()'),ctx);
 return {ctx,fields,writes,feedback,csrf,completions,reads,storage,records,controls,resets:()=>resets,navigations:()=>navigations,save:()=>ctx.saveProperty({preventDefault(){}})};
}
{
 const h=harness({deferCsrf:true}),first=h.save();await h.save();assert.equal(h.csrf.length,1);assert.equal(h.controls.disabled,true);
 h.csrf[0]('csrf');await first;assert.equal(h.writes.length,1);assert.equal(h.ctx.propertySavePending,false);
}
for(const mutate of [h=>h.ctx.editingPropertyId=B,h=>h.ctx.propertyEditorRevision++,h=>h.ctx.requestDraftOwner=other]) {
 const h=harness({deferCsrf:true});h.ctx.editingPropertyId=A;const pending=h.save();mutate(h);h.csrf[0]('csrf');await pending;
 assert.equal(h.writes.length,0,'Stale editor/account wrote a property after session recovery');assert.equal(h.resets(),0);
}
{
 const h=harness({loseWrite:true,loseRead:true});await h.save();assert.equal(h.records.size,1);
 const saved=[...h.storage.values()].join('');assert(!saved.includes('Example')&&!saved.includes('Private')&&!saved.includes('csrf'));
 const retry=harness({storage:h.storage,records:h.records});await retry.save();
 assert.equal(retry.records.size,1);assert.equal(retry.writes[0].id,h.writes[0].id);assert.equal(retry.ctx.editingPropertyId,h.writes[0].id);
 await retry.save();assert.equal(retry.writes[1].method,'PUT');assert.equal(retry.storage.size,0);assert.equal(retry.ctx.properties.length,1);
}
{
 const h=harness({loseWrite:true,loseRead:true});await h.save();const first=h.writes[0].id;
 h.fields.addressLine1='2 Example Road';await h.save();
 assert.equal(h.writes.length,1,'Same-tab edits after a lost create response issued another POST');assert.equal(h.ctx.editingPropertyId,first);
 assert.equal(h.fields.addressLine1,'2 Example Road');await h.save();assert.equal(h.writes[1].method,'PUT');assert.equal(h.writes[1].id,first);assert.equal(h.records.size,1);
}
{
 const h=harness({loseWrite:true,loseRead:true});await h.save();const first=h.writes[0].id;h.ctx.requestDraftOwner=other;await h.save();
 assert.notEqual(h.writes[1].id,first,'A different owner inherited another account attempt');
}
{
 const h=harness({loseWrite:true,loseRead:true,storageUnavailable:true});await h.save();await h.save();assert.equal(h.writes.length,1);await h.save();assert.equal(h.records.size,1);assert.equal(h.writes[0].id,h.writes[1].id);assert.equal(h.writes[1].method,'PUT');
}
for(const newerEditor of [false,true]) {
 const h=harness({deferWrite:true});h.ctx.editingPropertyId=A;h.ctx.properties=[{propertyId:A,name:'Old A'},{propertyId:B,name:'Keep B'}];
 const pending=h.save();for(let attempt=0;!h.completions.length&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,0));assert(h.completions.length);
 h.ctx.propertyViewRevision++;
 if(newerEditor){h.ctx.editingPropertyId=B;h.ctx.propertyEditorRevision++;h.fields.addressLine1='New unsaved B';}
 h.completions[0]();await pending;
 assert.equal(h.resets(),0);assert.equal(h.navigations(),0,'Late save changed the customer view');
 assert.equal(h.ctx.editingPropertyId,newerEditor?B:A);assert.equal(h.ctx.properties.find(p=>p.propertyId===B).name,'Keep B');
}
{
 const h=harness({deferWrite:true});const pending=h.save();for(let attempt=0;!h.completions.length&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,0));assert(h.completions.length);
 h.ctx.propertyViewRevision++;h.completions[0]();await pending;
 assert.equal(h.ctx.editingPropertyId,h.writes[0].id,'Returning to the same saved form could create a duplicate');assert.equal(h.navigations(),0);
}
// Force-refresh bypasses a cached CSRF token and verifies the current owner.
{
 let calls=0,bound='';const ctx=vm.createContext({storedCsrf:()=> 'cached',requestJson:async()=>{calls++;return {csrfToken:'fresh',account:{userId:owner}};},saveCsrf:()=>true,bindWorkingRequestOwner:account=>bound=account.userId,showFeedback(){}});
 vm.runInContext(section('async function recoverCsrf(', 'function exactAddress('),ctx);
 assert.equal(await ctx.recoverCsrf({},'saving',{refresh:true}),'fresh');assert.equal(calls,1);assert.equal(bound,owner);
}
console.log('Dashboard property save passed: stale editor/owner, double tap, uncertain create/reload, edited payload, storage failure and late-view ownership.');

// A restored unfinished form resolves a possible previous create before any
// new write. Delayed lookup results have the same editor/owner protections.
for(const mutate of [h=>h.ctx.propertyEditorRevision++,h=>h.ctx.editingPropertyId=B,h=>h.ctx.propertyEditorInstance++,h=>h.ctx.requestDraftOwner=other]) {
 const h=harness({restoredId:A,deferRead:true}),pending=h.save();
 for(let i=0;!h.reads.length&&i<100;i++)await new Promise(r=>setTimeout(r,0));assert.equal(h.reads.length,1);
 mutate(h);h.reads[0]({properties:[{propertyId:A,name:'Recovered'}]});await pending;
 assert.equal(h.writes.length,0);assert.equal(h.resets(),0);assert.equal(h.ctx.properties.length,0);
}
for(const response of [{}, {properties:[{propertyId:A},{propertyId:A}]}, {properties:[{propertyId:A,name:'Incomplete protected projection'}]}]) {
 const h=harness({restoredId:A,deferRead:true}),pending=h.save();
 for(let i=0;!h.reads.length&&i<100;i++)await new Promise(r=>setTimeout(r,0));h.reads[0](response);await pending;
 assert.equal(h.writes.length,0);assert.equal(h.resets(),0);assert.equal(h.ctx.restoredPropertyRetryId,A);
}
{
 const h=harness({restoredId:A,loseRead:true});await h.save();assert.equal(h.writes.length,0);assert.equal(h.ctx.restoredPropertyRetryId,A);
 h.fields.addressLine1='Latest edited location';await h.save();assert.equal(h.writes.length,1);assert.equal(h.writes[0].id,A,'An absent previous create must retry the same identity');assert.equal(h.writes[0].body.addressLine1,'Latest edited location');
}
{
 const h=harness({restoredId:A,deferRead:true});h.fields.addressLine1='Edited while original create was uncertain';const pending=h.save();
 for(let i=0;h.reads.length<1&&i<100;i++)await new Promise(r=>setTimeout(r,0));
 // The first attempt commits after the lookup's snapshot. Unique ID recovery
 // must attach it for review, without claiming these newer edits were saved.
 h.records.set(A,savedProperty(A));h.reads[0]({properties:[]});
 for(let i=0;h.reads.length<2&&i<100;i++)await new Promise(r=>setTimeout(r,0));assert.equal(h.reads.length,2);
 h.reads[1]({properties:[savedProperty(A)]});await pending;
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].id,A);assert.equal(h.records.size,1);assert.equal(h.ctx.editingPropertyId,A);
 assert.equal(h.fields.addressLine1,'Edited while original create was uncertain');assert.equal(h.resets(),0);
}
{
 const h=harness({restoredId:A,records:new Map([[A,savedProperty(A)]])});h.fields.accessInstructions='';h.fields.addressLine1='Edited after refresh';h.fields.parkingInstructions='Customer changed parking';
 await h.save();assert.equal(h.writes.length,0);assert.equal(h.ctx.properties[0].propertyId,A);assert.equal(h.resets(),0);assert.equal(h.ctx.editingPropertyId,A);
 assert.equal(h.fields.addressLine1,'Edited after refresh');assert.equal(h.fields.accessInstructions,'Keep this protected access');assert.equal(h.fields.parkingInstructions,'Customer changed parking');
 await h.save();assert.equal(h.writes[0].method,'PUT');assert.equal(h.writes[0].id,A);assert.equal(h.writes[0].body.accessInstructions,'Keep this protected access');
}
{
 const h=harness({restoredId:A,records:new Map([[A,savedProperty(A)]])});h.fields.accessInstructions='';h.ctx.propertyTouchedFields.add('accessInstructions');
 await h.save();assert.equal(h.fields.accessInstructions,'','Recovery overwrote an explicitly cleared optional field');
}
console.log('Restored property save passed: deferred lookup ownership, malformed/ambiguous/unavailable recovery, same-ID absent retry and no duplicate known create.');

// Recovery immediately after a lost response must reject ambiguous identity
// just as strictly as a later retry from the restored form.
{
 const h=harness({loseWrite:true,deferRead:true}), pending=h.save();
 for(let i=0;!h.reads.length&&i<100;i++)await new Promise(r=>setTimeout(r,0));
 assert.equal(h.reads.length,1);const id=h.writes[0].id;
 h.reads[0]({properties:[savedProperty(id),savedProperty(id)]});await pending;
 assert.equal(h.ctx.editingPropertyId,'','An ambiguous immediate lookup attached a saved property');
 assert.equal(h.ctx.properties.length,0);assert.equal(h.ctx.restoredPropertyRetryId,id);
 assert.equal(h.resets(),0);assert.equal(h.writes.length,1);
}



// Content edits remain attached to the same in-flight creation; closing and
// reopening another blank editor must not inherit that newly created identity.
for(const reopen of [false,true]) {
 const h=harness({deferWrite:true});const first=h.save();
 for(let attempt=0;!h.completions.length&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,0));assert(h.completions.length);
 const createdId=h.writes[0].id;h.fields.addressLine1='Changed while saving';h.ctx.propertyEditorRevision++;
 if(reopen)h.ctx.propertyEditorInstance++;
 h.completions[0]();await first;
 assert.equal(h.resets(),0);assert.equal(h.ctx.propertyDirty,true);assert.equal(h.fields.addressLine1,'Changed while saving');
 assert.equal(h.ctx.editingPropertyId,reopen?'':createdId);
 if(!reopen){
  const second=h.save();
  for(let attempt=0;h.completions.length<2&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.completions.length,2);
  assert.equal(h.writes[1].method,'PUT');assert.equal(h.writes[1].id,createdId);assert.equal(h.writes[1].body.addressLine1,'Changed while saving');
  h.completions[1]();await second;assert.equal(h.records.size,1);
 }
}
{
 const h=harness({deferWrite:true});const pending=h.save();
 for(let attempt=0;!h.completions.length&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,0));assert(h.completions.length);
 h.ctx.requestDraftOwner=other;h.completions[0]();await pending;
 assert.equal(h.ctx.properties.length,0,'A previous account response entered the new account cache');assert.equal(h.resets(),0);assert.equal(h.navigations(),0);
}
{
 const h=harness({loseWrite:true,loseRead:true});await h.save();const before=h.writes[0].id;
 h.ctx.propertyCreateRetry.createdAt=Date.now()-landlordRequestDraftLifetimeMs-1;await h.save();
 assert.equal(h.writes.length,1,'Expiry of stored digest silently replaced a still-active attempted identity');assert.equal(h.ctx.editingPropertyId,before);
}
