import {
  derivedArea, maximumUsableRelativeTolerance, measurementConfidence, measurementLabel,
  measurementMethods, measureFromReference, minimumReferencePixelSize,
  minimumReferenceRelativeTolerance, normalizedMeasurements, referenceObjects,
  referenceScale, userConfirmedMeasurement
} from "../src/marketplace/room-measurement.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
function throwsWith(run, fragment) {
  try { run(); } catch (error) { return String(error?.message || "").includes(fragment); }
  return false;
}

/* ── There is no sensor path in a web application ──────────────────────── */

// The enum keeps the value so adding a native path later is a code change
// rather than a migration on a table already holding customer data. Nothing may
// produce it, and a client claiming it is claiming an accuracy no browser has.
assert(measurementMethods.includes("sensor"), "The measurement method enum lost its reserved sensor value.");
{
  const stored = normalizedMeasurements([{ subject: "room-length", method: "sensor", valueMm: 3400, toleranceMm: 5 }]);
  assert(stored.length === 0, "A client claimed a sensor measurement and it was stored.");
}

/* ── A reference is only as good as the object it is ───────────────────── */

// A bank card is manufactured to a standard. A "standard" door is standard by
// convention and varies by tens of millimetres. Two references must not produce
// the same stated confidence.
{
  const card = referenceScale({ reference: "bank-card", referencePixels: 200 });
  const door = referenceScale({ reference: "interior-door", referencePixels: 200 });
  assert(card.relativeUncertainty < door.relativeUncertainty,
    "A precisely manufactured reference was treated as no better than a conventional one.");
  assert(referenceObjects["bank-card"].uncertaintyMm < referenceObjects["interior-door"].uncertaintyMm,
    "The reference table does not record that a door is a vaguer object than a card.");
}

// A reference too small in frame cannot mean anything: measured to a pixel, a
// tiny box is already double-digit percentages wrong before perspective.
assert(throwsWith(() => referenceScale({ reference: "bank-card", referencePixels: minimumReferencePixelSize - 1 }), "too small in the picture"),
  "A reference too small to measure from was accepted.");
assert(throwsWith(() => referenceScale({ reference: "moon", referencePixels: 200 }), "supported reference object"),
  "An unsupported reference object was accepted.");

// Scale is straightforward arithmetic and must be right.
{
  const scale = referenceScale({ reference: "bank-card", referencePixels: 856 });
  assert(Math.abs(scale.millimetresPerPixel - 0.1) < 1e-9, `The reference scale was wrong: ${scale.millimetresPerPixel}`);
  const height = referenceScale({ reference: "a4-paper", referencePixels: 297, referenceAxis: "height" });
  assert(Math.abs(height.millimetresPerPixel - 1) < 1e-9, "Measuring against the reference's height axis was wrong.");
}

/* ── The perspective floor is the honest part ──────────────────────────── */

// A single frame cannot know whether the reference and the wall behind it are
// the same distance from the lens. Arithmetic on pixel widths cannot see that
// error, so it is added by hand and can never be optimised away.
{
  const scale = referenceScale({ reference: "bank-card", referencePixels: 5000 });
  const measurement = measureFromReference({ subject: "room-length", scale, spanPixels: 50_000 });
  assert(measurement.relativeTolerance >= minimumReferenceRelativeTolerance,
    `A near-perfect reference produced a tolerance below the perspective floor: ${measurement.relativeTolerance}`);
  assert(measurement.toleranceMm > 0, "A reference-calibrated measurement was reported with no tolerance at all.");
}

// Nothing a web application measures is high confidence. The top band is medium.
{
  const scale = referenceScale({ reference: "bank-card", referencePixels: 1000 });
  const measurement = measureFromReference({ subject: "room-width", scale, spanPixels: 20_000 });
  assert(measurement.confidence === "medium", `A calibrated measurement claimed ${measurement.confidence} confidence.`);
  assert(measurement.method === "reference-calibrated", "The measurement lost its method.");
}

// A measurement too vague to be worth showing says so, rather than being
// displayed with a band nobody reads.
{
  assert(measurementConfidence("reference-calibrated", maximumUsableRelativeTolerance + 0.01) === "unusable",
    "An unusably wide tolerance was still reported as a confidence band.");
  // A span only a few pixels across — a mis-drawn line, or an attempt to
  // measure something far smaller than the reference beside it.
  const scale = referenceScale({ reference: "brick", referencePixels: 41 });
  const measurement = measureFromReference({ subject: "room-length", scale, spanPixels: 5 });
  assert(measurement.relativeTolerance > maximumUsableRelativeTolerance,
    `A five-pixel span produced a usable-looking tolerance: ${measurement.relativeTolerance}`);
  assert(measurement.usable === false, "A hopeless measurement was marked usable.");
}

assert(throwsWith(() => measureFromReference({ subject: "wall-colour", scale: referenceScale({ reference: "bank-card", referencePixels: 200 }), spanPixels: 100 }), "supported measurement subject"),
  "An unsupported measurement subject was accepted.");
assert(throwsWith(() => measureFromReference({ subject: "room-length", spanPixels: 100 }), "reference scale is required"),
  "A measurement was produced with no scale at all.");

/* ── A person's figure is the best a web application gets, not exact ───── */

{
  const measurement = userConfirmedMeasurement({ subject: "room-length", valueMm: 3400 });
  assert(measurement.confidence === "high" && measurement.method === "user-confirmed", "A confirmed figure was not treated as confirmed.");
  // Non-zero on purpose: a stated zero would make a typed figure look like a
  // laser reading. People estimate too.
  assert(measurement.toleranceMm > 0, "A typed measurement was presented as exact.");
  const exact = userConfirmedMeasurement({ subject: "room-length", valueMm: 3400, toleranceMm: 10 });
  assert(exact.toleranceMm === 10, "A stated tolerance was overridden.");
}
assert(throwsWith(() => userConfirmedMeasurement({ subject: "room-length", valueMm: 0 }), "positive length"), "A zero measurement was accepted.");
assert(throwsWith(() => userConfirmedMeasurement({ subject: "room-length", valueMm: 500_000 }), "outside the range"), "An absurd measurement was accepted.");

