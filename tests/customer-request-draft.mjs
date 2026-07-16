import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearCustomerRequestDraft, customerRequestDraftFingerprint, customerRequestDraftLifetimeMs, readCustomerRequestDraft, saveCustomerRequestDraft } from "../public/customer-request-draft.js";
import { pilotServiceSuggestionState, suggestedPilotService } from "../public/pilot-request-model.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
const now = Date.UTC(2026, 6, 15, 22, 0, 0);
const retryKey = "7daeb084-bf0b-4f7b-b21d-2ad14d96d81b";

assert.equal(suggestedPilotService("Flat or house"), "Regular home clean");
assert.equal(suggestedPilotService("Office or workplace"), "Regular workplace clean");
assert.equal(suggestedPilotService("Communal area"), "Communal area clean");
assert.equal(suggestedPilotService("Short-let property"), "Rental turnover clean");
assert.equal(suggestedPilotService("Other commercial space"), "Regular workplace clean");
assert.equal(suggestedPilotService("Unknown property"), "", "An unsupported property type received a guessed cleaning service.");
assert.deepEqual(pilotServiceSuggestionState({ propertyType: "Short-let property" }), { service: "Rental turnover clean", suggested: true });
assert.deepEqual(pilotServiceSuggestionState({ propertyType: "Office or workplace", currentService: "One-off deep clean", customerSelected: true }), { service: "One-off deep clean", suggested: false }, "A manual or restored choice was overwritten by the property suggestion.");

const saved = saveCustomerRequestDraft(storage, {
  fields: {
    postcode: "SW1A 1AA",
    propertyType: "Flat or house",
    service: "Regular home clean",
    siteSize: "Two bedrooms",
    contactName: "Test Landlord",
    email: "landlord@example.com",
    phone: "07123456789",
    website: "must-not-save",
    consent: "must-not-save"
  },
  currentStep: 3,
  submissionKey: retryKey
}, now);
assert.equal(saved.currentStep, 3);
assert.equal(saved.fields.contactName, "Test Landlord");
assert.equal(saved.fields.service, "Regular home clean");
assert.equal(saved.retry.key, retryKey);
assert.equal(saved.retry.fingerprint, customerRequestDraftFingerprint(saved.fields));
const storedText = [...values.values()][0];
assert(!storedText.includes("website") && !storedText.includes("consent"), "The honeypot and privacy consent must never enter the recovery draft.");
const restored = readCustomerRequestDraft(storage, now + 10_000);
assert.equal(restored.fields.email, "landlord@example.com");
assert.equal(restored.retry.key, retryKey, "An ambiguous network retry must reuse its original key after reload.");
assert.equal(readCustomerRequestDraft(storage, now + customerRequestDraftLifetimeMs), null, "Expired request drafts must be deleted.");
assert.equal(values.size, 0);

saveCustomerRequestDraft(storage, { fields: { postcode: "SW1A 1AA" }, currentStep: 9, submissionKey: "not-a-key" }, now);
const invalidRetry = readCustomerRequestDraft(storage, now);
assert.equal(invalidRetry.currentStep, 3, "Restored steps must stay inside the three-stage request.");
assert.equal(invalidRetry.retry, undefined, "Invalid retry keys must not survive draft validation.");
clearCustomerRequestDraft(storage);
assert.equal(values.size, 0);
saveCustomerRequestDraft(storage, { fields: { postcode: "SW1A 1AA", details: "Please clean the oven. Door code is 4821" }, currentStep: 2 }, now);
const sensitiveDraftText = [...values.values()][0];
assert(!sensitiveDraftText.includes("4821"), "An access code entered before booking acceptance was stored in the recovery draft.");
assert.equal(readCustomerRequestDraft(storage, now)?.fields.details, "", "A sensitive access detail outside the dedicated access field survived recovery-draft normalization.");
clearCustomerRequestDraft(storage);
saveCustomerRequestDraft(storage, {}, now);
assert.equal(values.size, 0, "An untouched request must not create a draft.");
saveCustomerRequestDraft(storage, { fields: { frequency: "One-off", preferredTimeWindow: "Flexible" } }, now);
assert.equal(values.size, 0, "Default choices alone must not create a draft.");
storage.setItem("tidewayCustomerRequestDraftV1", "broken-json");
assert.equal(readCustomerRequestDraft(storage, now), null);
assert.equal(values.size, 0, "Corrupt drafts must be removed.");

const [html, app, privacy] = await Promise.all([
  readFile(path.join(root, "public", "index.html"), "utf8"),
  readFile(path.join(root, "public", "app.js"), "utf8"),
  readFile(path.join(root, "public", "privacy.html"), "utf8")
]);
assert(html.includes("data-customer-draft-status") && html.includes("Access codes and privacy consent are never stored"));
assert(html.includes("<option>Regular home clean</option>"), "The working customer request omitted ordinary household cleaning.");
assert(html.includes('type="hidden" name="customerType" value="Cleaning customer"') && html.includes('type="hidden" name="accessNotes" value="Confirm privately after booking"') && !html.includes("I am a <select") && !html.includes("General access approach"), "The public request still asks for premature customer classification or access arrangements.");
assert(html.includes("Add phone or organisation") && !/name="phone"[^>]*required/.test(html.match(/data-guided-kind="customer"[\s\S]*?<\/form>/)?.[0] || "") && html.includes("We use this for your private scan and request updates."), "The customer request still requires secondary contact details or does not explain its required email.");
assert(html.includes("Add recurring or extra details") && html.indexOf("Add recurring or extra details") < html.indexOf('name="frequency"') && html.indexOf("Add recurring or extra details") < html.indexOf('name="details"'), "Optional recurrence and free-text details still compete with the primary timing decisions.");
assert(app.includes("readCustomerRequestDraft") && app.includes("clearCustomerRequestDraft(window.sessionStorage)"));
assert(app.includes("containsSensitiveAccessDetails") && app.includes("accessDetailsSafetyMessage"));
assert(app.includes("pilotServiceSuggestionState({ propertyType: propertyType.value") && app.includes("if (event.isTrusted) customerSelected = true") && app.includes('new Event("input"') && html.includes("data-service-suggestion"), "The public request does not suggest a safe service or preserve a restored/manual choice.");
assert(app.includes("customerDraftControls.get(form) || cleanerDraftControls.get(form)") && app.includes("draftControls?.rememberSubmission(pending.key)"));
assert(app.includes('["customer", "cleaner"].includes(form.dataset.guidedKind)') && app.includes("AbortController"));
assert(!app.includes('form.elements.namedItem("consent").checked = true'));
assert(privacy.includes("An incomplete cleaning request may keep"));

console.log("customer request draft tests passed");
