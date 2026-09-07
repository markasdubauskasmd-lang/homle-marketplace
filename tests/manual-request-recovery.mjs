import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { createManualRequestRecovery } from "../public/manual-request-recovery.js";

const body = { propertyId: "11111111-1111-4111-8111-111111111111", cleaningType: "regular-domestic", tasks: [{ roomName: "Kitchen", description: "Wipe surfaces" }], specialInstructions: "Private fixture note", submit: false };
const timeout = () => Object.assign(new Error("Response lost"), { code: "request-timeout" });
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) };
let now = 1000000000;
const records = new Map(), ids = [];
let failRead = true;
const requestJson = async (_url, options) => {
  if (options?.method === "POST") {
    const value = JSON.parse(options.body);
    ids.push(value.id);
    if (records.has(value.id)) throw Object.assign(new Error("Already saved"), { statusCode: 409 });
    records.set(value.id, { ...value, requestId: value.id, status: "draft" });
    throw timeout();
  }
  if (failRead) { failRead = false; throw timeout(); }
  return { cleaningRequests: [...records.values()] };
};
const options = { requestJson, getStorage: () => storage, crypto: webcrypto, clock: () => now };
let save = createManualRequestRecovery(options);
await assert.rejects(save("csrf", body), /Response lost/);
const persisted = [...values.values()].join("");
assert(!persisted.includes("Private fixture note") && !persisted.includes("Kitchen") && !persisted.includes("csrf"));
save = createManualRequestRecovery(options); // Reload: no original closure survives.
const recovered = await save("csrf", body);
assert.equal(records.size, 1);
assert.equal(ids[0], ids[1]);
assert.equal(recovered.cleaningRequest.requestId, ids[0]);
assert.equal(values.size, 0, "A verified save must clear its retry record");

// A changed scope must not recover the previous request, even after a timeout.
failRead = true;
await assert.rejects(save("csrf", body));
const oldId = ids.at(-1);
const changed = await save("csrf", { ...body, cleaningType: "deep-clean" });
assert.notEqual(changed.cleaningRequest.requestId, oldId);

// Expired retry metadata cannot extend the published same-tab recovery period.
failRead = true;
await assert.rejects(save("csrf", body));
const expiredId = ids.at(-1);
now += 30 * 60 * 1000;
const expired = await save("csrf", body);
assert.notEqual(expired.cleaningRequest.requestId, expiredId);

// Storage-disabled sessions retain retry identity in memory.
let readBroken = true;
const memoryIds = [];
const memory = createManualRequestRecovery({
  crypto: webcrypto, getStorage() { throw new Error("Storage disabled"); },
  requestJson: async (_url, options) => {
    if (options) { memoryIds.push(JSON.parse(options.body).id); throw timeout(); }
    if (readBroken) { readBroken = false; throw timeout(); }
    return { cleaningRequests: [{ requestId: memoryIds[0], status: "draft" }] };
  }
});
await assert.rejects(memory("csrf", body));
assert.equal((await memory("csrf", body)).cleaningRequest.requestId, memoryIds[0]);
assert.equal(memoryIds[0], memoryIds[1]);

const mismatched = createManualRequestRecovery({ crypto: webcrypto, requestJson: async () => ({ cleaningRequest: { requestId: "wrong" } }) });
await assert.rejects(mismatched("csrf", body), /could not be verified/);

// Execute the real manual save handler, including its pre-await double-click lock.
const source = await readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");
const start = source.indexOf("async function createRequestDraft(");
const handler = source.slice(start, source.indexOf("\nfunction setPending(", start));
const fields = { propertyId: body.propertyId, cleaningType: body.cleaningType, frequency: "one-time", scopeReviewed: "on" };
const button = { textContent: "Continue" };
let releaseCsrf;
const actualRecords = new Map();
let actualReadFails = true;
const actualIds = [];
const actualSave = createManualRequestRecovery({
  crypto: webcrypto, getStorage: () => storage,
  requestJson: async (_url, options) => {
    if (options) {
      const payload = JSON.parse(options.body);
      actualIds.push(payload.id);
      actualRecords.set(payload.id, { ...payload, requestId: payload.id, status: "draft" });
      throw timeout();
    }
    if (actualReadFails) { actualReadFails = false; throw timeout(); }
    return { cleaningRequests: [...actualRecords.values()] };
  }
});
const context = vm.createContext({
  requestFeedback: {}, requestForm: { reportValidity: () => true, elements: { scopeReviewed: {} } }, requestDraftPending: false,
  FormData: class { get(key) { return fields[key] || ""; } },
  optionalRequestScope: () => ({ tasks: body.tasks }),
  requestedWindow: () => ({ requestedStartAt: "2099-09-09T10:00:00Z", requestedEndAt: "2099-09-09T12:00:00Z" }),
  moneyToPence: () => null, requestSave: button, requestContinue: button,
  setRequestDraftControlsLocked() {}, setPending() {}, recoverCsrf: () => new Promise(resolve => { releaseCsrf = resolve; }),
  pricingRequestFromManualTasks: () => ({ rooms: [] }), saveManualRequest: actualSave,
  showFeedback() {}, requests: [], renderRequests() {}, clearLandlordRequestDraft() {}, window: { sessionStorage: storage },
  requestRecoveryStatus: { removeAttribute() {} }, showRequestContinuation() {}
});
vm.runInContext(handler, context);
const first = context.createRequestDraft();
assert.equal(await context.createRequestDraft(), false, "Second tap must be blocked before CSRF returns");
releaseCsrf("csrf");
assert.equal(await first, false);
context.recoverCsrf = async () => "csrf";
assert.equal(await context.createRequestDraft(), true);
assert.equal(actualRecords.size, 1);
assert.equal(actualIds[0], actualIds[1]);
assert.equal(context.requests.length, 1);
assert.equal(context.currentRequestDraft.requestId, actualIds[0]);
console.log("Manual draft recovery passed: lost response, reload/conflict, changed scope, expiry, unavailable storage, mismatched response and actual-handler double tap/retry.");
