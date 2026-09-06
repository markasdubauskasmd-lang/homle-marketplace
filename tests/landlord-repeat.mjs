import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createLandlordRepeatService } from "../src/marketplace/landlord-repeat-service.mjs";
const owner = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const bookingId = "22222222-2222-4222-8222-222222222222";
const propertyId = "33333333-3333-4333-8333-333333333333";
const cleanerId = "44444444-4444-4444-8444-444444444444";
const row = {
  id: bookingId, landlord_user_id: owner.userId, property_id: propertyId, cleaner_user_id: cleanerId, status: "completed",
  scope_snapshot: { cleaningType: "deep-cleans", requiredServices: ["deep-cleans"], specialInstructions: "Do not clean the oven.", tasks: [{ roomName: "Kitchen", description: "Wipe worktops", sortOrder: 0 }], requestedStartAt: "2026-01-01T09:00:00Z", requestedEndAt: "2026-01-01T12:00:00Z", customerPricePence: 99999, photos: ["private-object"] }
};
let currentRow = row;
const queries = [];
const service = createLandlordRepeatService({
  withUserTransaction(actor, callback) {
    assert.equal(actor, owner);
    return callback({ query: async (sql, values) => { queries.push({sql, values}); return { rows: currentRow ? [currentRow] : [] }; } });
  }
});
const scope = await service.getScope(owner, bookingId);
assert.deepEqual(scope.tasks, [{roomName:"Kitchen",description:"Wipe worktops"}]);
assert.equal(scope.specialInstructions, "Do not clean the oven.");
assert.equal(scope.requestedMinutes, 180);
assert.equal(scope.frequency, "one-time");
assert.equal(scope.propertyId, propertyId);
assert(!("photos" in scope) && !("customerPricePence" in scope) && !("requestedStartAt" in scope));
assert(Object.isFrozen(scope) && Object.isFrozen(scope.tasks[0]));
assert.deepEqual(queries[0].values, [bookingId, owner.userId]);
assert.match(queries[0].sql, /booking.landlord_user_id=\$2::uuid/);
assert.match(queries[0].sql, /property.archived_at IS NULL/);
await assert.rejects(service.getScope({userId:cleanerId,roles:["cleaner"]}, bookingId), /Landlord/);
await assert.rejects(service.getScope(owner, "invalid"), /booking id/);
for (const candidate of [null, {...row,landlord_user_id:cleanerId}, {...row,status:"confirmed"}]) {
  currentRow=candidate;
  await assert.rejects(service.getScope(owner, bookingId), /not available/);
}
for (const snapshot of [{legacyBooking:true}, {...row.scope_snapshot,tasks:[]}, {...row.scope_snapshot,cleaningType:"invented"}, {...row.scope_snapshot,requestedEndAt:"bad"}]) {
  currentRow={...row,scope_snapshot:snapshot};
  await assert.rejects(service.getScope(owner, bookingId), /scope is unavailable/);
}

const source = await readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("let repeatScopePending = false;"), source.indexOf("function renderLandlordHistory("));
function harness({ fail=false, changed=false }={}) {
  const fields=Object.fromEntries(["propertyId","cleaningType","frequency","requestedDate","requestedTime","budget","specialInstructions","tasks","transcript","durationMinutes","scopeReviewed"].map(key=>[key,{value:"old",checked:true}]));
  fields.cleaningType.options=[{value:"deep-cleans"}];fields.durationMinutes.options=[{value:"180"}];
  let resetCount=0, phase=0;
  const messages=[];
  const context=vm.createContext({
    requestDraftPending:false,requestDirty:false,currentRequestDraft:null,tasksManuallyEdited:false,selectedPropertyId:"",selectedCleanerId:"",
    document:{querySelector:()=>({hidden:true})},properties:[{propertyId}],cleaningTypeSelect:{...fields.cleaningType,dataset:{}},
    window:{confirm:()=>true,setTimeout:callback=>callback()},sessionStorage:{},localStorage:{},Event:class {constructor(name){this.type=name;}},
    requestForm:{elements:fields,reset:()=>{resetCount++; for(const field of Object.values(fields)){field.value="";field.checked=false;}},dispatchEvent:()=>{}},
    requestDraftFields:()=>({version:changed?phase:0}),requestJson:async()=>{phase=1;if(fail)throw Error("Offline");return {scope};},
    showFeedback:(_target,message)=>messages.push(message),tasksToLines:tasks=>tasks.map(t=>t.roomName+": "+t.description).join("\n"),
    loadPrepareWizard:async()=>{},resetRequestContinuation:()=>{},saveSelectedProperty:()=>{},saveSelectedCleaner:()=>{},renderTaskPreview:()=>{},
    rememberWorkingRequest:()=>{},selectWorkspaceTab:()=>{},checkManualCoverage:async()=>{},refreshSelectedCleanerProfile:async()=>{},scheduleManualQuote:()=>{},requestFeedback:{}
  });
  vm.runInContext(handler,context);
  return {context,fields,messages,resets:()=>resetCount};
}
const previous={bookingId,propertyId,cleanerId};
const success=harness();const button={disabled:false};
await success.context.prepareRepeatRequest(previous,button);
assert.equal(success.resets(),1);
assert.equal(success.fields.tasks.value,"Kitchen: Wipe worktops");
assert.equal(success.fields.specialInstructions.value,"Do not clean the oven.");
assert.equal(success.fields.requestedDate.value,"");
assert.equal(success.fields.requestedTime.value,"");
assert.equal(success.fields.budget.value,"");
assert.equal(success.fields.scopeReviewed.checked,false);
assert.equal(success.fields.frequency.value,"one-time");
assert.equal(button.disabled,false);
for(const options of [{fail:true},{changed:true}]) {
  const denied=harness(options);await denied.context.prepareRepeatRequest(previous,{disabled:false});
  assert.equal(denied.resets(),0);assert.equal(denied.fields.tasks.value,"old");
}
console.log("Repeat scope passed: owner-only completed records, frozen task/instruction projection, no old money/media/time, fresh review, failed reads and concurrent draft edits preserved.");
