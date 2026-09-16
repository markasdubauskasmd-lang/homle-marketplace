import assert from "node:assert/strict";
import {editScanRooms, inferredRoomType} from "../public/scan-review-edit.js";
import {localScanReview, applyCorrection} from "../public/scan-review-render.js";
import {scanChecklistLines, inventoryKey, correctInventoryItem, mergeRoomInventory, mergeInventoryIntoSavedDetections} from "../public/room-scan-model.js";
import {normalizedRoomScan, scanProjection} from "../src/marketplace/scan-service.mjs";
let rooms=[{name:"Kitchen",note:"Do not clean inside the oven",objects:[],tasks:[],taskRecords:[]}];
rooms=editScanRooms(rooms,{action:"add-item",roomName:"Kitchen",label:"Air fryer"});
assert.equal(rooms[0].objects[0].condition,"");
assert.ok(scanChecklistLines(rooms).includes("Kitchen: Clean the air fryer"));
rooms=editScanRooms(rooms,{action:"add-room",name:"Utility"});
const original=JSON.stringify(rooms);
assert.throws(()=>editScanRooms(rooms,{action:"rename-room",roomName:"Utility",name:" KITCHEN "}));
assert.equal(JSON.stringify(rooms),original);
assert.throws(()=>editScanRooms(rooms,{action:"rename-room",roomName:"Utility",name:"Utility: wrong"}));
rooms=editScanRooms(rooms,{action:"move-item",roomName:"Kitchen",inventoryKey:"air fryer",destination:"Utility"});
assert.equal(rooms[0].objects.length,0);
assert.ok(!scanChecklistLines(rooms).includes("Kitchen: Clean the air fryer"));
assert.ok(scanChecklistLines(rooms).includes("Utility: Clean the air fryer"));
assert.equal(rooms[0].note,"Do not clean inside the oven");
rooms=editScanRooms(rooms,{action:"room-type",roomName:"Utility",value:"kitchen"});
rooms=editScanRooms(rooms,{action:"rename-room",roomName:"Utility",name:"Laundry"});
assert.equal(inferredRoomType(rooms[1]),"kitchen");
rooms=applyCorrection(rooms,{roomName:"Laundry",inventoryKey:"air fryer",field:"quantity",value:3}).rooms;
const normalized=normalizedRoomScan({rooms,cleaningRequestId:"30000000-0000-4000-8000-000000000001"});
const saved=scanProjection({rooms:normalized.rooms});
assert.equal(saved.rooms[1].roomName,"Laundry");assert.equal(saved.rooms[1].roomType,"kitchen");
assert.equal(saved.rooms[1].objects[0].quantity,3);
assert.equal(localScanReview(rooms).rooms[1].objects[0].quantity,3);
rooms=applyCorrection(rooms,{roomName:"Laundry",inventoryKey:"air fryer",field:"removed",value:""}).rooms;
assert.equal(rooms[1].objects.length,0);
const item={key:"chair",label:"Chair",quantity:4,score:.9};
const corrected=correctInventoryItem([item],"chair",{quantity:1});
assert.equal(mergeRoomInventory(corrected,[{label:"Chair",quantity:4,score:1}])[0].quantity,1);
assert.equal(mergeInventoryIntoSavedDetections([{inventoryKey:"chair",label:"Chair",quantity:4}],corrected)[0].quantity,1);
for(const [label,expected] of [["Microwave oven","microwave"],["Air-fryer","air fryer"],["Refrigerator","fridge"],["Electric cooker","cooker"]]) assert.equal(inventoryKey(label),expected);
console.log("Scan structural review: local edits, duplicate names, moves, scope, room type, quantities and saved projection passed.");

