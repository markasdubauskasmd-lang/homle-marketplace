import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clearLandlordRequestDraft, landlordRequestDraftLifetimeMs, readLandlordRequestDraft, saveLandlordRequestDraft } from "../public/landlord-request-draft.js";

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
const now = Date.UTC(2026, 6, 17, 18, 30, 0);
const propertyId = "7daeb084-bf0b-4f7b-b21d-2ad14d96d81b";

const saved = saveLandlordRequestDraft(storage, { fields: {
  propertyId, requestedDate: "2026-07-20", requestedTime: "10:30", durationMinutes: "180", cleaningType: "rental-turnovers", frequency: "one-time", budget: "125.50",
  specialInstructions: "Please prioritise the oven.", transcript: "Kitchen, wipe the worktops and clean the oven.", tasks: "Kitchen: Wipe the worktops\nKitchen: Clean the oven",
  scopeReviewed: "on", csrfToken: "must-not-save", photos: "must-not-save"
} }, now);
assert.equal(saved.fields.propertyId, propertyId);
assert.equal(saved.fields.transcript, "Kitchen, wipe the worktops and clean the oven.");
const storedText = [...values.values()][0];
assert(!storedText.includes("scopeReviewed") && !storedText.includes("csrfToken") && !storedText.includes("photos") && !storedText.includes("must-not-save"), "Approval, security tokens or photos entered the same-tab recovery draft.");
assert.deepEqual(readLandlordRequestDraft(storage, now + 10_000)?.fields, saved.fields);
assert.equal(readLandlordRequestDraft(storage, now + landlordRequestDraftLifetimeMs), null, "Expired Landlord request drafts must be removed.");
assert.equal(values.size, 0);

saveLandlordRequestDraft(storage, { fields: { propertyId, specialInstructions: "Door code is 4821", transcript: "Key is hidden under the mat", tasks: "Hall: Clean floor. Alarm PIN: 1234" } }, now);
const sensitiveText = [...values.values()][0];
assert(!sensitiveText.includes("4821") && !sensitiveText.includes("under the mat") && !sensitiveText.includes("1234"), "Sensitive property access details survived browser-draft normalization.");
const sensitive = readLandlordRequestDraft(storage, now);
assert.equal(sensitive.fields.specialInstructions, "");
assert.equal(sensitive.fields.transcript, "");
assert.equal(sensitive.fields.tasks, "");
clearLandlordRequestDraft(storage);

saveLandlordRequestDraft(storage, { fields: { durationMinutes: "120", frequency: "one-time" } }, now);
assert.equal(values.size, 0, "Untouched default choices must not create a recovery draft.");
saveLandlordRequestDraft(storage, { fields: { propertyId: "not-a-property", transcript: "Kitchen, clean the sink." } }, now);
assert.equal(readLandlordRequestDraft(storage, now)?.fields.propertyId, "", "An invalid property identifier survived recovery validation.");
clearLandlordRequestDraft(storage);
storage.setItem("homleLandlordRequestDraftV1", "broken-json");
assert.equal(readLandlordRequestDraft(storage, now), null);
assert.equal(values.size, 0, "Corrupt Landlord recovery data must be removed.");

const [page, script] = await Promise.all([readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"), readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8")]);
assert(page.includes("data-request-recovery-status") && page.includes("Approval and photos are never restored"), "The Landlord does not receive the recovery privacy boundary.");
assert(script.includes("saveLandlordRequestDraft(window.sessionStorage") && script.includes("readLandlordRequestDraft(window.sessionStorage") && script.includes("clearLandlordRequestDraft(window.sessionStorage)"), "The Landlord request is not recovered only inside the current browser tab.");
assert(script.includes("properties.some((property) => property.propertyId === draft.fields.propertyId)"), "A removed or foreign property could be restored into the request form.");
assert(script.includes("requestForm.elements.scopeReviewed.checked = false") && !script.includes("fields.scopeReviewed"), "Checklist approval is restored without a fresh Landlord review.");

console.log("landlord request draft tests passed");
