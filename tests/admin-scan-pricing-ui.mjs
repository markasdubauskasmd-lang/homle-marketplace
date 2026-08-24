import { readFile } from "node:fs/promises";
import {
  basisPointsToPercent, changeReasonError, penceToPounds, percentToBasisPoints,
  poundsToPence, pricingChangeSummary, pricingFields, pricingRulesFromForm
} from "../public/admin-scan-pricing-model.js";
import { scanOperationalWarnings, scanTimingSummary } from "../public/admin-scan-operations-model.js";
import { normalizedPricingRuleset } from "../src/marketplace/scan-pricing.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
function throwsWith(run, fragment) {
  try { run(); } catch (error) { return String(error?.message || "").includes(fragment); }
  return false;
}

// Three fields, all about UNCERTAINTY. The rates that used to be on this form
// are at /admin/pricing, and migration 103 dropped their columns.
const validForm = {
  baseRangeBasisPoints: "1500",
  unresolvedRangeBasisPointsEach: "200",
  maximumRangeBasisPoints: "6000"
};

/* ── Anonymous scanner operations evidence ─────────────────────────────── */

{
  const summary = scanTimingSummary({ timings: {
    "scan.reading.latency_ms|outcome=ok|0-250ms": 2,
    "scan.reading.latency_ms|outcome=ok|8000-15000ms": 1,
    "scan.reading.latency_ms|outcome=error|15000-30000ms": 1,
    "scan.room.duration_ms|8000-15000ms": 99,
    "scan.reading.latency_ms|outcome=ok|invented-bucket": 99
  } });
  assert(summary.total === 4, "Assisted-reading latency mixed in another timing or an unknown bucket.");
  assert(summary.slowCount === 2 && summary.slowRate === 0.5, "Slow assisted reads were not calculated from the 8-second boundary.");
  assert(summary.buckets.find((entry) => entry.bucket === "0-250ms")?.count === 2,
    "Latency dimensions were not aggregated into their safe bucket.");
}

{
  const warnings = scanOperationalWarnings({ counters: {
    "scan.camera.denied|deviceClass=guided-web": 2,
    "scan.camera.denied|deviceClass=mobile": 1,
    "scan.detector.unavailable": 1,
    "scan.session.started": 500
  } });
  assert(warnings.length === 2, "Routine counters became scanner reliability warnings.");
  assert(warnings[0].code === "camera-denied" && warnings[0].count === 3,
    "Camera-denial dimensions were not safely aggregated.");
  assert(warnings[1].code === "detector-unavailable" && warnings[1].count === 1,
    "Detector unavailability was not surfaced to operations.");
}

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
  assert(rules.baseRangeBasisPoints === 1500 && rules.maximumRangeBasisPoints === 6000, "The form did not read its range fields.");
  // The whole point of the retirement: this screen can no longer set a price.
  for (const retired of ["hourlyRatePence", "minimumChargePence", "roomBasePence", "perSquareMetrePence", "levelMultiplierBasisPoints"]) {
    assert(!Object.hasOwn(rules, retired), `This form still produces ${retired}, so there are two places a price can be set again.`);
  }
  assert(!pricingFields.some((field) => field.money), "A money field reappeared on the scan-pricing form.");
  // The real test of a browser-side form: the server must accept its output
  // unchanged. A form that can produce a payload the server rejects is a form
  // that will reject an operator's work after they have done it.
  const accepted = normalizedPricingRuleset(rules);
  assert(accepted.baseRangeBasisPoints === 1500,
    "The server rejected or altered a payload this form produced.");
  // The server accepts exactly what this form produces and nothing else, so a
  // retired key sent by an older client cannot resurrect a second rate table.
  assert(Object.keys(accepted).length === Object.keys(rules).length + 2,
    "The server's ruleset carries fields this form does not produce.");
  assert(normalizedPricingRuleset({ ...rules, hourlyRatePence: 9000, minimumChargePence: 99000 }).baseRangeBasisPoints === 1500,
    "A retired rate sent alongside the range fields was not ignored.");
  for (const retired of ["hourlyRatePence", "minimumChargePence", "roomBasePence", "perSquareMetrePence", "levelMultiplierBasisPoints"]) {
    assert(!Object.hasOwn(accepted, retired), `The server ruleset still carries ${retired}.`);
  }
}

