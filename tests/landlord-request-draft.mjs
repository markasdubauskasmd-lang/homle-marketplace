import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { clearLandlordRequestDraft, landlordRequestDraftLifetimeMs, readLandlordRequestDraft, saveLandlordRequestDraft } from "../public/landlord-request-draft.js";

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
const now = Date.UTC(2026, 6, 17, 18, 30, 0);
const propertyId = "7daeb084-bf0b-4f7b-b21d-2ad14d96d81b";

const saved = saveLandlordRequestDraft(storage, { ownerId: propertyId, fields: {
  propertyId, requestedDate: "2026-07-20", requestedTime: "10:30", durationMinutes: "180", cleaningType: "rental-turnovers", frequency: "one-time", budget: "125.50",
  specialInstructions: "Please prioritise the oven.", transcript: "Kitchen, wipe the worktops and clean the oven.", tasks: "Kitchen: Wipe the worktops\nKitchen: Clean the oven",
  scopeReviewed: "on", csrfToken: "must-not-save", photos: "must-not-save"
} }, now);
assert.equal(saved.fields.propertyId, propertyId);
assert.equal(saved.fields.transcript, "Kitchen, wipe the worktops and clean the oven.");
const storedText = [...values.values()][0];
assert(!storedText.includes("scopeReviewed") && !storedText.includes("csrfToken") && !storedText.includes("photos") && !storedText.includes("must-not-save"), "Approval, security tokens or photos entered the same-tab recovery draft.");
assert.deepEqual(readLandlordRequestDraft(storage, now + 10_000, propertyId)?.fields, saved.fields);
assert.equal(readLandlordRequestDraft(storage, now + landlordRequestDraftLifetimeMs, propertyId), null, "Expired Landlord request drafts must be removed.");
assert.equal(values.size, 0);

saveLandlordRequestDraft(storage, { ownerId: propertyId, fields: { propertyId, specialInstructions: "Door code is 4821", transcript: "Key is hidden under the mat", tasks: "Hall: Clean floor. Alarm PIN: 1234" } }, now);
const sensitiveText = [...values.values()][0];
assert(!sensitiveText.includes("4821") && !sensitiveText.includes("under the mat") && !sensitiveText.includes("1234"), "Sensitive property access details survived browser-draft normalization.");
const sensitive = readLandlordRequestDraft(storage, now, propertyId);
assert.equal(sensitive.fields.specialInstructions, "");
assert.equal(sensitive.fields.transcript, "");
assert.equal(sensitive.fields.tasks, "");
clearLandlordRequestDraft(storage);

saveLandlordRequestDraft(storage, { ownerId: propertyId, fields: { durationMinutes: "120", frequency: "one-time" } }, now);
assert.equal(values.size, 0, "Untouched default choices must not create a recovery draft.");
saveLandlordRequestDraft(storage, { ownerId: propertyId, fields: { propertyId: "not-a-property", transcript: "Kitchen, clean the sink." } }, now);
assert.equal(readLandlordRequestDraft(storage, now, propertyId)?.fields.propertyId, "", "An invalid property identifier survived recovery validation.");
clearLandlordRequestDraft(storage);
storage.setItem("homleLandlordRequestDraftV1", "broken-json");
assert.equal(readLandlordRequestDraft(storage, now, propertyId), null);
assert.equal(values.size, 0, "Corrupt Landlord recovery data must be removed.");

const [page, script] = await Promise.all([readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"), readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8")]);
assert(page.includes("data-request-recovery-status") && page.includes("Approval and photos are never restored"), "The Landlord does not receive the recovery privacy boundary.");
assert(script.includes("saveLandlordRequestDraft(window.sessionStorage") && script.includes("readLandlordRequestDraft(window.sessionStorage") && script.includes("clearLandlordRequestDraft(window.sessionStorage)"), "The Landlord request is not recovered only inside the current browser tab.");
assert(script.includes("properties.some((property) => property.propertyId === draft.fields.propertyId)"), "A removed or foreign property could be restored into the request form.");
assert(script.includes("requestForm.elements.scopeReviewed.checked = false") && !script.includes("fields.scopeReviewed"), "Checklist approval is restored without a fresh Landlord review.");



 
// Execute the actual dashboard recovery handler under a different account's
// property list. Rejecting the old property must not restore private text.
{
  const draftValues = new Map();
  const draftStorage = { getItem: key => draftValues.get(key) ?? null, setItem: (key, value) => draftValues.set(key, value), removeItem: key => draftValues.delete(key) };
  saveLandlordRequestDraft(draftStorage, { ownerId: propertyId, fields: { propertyId, cleaningType: "regular-domestic", tasks: "Kitchen: Private prior account task", specialInstructions: "Private prior account note" } });
  const controls = Object.fromEntries(["propertyId", "requestedDate", "requestedTime", "durationMinutes", "cleaningType", "frequency", "budget", "specialInstructions", "transcript", "tasks", "scopeReviewed"].map(name => [name, { value: "", checked: false }]));
  const recoveryContext = vm.createContext({
    requestRecoveryChecked: false, requestDirty: false, requestDraftOwner: "22222222-2222-4222-8222-222222222222",
    window: { sessionStorage: draftStorage }, readLandlordRequestDraft,
    properties: [{ propertyId: "22222222-2222-4222-8222-222222222222" }],
    requestForm: { elements: controls }, propertySelect: { value: "" },
    cleaningTypeSelect: { dataset: {} }, renderTaskPreview() {},
    requestRecoveryStatus: { dataset: {} }
  });
  vm.runInContext(script.slice(script.indexOf("function restoreWorkingRequest()"), script.indexOf("function element(", script.indexOf("function restoreWorkingRequest()"))), recoveryContext);
  recoveryContext.restoreWorkingRequest();
  assert.equal(recoveryContext.propertySelect.value, "");
  assert.equal(controls.tasks.value, "", "Previous account's private tasks were restored into the manual form.");
  assert.equal(controls.specialInstructions.value, "", "Previous account's private notes were restored into the manual form.");
}

