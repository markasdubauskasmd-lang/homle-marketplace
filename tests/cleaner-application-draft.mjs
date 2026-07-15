import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanerApplicationDraftFingerprint, cleanerApplicationDraftLifetimeMs, clearCleanerApplicationDraft, readCleanerApplicationDraft, saveCleanerApplicationDraft } from "../public/cleaner-application-draft.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
const now = Date.UTC(2026, 6, 15, 20, 0, 0);
const retryKey = "31cbeef4-d217-4c08-a2c4-60fd03c5f0c8";

const saved = saveCleanerApplicationDraft(storage, {
  fields: { fullName: "Test Applicant", email: "applicant@example.com", postcode: "SW1A 1AA", professionalBio: "Careful cleaner with a consistent room-by-room process.", website: "must-not-save" },
  services: { serviceTurnovers: true, consent: true, rightToWork: true },
  currentStep: 3,
  submissionKey: retryKey
}, now);
assert.equal(saved.currentStep, 3);
assert.equal(saved.fields.fullName, "Test Applicant");
assert.equal(saved.services.serviceTurnovers, true);
assert.equal(saved.retry.key, retryKey);
assert.equal(saved.retry.fingerprint, cleanerApplicationDraftFingerprint(saved.fields, saved.services));
const storedText = [...values.values()][0];
assert(!storedText.includes("website") && !storedText.includes("rightToWork") && !storedText.includes("consent"), "Honeypot, eligibility and consent fields must never enter the recovery draft.");
const restored = readCleanerApplicationDraft(storage, now + 10_000);
assert.equal(restored.fields.email, "applicant@example.com");
assert.equal(restored.retry.key, retryKey, "An ambiguous application retry must reuse its original key after reload.");
assert.equal(readCleanerApplicationDraft(storage, now + cleanerApplicationDraftLifetimeMs), null, "Expired application drafts must be deleted.");
assert.equal(values.size, 0);

saveCleanerApplicationDraft(storage, { fields: { fullName: "Temporary" }, currentStep: 9, submissionKey: "not-a-key" }, now);
const invalidRetry = readCleanerApplicationDraft(storage, now);
assert.equal(invalidRetry.currentStep, 3, "Restored steps must stay inside the three-stage application.");
assert.equal(invalidRetry.retry, undefined, "Invalid retry keys must not survive draft validation.");
clearCleanerApplicationDraft(storage);
assert.equal(values.size, 0);
saveCleanerApplicationDraft(storage, {}, now);
assert.equal(values.size, 0, "An untouched application must not create a draft.");
saveCleanerApplicationDraft(storage, { fields: { transport: "Public transport" } }, now);
assert.equal(values.size, 0, "A default transport choice alone must not create a draft.");
storage.setItem("tidewayCleanerApplicationDraftV1", "broken-json");
assert.equal(readCleanerApplicationDraft(storage, now), null);
assert.equal(values.size, 0, "Corrupt drafts must be removed.");

const [html, app] = await Promise.all([readFile(path.join(root, "public", "index.html"), "utf8"), readFile(path.join(root, "public", "app.js"), "utf8")]);
assert(html.includes("data-cleaner-draft-status") && html.includes("Eligibility and consent confirmations are never restored"));
assert(app.includes("readCleanerApplicationDraft") && app.includes("clearCleanerApplicationDraft(window.sessionStorage)"));
assert(app.includes("AbortController") && app.includes("navigator.onLine === false"), "Cleaner submission needs bounded poor-connection recovery.");
assert(app.includes("cleanerDraftControls.get(form)") && app.includes("draftControls?.rememberSubmission(pending.key)"), "Cleaner recovery must preserve exact retry identity across an interrupted response.");
assert(!app.includes('form.elements.namedItem("rightToWork").checked = true') && !app.includes('form.elements.namedItem("consent").checked = true'));

console.log("cleaner application draft tests passed");
