import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createManualCameraZoom } from "../public/manual-camera-zoom.js";
import { torchSupported, zoomLabel, zoomRange } from "../public/camera-assist.js";
import { createCameraConstraintCoordinator } from "../public/camera-constraints.js";
const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const tick = () => new Promise(setImmediate);
const failures = [];

// A standards-consistent track replaces its constraints on every successful
// call. Omitted zoom/torch or capture settings are allowed to revert to defaults.
for (const order of ["zoom-first", "torch-first"]) {
  const baseline = { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 24, max: 30 }, facingMode: { ideal: "environment" }, resizeMode: { ideal: "none" },
    advanced: [{ exposureMode: "continuous" }] };
  let constraints = structuredClone(baseline), hardware = { zoom: 1, torch: false };
  const calls = [];
  const track = {
    readyState: "live", getCapabilities: () => ({ zoom: { min: 1, max: 4, step: .1 }, torch: true }),
    getSettings: () => ({ ...hardware }), getConstraints: () => structuredClone(constraints),
    applyConstraints: next => new Promise(resolve => calls.push({ constraints: next, finish() {
      constraints = structuredClone(next);
      hardware = { zoom: 1, torch: false, ...next, ...Object.assign({}, ...next.advanced || []) };
      resolve();
    } }))
  };
  const state = { cameraTrack: track, closed: false, roomSession: 1, zoom: 1, torchOn: false };
  const context = vm.createContext({ state, createManualCameraZoom, createCameraConstraintCoordinator,
    window: { setTimeout, clearTimeout }, renderCameraAssist() {}, toast() {} });
  vm.runInContext(section("const initializedZoomTracks =", "// Chrome on Android")
    + section("async function toggleTorch()", "async function cycleZoom()"), context);
  const first = order === "zoom-first" ? context.changeCameraZoom(false) : context.toggleTorch();
  await tick();
  const second = order === "zoom-first" ? context.toggleTorch() : context.changeCameraZoom(false);
  await tick();
  if (calls.length !== 1) failures.push(`${order}: ${calls.length} hardware requests overlapped`);
  calls[0].finish(); await first; await tick();
  calls[1].finish(); await second;
  if (hardware.zoom !== 1.5 || hardware.torch !== true) failures.push(`${order}: controls reset each other (${hardware.zoom}, ${hardware.torch})`);
  if (state.zoom !== hardware.zoom || state.torchOn !== hardware.torch) failures.push(`${order}: controls disagree with hardware`);
  for (const call of calls) {
    for (const key of ["width", "height", "frameRate", "facingMode", "resizeMode"]) {
      if (JSON.stringify(call.constraints[key]) !== JSON.stringify(baseline[key])) failures.push(`${order}: dropped ${key}`);
    }
    if (!call.constraints.advanced.some(value => value.exposureMode === "continuous")) failures.push(`${order}: dropped other advanced constraint`);
  }
}
if (!torchSupported({ torch: [false, true] })) failures.push("standard controllable torch capability was hidden");
assert.deepEqual(failures, []);

for (const replace of [false, true]) {
  const timers = new Set(), updates = [], calls = [];
  let settleOld, oldSettings = { zoom: 2, torch: true };
  const baseline = { resizeMode: { ideal: "none" }, frameRate: { ideal: 24, max: 30 },
    advanced: [{ zoom: 2, torch: true, exposureMode: "continuous" }] };
  const oldTrack = { readyState: "live", getConstraints: () => structuredClone(baseline),
    getSettings: () => ({ ...oldSettings }), getCapabilities: () => ({ zoom: { min: 1, max: 4, step: .1 } }),
    applyConstraints: value => new Promise(resolve => {
      calls.push({ track: "old", value });
      settleOld = () => { oldSettings = { ...oldSettings, ...value.advanced.at(-1) }; resolve(); };
    }) };
  let active = oldTrack;
  const coordinator = createCameraConstraintCoordinator({ getTrack: () => active,
    setTimer: callback => { timers.add(callback); return callback; }, clearTimer: callback => timers.delete(callback),
    onSettled: settings => updates.push(settings) });
  const zoomErrors = [];
  const zoom = createManualCameraZoom({ getTrack: () => active, cameraConstraints: coordinator,
    onChange() {}, onError: error => zoomErrors.push(error) });
  const first = zoom(true);
  await tick();
  const queued = coordinator.change({ torch: false }).catch(error => error.code);
  assert.equal(calls.length, 1, "Torch overlapped an unresolved Zoom Reset");
  for (const expire of [...timers]) expire();
  assert.equal(await first, false);
  assert.equal(zoomErrors[0].code, "zoom-timeout");
  assert.equal(zoomErrors[0].recoverCamera, true);
  assert.equal(await queued, "camera-constraint-busy", "Timed-out zoom allowed a torch request onto the same track");
  assert.equal(calls.length, 1);
  assert.equal(coordinator.isPending(oldTrack), true);
  assert.equal(updates.length, 0, "Timeout falsely reported applied hardware state");
  if (replace) {
    let replacementSettings = { zoom: 2, torch: false };
    active = { readyState: "live", getCapabilities: oldTrack.getCapabilities,
      getConstraints: () => ({ ...baseline, advanced: [{ exposureMode: "continuous" }] }),
      getSettings: () => ({ ...replacementSettings }),
      applyConstraints: async value => {
        calls.push({ track: "replacement", value });
        replacementSettings = { ...replacementSettings, ...value.advanced.at(-1) };
      } };
    assert.equal(await zoom(true), true, "Replacement track inherited the old hardware lock");
    assert.equal(replacementSettings.zoom, 1);
    assert.equal(replacementSettings.torch, false);
    assert.equal(updates.length, 1);
    settleOld(); await tick();
    assert.equal(updates.length, 1, "Old hardware completion changed replacement camera controls");
  } else {
    settleOld(); await tick();
    assert.equal(updates.length, 1, "Verified late hardware state was never reconciled");
    assert.equal(updates[0].zoom, 1);
    oldTrack.applyConstraints = async value => {
      calls.push({ track: "recovered", value }); oldSettings = { ...oldSettings, ...value.advanced.at(-1) };
    };
    const result = await coordinator.change({ torch: false });
    assert.equal(result.settings.zoom, 1, "Torch forgot the late successful Zoom Reset");
    assert.equal(result.settings.torch, false);
    assert.equal(calls.at(-1).value.advanced.filter(value => "zoom" in value).length, 1, "Old advanced zoom constraints survived alongside the new value");
    assert.equal(calls.at(-1).value.resizeMode.ideal, "none");
  }
  assert.equal(coordinator.isPending(oldTrack), false);
  assert.equal(timers.size, 0);
}

