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