{
  const {withManualInventoryTasks} = await import("../public/room-scan-model.js");
  const inventory=[{key:"air fryer",label:"Air fryer",source:"manual",quantity:2}];
  const room={name:"Kitchen",detections:inventory,taskRecords:[{text:"Leave the keys alone",origin:"customer",inventoryKeys:[]}]};
  const saved=withManualInventoryTasks(room,inventory);
  assert.ok(scanChecklistLines([saved]).includes("Kitchen: Clean the 2 × air fryer"));
  assert.equal(withManualInventoryTasks(saved,inventory).taskRecords.length,2);
  const removed={...saved,detections:[],removedInventoryKeys:["air fryer"]};
  assert.deepEqual(scanChecklistLines([removed]),["Kitchen: Leave the keys alone"]);
}

// Whole-room-only results must be offered by the actual editor's inventory path.
{
  const {readFileSync}=await import("node:fs"), {default:vm}=await import("node:vm");
  const source=readFileSync(new URL("../public/room-scan-overlay.js",import.meta.url),"utf8");
  const start=source.indexOf("    function seedSavedInventory("), end=source.indexOf("    function setInventory(",start);
  const state={inventories:new Map(),dismissed:new Map([["kitchen",new Set(["fridge"])]])};
  const context=vm.createContext({state,inventoryKey,transcriptKey:name=>name.toLowerCase(),inventoryFor:name=>state.inventories.get(name.toLowerCase())||[],renderInventory(){}});
  vm.runInContext(source.slice(start,end),context);
  context.seedSavedInventory({name:"Kitchen",detections:[{inventoryKey:"oven",label:"Oven",quantity:1},{inventoryKey:"fridge",label:"Fridge"}]});
  assert.equal(state.inventories.get("kitchen")[0].label,"Oven");assert.equal(state.inventories.get("kitchen").length,1);
  state.inventories.set("kitchen",[{key:"oven",label:"Cabinet",confirmed:true,quantity:2,quantityConfirmed:true}]);
  context.seedSavedInventory({name:"Kitchen",detections:[{inventoryKey:"oven",label:"Oven",quantity:3}]});
  assert.equal(state.inventories.get("kitchen")[0].label,"Cabinet");assert.equal(state.inventories.get("kitchen")[0].quantity,2);
}
{
  const {mergeSavedDetections}=await import("../public/room-scan-model.js");
  const saved=mergeInventoryIntoSavedDetections([{inventoryKey:"chair",label:"Chair",quantity:4}],corrected);
  assert.equal(mergeSavedDetections(saved,[{inventoryKey:"chair",label:"Chair",quantity:4}])[0].quantity,1);
}
{
  const {createPremiumPlan}=await import("../public/scan-premium-selection.js");
  const config={premiumItems:{oven:{label:"Oven",pence:5500}}};
  const original=[{name:"Kitchen",objects:[{inventoryKey:"oven",label:"Oven",quantity:1}],taskRecords:[{text:"Clean the oven",origin:"vision",inventoryKeys:["oven"]}]}];
  const corrected=applyCorrection(original,{roomName:"Kitchen",inventoryKey:"oven",field:"label",value:"Cabinet"}).rooms;
  assert.equal(createPremiumPlan(corrected,[],config).options.length,0,"Renaming an oven to a cabinet must remove the oven extra");
  assert.equal(corrected[0].taskRecords[0].text,"Clean the cabinet");
  const counted=applyCorrection(corrected,{roomName:"Kitchen",inventoryKey:"oven",field:"quantity",value:3}).rooms;
  assert.equal(counted[0].taskRecords[0].text,"Clean the 3 × cabinet");
  assert.equal(original[0].objects[0].label,"Oven","Corrections must not mutate captured evidence");
}