{
  const ownerA = propertyId, ownerB = "22222222-2222-4222-8222-222222222222";
  const fields = { propertyId, tasks: "Kitchen: same owner task" };
  saveLandlordRequestDraft(storage, { ownerId: ownerA, fields }, now);
  assert.equal(readLandlordRequestDraft(storage, now, ownerA)?.fields.tasks, fields.tasks);
  saveLandlordRequestDraft(storage, { ownerId: ownerA, fields: { tasks: fields.tasks } }, now);
  assert.equal(readLandlordRequestDraft(storage, now, ownerB), null, "Property-free drafts crossed accounts.");
  assert.equal(values.size, 0);
  saveLandlordRequestDraft(storage, { ownerId: ownerA, fields }, now);
  assert.equal(readLandlordRequestDraft(storage, now), null, "Missing owner hydrated a draft.");
  assert.equal(saveLandlordRequestDraft(storage, { fields }, now), null, "Unverified draft was persisted.");
  storage.setItem("homleLandlordRequestDraftV1", JSON.stringify({ version: 1, fields, savedAt: now, expiresAt: now + landlordRequestDraftLifetimeMs }));
  assert.equal(readLandlordRequestDraft(storage, now, ownerA), null, "Legacy unowned draft survived.");
}
console.log("Manual draft ownership passed: same account, different account, property-free, missing owner, legacy and expiry.");

{
  const scopeControls = { tasks: { value: "Private current task" }, specialInstructions: { value: "Private current note" } };
  const ownerContext = vm.createContext({
    requestDraftOwner: propertyId, requestRecoveryTimer: 1, requestRecoveryChecked: true,
    requestDirty: true, currentRequestDraft: { requestId: "old" },
    generatedChecklist: ["old"], generatedChecklistSource: "old", assistedSummaryTranscript: "old", tasksManuallyEdited: true,
    window: { sessionStorage: storage, clearTimeout() {} }, clearLandlordRequestDraft,
    requestForm: { reset() { for (const field of Object.values(scopeControls)) field.value = ""; } },
    closeRequestPhotoDialog() {}, renderTaskPreview() {}
  });
  vm.runInContext(script.slice(script.indexOf("function bindWorkingRequestOwner("), script.indexOf("function requestDraftFields()")), ownerContext);
  ownerContext.bindWorkingRequestOwner({ userId: propertyId });
  assert.equal(scopeControls.tasks.value, "Private current task", "Same-owner token recovery discarded edits.");
  saveLandlordRequestDraft(storage, { ownerId: propertyId, fields: { tasks: "Private current task" } });
  assert.throws(() => ownerContext.bindWorkingRequestOwner({ userId: "22222222-2222-4222-8222-222222222222" }), /account changed/);
  assert.equal(scopeControls.tasks.value, "");
  assert.equal(scopeControls.specialInstructions.value, "");
  assert.equal(ownerContext.currentRequestDraft, null);
  assert.equal(ownerContext.generatedChecklist.length, 0);
  assert.equal(ownerContext.assistedSummaryTranscript, "");
  assert.equal(values.size, 0);
  assert.throws(() => ownerContext.bindWorkingRequestOwner({}), /identity is unavailable/);
  ownerContext.bindWorkingRequestOwner({ userId: propertyId }, { allowChange: true });
  assert.equal(ownerContext.requestDraftOwner, propertyId);
}
console.log("Actual owner binding passed: same-owner editing, changed-session cleanup and missing identity.");
