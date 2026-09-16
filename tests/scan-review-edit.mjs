import assert from "node:assert/strict";
import {editScanRooms, inferredRoomType, mergeReviewedRoomRescan} from "../public/scan-review-edit.js";
import "./scanner-handoff.mjs";
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
  const {reviewedScanNotes}=await import('../public/scan-premium-selection.js');
  const context=vm.createContext({state,applyCorrection,inferredRoomType,mergeReviewedRoomRescan,reviewedScanNotes,toast(){},taskReviewRooms:()=>[old],commitScanStructure:rooms=>{committed=rooms;},openRoomScan:async args=>{options=args;if(shouldFail)throw Error('unavailable');return nextResult;}});
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
  const afterItemRescan=JSON.parse(JSON.stringify(committed[0]));
  const laterRoomRead=mergeReviewedRoomRescan(afterItemRescan,{objects:[{inventoryKey:'air fryer',label:'Air fryer',quantity:1,condition:'clean',confidenceCondition:.99}],tasks:[]});
  assert.equal(laterRoomRead.objects.length,2,'A later room read duplicated the item explicitly selected by rescan');
  assert.equal(laterRoomRead.objects[0].quantity,2,'A later room read overwrote the accepted item rescan');
  committed=undefined;shouldFail=true;await context.rescanReviewRoom('Kitchen','oven');assert.equal(committed,undefined);assert.equal(state.rescanningRoom,false);
  shouldFail=false;
  nextResult={rooms:[{name:'Kitchen',note:'Wipe the handles',objects:[{inventoryKey:'kettle',label:'Kettle',quantity:1}],taskRecords:[]}]};
  await context.rescanReviewRoom('Kitchen');
  assert.equal(committed[0].objects.length,3,'A room rescan discarded existing inventory outside the new view');
  assert.match(committed[0].note,/Wipe the handles/,'A room rescan discarded new customer instructions');
  committed=undefined;
  state.scanGeneralNote='x'.repeat(4990);
  const notesBefore=JSON.stringify(state.scanNoteEdits), photosBefore=JSON.stringify(state.scanPhotos);
  await context.rescanReviewRoom('Kitchen');
  assert.equal(committed,undefined,'Oversized combined notes were accepted then lost during draft saving');
  assert.equal(JSON.stringify(state.scanNoteEdits),notesBefore);
  assert.equal(JSON.stringify(state.scanPhotos),photosBefore);
  context.openRoomScan=async()=>{state.draftOwner='different-owner';return nextResult;};
  await context.rescanReviewRoom('Kitchen'); assert.equal(committed,undefined,'Rescan data crossed an account change');
  for (const replacement of ['draft', 'rooms']) {
    state.scanGeneralNote='';
    state.draft={requestId:'original'};
    state.scanRooms=[old];
    state.scanNoteEdits={kitchen:'Existing instructions'};
    const photosBefore=JSON.stringify(state.scanPhotos), notesBefore=JSON.stringify(state.scanNoteEdits);
    context.openRoomScan=async()=>{
      if(replacement==='draft')state.draft={requestId:'replacement'};
      else state.scanRooms=[{...old,note:'Replacement scan'}];
      return nextResult;
    };
    await context.rescanReviewRoom('Kitchen');
    assert.equal(committed,undefined,'Late rescan overwrote replacement '+replacement+' for the same account');
    assert.equal(JSON.stringify(state.scanPhotos),photosBefore,'Stale rescan replaced another draft photo');
    assert.equal(JSON.stringify(state.scanNoteEdits),notesBefore,'Stale rescan replaced another draft instructions');
    assert.equal(state.rescanningRoom,false);
  }
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

