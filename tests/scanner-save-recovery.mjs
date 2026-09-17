import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/landlord-journey.js", import.meta.url), "utf8");
const handlers = source.slice(source.indexOf("async function replayScanCorrections("), source.indexOf("async function uploadRoomPhotos("));
function harness({ rooms = [{ name: "Kitchen", objects: [{ inventoryKey: "oven", label: "Oven", quantity: 1 }] }], failures = [], correction = false } = {}) {
  const calls = [], delays = [];
  const state = { scanRooms: rooms, scanSessionId: "", scanInstructions: [], scanMeasurements: [],
    scanCorrections: correction ? [{ roomName: "Kitchen", inventoryKey: "oven", field: "label", value: "Cooker" }] : [] };
  const context = vm.createContext({ state, console: { warn() {} },
    currentReviewedNotes: () => ({ notes: {} }), inferredRoomType: () => "kitchen", randomId: () => "stable-scan-session",
    setTimeout: (callback, delay) => { delays.push(delay); callback(); },
    requestJson: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const isCorrection = url.includes("/objects/");
      if (isCorrection === correction && failures.length) throw failures.shift();
      return { scan: { rooms: [{ roomName: "Kitchen", objects: [{ inventoryKey: "oven", objectId: "saved-oven" }] }] } };
    }
  });
  vm.runInContext(handlers, context);
  return { context, state, calls, delays };
}
const error = (statusCode, code) => Object.assign(new Error("Fixture save failed"), { statusCode, code });

// An incomplete successful response is not evidence that corrections saved.
for (const scan of [undefined, {}, {rooms: []}, {rooms: [{roomName:"Kitchen", objects:[]}]},
  {rooms:[{roomName:"Kitchen",objects:[{inventoryKey:"oven"}]}]},
  {rooms:[{roomName:"Kitchen",objects:[{inventoryKey:"oven",objectId:"one"},{inventoryKey:"oven",objectId:"two"}]}]}]) {
  const h = harness({correction:true});
  await assert.rejects(h.context.replayScanCorrections("csrf","request",scan), /could not be verified/);
  assert.deepEqual(h.calls, [], "An incomplete mapping applied a partial correction");
}
{
  const h = harness({correction:true});
  h.state.scanCorrections.push({roomName:"Kitchen",inventoryKey:"missing",field:"quantity",value:2});
  const scan={rooms:[{roomName:"Kitchen",objects:[{inventoryKey:"oven",objectId:"saved-oven"}]}]};
  await assert.rejects(h.context.replayScanCorrections("csrf","request",scan), /could not be verified/);
  assert.deepEqual(h.calls, [], "A later missing item allowed earlier partial corrections");
}
{
  const h = harness({correction:true});
  let attempts=0;
  h.context.requestJson = async () => { attempts++; return {scan:{rooms:[]}}; };
  assert.equal(await h.context.saveStructuredScanWithRetry("csrf","request"), false, "Unverified correction looked saved");
  assert.equal(attempts,3);
  assert.equal(h.state.scanCorrections.length,1);
}

// A manual booking has no scan to retry, and should not incur 2.1 seconds of waiting.
// The database deletes removed objects. A lost deletion response must still
// recover from the next idempotent room read, including earlier edits to it.
{
  const h = harness({correction:true});
  h.state.scanCorrections.push({roomName:"Kitchen",inventoryKey:"oven",field:"removed"});
  let deleted=false, saves=0, corrections=0;
  h.context.requestJson=async url => {
    if (url.includes("/objects/")) {
      corrections++;
      if (corrections===2) { deleted=true; throw error(undefined,"request-timeout"); }
      return {};
    }
    saves++;
    return {scan:{rooms:[{roomName:"Kitchen",objects:deleted?[]:[{inventoryKey:"oven",objectId:"saved-oven"}]}]}};
  };
  assert.equal(await h.context.saveStructuredScanWithRetry("csrf","request"),true,"A committed removal could not recover after its response was lost");
  assert.equal(saves,2);
  assert.equal(corrections,2,"An absent removed object was targeted again");
  await assert.rejects(h.context.replayScanCorrections("csrf","request",{rooms:[]}),/could not be verified/,"A missing room was treated as a verified deletion");
}

{
  const h = harness({ rooms: [] });
  assert.equal(await h.context.saveStructuredScanWithRetry("csrf", "request"), false);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.delays, [], "A manual booking waited for nonexistent scan saves");
}
for (const correction of [false, true]) for (const status of [400, 401, 403, 404, 409, 422]) {
  const h = harness({ correction, failures: [error(status, status === 401 ? "authentication-required" : "scan-invalid")] });
  const originalRooms = h.state.scanRooms;
  await assert.rejects(h.context.saveStructuredScanWithRetry("csrf", "request"), e => e.statusCode === status);
  assert.deepEqual(h.delays, [], `${status}: a permanent refusal was retried`);
  assert.equal(h.calls.length, correction ? 2 : 1);
  assert.equal(h.state.scanRooms, originalRooms, "A failed save cleared reviewed items");
}
for (const failure of [error(408), error(429), error(503), error(undefined, "request-timeout"), new TypeError("Network lost")]) {
  const h = harness({ failures: [failure] });
  assert.equal(await h.context.saveStructuredScanWithRetry("csrf", "request"), true);
  assert.deepEqual(h.delays, [700]);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].body.sessionId, h.calls[1].body.sessionId, "A retry created a new scan identity");
}
{
  const h = harness({ failures: [error(503), error(503), error(503)] });
  assert.equal(await h.context.saveStructuredScanWithRetry("csrf", "request"), false);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.delays, [700, 1400]);
  assert.equal(h.state.scanRooms[0].objects[0].label, "Oven");
}
// An account expiring at either save boundary must reveal sign-in recovery,
// retain the reviewed scope and stop before submission or invitation.
for (const correction of [false, true]) {
  const h = harness({ correction, failures: [error(401, "authentication-required")] });
  const originalRooms = h.state.scanRooms;
  Object.assign(h.state, { signedIn: true, draft: {}, scanPhotos: [], step: "checkout" });
  const el = Object.fromEntries(["back", "confirm", "checkoutState", "propertySignIn", "tasks"].map(key => [key, {}]));
  let submitted = false;
  Object.assign(h.context, { el, $$: () => [], validatePremiumChecklist: () => true,
    premiumScope: () => [], editableTaskLines: () => [], eligiblePremiumSelections: () => [],
    recoverCsrf: async () => "csrf", createOrRecoverProperty: async () => "property",
    createOrRecoverRequest: async () => ({ requestId: "request" }),
    inviteSelectedCleaner: () => { submitted = true; }, discardDraft: () => { submitted = true; },
    show: step => { h.state.step = step; }
  });
  vm.runInContext(source.slice(source.indexOf("function lockConfirmationControls()"), source.indexOf("async function loadCapabilities()")), h.context);
  await h.context.confirmJourney();
  assert.equal(el.propertySignIn.hidden, false, "Expired scan save omitted sign-in recovery");
  assert.match(el.checkoutState.textContent, /session ended/);
  assert.equal(h.state.step, "checkout");
  assert.equal(h.state.scanRooms, originalRooms);
  assert.equal(h.state.confirming, false);
  assert.equal(el.confirm.disabled, false);
  assert.equal(submitted, false);
  assert(h.calls.every(call => call.url.includes("/room-scan")), "A failed scan reached submission");
}
console.log("Scanner save recovery passed: no empty-scan delay, immediate permanent/auth refusals, stable transient retries and preserved review through checkout.");
