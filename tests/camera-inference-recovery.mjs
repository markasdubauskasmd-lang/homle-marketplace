import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const tick = () => new Promise(setImmediate);
function harness() {
  const timers = new Map();
  const context = vm.createContext({ detectorBusy: false, detectorStalled: false, detectionMinimumScore: .62,
    Date, console: { warn() {} }, nextDetectionDelay: () => 200,
    window: { setTimeout(callback, milliseconds) { timers.set(callback, milliseconds); return callback; },
      clearTimeout(callback) { timers.delete(callback); } }
  });
  vm.runInContext(`function createHarness(detector) {
    const state = {screen:'live',stream:{},closed:false,frozen:false,detectorState:'ready',liveDetectionAvailable:true,
      detectionGeneration:0,rafId:0,lastDetectionAt:0,detectionInterval:200,detector,
      diagnostics:{framesInferred:0,detectorErrors:0},tracks:[],nextTrackId:1,framingMessage:'',
      reads:0,quality:0,painted:0,cleared:0,unavailable:0};
    const el={camera:{videoWidth:1280,videoHeight:720}};
    let frame;
    const scheduleDetectionFrame=callback=>{frame=callback;state.rafId=1;};
    const warmDetector=()=>{},inferenceFrame=video=>{if(detector.prepareThrows)throw Error('cannot prepare frame');return video;};
    const sampleFrameQuality=()=>{state.quality++;return true;},maybeReadKeyframe=()=>{state.reads++;};
    const viewfinderRect=()=>({width:1280,height:720});
    const trackDetections=()=>({tracks:[],nextId:1}),paintBoxes=()=>{state.painted++;},liveBoxes=()=>[];
    const inventoryFor=()=>[],renderInventory=()=>{},objectFramingAdvice=()=>null,renderDetectorState=()=>{};
    const clearBoxes=()=>{state.cleared++;},scanEvents={record(){state.unavailable++;}};
    const implausibleForRoom=()=>false,cocoLabel=value=>value,fitBoxToFrame=()=>null,shouldRedact=()=>false;
    ${section("async function waitForCameraOperation(", "async function applyTrackConstraint(")}
    ${section("function startDetection()", "function scheduleDetectionFrame(")}
    ${section("async function runDetection(", "function pauseForBackground()")}
    return {state,start:startDetection,step(){state.lastDetectionAt=0;frame();},
      reset(){state.detectionGeneration++;state.rafId=0;state.stream={};startDetection();}};
  }`, context);
  return { context, timers, create: detector => context.createHarness(detector),
    expire() { for (const callback of [...timers.keys()]) callback(); } };
}

for (const transition of ["current", "reset", "frozen", "closed-and-reopened"]) {
  const h = harness();
  let settle, calls = 0;
  const detector = { detect() { calls++; return new Promise(resolve => { settle = resolve; }); } };
  const first = h.create(detector);
  first.start(); first.step(); await tick();
  assert.equal(calls, 1);
  assert(h.timers.size > 0, "Live inference has no deadline; the first item list can wait forever");
  let active = first;
  if (transition === "reset") first.reset();
  if (transition === "frozen") first.state.frozen = true;
  if (transition === "closed-and-reopened") {
    first.state.closed = true;
    active = h.create(detector); active.start();
  }
  h.expire(); await tick();
  assert.equal(h.context.detectorBusy, true, "Deadline unlocked non-cancellable inference for overlap");
  if (transition === "frozen") {
    assert.equal(first.state.cleared, 0, "Timeout cleared the user's frozen selection");
    first.state.frozen = false; first.reset();
  }
  active.step(); await tick();
  assert.equal(active.state.detectorState, "unavailable");
  assert.equal(active.state.liveDetectionAvailable, false);
  assert.equal(active.state.reads, 1, "The fallback did not resume automatic room reads");
  assert.equal(calls, 1, "Recovery overlapped the pending model inference");
  assert.equal(first.state.painted, 0);
  settle([{ class: "oven", bbox: [0, 0, 10, 10], score: .99 }]); await tick();
  assert.equal(h.context.detectorBusy, false);
  assert.equal(first.state.painted, 0, "Late inference painted stale boxes after timeout");
  assert.equal(active.state.detectorState, "unavailable", "Late completion silently changed recovery mode");
  assert.equal(h.timers.size, 0);
  // A later opening may reuse the settled singleton. Timeout recovery must not
  // permanently disable detection or leak the prior hardware lock.
  detector.detect = async () => { calls++; return []; };
  const later = h.create(detector); later.start(); later.step(); await tick();
  assert.equal(later.state.painted, 1);
  assert.equal(later.state.reads, 1);
  assert.equal(h.context.detectorBusy, false);
}

for (const behavior of ["success", "reject", "prepare-throws"]) {
  const h = harness();
  const detector = { detect() { if (behavior === "reject") return Promise.reject(Error("model failed")); return []; } };
  const active = h.create(detector);
  // A synchronous frame preparation error must release ownership as well.
  if (behavior === "prepare-throws") detector.prepareThrows = true;
  active.start(); active.step(); await tick();
  assert.equal(h.context.detectorBusy, false);
  assert.equal(h.timers.size, 0);
  assert.equal(active.state.painted, behavior === "success" ? 1 : 0);
  if (behavior !== "success") { active.step(); assert.equal(active.state.reads, 1); }
}
console.log("Live inference recovery passed: bounded waits, continuing room reads, shared lock, reset/reopen ownership and discarded late boxes.");
