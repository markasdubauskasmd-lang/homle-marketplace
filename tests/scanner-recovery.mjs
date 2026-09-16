import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import * as model from "../public/room-scan-model.js";
import {readRoomResponse, withReadingSignal} from "../public/room-reading-stream.js";
const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const section = (start, end) => {
  const first=source.indexOf(start), last=source.indexOf(end, first);
  assert.ok(first>=0 && last>first); return source.slice(first,last);
};
const tick = () => new Promise(setImmediate);

// The entire request, including non-cancellable image preparation, has a
// deadline. A late image decode must not start an upload after abandonment.
for (const stage of ["decode", "crop"]) for (const action of ["deadline", "close"]) {
  let resolveWork, uploaded=0, timer;
  const blocked=new Promise(resolve=>{resolveWork=resolve;});
  const state={readingAllowed:true,visionAvailable:true,roomReadControllers:new Set()};
  const context=vm.createContext({...model,state,AbortController,readRoomResponse,withReadingSignal,
    snapshotCropSource:()=>stage==="decode"?blocked:Promise.resolve({}),cropFor:()=>blocked,
    window:{setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;}},
    recoverCsrf:async()=>"test",fetch:()=>{uploaded++;throw Error("Unexpected upload");}});
  vm.runInContext(section("async function readRoom(image,","function localRoomTasks("),context);
  const read=context.readRoom("photo","Kitchen",[{id:"m1",label:"Oven",x:10,y:10,width:20,height:20}]);
  const failure=assert.rejects(read,error=>error.code==="reading-timeout");
  await tick(); assert.equal(state.roomReadControllers.size,1);
  if(action==="deadline")timer();else {state.closed=true;for(const controller of state.roomReadControllers)controller.abort();}
  await failure; resolveWork({}); await tick();
  assert.equal(uploaded,0);assert.equal(state.roomReadControllers.size,0);assert.equal(timer,null);
}

// Whole-room recovery must stay a whole-room read even when the walk has
// already collected more than twelve objects, some without photo coordinates.
for(const selected of [[],[{id:"m1",label:"Oven",x:1,y:1,width:20,height:20}]]) {
  let request;
  const state={networkDeferredRooms:new Set(["kitchen"]),nextReadingRevision:4,rooms:[{
    name:"Kitchen",image:"photo",readingStatus:"needs-retry",readingSelection:selected,
    detections:Array.from({length:15},(_,i)=>({label:"Item "+i}))}]};
  const context=vm.createContext({...model,state,document:{hidden:false},transcriptKey:name=>name.toLowerCase(),
    readRoomInBackground:input=>{request=input;},renderHub(){}});
  vm.runInContext(section("function resumeDeferredRoomReads()","async function readRoom(image,"),context);
  context.resumeDeferredRoomReads();
  assert.deepEqual(request.chosen,selected);assert.equal(request.readingRevision,4);assert.equal(state.networkDeferredRooms.size,0);
}

// Provisional names arrive before completion, without becoming saved objects or
// priceable findings. An older request cannot replace a newer room's preview.
for(const outcome of ["success","failure","stale"]) {
  let complete,fail,preview;
  const pending=new Promise((resolve,reject)=>{complete=resolve;fail=reject;});
  const state={rooms:[{name:"Kitchen",readingStatus:"reading",readingRevision:1,detections:[],tasks:[]}],
    pendingReads:0,confirmationPreviews:new Map(),dismissed:new Map(),networkDeferredRooms:new Set()};
  const context=vm.createContext({...model,state,navigator:{onLine:true},transcriptKey:name=>name.toLowerCase(),
    inventoryFor:()=>[],seedSavedInventory(){},renderHub(){},toast(){},
    readRoom:(_frame,_room,_chosen,_note,purpose,onPreview)=>{assert.equal(purpose,"confirmation");preview=onPreview;return pending;}});
  vm.runInContext(section("function mergeSavedTasks(","function resumeDeferredRoomReads()"),context);
  context.readRoomInBackground({frame:"photo",roomName:"Kitchen",chosen:[],spokenNote:"",readingRevision:1});
  preview({index:0,label:"Air fryer"});
  assert.equal(state.confirmationPreviews.get("kitchen").items[0].label,"Air fryer");
  assert.equal(state.rooms[0].detections.length,0,"Incomplete names must not enter saved inventory");
  if(outcome==="stale") {
    state.rooms[0]={...state.rooms[0],readingRevision:2};
    state.confirmationPreviews.set("kitchen",{revision:2,items:[{index:0,label:"Microwave"}]});
    preview({index:1,label:"Old result"});
  }
  if(outcome==="failure")fail(Error("network"));
  else complete({detections:[{label:"Air fryer",x:1,y:1,width:10,height:10}],tasks:[],condition:"",readingStatus:"ready"});
  await tick();
  assert.equal(state.pendingReads,0);
  if(outcome==="stale") {assert.equal(state.confirmationPreviews.get("kitchen").items.length,1);assert.equal(state.rooms[0].detections.length,0);}
  else {assert.equal(state.confirmationPreviews.size,0);assert.equal(state.rooms[0].readingStatus,outcome==="success"?"ready":"needs-retry");}
}