// The note editor is authoritative even when its change clears the old note.
// A rescan must not rebuild tasks from the original, now withdrawn instruction.
{
  const {readFileSync}=await import('node:fs'), {default:vm}=await import('node:vm');
  const {withCurrentRoomInstructions,roomInstructionTasks}=await import('../public/room-scan-model.js');
  const {checklistFromTranscript}=await import('../public/checklist.js');
  const source=readFileSync(new URL('../public/landlord-journey.js',import.meta.url),'utf8');
  for (const note of ['Do not clean inside the oven','']) {
    const state={scanRooms:[{name:'Kitchen',note:'Clean inside the oven',objects:[],taskRecords:[{text:'Clean inside the oven',origin:'customer',inventoryKeys:[]}]}],
      scanNoteEdits:{kitchen:note},scanCorrections:[]};
    const context=vm.createContext({state,applyCorrection,withCurrentRoomInstructions,roomInstructionTasks,checklistFromTranscript});
    vm.runInContext(source.slice(source.indexOf('function correctedScanRooms()'),source.indexOf('function renderTaskReview()')),context);
    const room=context.taskReviewRooms()[0];
    assert.equal(room.note,note,'The reviewed room still carried its withdrawn note');
    const merged=mergeReviewedRoomRescan(room,{objects:[],note:'Wipe handles',tasks:[]});
    assert(!merged.note.split('\n').includes('Clean inside the oven'));
    assert.equal(merged.note,note ? note+'\nWipe handles' : 'Wipe handles');
  }
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

// The real structural commit must preserve selected work through a room rename,
// but must not transfer that consent to a different appliance after a rescan.
{
  const {readFileSync}=await import('node:fs'), {default:vm}=await import('node:vm');
  const {createPremiumPlan,premiumChoiceId,premiumScope}=await import('../public/scan-premium-selection.js');
  const {defaultPricingConfig}=await import('../public/pricing-config.js');
  const source=readFileSync(new URL('../public/landlord-journey.js',import.meta.url),'utf8');
  const old=[{name:'Kitchen',objects:[{inventoryKey:'oven',pricingCode:'oven',label:'Oven'}],tasks:[]}];
  const plan=createPremiumPlan(old,[],defaultPricingConfig);
  const state={scanRooms:old,scanPremiumPlan:plan,scanPremiumSelected:plan.options.map(o=>o.id),scanNoteEdits:{kitchen:'Keep keys safe',deleted:'Old note'},scanPhotos:[],scanMeasurements:[],draft:{}};
  const context=vm.createContext({state,createPremiumPlan,premiumChoiceId,premiumScope,scanChecklistLines,pricingConfig:defaultPricingConfig,defaultPricingConfig,
    roomKeyOf:n=>String(n||'').trim().toLowerCase(),correctedScanRooms:()=>state.scanRooms,
    reconcileReviewedChecklist(){},editableTaskLines:()=>[],eligiblePremiumSelections:()=>state.scanPremiumSelected,
    invalidateScanRequest(){},renderPremiumChoices(){},renderRoomNotes(){},updateResultTotals(){},saveDraft(){},renderReview(){},refreshScanReview(){}});
  vm.runInContext(source.slice(source.indexOf('function commitScanStructure('),source.indexOf('function changeScanStructure(')),context);
  const renamed=editScanRooms(old,{action:'rename-room',roomName:'Kitchen',name:'Utility'});
  context.commitScanStructure(renamed,{action:'rename-room',roomName:'Kitchen',name:'Utility'});
  assert.deepEqual(Array.from(state.scanPremiumSelected),[premiumChoiceId('Utility','oven')],'Renaming a room silently removed selected specialist work');
  assert.equal(state.scanNoteEdits.deleted,undefined,'Deleted room instructions can leak into a later room with the same name');
  const withDestination=[...state.scanRooms,{name:'Pantry',objects:[{inventoryKey:'oven',pricingCode:'oven',label:'Oven'}],tasks:[]}];
  state.scanRooms=withDestination;
  const moved=editScanRooms(withDestination,{action:'move-item',roomName:'Utility',inventoryKey:'oven',destination:'Pantry'});
  context.commitScanStructure(moved,{action:'move-item',roomName:'Utility',inventoryKey:'oven',destination:'Pantry'});
  assert.deepEqual(Array.from(state.scanPremiumSelected),[premiumChoiceId('Pantry','oven-2')],'Moving a selected appliance lost consent or selected the destination appliance');
  context.commitScanStructure([{name:'Pantry',objects:[{inventoryKey:'oven-2',pricingCode:'fridge',label:'Fridge'}],tasks:[]}]);
  assert.equal(state.scanPremiumSelected.length,0,'An appliance rescan silently selected a different paid extra');
  state.scanPremiumPlan=createPremiumPlan(renamed,[],defaultPricingConfig);
  state.scanPremiumSelected=state.scanPremiumPlan.options.map(o=>o.id);
  context.commitScanStructure([{name:'Utility',objects:[{inventoryKey:'oven',pricingCode:'fridge',label:'Fridge'}],tasks:[]}]);
  assert.equal(state.scanPremiumSelected.length,0,'An appliance rescan silently selected a different paid extra');
  state.scanRooms=[...old,{name:'Utility',objects:[],tasks:[]}];
  state.scanPremiumPlan=createPremiumPlan(state.scanRooms,[],defaultPricingConfig);
  state.scanPremiumSelected=state.scanPremiumPlan.options.map(o=>o.id);
  for(const edit of [
    {action:'move-item',roomName:'Kitchen',inventoryKey:'oven',destination:'Utility'},
    {action:'move-item',roomName:'Utility',inventoryKey:'oven',destination:'Kitchen'}
  ]) context.commitScanStructure(editScanRooms(state.scanRooms,edit),edit);
  assert.equal(state.scanRooms[0].objects[0].inventoryKey,'oven-2');
  assert.deepEqual(Array.from(state.scanPremiumSelected),[premiumChoiceId('Kitchen','oven-2')],
    'Returning a selected appliance reused a removed identity or lost its specialist selection');
  context.commitScanStructure(state.scanRooms.map(room=>room.name==='Kitchen'?mergeReviewedRoomRescan(room,{objects:[],tasks:[]}):room));
  assert.deepEqual(Array.from(state.scanPremiumSelected),[premiumChoiceId('Kitchen','oven-2')]);
  assert.equal(state.scanRooms[0].objects.length,1,'A rescan discarded the returned selected appliance');
}

// A room rescan is additional evidence, not permission to erase reviewed scope.
{
  const {mergeReviewedRoomRescan} = await import('../public/scan-review-edit.js');
  const old = {name:'Kitchen',roomType:'kitchen',note:'Leave the locked cupboard alone',
    removedInventoryKeys:['microwave'],changedInventoryKeys:['oven','air fryer'],
    objects:[{inventoryKey:'oven',label:'Cabinet',pricingCode:'cabinet',quantity:3,origin:'manual'},
      {inventoryKey:'air fryer',label:'Air fryer',quantity:2,origin:'manual'},
      {inventoryKey:'fridge',label:'Fridge',quantity:1}],
    taskRecords:[{text:'Polish the 3 × cabinet',origin:'vision',inventoryKeys:['oven']},
      {text:'Clean the 2 × air fryer',origin:'vision',inventoryKeys:['air fryer']},
      {text:'Leave the locked cupboard alone',origin:'customer',inventoryKeys:[]}]};
  const incoming = {name:'Kitchen',note:'Wipe the handles',objects:[
    {inventoryKey:'oven',label:'Oven',quantity:1},
    {inventoryKey:'microwave',label:'Microwave',quantity:1},
    {inventoryKey:'air fryer',label:'Air fryer',quantity:1},
    {inventoryKey:'kettle',label:'Kettle',quantity:1}],taskRecords:[
      {text:'Clean the oven',origin:'vision',inventoryKeys:['oven']},
      {text:'Clean the microwave',origin:'vision',inventoryKeys:['microwave']},
      {text:'Clean the air fryer',origin:'vision',inventoryKeys:['air fryer']},
      {text:'Clean the kettle',origin:'vision',inventoryKeys:['kettle']},
      {text:'Wipe the handles',origin:'customer',inventoryKeys:[]}]};
  const original=JSON.stringify(old);
  const result=mergeReviewedRoomRescan(old,incoming);
  assert.equal(JSON.stringify(old),original);
  assert.deepEqual(result.objects.map(o=>o.label),['Cabinet','Air fryer','Fridge','Kettle']);
  assert.equal(result.objects[0].quantity,3);
  assert.equal(result.objects[1].quantity,2);
  assert.equal(result.roomType,'kitchen');
  assert.match(result.note,/locked cupboard/); assert.match(result.note,/Wipe the handles/);
  const lines=scanChecklistLines([result]);
  assert(lines.includes('Kitchen: Polish the 3 × cabinet'));
  assert(lines.includes('Kitchen: Clean the kettle'));
  assert(!lines.some(line=>/oven|microwave/i.test(line)));
  assert(lines.includes('Kitchen: Leave the locked cupboard alone'));
  assert(lines.includes('Kitchen: Wipe the handles'));
  assert.equal(mergeReviewedRoomRescan(result,incoming).note,result.note,'Retry duplicated instructions');
  assert.throws(()=>mergeReviewedRoomRescan({...old,note:'x'.repeat(995)},incoming),RangeError);
  const partial=mergeReviewedRoomRescan({name:'Kitchen',objects:[{inventoryKey:'oven',label:'Oven',quantity:2}],taskRecords:[{text:'Clean the 2 × oven',origin:'vision',inventoryKeys:['oven']}]},
    {objects:[{inventoryKey:'oven',label:'Oven',quantity:1}],taskRecords:[{text:'Clean the oven',origin:'vision',inventoryKeys:['oven']}]});
  assert.equal(partial.objects[0].quantity,2,'A narrow camera view removed an earlier visible appliance');
  assert.deepEqual(scanChecklistLines([partial]),['Kitchen: Clean the 2 × oven']);
  const clearer=mergeReviewedRoomRescan({name:'Kitchen',objects:[{inventoryKey:'oven',label:'Oven',quantity:1,condition:'light',confidenceCondition:.2,evidence:'Distant view'}]},
    {objects:[{inventoryKey:'oven',label:'Oven',quantity:1,condition:'heavy',confidenceCondition:.95,evidence:'Visible grease around handle'}]});
  assert.equal(clearer.objects[0].condition,'heavy');
  assert.equal(clearer.objects[0].confidenceCondition,.95);
  assert.equal(clearer.objects[0].evidence,'Visible grease around handle','The new grade was paired with stale evidence');
  const grouped=mergeReviewedRoomRescan(old,{objects:[{inventoryKey:'kettle',label:'Kettle',quantity:1}],taskRecords:[{text:'Clean the oven and kettle',origin:'vision',inventoryKeys:['oven','kettle']}]});
  const {scanTaskReview}=await import('../public/room-scan-model.js');
  assert(scanTaskReview(grouped).some(record=>record.text==='Clean the oven and kettle' && record.reviewRequired),'A new item lost its grouped task rather than retaining it for review');
}

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

// Explicitly adding or returning an item must not reuse a dismissal identity:
// rescanning later would otherwise silently discard the current object.
{
  const original={name:'Kitchen',objects:[{inventoryKey:'oven',pricingCode:'oven',label:'Oven',quantity:2}],
    taskRecords:[{text:'Clean the 2 × oven',origin:'vision',inventoryKeys:['oven']}]};
  let moved=editScanRooms([original,{name:'Utility',objects:[]}],{action:'move-item',roomName:'Kitchen',destination:'Utility',inventoryKey:'oven'});
  moved=editScanRooms(moved,{action:'move-item',roomName:'Utility',destination:'Kitchen',inventoryKey:'oven'});
  assert.equal(moved[0].objects[0].inventoryKey,'oven-2');
  const rescanned=mergeReviewedRoomRescan(moved[0],{objects:[]});
  assert.equal(rescanned.objects.length,1);assert.equal(rescanned.objects[0].quantity,2);
  assert.deepEqual(scanChecklistLines([rescanned]),['Kitchen: Clean the 2 × oven']);
  const deleted={...original,objects:[],removedInventoryKeys:['oven'],changedInventoryKeys:['oven']};
  const added=editScanRooms([deleted],{action:'add-item',roomName:'Kitchen',label:'Oven'})[0];
  assert.equal(added.objects[0].inventoryKey,'oven-2');
  const after=mergeReviewedRoomRescan(added,{objects:[{inventoryKey:'oven',label:'Oven',quantity:1}],tasks:[]});
  assert.equal(after.objects.length,1);assert.equal(after.objects[0].pricingCode,'oven');
  assert.deepEqual(scanChecklistLines([after]),['Kitchen: Clean the oven'],'Previously dismissed task quantities were revived');
}

// Object evidence without linked replacement work cannot erase the checklist.
{
  const old={name:'Kitchen',objects:[{inventoryKey:'tap',label:'Tap',quantity:1},{inventoryKey:'sink',label:'Sink',quantity:1}],
    taskRecords:[{text:'Descale the tap',origin:'vision',inventoryKeys:['tap']},{text:'Clean tap and sink',origin:'vision',inventoryKeys:['tap','sink']}]};
  const objects=old.objects.map(item=>({...item}));
  const empty=mergeReviewedRoomRescan(old,{objects,tasks:[]});
  assert.deepEqual(scanChecklistLines([empty]),['Kitchen: Descale the tap','Kitchen: Clean tap and sink']);
  const partial=mergeReviewedRoomRescan(old,{objects,taskRecords:[{text:'Polish the tap',origin:'vision',inventoryKeys:['tap']}]});
  assert(scanChecklistLines([partial]).includes('Kitchen: Clean tap and sink'),'Partial replacement dropped grouped work');
  assert(!scanChecklistLines([partial]).includes('Kitchen: Descale the tap'));
  assert(scanChecklistLines([partial]).includes('Kitchen: Polish the tap'));
}

// Renaming and quantities also apply to names ending in punctuation and names
// outside ASCII, without replacing a similar word inside another item name.
for(const label of ['TV (large)','洗衣机','Fridge + freezer']) {
  const rooms=[{name:'Room',objects:[{inventoryKey:'custom',label,quantity:1}],taskRecords:[{text:'Wipe the '+label,origin:'vision',inventoryKeys:['custom']},
    {text:'Leave the '+label+' alone',origin:'customer',inventoryKeys:[]}]}];
  let result=applyCorrection(rooms,{roomName:'Room',inventoryKey:'custom',field:'quantity',value:3}).rooms;
  assert.equal(result[0].taskRecords[0].text,'Wipe the 3 × '+label.toLowerCase());
  result=applyCorrection(result,{roomName:'Room',inventoryKey:'custom',field:'label',value:'Monitor'}).rooms;
  assert.equal(result[0].taskRecords[0].text,'Wipe the 3 × monitor');
  assert.equal(result[0].taskRecords[1].text,'Leave the '+label+' alone');
}
{
  const rooms=[{name:'Room',objects:[{inventoryKey:'chair',label:'Chair',quantity:1}],taskRecords:[{text:'Clean the wheelchair and chair',origin:'vision',inventoryKeys:['chair']}]}];
  assert.equal(applyCorrection(rooms,{roomName:'Room',inventoryKey:'chair',field:'label',value:'Stool'}).rooms[0].taskRecords[0].text,'Clean the wheelchair and stool');
}
console.log('Additional review regressions passed: dismissal-safe identities, incomplete rescan tasks, punctuation and Unicode item corrections.');

// Checklist prefixes already compare room names without case sensitivity; a
// room rename must use that same rule instead of nesting its former name.
for(const useRoomName of [false,true]) {
  const room={...(useRoomName?{roomName:'Kitchen'}:{name:'Kitchen'}),objects:[],tasks:['kitchen: Wipe handles'],taskRecords:[{text:'kitchen: Wipe handles',origin:'customer',inventoryKeys:[]}]};
  const renamed=editScanRooms([room],{action:'rename-room',roomName:'Kitchen',name:'Utility'});
  assert.deepEqual(scanChecklistLines(renamed),['Utility: Wipe handles']);
  assert.equal(renamed[0].taskRecords[0].origin,'customer');
}
