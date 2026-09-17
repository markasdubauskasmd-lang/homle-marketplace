import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {applyCorrection} from "../public/scan-review-render.js";
import {editScanRooms, mergeReviewedRoomRescan} from "../public/scan-review-edit.js";
import {scanChecklistLines} from "../public/room-scan-model.js";
import {createPremiumPlan, premiumChoiceId, premiumScope} from "../public/scan-premium-selection.js";
import {defaultPricingConfig} from "../public/pricing-config.js";

const source=readFileSync(new URL("../public/landlord-journey.js",import.meta.url),"utf8");
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const oven={inventoryKey:"oven",label:"Oven",pricingCode:"oven",quantity:1};
const kitchen={name:"Kitchen",objects:[oven],tasks:[],taskRecords:[]};
function reviewHarness(state) {
  const context=vm.createContext({state,applyCorrection});
  vm.runInContext(slice("function correctedScanRooms()","function renderTaskReview()"),context);
  return context;
}

// Removing or moving a corrected identity must survive a reread under either
// the original detector label or the customer's replacement label, then reload.
for(const action of ["remove","move"]) {
  const state={scanRooms:[kitchen,{name:"Utility",objects:[],tasks:[]}],scanCorrections:[
    {roomName:"Kitchen",inventoryKey:"oven",field:"label",value:"Cabinet"}
  ],scanNoteEdits:{}};
  if(action==="remove")state.scanCorrections.push({roomName:"Kitchen",inventoryKey:"oven",field:"removed",value:""});
  let rooms=reviewHarness(state).taskReviewRooms();
  if(action==="move")rooms=editScanRooms(rooms,{action:"move-item",roomName:"Kitchen",inventoryKey:"oven",destination:"Utility"});
  const restored=JSON.parse(JSON.stringify(rooms));
  const reread=mergeReviewedRoomRescan(restored[0],{objects:[oven,{...oven,inventoryKey:"cabinet",label:"Cabinet"}],tasks:[]});
  assert.equal(reread.objects.length,0,`A ${action}d corrected item returned under its new name`);
  if(action==="move")assert.equal(restored[1].objects[0].label,"Cabinet");
}

// Dismissing the corrected row must not delete a distinct existing identity.
{
  const rooms=[{...kitchen,objects:[{...oven,label:"Cabinet"},{inventoryKey:"cabinet",label:"Cabinet",quantity:2}]}];
  const result=applyCorrection(rooms,{roomName:"Kitchen",inventoryKey:"oven",field:"removed"}).rooms[0];
  assert.equal(mergeReviewedRoomRescan(result,{objects:[],tasks:[]}).objects[0].quantity,2);
  assert.equal(rooms[0].objects.length,2,"Corrections changed original scan evidence");
}

// Removing a destination's oven, then moving another selected oven there uses
// a fresh identity. Paid-extra consent must follow exactly that moved identity.
{
  const rooms=[kitchen,{name:"Utility",objects:[{...oven}],tasks:[]}];
  const state={scanRooms:rooms,scanCorrections:[{roomName:"Utility",inventoryKey:"oven",field:"removed",value:""}],
    scanNoteEdits:{},scanPhotos:[],scanMeasurements:[],draft:{},scanPremiumSelected:[premiumChoiceId("Kitchen","oven")],
    scanPremiumPlan:createPremiumPlan(rooms,[],defaultPricingConfig)};
  const context=reviewHarness(state);
  Object.assign(context,{createPremiumPlan,premiumChoiceId,premiumScope,scanChecklistLines,pricingConfig:defaultPricingConfig,defaultPricingConfig,
    roomKeyOf:n=>String(n||"").trim().toLowerCase(),reconcileReviewedChecklist(){},editableTaskLines:()=>[],
    eligiblePremiumSelections:()=>state.scanPremiumSelected,invalidateScanRequest(){},renderPremiumChoices(){},renderRoomNotes(){},
    updateResultTotals(){},saveDraft(){},renderReview(){},refreshScanReview(){}});
  vm.runInContext(slice("function commitScanStructure(","function changeScanStructure("),context);
  const edit={action:"move-item",roomName:"Kitchen",inventoryKey:"oven",destination:"Utility"};
  context.commitScanStructure(editScanRooms(context.taskReviewRooms(),edit),edit);
  assert.equal(state.scanRooms[1].objects[0].inventoryKey,"oven-2");
  assert.deepEqual(Array.from(state.scanPremiumSelected),[premiumChoiceId("Utility","oven-2")]);
}
console.log("Scan corrections follow through removal, room move, reread, reload and selected appliance scope.");