// Exercise the actual rescan handler: cancellation and failed/multiple-object
// reads preserve the previous room; an item close-up cannot replace its photo.
{
  const {readFileSync}=await import('node:fs'), {default:vm}=await import('node:vm');
  const source=readFileSync(new URL('../public/landlord-journey.js',import.meta.url),'utf8');
  const start=source.indexOf('async function rescanReviewRoom('),end=source.indexOf('// Sends each customer correction',start);
  const old={name:'Kitchen',roomType:'kitchen',note:'Leave the keys alone',objects:[{inventoryKey:'oven',label:'Oven',quantity:1},{inventoryKey:'fridge',label:'Fridge',quantity:1}],taskRecords:[{text:'Clean the oven',origin:'vision',inventoryKeys:['oven']}]};
  let nextResult=null, shouldFail=false, committed, options;
  const state={rescanningRoom:false,scanPhotos:[{roomName:'Kitchen',dataUrl:'whole-room'}]};
  const context=vm.createContext({state,applyCorrection,inferredRoomType,toast(){},taskReviewRooms:()=>[old],commitScanStructure:rooms=>{committed=rooms;},openRoomScan:async args=>{options=args;if(shouldFail)throw Error('unavailable');return nextResult;}});
  vm.runInContext(source.slice(start,end),context);
  await context.rescanReviewRoom('Kitchen','oven');assert.equal(committed,undefined);assert.equal(state.rescanningRoom,false);
  nextResult={rooms:[{name:'Kitchen',objects:[{inventoryKey:'air fryer',label:'Air fryer',quantity:2},{inventoryKey:'microwave',label:'Microwave',quantity:1}]}]};
  await context.rescanReviewRoom('Kitchen','oven');assert.equal(committed,undefined);
  nextResult={rooms:[{name:'Kitchen',objects:[{inventoryKey:'air fryer',pricingCode:'air fryer',label:'Air fryer',quantity:2}]}],photos:[{roomName:'Kitchen',dataUrl:'close-up'}]};
  await context.rescanReviewRoom('Kitchen','oven');
  assert.equal(options.itemOnly,true);assert.equal(committed[0].objects.length,2);assert.equal(committed[0].objects[0].label,'Air fryer');
  assert.equal(committed[0].objects[0].inventoryKey,'oven');assert.equal(committed[0].objects[1].label,'Fridge');
  assert.equal(committed[0].note,old.note);assert.equal(committed[0].roomType,'kitchen');
  assert.equal(committed[0].taskRecords[0].text,'Clean the 2 × air fryer');assert.equal(state.scanPhotos[0].dataUrl,'whole-room');
  committed=undefined;shouldFail=true;await context.rescanReviewRoom('Kitchen','oven');assert.equal(committed,undefined);assert.equal(state.rescanningRoom,false);
}

// Dismissals survive the real save/restore path and later checklist edits.
{
  const {readFileSync}=await import('node:fs'), {default:vm}=await import('node:vm');
  const source=readFileSync(new URL('../public/landlord-journey.js',import.meta.url),'utf8');
  const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
  const room={name:'Kitchen',objects:[{inventoryKey:'microwave',label:'Microwave',quantity:1},{inventoryKey:'tap',label:'Tap',quantity:1}],
    taskRecords:[{text:'Clean the microwave',origin:'vision',inventoryKeys:['microwave']},{text:'Descale the tap',origin:'vision',inventoryKeys:['tap']},
      {text:'Leave the locked cupboard alone',origin:'customer',inventoryKeys:[]}]};
  const storage=new Map();
  const state={draftOwner:'10000000-0000-4000-8000-000000000001',step:'results',scanRooms:[room],scanCorrections:[{roomName:'Kitchen',inventoryKey:'microwave',field:'removed',value:''}],
    scanNoteEdits:{},scanPremiumSelected:[],scanPremiumPlan:{options:[],groups:[]},draft:{tasks:['Kitchen: Descale the tap'],scanChecklistEdited:false,durationMinutes:120}};
  const context=vm.createContext({state,applyCorrection,scanChecklistLines,Date,landlordRequestDraftLifetimeMs:1800000,draftKey:'test',
    sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    currentReviewedNotes:()=>({transcript:'',notes:{}}),durationChoices:[120],stepIndex:()=>2,setRequestScopeValue:(k,v)=>state.draft[k]=v,
    premiumBaseTasks:(_plan,tasks)=>tasks,el:{tasks:{}},renderTaskReview(){}});
  vm.runInContext(section('function saveDraft()', '// A finished room scan')+section('function correctedScanRooms()', 'function renderTaskReview()')+section('function reconcileReviewedChecklist()', 'function correctScanObject('),context);
  context.saveDraft();
  assert.deepEqual(JSON.parse(storage.get('test')).draft.rooms[0].removedInventoryKeys,['microwave']);
  context.restoreDraft();
  state.scanCorrections.push({roomName:'Kitchen',inventoryKey:'tap',field:'quantity',value:3});
  context.reconcileReviewedChecklist();
  assert.doesNotMatch(context.el.tasks.value,/microwave/i,'A later edit resurrected the removed appliance after reload');
  assert.match(context.el.tasks.value,/Descale the 3 × tap/);
  assert.match(context.el.tasks.value,/Leave the locked cupboard alone/);
  context.saveDraft(); context.restoreDraft(); context.reconcileReviewedChecklist();
  assert.doesNotMatch(context.el.tasks.value,/microwave/i,'The dismissal survived only one reload');
}