/* ── Bounds name the field that is wrong ───────────────────────────────── */

assert(throwsWith(() => pricingRulesFromForm({ ...validForm, unresolvedRangeBasisPointsEach: "5000" }), "Extra range per open question"),
  "An out-of-range per-question widening was accepted, or reported without naming the field.");
assert(throwsWith(() => pricingRulesFromForm({ ...validForm, maximumRangeBasisPoints: "100" }), "Widest allowed range"),
  "A maximum range below the supported floor was accepted.");
// Both values are individually in range; it is the pair that is wrong, and a
// base range wider than the cap would quote every job at its own maximum.
assert(throwsWith(() => pricingRulesFromForm({ ...validForm, baseRangeBasisPoints: "5000", maximumRangeBasisPoints: "3000" }), "wider than the widest allowed"),
  "A base range wider than the maximum was accepted.");
assert(throwsWith(() => pricingRulesFromForm({ ...validForm, baseRangeBasisPoints: "7000" }), "Base price range"),
  "An out-of-range base range was accepted, or reported without naming the field.");


/* ── A rate change must be explainable ─────────────────────────────────── */

assert(changeReasonError("") !== "" && changeReasonError("too short") !== "", "A rate change with no real reason was allowed.");
assert(changeReasonError("Raised the hourly rate after the spring review.") === "", "A valid reason was rejected.");
assert(changeReasonError("x".repeat(501)) !== "", "An unbounded reason was allowed.");

/* ── The operator sees what they are about to change ───────────────────── */

// A widened range applies to every estimate from the moment it lands, so
// "1500 → 2000" is the sentence that catches a mistyped figure.
{
  const current = { baseRangeBasisPoints: 1500, unresolvedRangeBasisPointsEach: 200, maximumRangeBasisPoints: 6000 };
  const proposed = pricingRulesFromForm({ ...validForm, baseRangeBasisPoints: "2000" });
  const summary = pricingChangeSummary(current, proposed);
  assert(summary.some((line) => line.includes("1500 → 2000")), `The summary did not show the change: ${summary.join(" | ")}`);
  assert(summary.length === 1, `The summary invented changes: ${summary.join(" | ")}`);

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
// The rates left this page for /admin/pricing, and an operator who came here
// looking for them has to be told where they went rather than concluding they
// are gone. Level 5's unpriceability is stated at the price list now, beside
// the condition multipliers it belongs to.
assert(/\/admin\/pricing/.test(page),
  "The scan-pricing page does not point at the price list, so an operator looking for the rates finds nothing.");
assert(!/hourly rate|minimum charge|per-room charge/i.test(page.replace(/Rates, minimums[^<]*/i, "")),
  "A retired rate field reappeared on the scan-pricing page.");
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
assert(operationsPage.includes("data-admin-scan-latency") && operationsPage.includes("data-admin-scan-warnings"),
  "The operations page collects scanner latency and failures without showing them to an operator.");
assert(operationsPage.includes("data-admin-scan-releases") && operationsScript.includes("payload.currentRelease"),
  "The operations page cannot compare scanner reliability by packaged release.");
assert(operationsScript.includes("scanTimingSummary") && operationsScript.includes("scanOperationalWarnings"),
  "The operations page does not interpret its privacy-safe scanner evidence.");
// Everything rendered with textContent; model output must never become markup.
assert(!/innerHTML\s*=/.test(operationsScript), "The operations page assigns innerHTML.");

console.log("Administrator scan-operations accuracy-review checks passed.");
