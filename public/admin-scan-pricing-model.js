// Pure form logic for the scan-pricing rules, kept free of DOM and network so
// the bounds an operator is held to can be tested directly.
//
// Every bound here is stated twice more — once in scan-pricing.mjs and once as
// a CHECK constraint in migration 075. That is deliberate. This copy exists to
// tell an operator which field is wrong before a request is sent; the server
// copy is the one that decides. A browser check alone would be a suggestion.

export const pricingFields = Object.freeze([
  { key: "baseRangeBasisPoints", label: "Base price range", minimum: 0, maximum: 5000, money: false,
    help: "How wide the quoted range is before the scan's own uncertainty widens it. 1500 is ±15%." },
  { key: "unresolvedRangeBasisPointsEach", label: "Extra range per open question", minimum: 0, maximum: 2000, money: false,
    help: "Added for every reading the customer has not confirmed, so an unchecked scan quotes visibly vaguer." },
  { key: "maximumRangeBasisPoints", label: "Widest allowed range", minimum: 500, maximum: 9000, money: false,
    help: "Past this a range stops being a price at all." }
]);

// THE RATES THAT USED TO BE HERE ARE AT /admin/pricing.
//
// An hourly rate, a minimum charge, a per-room charge, a square-metre rate and
// the condition multipliers were all editable on this screen while the price
// list that actually charged a customer was editable on another. Both shipped
// £28.00/hour, nothing compared them, and changing one moved half the product.
//
// This screen now owns exactly one thing: how UNCERTAIN an estimate says it is
// while the customer is still checking what the scanner found. The money comes
// from the one price list. Migration 103 dropped the columns.

export function poundsToPence(value) {
  const text = String(value ?? "").trim().replace(/^£/, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) throw new TypeError("Enter an amount in pounds, such as 28.00.");
  return Math.round(Number(text) * 100);
}

export function penceToPounds(value) {
  const pence = Number(value);
  return Number.isInteger(pence) ? (pence / 100).toFixed(2) : "";
}

export function basisPointsToPercent(value) {
  const points = Number(value);
  return Number.isInteger(points) ? String(Math.round(points / 100)) : "";
}

export function percentToBasisPoints(value) {
  const text = String(value ?? "").trim().replace(/%$/, "");
  if (!/^\d{1,3}(\.\d)?$/.test(text)) throw new TypeError("Enter a percentage, such as 125.");
  return Math.round(Number(text) * 100);
}

/**
 * Turns the form into the exact payload the server validates, naming the field
 * that is wrong rather than reporting a generic failure.
 */
export function pricingRulesFromForm(values = {}) {
  const rules = {};
  for (const field of pricingFields) {
    const raw = values[field.key];
    let parsed;
    try { parsed = field.money ? poundsToPence(raw) : Number(String(raw ?? "").trim()); }
    catch (error) { throw new TypeError(`${field.label}: ${error.message}`); }
    if (!Number.isInteger(parsed) || parsed < field.minimum || parsed > field.maximum) {
      throw new TypeError(field.money
        ? `${field.label} must be between £${(field.minimum / 100).toFixed(2)} and £${(field.maximum / 100).toFixed(2)}.`
        : `${field.label} must be between ${field.minimum} and ${field.maximum}.`);
    }
    rules[field.key] = parsed;
  }
  if (rules.baseRangeBasisPoints > rules.maximumRangeBasisPoints) {
    throw new TypeError("The base price range cannot be wider than the widest allowed range.");
  }
  return rules;
}

export function changeReasonError(value) {
  const reason = String(value ?? "").trim();
  if (reason.length < 10) return "Say why these rates are changing, in at least 10 characters.";
  if (reason.length > 500) return "Keep the reason under 500 characters.";
  return "";
}

/**
 * What an operator is about to do to live prices, in plain words.
 *
 * Shown before publishing because a rate change applies to every estimate from
 * the moment it lands, and "hourly rate £28.00 → £30.00" is the sentence that
 * catches a mistyped figure.
 */
export function pricingChangeSummary(current, proposed) {
  if (!current) return ["These will be the first published rates. Until now the shipped defaults have been used."];
  const changes = [];
  for (const field of pricingFields) {
    const before = Number(current[field.key]);
    const after = Number(proposed[field.key]);
    if (!Number.isInteger(before) || before === after) continue;
    changes.push(field.money
      ? `${field.label} £${penceToPounds(before)} → £${penceToPounds(after)}`
      : `${field.label} ${before} → ${after}`);
  }
  return changes.length ? changes : ["Nothing has changed. Publishing would create a new version with identical rates."];
}