// Collision-safe identity is distinct from appliance pricing classification.
{
  const {createPremiumPlan,selectedScanRooms}=await import('../public/scan-premium-selection.js');
  const {defaultPricingConfig}=await import('../public/pricing-config.js');
  const {quoteInputFromScan,quoteRooms}=await import('../public/pricing-engine.js');
  let rooms=[{name:'Kitchen',roomType:'kitchen',objects:[],tasks:[],taskRecords:[]}];
  for(let i=0;i<2;i++) rooms=editScanRooms(rooms,{action:'add-item',roomName:'Kitchen',label:'Oven'});
  for(const object of rooms[0].objects) rooms=applyCorrection(rooms,{roomName:'Kitchen',inventoryKey:object.inventoryKey,field:'condition',value:'light'}).rooms;
  assert.deepEqual(rooms[0].objects.map(o=>o.inventoryKey),['oven','oven-2']);
  assert.deepEqual(rooms[0].objects.map(o=>o.pricingCode),['oven','oven']);
  const plan=createPremiumPlan(rooms,scanChecklistLines(rooms),defaultPricingConfig);
  assert.equal(plan.options.length,2,'The second appliance lost its optional specialist choice');
  const selected=selectedScanRooms(rooms,plan,plan.options.map(o=>o.id));
  const input=quoteInputFromScan({rooms:selected.map(room=>({...room,roomName:room.name,objects:room.objects.map(o=>({...o,inventoryKey:o.pricingCode}))}))},{config:defaultPricingConfig});
  assert.equal(quoteRooms(input,defaultPricingConfig).premiumPence,11000,'Two explicitly selected ovens must use two existing £55 components');
  const unselected=selectedScanRooms(rooms,plan,[]);
  const noExtras=quoteInputFromScan({rooms:unselected.map(room=>({...room,roomName:room.name,objects:room.objects.map(o=>({...o,inventoryKey:o.pricingCode}))}))},{config:defaultPricingConfig});
  assert.equal(quoteRooms(noExtras,defaultPricingConfig).premiumPence,0,'Detection/addition must not select specialist work');
}

