// Pure form logic for the scan-pricing rules, kept free of DOM and network so
// the bounds an operator is held to can be tested directly.
//
// Every bound here is stated twice more — once in scan-pricing.mjs and once as
// a CHECK constraint in migration 075. That is deliberate. This copy exists to
// tell an operator which field is wrong before a request is sent; the server
// copy is the one that decides. A browser check alone would be a suggestion.

export const pricingFields = Object.freeze([
  { key: "hourlyRatePence", label: "Cleaning rate per hour", minimum: 500, maximum: 30000, money: true,
    help: "What the customer pays for an hour of cleaning time." },
  { key: "minimumChargePence", label: "Minimum visit charge", minimum: 500, maximum: 100000, money: true,
    help: "No visit is estimated below this, however small the scan." },
  { key: "roomBasePence", label: "Per-room charge", minimum: 0, maximum: 20000, money: true,
    help: "Charged once per room, for setting up and moving between rooms." },
  { key: "perSquareMetrePence", label: "Rate per square metre", minimum: 0, maximum: 2000, money: true,
    help: "Applied only to rooms with a usable floor-area measurement. Unmeasured rooms are priced on their contents alone." },
  { key: "baseRangeBasisPoints", label: "Base price range", minimum: 0, maximum: 5000, money: false,
    help: "How wide the quoted range is before the scan's own uncertainty widens it. 1500 is ±15%." },
  { key: "unresolvedRangeBasisPointsEach", label: "Extra range per open question", minimum: 0, maximum: 2000, money: false,
    help: "Added for every reading the customer has not confirmed, so an unchecked scan quotes visibly vaguer." },
  { key: "maximumRangeBasisPoints", label: "Widest allowed range", minimum: 500, maximum: 9000, money: false,
    help: "Past this a range stops being a price at all." }
]);

// Level 5 is absent on purpose and must stay absent. It means a person needs to
// look at the property before a cleaner is sent, and an operator who could set
// a multiplier on it could put a number on that.
export const levelFields = Object.freeze([
  { level: 1, label: "Light maintenance clean" },
  { level: 2, label: "Standard clean" },
  { level: 3, label: "Heavy clean" },
  { level: 4, label: "Deep-clean conditions" }
]);

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
  const levelMultiplierBasisPoints = {};
  for (const field of levelFields) {
    const parsed = Number(String(values[`level${field.level}`] ?? "").trim());
    if (!Number.isInteger(parsed) || parsed < 5000 || parsed > 30000) {
      throw new TypeError(`${field.label} must be between 50% and 300% of the standard rate.`);
    }
    levelMultiplierBasisPoints[field.level] = parsed;
  }
  // A heavier home costing less than a lighter one is almost always a
  // transposed pair of fields rather than an intended discount, and it would
  // quietly under-price every deep clean until somebody noticed.
  for (let index = 1; index < levelFields.length; index += 1) {
    const lower = levelMultiplierBasisPoints[levelFields[index - 1].level];
    const higher = levelMultiplierBasisPoints[levelFields[index].level];
    if (higher < lower) {
      throw new TypeError(`${levelFields[index].label} is priced below ${levelFields[index - 1].label}. Check these two figures.`);
    }
  }
  // Level 5 is never sent. The server forces it to zero regardless, and sending
  // a value would imply this form could set one.
  return { ...rules, levelMultiplierBasisPoints };
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
  const currentLevels = current.levelMultiplierBasisPoints || {};
  for (const field of levelFields) {
    const before = Number(currentLevels[field.level] ?? currentLevels[String(field.level)]);
    const after = Number(proposed.levelMultiplierBasisPoints[field.level]);
    if (!Number.isInteger(before) || before === after) continue;
    changes.push(`${field.label} ${Math.round(before / 100)}% → ${Math.round(after / 100)}%`);
  }
  return changes.length ? changes : ["Nothing has changed. Publishing would create a new version with identical rates."];
}