// Live, frozen, capture and tap coordinates agree for portrait/landscape feeds
// on desktop and phones. The live feed retains every pixel, including edges.
for(const [frameWidth,frameHeight] of [[390,844],[1280,720],[844,390]]) for(const [videoWidth,videoHeight] of [[1280,720],[720,1280]]) {
  const rect={width:frameWidth,height:frameHeight,left:0,top:0};
  const element=()=>({style:{},getBoundingClientRect(){return {left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0,width:parseFloat(this.style.width)||frameWidth,height:parseFloat(this.style.height)||frameHeight};}});
  const el={camera:{...element(),videoWidth,videoHeight},detections:element(),still:element(),canvas:{width:videoWidth,height:videoHeight},viewfinder:{getBoundingClientRect:()=>rect}};
  const state={frozen:false};
  const context=vm.createContext({...model,state,el});
  vm.runInContext(section("function layoutFrozen()","function resetLayout()")+section("function tapPoint(event)","async function onViewfinderTap(")+section("function viewfinderSourceRect(","// Maps the detector"),context);
  context.layoutLive();const live=el.detections.getBoundingClientRect();
  assert.ok(Math.abs(live.width/live.height-videoWidth/videoHeight)<1e-9);
  assert.deepEqual(JSON.parse(JSON.stringify(context.viewfinderSourceRect(videoWidth,videoHeight))),{sx:0,sy:0,sWidth:videoWidth,sHeight:videoHeight});
  assert.ok(Math.abs(context.tapPoint({clientX:live.left+live.width*.1,clientY:live.top+live.height*.2}).x-10)<1e-9);
  if(live.top>1)assert.equal(context.tapPoint({clientX:frameWidth/2,clientY:0}),null);
  if(live.left>1)assert.equal(context.tapPoint({clientX:0,clientY:frameHeight/2}),null);
  state.frozen=true;context.layoutFrozen();assert.deepEqual(el.detections.getBoundingClientRect(),live);
}
console.log("Scanner recovery passed: bounded preparation, faithful retry, early disposable names, stale response guards and full-frame geometry.");

// Redaction boxes come from a downscaled detector, never directly from the
// sensor. Both capture routes erase the correctly scaled regions before JPEG.
for(const width of [640,1280,1920]) {
  let mapped;
  const state={privateRegions:[{class:"person",bbox:[160,45,40,80]}],privateRegionSource:{width:320,height:180}};
  const context=vm.createContext({state,document:{},scanEvents:{record(){}},
    redactionRegions:items=>{mapped=items;return items;},applyRedaction(){},redactionSummary:()=>"redacted",redactedAreaRatio:()=>.1});
  vm.runInContext(section("function redactPrivateContent(",'scanEvents.record("scan.session.started")'),context);
  const height=width*9/16,scale=Math.min(1,1280/width);
  context.redactPrivateContent({width:width*scale,height:height*scale,getContext:()=>({})},{sx:0,sy:0,sWidth:width,sHeight:height},scale,{width,height});
  assert.deepEqual(Array.from(mapped[0].bbox),[160,45,40,80].map(value=>value*width/320*scale));
}
{
  const events=[];
  const context=vm.createContext({width:1280,height:720,sourceRect:{sx:0,sy:0,sWidth:1280,sHeight:720},video:{},
    canvas:{getContext:()=>({drawImage:()=>events.push("draw")})},
    redactPrivateContent:()=>events.push("redact"),encodeCanvasJpeg:async()=>{events.push("encode");return "photo";}});
  const first=source.indexOf("const scale = Math.min(1, 1280 / Math.max(sourceRect.sWidth");
  const last=source.indexOf("image = await encodeCanvasJpeg(canvas, 0.80);",first)+"image = await encodeCanvasJpeg(canvas, 0.80);".length;
  assert.ok(first>0&&last>first);
  await vm.runInContext("(async()=>{let image;"+source.slice(first,last)+"})()",context);
  assert.deepEqual(events,["draw","redact","encode"]);
}
console.log("Scanner privacy mapping passed: inference-to-sensor scale and walking redaction before encoding.");
