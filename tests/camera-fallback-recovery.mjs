import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createCameraConstraintCoordinator } from "../public/camera-constraints.js";
import "./scanner-revisit-recovery.mjs";
const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const section = (start, end) => {
  const first = source.indexOf(start);
  return first < 0 ? "" : source.slice(first, source.indexOf(end, first));
};
const tick = () => new Promise(setImmediate);
const failures = [];
async function check(name, task) { try { await task(); } catch (error) { failures.push(`${name}: ${error.message}`); } }
function timerWindow() {
  const timers = new Set();
  return { timers, setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); } };
}
const helper = section("async function waitForCameraOperation(", "async function applyTrackConstraint(");

for (const behavior of ["reject", "ignore", "hang", "replace"]) {
  await check(`torch-off/${behavior}`, async () => {
    let settle, calls = 0;
    const window = timerWindow(), messages = [];
    const track = {
      applyConstraints() { calls++; return behavior === "reject" ? Promise.reject(Error("unsupported"))
        : behavior === "ignore" ? Promise.resolve() : new Promise(resolve => { settle = resolve; }); },
      getSettings: () => ({ torch: behavior === "ignore" })
    };
    const state = { cameraTrack: track, torchOn: true };
    const context = vm.createContext({ state, window, createCameraConstraintCoordinator,
      renderCameraAssist() {}, toast: message => messages.push(message) });
    vm.runInContext(section("const cameraConstraints =", "const applyCameraZoom =")
      + helper + section("async function applyTrackConstraint(", "// Chrome on Android")
      + section("async function toggleTorch()", "async function cycleZoom()"), context);
    const toggle = context.toggleTorch();
    await tick();
    if (behavior === "hang") {
      assert.ok(window.timers.size, "no deadline bounds hardware constraint");
      for (const expire of [...window.timers]) expire();
      await toggle;
      assert.equal(state.torchOn, true, "timeout claimed torch-off before hardware settled");
      await context.toggleTorch();
      assert.equal(calls, 1, "timed-out hardware constraint was overlapped");
      settle(); await tick();
    } else if (behavior === "replace") {
      state.cameraTrack = {}; state.torchOn = true; settle(); await toggle;
    } else await toggle;
    assert.equal(state.torchOn, behavior !== "hang", "failed/stale or verified late hardware result was displayed incorrectly");
    if (behavior !== "replace") assert.ok(messages.length, "manual failure was silent");
    assert.equal(window.timers.size, 0);
  });
}

for (const stage of ["load", "detect"]) {
  await check(`photo-private-check/${stage}/deadline`, async () => {
    let settle, calls = 0;
    const wait = new Promise(resolve => { settle = resolve; }), window = timerWindow();
    const detector = { detect() { calls++; return wait; } };
    const state = { roomSession: 1, detector: stage === "detect" ? detector : null };
    const context = vm.createContext({ state, window, detectorBusy: false, detectorStalled: false,
      pendingTrackConstraints: new WeakMap(), loadDetectorOnce: () => wait,
      detectionMinimumScore: .5, shouldRedact: () => true, renderDetectorState() {} });
    vm.runInContext(helper + section("async function refreshPrivateRegionsForSource(", "/* ── Choosing what matters"), context);
    const reading = context.refreshPrivateRegionsForSource({}, 100, 100);
    const observed = reading.then(() => "resolved", () => "rejected");
    await tick();
    assert.ok(window.timers.size, "no deadline bounds photo preparation");
    for (const expire of [...window.timers]) expire();
    assert.equal(await observed, "rejected");
    if (stage === "detect") assert.equal(context.detectorBusy, true, "hung detector was unlocked for concurrent inference");
    if (stage === "detect") assert.equal(context.detectorStalled, true, "A later camera session cannot identify the pending timed-out inference");
    state.roomSession++;
    state.privateRegions = [{ class: "new-room" }];
    settle(stage === "load" ? detector : [{ class: "person", bbox: [1, 1, 2, 2] }]);
    await tick();
    assert.equal(state.privateRegions[0].class, "new-room", "late private check overwrote newer room data");
    if (stage === "detect") assert.equal(context.detectorBusy, false);
    if (stage === "detect") assert.equal(context.detectorStalled, false);
    assert.equal(window.timers.size, 0);
  });
}

for (const installed of [false, true]) {
  await check(`video/installed=${installed}`, async () => {
    const messages = [], state = { roomSession: 1 };
    const context = vm.createContext({ state, maximumRoomVideoFrames: 3,
      el: { shutter: {}, blocked: { hidden: true }, hint: {}, videoFallbacks: [] },
      extractRoomVideoFrames: async () => [], videoContactSheet: async () => ({}),
      captureSelectedPhoto: async () => installed, toast: message => messages.push(message) });
    vm.runInContext(section("async function captureSelectedVideo(", "async function recoverCsrf("), context);
    await context.captureSelectedVideo({});
    assert.equal(messages.some(message => message.includes("views are ready")), installed);
  });
}

for (const outcome of ["success", "timeout", "rejected"]) {
  await check(`photo-install/${outcome}/controls`, async () => {
    const window = timerWindow();
    let frozen = 0, blocked = 0, release;
    const state = { roomSession: 1, detector: { detect: () => outcome === "success" ? Promise.resolve([])
      : outcome === "rejected" ? Promise.reject(Error("inference failed")) : new Promise(resolve => { release = resolve; }) } };
    const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
    const context = vm.createContext({ state, window, detectorBusy: false,
      el: { fallbacks: [button], blocked: {}, deck: { removeAttribute() {} } },
      decodePhoto: async () => ({ naturalWidth: 100, naturalHeight: 100 }),
      drawVisibleRegion: async () => "photo", detectionMinimumScore: .5, shouldRedact: () => true,
      freezeFrame() { frozen++; }, blockCamera() { blocked++; }, toast() {},
      renderDetectorState() {}, unusableRedactionRatio: .7
    });
    vm.runInContext(helper + section("async function refreshPrivateRegionsForSource(", "/* ── Choosing what matters")
      + section("async function captureSelectedPhoto(", "function videoContactSheet("), context);
    const installing = context.captureSelectedPhoto({});
    await tick();
    if (outcome === "timeout") {
      assert.equal(state.photoProcessing, true);
      for (const expire of [...window.timers]) expire();
    }
    assert.equal(await installing, outcome === "success");
    assert.equal(state.photoProcessing, false, "photo remained busy after completion/failure");
    assert.equal(button.disabled, false, "photo retry remained disabled");
    assert.equal(frozen, outcome === "success" ? 1 : 0);
    assert.equal(blocked, outcome === "success" ? 0 : 1);
    if (release) { release([]); await tick(); assert.equal(frozen, 0); }
  });
}

assert.deepEqual(failures, []);
console.log("Camera fallback recovery: bounded truthful torch, late hardware ownership, photo deadlines and honest video completion passed.");