// A queued request belongs to the originating track even when replacement
// happens before the first microtask, and rejection must leave the queue usable.
{
  let calls = 0, active;
  const track = { readyState: "live", getSettings: () => ({ zoom: 1, torch: false }),
    applyConstraints: async () => { calls++; throw Error("device rejected"); } };
  active = track;
  const coordinator = createCameraConstraintCoordinator({ getTrack: () => active });
  const abandoned = coordinator.change({ torch: true });
  active = null;
  assert.equal(await abandoned, null);
  assert.equal(calls, 0);
  active = track;
  await assert.rejects(coordinator.change({ torch: true }), /device rejected/);
  track.applyConstraints = async () => { calls++; };
  await coordinator.change({ torch: false });
  assert.equal(calls, 2);
}
// A torch-only camera must expose Reset after a failed hardware operation.
// Its late completion cannot clear the recovery state or affect a newer track.
{
  const timers = new Set();
  let finish, reopened = 0, torch = true;
  const track = { readyState: "live", getSettings: () => ({ torch }),
    applyConstraints: () => new Promise(resolve => { finish = () => { torch = false; resolve(); }; }) };
  const state = { cameraTrack: track, cameraCapabilities: { torch: [false, true] }, stream: {},
    roomSession: 1, torchOn: true, zoomNeedsRestart: false };
  const element = () => ({ hidden: false, attributes: {}, classList: { toggle() {} },
    setAttribute(key, value) { this.attributes[key] = value; } });
  const el = { torch: element(), zoomReset: element(), zoomWide: element() };
  const context = vm.createContext({ state, el, createManualCameraZoom, createCameraConstraintCoordinator,
    torchSupported, zoomLabel, zoomRange, toast() {}, stopDetection() {},
    window: { setTimeout: callback => { timers.add(callback); return callback; }, clearTimeout: callback => timers.delete(callback) },
    stopCamera() { state.cameraTrack = null; state.stream = null; },
    async startCamera() { reopened++; state.cameraTrack = {}; state.stream = {}; context.renderCameraAssist(); }
  });
  vm.runInContext(section("const initializedZoomTracks =", "// Chrome on Android")
    + section("function renderCameraAssist()", "async function maybeAssistCamera()")
    + section("async function toggleTorch()", "async function cycleZoom()"), context);
  context.renderCameraAssist();
  assert.equal(el.zoomWide.hidden, true);
  const toggle = context.toggleTorch(); await tick();
  for (const expire of [...timers]) expire();
  await toggle;
  assert.equal(state.zoomNeedsRestart, true, "Torch failure did not offer camera recovery");
  assert.equal(el.zoomReset.hidden, true, "A torch-only camera acquired a fake zoom control");
  assert.equal(el.zoomWide.hidden, false, "Torch-only hardware failure left Reset inaccessible");
  finish(); await tick();
  assert.equal(state.torchOn, false);
  assert.equal(state.zoomNeedsRestart, true, "A late hardware callback cleared pending recovery");
  await context.changeCameraZoom(true);
  assert.equal(reopened, 1);
  assert.equal(state.zoomNeedsRestart, false);
  assert.equal(el.zoomWide.hidden, true);
}
console.log("Camera constraint coordination: both control orders, retained framing, shared deadlines, late results, torch-only Reset and replacement recovery passed.");