/* ── Compounding is why an estimated floor area must carry its band ────── */

{
  const scale = referenceScale({ reference: "bank-card", referencePixels: 1000 });
  const length = measureFromReference({ subject: "room-length", scale, spanPixels: 34_000 });
  const width = measureFromReference({ subject: "room-width", scale, spanPixels: 26_000 });
  const area = derivedArea({ length, width });
  // Relative tolerances add: two figures each good to ±12% give an area good to
  // ±24%, and that is the whole reason a photographed floor area is never a
  // figure.
  assert(Math.abs(area.relativeTolerance - (length.relativeTolerance + width.relativeTolerance)) < 1e-6,
    `Area tolerance did not compound: ${area.relativeTolerance}`);
  assert(area.relativeTolerance > 0.2, "Two estimated lengths produced an implausibly tight area.");
  assert(area.toleranceSquareMetres > 0, "A derived area carried no tolerance.");
  assert(area.method === "derived" && area.subject === "floor-area", "A derived area lost its method or subject.");
}

// Derived from two confirmed figures is confirmed. Derived from anything
// estimated is not, whatever the arithmetic works out to.
{
  const length = userConfirmedMeasurement({ subject: "room-length", valueMm: 4000, toleranceMm: 20 });
  const width = userConfirmedMeasurement({ subject: "room-width", valueMm: 3000, toleranceMm: 20 });
  const area = derivedArea({ length, width });
  assert(area.confidence === "high", "An area derived from two confirmed lengths was downgraded.");
  assert(area.squareMetres === 12, `A confirmed area was computed wrongly: ${area.squareMetres}`);

  const scale = referenceScale({ reference: "bank-card", referencePixels: 1000 });
  const estimated = measureFromReference({ subject: "room-width", scale, spanPixels: 30_000 });
  const mixed = derivedArea({ length, width: estimated });
  assert(mixed.confidence !== "high", "An area derived from an estimate was reported as confirmed.");
}
assert(throwsWith(() => derivedArea({ length: null, width: null }), "Two measured lengths are required"), "An area was derived from nothing.");

/* ── How it is written for a customer ──────────────────────────────────── */

// "3.4m ± 0.4m, estimated from a bank card in the photo" tells the truth in the
// same space that "3.4m" tells a lie.
{
  const scale = referenceScale({ reference: "bank-card", referencePixels: 1000 });
  const measurement = measureFromReference({ subject: "room-length", scale, spanPixels: 34_000 });
  const label = measurementLabel(measurement);
  assert(label.includes("±"), `An estimated measurement was written without a range: ${label}`);
  assert(label.includes("bank card"), `The label did not say what it was estimated from: ${label}`);
  assert(/^Length /.test(label), `The label did not name its subject: ${label}`);
}
{
  const label = measurementLabel(userConfirmedMeasurement({ subject: "ceiling-height", valueMm: 2400, toleranceMm: 0 }));
  assert(label.includes("confirmed by you"), `A confirmed measurement did not say who confirmed it: ${label}`);
  assert(!label.includes("±"), `A confirmed exact figure was given a spurious range: ${label}`);
}
{
  const scale = referenceScale({ reference: "a4-paper", referencePixels: 1000 });
  const length = measureFromReference({ subject: "room-length", scale, spanPixels: 20_000 });
  const width = measureFromReference({ subject: "room-width", scale, spanPixels: 15_000 });
  const label = measurementLabel(derivedArea({ length, width }));
  assert(label.includes("m²") && label.includes("±"), `A derived area was written without its band: ${label}`);
}

/* ── Storage refuses a measurement whose provenance is unknown ─────────── */

{
  const stored = normalizedMeasurements([
    { subject: "room-length", method: "reference-calibrated", valueMm: 3400, toleranceMm: 420, reference: "bank-card" },
    { subject: "ceiling-height", method: "user-confirmed", valueMm: 2400, toleranceMm: 0 },
    // No method: worse than no measurement, because it looks like the others.
    { subject: "room-width", valueMm: 2600, toleranceMm: 300 },
    { subject: "room-width", method: "guessed", valueMm: 2600, toleranceMm: 300 },
    // An estimate with no band would read as exact for ever after.
    { subject: "wall-area", method: "reference-calibrated", valueMm: 20_000_000, toleranceMm: 0 },
    // Duplicate subject.
    { subject: "room-length", method: "user-confirmed", valueMm: 9999, toleranceMm: 10 }
  ]);
  assert(stored.length === 2, `Storage kept ${stored.length} measurements rather than the two with usable provenance.`);
  assert(stored[0].subject === "room-length" && stored[0].reference === "bank-card", "A stored measurement lost the reference it came from.");
  assert(stored[1].subject === "ceiling-height" && stored[1].confidence === "high", "A confirmed measurement was downgraded in storage.");
  assert(stored.every((entry) => entry.method && entry.confidence), "A measurement was stored without a method or a confidence.");
}

// A confirmed figure may legitimately carry a zero tolerance; an estimate may not.
{
  const stored = normalizedMeasurements([{ subject: "room-length", method: "user-confirmed", valueMm: 3400, toleranceMm: 0 }]);
  assert(stored.length === 1 && stored[0].toleranceMm === 0, "A confirmed exact figure was rejected by storage.");
}

console.log("Room-measurement checks passed.");
