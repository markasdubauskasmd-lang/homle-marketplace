import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {clearPropertyFormDraft,readPropertyFormDraft,savePropertyFormDraft,propertyDraftFields} from '../public/landlord-property-draft.js';
import {landlordRequestDraftLifetimeMs} from '../public/landlord-request-draft.js';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const retry='33333333-3333-4333-8333-333333333333';
const key='homlePropertyFormDraftV1',now=Date.now();
const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
const fields={propertyType:'flat',addressLine1:'1 Example Road',addressLine2:'Apartment 3',locality:'London',postcode:'SW1A 1AA',
 accessInstructions:'Door code 6789',parkingInstructions:'Keys under the mat',specialNotes:'Password: abc123',savedChecklist:'secret',csrfToken:'private',name:'Private tenant'};
savePropertyFormDraft(storage,{ownerId:owner,fields,retryId:retry},now);
assert.deepEqual(Object.keys(readPropertyFormDraft(storage,owner,now).fields),Object.keys(propertyDraftFields));
assert.equal(readPropertyFormDraft(storage,owner,now).retryId,retry);
for(const value of ['6789','under the mat','abc123','secret','private','Private tenant'])assert(!memory.get(key).includes(value));
assert.equal(readPropertyFormDraft(storage,other,now),null);assert.equal(memory.size,0);
for(const delta of [landlordRequestDraftLifetimeMs,-300001]){
 savePropertyFormDraft(storage,{ownerId:owner,fields},now);assert.equal(readPropertyFormDraft(storage,owner,now+delta),null);assert.equal(memory.size,0);
}
for(const secret of ['Door code 1234','Key safe is behind the bin','password: abc123','API key sk_example']){
 savePropertyFormDraft(storage,{ownerId:owner,fields:{...fields,addressLine1:secret}},now);
 assert.equal(readPropertyFormDraft(storage,owner,now).fields.addressLine1,'');assert(!memory.get(key).includes(secret));
}
const broken={getItem(){throw Error('denied');},setItem(){throw Error('full');},removeItem(){throw Error('denied');}};
assert.equal(savePropertyFormDraft(broken,{ownerId:owner,fields},now),null);assert.equal(readPropertyFormDraft(broken,owner,now),null);clearPropertyFormDraft(broken);

// Actual dashboard handlers: only a new editor restores, dirty/current saved
// property forms stay untouched, and allowed-field writes never contain notes.
const source=readFileSync(new URL('../public/landlord-dashboard.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const elements=Object.fromEntries(Object.keys(fields).map(name=>[name,{value:''}]));
const ctx=vm.createContext({propertyForm:{hidden:false,elements},requestDraftOwner:owner,editingPropertyId:'',propertyDirty:false,restoredPropertyRetryId:'',propertyAttemptOwner:'',
 window:{sessionStorage:storage},propertyDraftStorage:()=>storage,propertyDraftFields,savePropertyFormDraft,readPropertyFormDraft,clearPropertyFormDraft,propertyFeedback:{},showFeedback(){}});
vm.runInContext(section('function rememberPropertyFormDraft(', 'function closePropertyEditor('),ctx);
savePropertyFormDraft(storage,{ownerId:owner,fields,retryId:retry});
ctx.restorePropertyFormDraft();assert.equal(elements.addressLine1.value,fields.addressLine1);assert.equal(ctx.restoredPropertyRetryId,retry);assert.equal(ctx.propertyDirty,true);
elements.addressLine1.value='New unsaved change';ctx.restorePropertyFormDraft();assert.equal(elements.addressLine1.value,'New unsaved change');
ctx.propertyDirty=false;ctx.editingPropertyId=other;ctx.restorePropertyFormDraft();assert.equal(elements.addressLine1.value,'New unsaved change');
ctx.editingPropertyId='';ctx.propertyDirty=true;elements.accessInstructions.value='Password: protected';ctx.rememberPropertyFormDraft();
assert(!memory.get(key).includes('protected'));assert.equal(readPropertyFormDraft(storage,owner).fields.addressLine1,'New unsaved change');
console.log('Property form draft passed: strict field allowlist, owner/expiry/clock/storage boundaries and actual editor restore isolation.');
