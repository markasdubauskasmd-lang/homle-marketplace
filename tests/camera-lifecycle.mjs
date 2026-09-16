import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createCameraSession } from "../public/camera-session.js";
import { createManualCameraZoom } from "../public/manual-camera-zoom.js";

const source = fs.readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}
const tick = () => new Promise(setImmediate);

// Exercise the actual overlay orchestration, not just the session helper. A
// foreground/Reset request must survive cancellation of a pending first frame.
for (const stage of ["permission", "first-frame"]) for (const action of ["background", "reset", "close"]) {
  let acquisitions = 0, resumeTimer, blocked = 0, latePermission;
  const makeStream = () => {
    let stops = 0;
    const track = { stop() { stops++; }, addEventListener() {} };
    return { getTracks: () => [track], getVideoTracks: () => [track], get stops() { return stops; } };
  };
  const first = makeStream(), replacement = makeStream();
  const video = Object.assign(new EventTarget(), {
    videoWidth: 0, videoHeight: 0, readyState: 0,
    play: async () => {}, pause() {}
  });
  const state = { closed: false, stream: null, cameraStarting: false, frozen: false,
    timers: { capabilityProbes: [] }, zoomNeedsRestart: true };
  const document = { hidden: false };
  const context = vm.createContext({ createCameraSession, state, document, isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: () => {
      acquisitions++;
      if (acquisitions === 1 && stage === "permission") return new Promise(resolve => { latePermission = resolve; });
      if (acquisitions === 1) return first;
      video.videoWidth = 1280; video.videoHeight = 720; video.readyState = 2;
      return replacement;
    } } },
    el: { camera: video, blocked: {}, deck: { removeAttribute() {}, setAttribute() {} }, shutter: {}, blockedReason: {} },
    setTimeout, clearTimeout,
    window: { clearTimeout() {}, setTimeout: callback => { resumeTimer = callback; return 1; } },
    refreshCameraCapabilities() {}, scheduleCapabilityProbes() {}, renderCameraAssist() {}, layoutLive() {},
    startDetection() {}, stopDetection() {}, stopSpeaking() {}, resumeDeferredRoomReads() {},
    scanEvents: { record() { blocked++; } }
  });
  vm.runInContext(
    section("export function waitForCameraFrame(", "// JPEG compression").replace("export function", "function")
    + section("const cameraSession =", "    /* ── Camera controls")
    + section("async function changeCameraZoom(", "    async function applyTrackConstraint(")
    + section("function scheduleCameraResume()", "    /* ── Capture")
    + section("function pauseForBackground()", "    function onVisibility()"), context);
  const initial = context.startCamera();
  await tick();
  assert.equal(state.cameraStarting, true);
  if (action === "background") {
    document.hidden = true; context.pauseForBackground();
    assert.equal(state.resumeCameraOnVisible, true, "Pending acquisition must also resume after backgrounding");
    document.hidden = false; context.resumeAfterBackground();
    resumeTimer(); // Return before the cancelled attempt's promise unwinds.
  } else if (action === "reset") {
    await context.changeCameraZoom(true);
  } else {
    state.closed = true; context.stopCamera();
  }
  await initial; await tick();
  assert.equal(blocked, 0, "Intentional cancellation must not display a camera failure");
  assert.equal(state.cameraStarting, false);
  assert.equal(acquisitions, action === "close" ? 1 : 2);
  assert.equal(state.stream, action === "close" ? null : replacement);
  if (latePermission) {
    latePermission(first); await tick();
    assert.ok(first.stops > 0, "Late permission result must release its stream");
    assert.equal(replacement.stops, 0, "An old completion must not release the replacement camera");
  }
  context.stopCamera();
}

// A real rejected/ignored zoom reset must reach the overlay's reopen path.
// Setting zoomNeedsRestart by hand alone would miss regressions at this boundary.
for (const behavior of ["rejected", "ignored", "unreported"]) {
  let attempts = 0, reopenings = 0, stops = 0;
  const broken = {
    readyState: "live", getCapabilities: () => ({ zoom: { min: 1, max: 3, step: .1 } }),
    getSettings: () => behavior === "unreported" ? {} : { zoom: 2 },
    applyConstraints: async () => { attempts++; if (behavior === "rejected") throw Error("unsupported"); }
  };
  const state = { closed: false, cameraTrack: broken, zoom: 2, zoomNeedsRestart: false };
  const context = vm.createContext({ state, createManualCameraZoom,
    renderCameraAssist() {}, toast() {}, stopDetection() {},
    stopCamera() { stops++; state.cameraTrack = null; },
    async startCamera() { reopenings++; state.cameraTrack = { readyState: "live" }; }
  });
  vm.runInContext(section("const applyCameraZoom =", "const pendingTrackConstraints ="), context);
  assert.equal(await context.changeCameraZoom(true), false);
  assert.equal(state.zoomNeedsRestart, true);
  await context.changeCameraZoom(true);
  assert.equal(attempts, 1, "Reset must not repeat the known-broken hardware command");
  assert.equal(stops, 1);
  assert.equal(reopenings, 1, "Reset must actually reopen after a failed constraint");
}

console.log("Camera lifecycle: foreground/Reset waits, failed-zoom reopening, silent cancellation and late-stream ownership passed.");

import "./camera-capture-ownership.mjs";
import "./camera-fallback-recovery.mjs";