// Moves retain item-specific actions and quantities, with remapped collision keys.
{
  const original=[{name:'Kitchen',objects:[{inventoryKey:'oven',label:'Oven',quantity:3},{inventoryKey:'tap',label:'Tap',quantity:1}],taskRecords:[
    {text:'Kitchen: Degrease the 3 × oven',origin:'vision',inventoryKeys:['oven']},
    {text:'Polish the 3 × oven handles',origin:'vision',inventoryKeys:['oven']},
    {text:'Wipe the oven and tap',origin:'vision',inventoryKeys:['oven','tap']},
    {text:'Leave keys in Kitchen',origin:'customer',inventoryKeys:[]}]},
    {name:'Utility',objects:[{inventoryKey:'oven',label:'Oven',pricingCode:'oven',quantity:1}],taskRecords:[]}];
  const moved=editScanRooms(original,{action:'move-item',roomName:'Kitchen',inventoryKey:'oven',destination:'Utility'});
  const lines=scanChecklistLines(moved);
  assert(lines.includes('Utility: Degrease the 3 × oven'));
  assert(lines.includes('Utility: Polish the 3 × oven handles'));
  assert(!lines.includes('Kitchen: Degrease the 3 × oven'));
  assert(lines.includes('Kitchen: Leave keys in Kitchen'));
  assert(lines.includes('Kitchen: Wipe the oven and tap'),'Grouped instructions must be retained for explicit review');
  assert.equal(moved[1].objects[1].inventoryKey,'oven-2');
  assert.equal(moved[1].objects[1].pricingCode,'oven');
  assert.equal(moved[1].objects[1].quantity,3);
  assert(moved[1].taskRecords.every(record=>record.inventoryKeys[0]==='oven-2'));
  const fallback=editScanRooms([{name:'A',objects:[{inventoryKey:'chair',label:'Chair',quantity:4}],tasks:[]},{name:'B',objects:[],tasks:[]}],
    {action:'move-item',roomName:'A',inventoryKey:'chair',destination:'B'});
  assert(scanChecklistLines(fallback).includes('B: Clean the 4 × chair'));
}
console.log('Scan persistence and structural regressions passed: repeated reload dismissals, distinct appliance prices/consent and item-specific task moves.');

// A selected specialist quantity edit must replace its generated task, not add
// a second task from a stale premium plan alongside the corrected quantity.
{
  const {readFileSync}=await import('node:fs'), {default:vm}=await import('node:vm');
  const {createPremiumPlan,premiumBaseTasks,premiumScope,premiumChoiceId}=await import('../public/scan-premium-selection.js');
  const {defaultPricingConfig}=await import('../public/pricing-config.js');
  const source=readFileSync(new URL('../public/landlord-journey.js',import.meta.url),'utf8');
  const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
  const rooms=[{name:'Kitchen',objects:[{inventoryKey:'oven',pricingCode:'oven',label:'Oven',quantity:1,condition:'light',conditionConfirmed:true}],
    taskRecords:[{text:'Clean the oven',origin:'vision',inventoryKeys:['oven']}]}];
  const plan=createPremiumPlan(rooms,scanChecklistLines(rooms),defaultPricingConfig);
  const state={scanRooms:rooms,scanCorrections:[],scanNoteEdits:{},scanPremiumPlan:plan,scanPremiumSelected:plan.options.map(o=>o.id),draft:{scanChecklistEdited:false}};
  const el={tasks:{value:''}};
  const context=vm.createContext({state,el,applyCorrection,scanChecklistLines,createPremiumPlan,premiumBaseTasks,premiumScope,premiumChoiceId,
    pricingConfig:defaultPricingConfig,defaultPricingConfig,eligiblePremiumSelections:()=>state.scanPremiumSelected,
    editableTaskLines:()=>el.tasks.value.split('\n').filter(Boolean),renderReview(){},renderPremiumChoices(){},renderTaskReview(){},
    invalidateScanRequest(){},updateResultTotals(){},saveDraft(){},refreshScanReview(){}});
  vm.runInContext(section('function correctedScanRooms()', 'function renderTaskReview()')+section('function reconcileReviewedChecklist()', 'function commitScanStructure('),context);
  context.correctScanObject('Kitchen','oven','quantity',3);
  assert.deepEqual(Array.from(state.draft.tasks),['Kitchen: Clean the 3 × oven'],'A stale optional task survived the corrected appliance quantity');
  assert.equal(state.scanPremiumSelected.length,1,'Changing quantity should not deselect previously approved specialist work');
}
