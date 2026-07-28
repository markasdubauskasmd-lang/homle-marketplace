import assert from "node:assert/strict";
import { saveBriefDraft } from "../public/brief-draft.js";
import { saveCleanerApplicationDraft } from "../public/cleaner-application-draft.js";
import { saveCustomerRequestDraft } from "../public/customer-request-draft.js";

// Autosave runs from `input` handlers. `setItem` throws QuotaExceededError when storage
// is full, and throws unconditionally in Safari private browsing.
//
// Honest scope: every current caller already wraps the call in `try {} catch {}`, so this
// was not a live outage — an earlier version of this comment said the form stopped
// responding, which was wrong. What it was: three call sites carrying a failure mode only
// this module knows about, and a function that could return a draft object describing a
// save that never happened.
//
// The contract these pin: a failed write returns null, exactly like the "nothing worth
// saving" paths already did, and never propagates — so a caller that forgets the guard
// still cannot be broken by a full disk.

function hostileStorage(failure) {
  const store = new Map();
  return {
    calls: 0,
    setItem() { this.calls += 1; throw failure; },
    getItem: (key) => store.get(key) ?? null,
    removeItem: (key) => { store.delete(key); }
  };
}

// The two shapes that actually occur in the field.
const quota = Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
const privateBrowsing = new Error("The operation is insecure.");

const savers = [
  { label: "brief draft", save: (storage) => saveBriefDraft(storage, { reference: "REQ-1234ABCD", transcript: "Clean the kitchen", tasks: ["Wipe the worktops"] }) },
  { label: "cleaner application draft", save: (storage) => saveCleanerApplicationDraft(storage, { fields: { fullName: "A Cleaner" }, services: { deepClean: true }, currentStep: 2 }) },
  { label: "customer request draft", save: (storage) => saveCustomerRequestDraft(storage, { fields: { fullName: "A Customer", postcode: "SW1A 1AA" }, currentStep: 2 }) }
];

for (const { label, save } of savers) {
  for (const failure of [quota, privateBrowsing]) {
    const storage = hostileStorage(failure);
    let result;
    assert.doesNotThrow(() => { result = save(storage); }, `A failing storage write escaped ${label}, so any caller without its own try/catch would be broken by a full disk.`);
    assert.equal(result, null, `${label} reported a saved draft after the write failed.`);
    assert.ok(storage.calls > 0, `${label} never attempted the write, so this test is not exercising the guard.`);
  }
}

/* ── A working storage must still save ── */

for (const { label, save } of savers) {
  const store = new Map();
  const storage = { setItem: (key, value) => store.set(key, value), getItem: (key) => store.get(key) ?? null, removeItem: (key) => store.delete(key) };
  const draft = save(storage);
  assert.ok(draft, `${label} stopped saving when storage works.`);
  assert.equal(store.size, 1, `${label} did not write exactly one entry.`);
}

console.log("Draft storage resilience tests passed: a full or private-browsing storage cannot abort autosave, and working storage still saves.");
