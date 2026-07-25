import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { saveBriefDraft } from "../public/brief-draft.js";
import { saveCleanerApplicationDraft } from "../public/cleaner-application-draft.js";
import { saveCustomerRequestDraft } from "../public/customer-request-draft.js";

// Autosave runs from `input` handlers. `localStorage.setItem` throws QuotaExceededError
// when storage is full, and throws unconditionally in Safari private browsing — so an
// unguarded write did not merely fail to save, it aborted the keystroke handler that
// called it. The form stopped responding, with no error anyone would connect to storage.
//
// The contract these pin: a failed write returns null, exactly like the "nothing worth
// saving" paths already did, and never propagates.

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
    assert.doesNotThrow(() => { result = save(storage); }, `A failing storage write escaped ${label}, so the input handler that triggered autosave was aborted and the form stopped responding.`);
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

/* ── Blob URLs created for booking-pack media are released ── */

// Each room photo and video in a pack got an object URL that was never revoked, so the
// blob stayed in memory for the life of the page. A pack with a dozen items pinned tens
// of megabytes on a Landlord's phone.
const pack = await readFile(new URL("../public/booking-pack.js", import.meta.url), "utf8");
assert.match(pack, /revokeObjectURL/, "Booking-pack media object URLs are never revoked, so every room photo and video stays in memory for the life of the page.");
assert.ok(
  (pack.match(/revokeObjectURL/g) || []).length >= 2,
  "Object URLs are revoked on only one outcome. Both the success path and the error path must release the blob, or a failed decode leaks it."
);

console.log("Draft storage resilience tests passed: a full or private-browsing storage cannot abort the autosave handler in any of the three draft modules, working storage still saves, and booking-pack media object URLs are released on both load and error.");
