import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const tick = () => new Promise(setImmediate);
const failures = [];
async function check(name, action) {
  try { await action(); } catch (error) { failures.push(`${name}: ${error.message}`); }
}

for (const route of ["shutter", "tap"]) for (const outcome of ["room-changed", "tracks-moved", "camera-reset"]) {
  await check(`${route}/${outcome}`, async () => {
    let resolveFrame;
    const pending = new Promise(resolve => { resolveFrame = resolve; });
    const original = { id: 1, label: "Oven", x: 10, y: 20, width: 25, height: 30, score: .9 };
    const state = { screen: "live", roomSession: 1, cameraTrack: {}, tracks: [original], lastRedaction: null };
    const frozen = [];
    const context = vm.createContext({ state,
      el: { shutter: {}, blocked: { hidden: true } },
      currentFrame: () => pending, flashViewfinder() {}, toast() {},
      scanEvents: { record() {} }, unusableRedactionRatio: .7,
      drawableTracks: tracks => tracks, usableLiveBoxes: boxes => boxes,
      tapPoint: () => ({ x: 15, y: 25 }), boxAtPoint: boxes => boxes[0],
      freezeFrame: (frame, options) => frozen.push({ frame, options }),
      confirmSelection() {}
    });
    vm.runInContext(section("async function capture(", "async function confirmSelection()")
      + section("async function onViewfinderTap(event)", "function toggleDetectedItem("), context);
    const capture = route === "shutter" ? context.capture() : context.onViewfinderTap({});
    if (outcome === "room-changed") state.roomSession++;
    else if (outcome === "camera-reset") state.cameraTrack = {};
    else { original.x = 80; state.tracks = [{ ...original, id: 2, label: "Fridge" }]; }
    resolveFrame("kitchen-frame");
    await capture;
    if (outcome !== "tracks-moved") assert.equal(frozen.length, 0, "stale frame installed after ownership changed");
    else {
      assert.equal(frozen.length, 1);
      assert.equal(frozen[0].options?.candidates?.[0]?.label, "Oven", "captured candidates were not retained");
      assert.equal(frozen[0].options?.candidates?.[0]?.x, 10, "candidate coordinates mutated while encoding");
    }
  });
}

for (const stage of ["extract", "sheet"]) {
  await check(`video/${stage}/room-changed`, async () => {
    let resolveWork, installed = 0, sheetCalls = 0;
    const wait = new Promise(resolve => { resolveWork = resolve; });
    const state = { roomSession: 1 };
    const context = vm.createContext({ state, maximumRoomVideoFrames: 3,
      el: { shutter: {}, blocked: { hidden: true }, hint: { textContent: "Kitchen" }, videoFallbacks: [] },
      extractRoomVideoFrames: () => stage === "extract" ? wait : Promise.resolve([]),
      videoContactSheet: () => { sheetCalls++; return stage === "sheet" ? wait : Promise.resolve("sheet"); },
      captureSelectedPhoto: () => { installed++; }, toast() {}
    });
    vm.runInContext(section("async function captureSelectedVideo(file)", "async function recoverCsrf("), context);
    const capture = context.captureSelectedVideo({});
    await tick();
    state.roomSession++;
    context.el.hint.textContent = "Bathroom";
    resolveWork([]);
    await capture;
    assert.equal(installed, 0, "old room video installed in the new room");
    assert.equal(context.el.hint.textContent, "Bathroom", "old video restored previous room guidance");
    if (stage === "extract") assert.equal(sheetCalls, 0, "abandoned video unnecessarily decoded again");
  });
}

await check("rapid taps and late finally", async () => {
  const pending = [], installed = [], messages = [];
  const state = { screen: "live", roomSession: 1, cameraTrack: {}, tracks: [] };
  const context = vm.createContext({ state,
    el: { shutter: {}, blocked: { hidden: true } },
    currentFrame: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    flashViewfinder() {}, toast: message => messages.push(message),
    scanEvents: { record() {} }, unusableRedactionRatio: .7,
    drawableTracks: tracks => tracks, usableLiveBoxes: boxes => boxes,
    freezeFrame: frame => installed.push(frame), confirmSelection() {}
  });
  vm.runInContext(section("async function capture(", "async function confirmSelection()"), context);
  const first = context.capture();
  await context.capture();
  assert.equal(pending.length, 1, "a rapid second capture started another encode");
  state.roomSession++;
  const second = context.capture();
  const newOwner = state.liveCapturePending;
  pending[0].reject(new Error("old encode failed"));
  await first;
  assert.equal(state.liveCapturePending, newOwner, "old cleanup cleared the replacement capture");
  assert.equal(context.el.shutter.disabled, true, "old cleanup unlocked the replacement capture");
  assert.equal(messages.length, 0, "abandoned capture showed an error in a different room");
  pending[1].resolve("bathroom-frame");
  await second;
  assert.deepEqual(installed, ["bathroom-frame"]);
});

await check("tap obeys the same private-content rejection", async () => {
  let rejected = 0, frozen = 0;
  const state = { screen: "live", roomSession: 1, cameraTrack: {}, tracks: [], lastRedaction: { ratio: .95 } };
  const context = vm.createContext({ state,
    el: { shutter: {}, blocked: { hidden: true } },
    currentFrame: () => Promise.reject(new Error("JPEG error after rejected frame")),
    flashViewfinder() {}, toast() {}, scanEvents: { record() { rejected++; } }, unusableRedactionRatio: .7,
    drawableTracks: tracks => tracks, usableLiveBoxes: boxes => boxes,
    tapPoint: () => ({ x: 15, y: 25 }), boxAtPoint: () => null,
    freezeFrame() { frozen++; }, confirmSelection() {}
  });
  vm.runInContext(section("async function capture(", "async function confirmSelection()")
    + section("async function onViewfinderTap(event)", "function toggleDetectedItem("), context);
  await context.onViewfinderTap({});
  await tick();
  assert.equal(frozen, 0);
  assert.equal(rejected, 1);
});

assert.deepEqual(failures, []);
console.log("Capture ownership: shutter/tap room and camera changes, immutable geometry, and abandoned video stages passed.");
