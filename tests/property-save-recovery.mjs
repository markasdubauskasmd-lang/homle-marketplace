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
function harness({storage=new Map(),records=new Map(),deferCsrf=false,deferWrite=false,loseWrite=false,loseRead=false,storageUnavailable=false}={}) {
 const fields={name:'Fixture property',propertyType:'flat',addressLine1:'1 Example Road',locality:'London',postcode:'SW1A 1AA',accessInstructions:'Private fixture entry note'};
 const writes=[],feedback=[],csrf=[],completions=[];let resets=0,navigations=0;
 const controls={};
 const ctx=vm.createContext({crypto:webcrypto,TextEncoder,Date,landlordRequestDraftLifetimeMs,
 propertyCreateRetry:null,propertySavePending:false,propertyEditorRevision:0,propertyEditorInstance:0,propertyViewRevision:0,requestDraftOwner:owner,
 propertyFeedback:{},propertyForm:{reportValidity:()=>true,reset(){resets++;},hidden:false},
 FormData:class {constructor(){this.values={...fields};}get(key){return this.values[key]??'';}},
 isUkPostcode:()=>true,requestTasksFromLines:()=>[],optionalNumber:v=>v?Number(v):null,
 recoverCsrf:(_feedback,_action,options)=>{assert.equal(options.refresh,true);return deferCsrf?new Promise(resolve=>csrf.push(resolve)):Promise.resolve('csrf');},
 propertySave:controls,propertyFormTitle:{},propertyStatus:{},propertyDialog:null,bookingStart:true,editingPropertyId:'',propertyDirty:true,properties:[],
 setPending(button,pending){button.disabled=pending;},renderProperties(){},showFeedback(_target,message){feedback.push(message);},
 selectWorkspaceTab(){navigations++;},propertySelect:{},requestForm:{scrollIntoView(){},elements:{requestedDate:{focus(){}}}},customerScrollBehavior:()=> 'instant',
 window:{sessionStorage:{getItem:k=>{if(storageUnavailable)throw Error('denied');return storage.get(k);},setItem:(k,v)=>{if(storageUnavailable)throw Error('denied');storage.set(k,v);},removeItem:k=>storage.delete(k)}},
 requestJson:async(path,options)=>{
  if(!options){if(loseRead){loseRead=false;throw Object.assign(Error('read lost'),{code:'request-timeout'});}return {properties:[...records.values()]};}
  const body=JSON.parse(options.body),record=normalizedProperty(body,'fixture-encryption-key-over-thirty-two-characters',options.method==='PUT'?path.split('/').at(-1):body.id);
  writes.push({path,method:options.method,body,id:record.id});
  if(options.method==='POST'&&records.has(record.id))throw Object.assign(Error('exists'),{statusCode:409});
  const property={propertyId:record.id,name:record.name,exactAddress:{addressLine1:record.addressLine1,postcode:record.postcode}};
  records.set(record.id,property);
  if(loseWrite){loseWrite=false;throw Object.assign(Error('write response lost'),{code:'request-timeout'});}
  if(deferWrite)return new Promise(resolve=>completions.push(()=>resolve({property})));
  return {property};
 }});
 vm.runInContext(section('async function propertyCreateIdentity(', 'function openNewRequestPhotoDialog()'),ctx);
 return {ctx,fields,writes,feedback,csrf,completions,storage,records,controls,resets:()=>resets,navigations:()=>navigations,save:()=>ctx.saveProperty({preventDefault(){}})};
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
 assert.equal(retry.records.size,1);assert.equal(retry.writes[0].id,h.writes[0].id);assert.equal(retry.storage.size,0);assert.equal(retry.ctx.properties.length,1);
}
for(const change of [h=>h.fields.addressLine1='2 Example Road',h=>h.ctx.requestDraftOwner=other]) {
 const h=harness({loseWrite:true,loseRead:true});await h.save();const first=h.writes[0].id;change(h);await h.save();
 assert.notEqual(h.writes[1].id,first,'Changed owner or payload reused an uncertain identity');
}
{
 const h=harness({loseWrite:true,loseRead:true,storageUnavailable:true});await h.save();await h.save();assert.equal(h.records.size,1);assert.equal(h.writes[0].id,h.writes[1].id);
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
 assert.notEqual(h.writes[1].id,before,'Expired retry metadata outlived the existing retention limit');
}
