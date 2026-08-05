import { readFile } from "node:fs/promises";
import {
  basisPointsToPercent, changeReasonError, levelFields, penceToPounds, percentToBasisPoints,
  poundsToPence, pricingChangeSummary, pricingFields, pricingRulesFromForm
} from "../public/admin-scan-pricing-model.js";
import { normalizedPricingRuleset } from "../src/marketplace/scan-pricing.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
function throwsWith(run, fragment) {
  try { run(); } catch (error) { return String(error?.message || "").includes(fragment); }
  return false;
}

const validForm = {
  hourlyRatePence: "28.00", minimumChargePence: "45.00", roomBasePence: "4.00",
  perSquareMetrePence: "0.90", baseRangeBasisPoints: "1500",
  unresolvedRangeBasisPointsEach: "200", maximumRangeBasisPoints: "6000",
  level1: "9000", level2: "10000", level3: "12500", level4: "15000"
};

/* ── Money in and out of a form ────────────────────────────────────────── */

assert(poundsToPence("28.00") === 2800 && poundsToPence("£28") === 2800 && poundsToPence("0.90") === 90,
  "Pounds were not converted to pence correctly.");
assert(throwsWith(() => poundsToPence("28.001"), "amount in pounds"), "A sub-penny amount was accepted.");
assert(throwsWith(() => poundsToPence("twenty"), "amount in pounds"), "A non-numeric amount was accepted.");
assert(throwsWith(() => poundsToPence("-5"), "amount in pounds"), "A negative amount was accepted.");
assert(penceToPounds(2800) === "28.00", "Pence were not displayed as pounds.");
assert(percentToBasisPoints("125") === 12500 && basisPointsToPercent(12500) === "125", "Percentages and basis points did not round-trip.");

/* ── The form produces exactly what the server validates ───────────────── */

{
  const rules = pricingRulesFromForm(validForm);
  assert(rules.hourlyRatePence === 2800 && rules.minimumChargePence === 4500, "The form did not convert its money fields.");
  assert(rules.levelMultiplierBasisPoints[4] === 15000, "The form lost a condition multiplier.");
  // The real test of a browser-side form: the server must accept its output
  // unchanged. A form that can produce a payload the server rejects is a form
  // that will reject an operator's work after they have done it.
  const accepted = normalizedPricingRuleset(rules);
  assert(accepted.hourlyRatePence === 2800 && accepted.levelMultiplierBasisPoints[3] === 12500,
    "The server rejected or altered a payload this form produced.");
  // Level 5 is never sent, and the server forces it to zero regardless.
  assert(!Object.hasOwn(rules.levelMultiplierBasisPoints, "5") && !Object.hasOwn(rules.levelMultiplierBasisPoints, 5),
    "The form offered a price for specialist review.");
  assert(accepted.levelMultiplierBasisPoints[5] === 0, "Specialist review became priceable.");
  assert(!levelFields.some((field) => field.level === 5), "The form lists a level-5 field.");
}

/* ── Bounds name the field that is wrong ───────────────────────────────── */

assert(throwsWith(() => pricingRulesFromForm({ ...validForm, hourlyRatePence: "0.50" }), "Cleaning rate per hour"),
  "An under-range hourly rate was accepted, or reported without naming the field.");
assert(throwsWith(() => pricingRulesFromForm({ ...validForm, hourlyRatePence: "9999.00" }), "Cleaning rate per hour"),
  "An absurd hourly rate was accepted.");
assert(throwsWith(() => pricingRulesFromForm({ ...validForm, minimumChargePence: "1.00" }), "Minimum visit charge"),
  "A trivial minimum charge was accepted.");
assert(throwsWith(() => pricingRulesFromForm({ ...validForm, level3: "40000" }), "Heavy clean"),
  "An absurd condition multiplier was accepted.");
// Both values are individually in range; it is the pair that is wrong, and a
// base range wider than the cap would quote every job at its own maximum.
assert(throwsWith(() => pricingRulesFromForm({ ...validForm, baseRangeBasisPoints: "5000", maximumRangeBasisPoints: "3000" }), "wider than the widest allowed"),
  "A base range wider than the maximum was accepted.");
assert(throwsWith(() => pricingRulesFromForm({ ...validForm, baseRangeBasisPoints: "7000" }), "Base price range"),
  "An out-of-range base range was accepted, or reported without naming the field.");

// A heavier home costing less than a lighter one is almost always a transposed
// pair of fields, and it would quietly under-price every deep clean.
assert(throwsWith(() => pricingRulesFromForm({ ...validForm, level3: "15000", level4: "12500" }), "priced below"),
  "A deep clean priced below a heavy clean was accepted.");
// Equal is allowed: an operator may legitimately decide two levels cost the same.
{
  const rules = pricingRulesFromForm({ ...validForm, level3: "12500", level4: "12500" });
  assert(rules.levelMultiplierBasisPoints[4] === 12500, "Two levels priced identically were rejected.");
}

/* ── A rate change must be explainable ─────────────────────────────────── */

assert(changeReasonError("") !== "" && changeReasonError("too short") !== "", "A rate change with no real reason was allowed.");
assert(changeReasonError("Raised the hourly rate after the spring review.") === "", "A valid reason was rejected.");
assert(changeReasonError("x".repeat(501)) !== "", "An unbounded reason was allowed.");

/* ── The operator sees what they are about to change ───────────────────── */

// A rate change applies to every estimate from the moment it lands, so
// "£28.00 → £30.00" is the sentence that catches a mistyped figure.
{
  const current = { hourlyRatePence: 2800, minimumChargePence: 4500, roomBasePence: 400, perSquareMetrePence: 90,
    baseRangeBasisPoints: 1500, unresolvedRangeBasisPointsEach: 200, maximumRangeBasisPoints: 6000,
    levelMultiplierBasisPoints: { 1: 9000, 2: 10000, 3: 12500, 4: 15000 } };
  const proposed = pricingRulesFromForm({ ...validForm, hourlyRatePence: "30.00", level4: "16000" });
  const summary = pricingChangeSummary(current, proposed);
  assert(summary.some((line) => line.includes("£28.00 → £30.00")), `The summary did not show the rate change: ${summary.join(" | ")}`);
  assert(summary.some((line) => line.includes("150% → 160%")), `The summary did not show the multiplier change: ${summary.join(" | ")}`);
  assert(summary.length === 2, `The summary invented changes: ${summary.join(" | ")}`);

  const unchanged = pricingChangeSummary(current, pricingRulesFromForm(validForm));
  assert(unchanged[0].includes("Nothing has changed"), "An unchanged form did not say so.");
  const first = pricingChangeSummary(null, proposed);
  assert(first[0].includes("first published rates"), "A first publication was not described as one.");
}

/* ── The page itself ───────────────────────────────────────────────────── */

const [page, script] = await Promise.all([
  readFile(new URL("../public/admin-scan-pricing.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-scan-pricing.js", import.meta.url), "utf8")
]);

assert(/<meta name="robots" content="noindex,nofollow,noarchive">/.test(page), "The internal pricing page is indexable.");
assert(page.includes('data-admin-pricing-gate'), "The pricing page has no protected-access gate.");
// Publishing changes what every customer is charged, so it must state that
// before the button, not after.
assert(/every new estimate/i.test(page), "The pricing page does not warn that publishing affects live estimates.");
assert(page.includes("Specialist review") && /cannot be priced|not priceable|never priced/i.test(page),
  "The pricing page does not explain that level 5 has no price.");
assert(script.includes("X-CSRF-Token"), "The pricing page publishes without a CSRF token.");
assert(script.includes("/api/marketplace/admin/pricing/scan-ruleset"), "The pricing page does not use the Administrator endpoint.");
assert(script.includes("pricingChangeSummary"), "The pricing page publishes without showing what is changing.");
// Rendering an operator-entered reason as HTML would make the internal audit
// trail an injection surface.
assert(!/innerHTML\s*=/.test(script), "The pricing page assigns innerHTML.");

console.log("Administrator scan-pricing UI checks passed.");

/* ── The accuracy review surface on the operations page ── */

const [operationsPage, operationsScript] = await Promise.all([
  readFile(new URL("../public/admin-scan-operations.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-scan-operations.js", import.meta.url), "utf8")
]);

// The queue, the report, and a verdict form per object.
assert(operationsPage.includes("data-admin-truth-queue") && operationsPage.includes("data-admin-truth-report"),
  "The operations page lost its accuracy-review section.");
assert(operationsScript.includes("/api/marketplace/admin/scan-ground-truth"),
  "The review section does not talk to the ground-truth endpoints.");
// Consent is an attestation the reviewer makes deliberately — never pre-ticked.
assert(/consentInput\.type = "checkbox";\s*\n\s*consent\.append/.test(operationsScript) && !/consentInput\.checked = true/.test(operationsScript),
  "The training-consent attestation is pre-ticked, manufacturing consent by default.");
// An empty report is the honest zero, and a small sample says so.
assert(operationsScript.includes("That is different from it being good") && operationsScript.includes("anecdote, not accuracy"),
  "The report presents an unmeasured or under-sampled accuracy as a clean bill of health.");
// The false-clean rate — the dirty-sink number — is named on its own.
assert(operationsScript.includes("falseCleanRate"), "The false-clean rate is not reported.");
// Everything rendered with textContent; model output must never become markup.
assert(!/innerHTML\s*=/.test(operationsScript), "The operations page assigns innerHTML.");

console.log("Administrator scan-operations accuracy-review checks passed.");
