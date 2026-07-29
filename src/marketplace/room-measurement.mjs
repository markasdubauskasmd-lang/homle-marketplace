// Room measurement for a web application with no depth sensor.
//
// Phase 5 of docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md, under the web-only decision
// recorded in its §11. RoomPlan, ARKit and ARCore Depth are unreachable from a
// web page, so there is no `sensor-measured` path and this module does not
// pretend otherwise.
//
// What is left is genuinely useful and genuinely imprecise: an object of known
// real size in the same frame gives a scale, and that scale gives everything
// else in the same plane. The whole design of this module is about making the
// imprecision explicit rather than rounding it away.
//
// The rule the vision reader states twice and this module exists to honour:
// "Never estimate floor area, room dimensions or measurements. You cannot
// measure from a photograph and a wrong figure would misprice the job." That
// rule stands for a *bare* photograph. A photograph with a bank card in it is a
// different problem — but only if the answer carries how wrong it can be.
//
// Every value produced here has a `method`, a `confidence` and a `toleranceMm`.
// There is no code path that produces a measurement without them.

export const measurementMethods = Object.freeze([
  // A known-size object in the same frame supplied the scale.
  "reference-calibrated",
  // A person entered or corrected the figure. The most accurate method
  // available to a web application, and the only one that can be called settled.
  "user-confirmed",
  // Derived from other measurements — floor area from length and width.
  "derived",
  // Reserved and currently unreachable. Nothing in a web application can
  // produce it; it exists so that adding a native path later is a code change
  // rather than a migration on a table that already holds customer data.
  "sensor"
]);

export const measurementSubjects = Object.freeze([
  "room-length", "room-width", "ceiling-height", "floor-area", "wall-area"
]);

// Reference objects, with the real-world uncertainty of each.
//
// The uncertainty is the point. A bank card is manufactured to a standard and
// is exact to a fraction of a millimetre. A "standard" UK internal door is
// standard only by convention and varies by tens of millimetres between houses.
// Treating those two as equally good references would produce two answers with
// the same stated confidence and very different real accuracy.
export const referenceObjects = Object.freeze({
  // ISO/IEC 7810 ID-1. Every bank and credit card in the customer's wallet.
  "bank-card": Object.freeze({ label: "Bank card", widthMm: 85.6, heightMm: 53.98, uncertaintyMm: 0.5 }),
  // ISO 216. Exact, and most homes have one.
  "a4-paper": Object.freeze({ label: "A4 sheet", widthMm: 210, heightMm: 297, uncertaintyMm: 2 }),
  // BS 4787 convention. Common, large — which helps — but genuinely variable.
  "interior-door": Object.freeze({ label: "Internal door", widthMm: 762, heightMm: 1981, uncertaintyMm: 40 }),
  // BS EN 1996 co-ordinating size. Only useful where brick is exposed.
  "brick": Object.freeze({ label: "Brick", widthMm: 215, heightMm: 65, uncertaintyMm: 10 }),
  // BS 1363 faceplate. Present in every UK room and a known fixed size.
  "socket-faceplate": Object.freeze({ label: "Plug socket", widthMm: 86, heightMm: 86, uncertaintyMm: 3 })
});

// The floor under any reference-calibrated tolerance, whatever the arithmetic
// says.
//
// A single frame cannot know whether the reference and the thing being measured
// are the same distance from the lens. A bank card held 200mm nearer the phone
// than the wall behind it is reported as a larger card, and everything scaled
// from it comes out proportionally small. The guidance asks the customer to
// hold the reference flat against the surface being measured, and most people
// will roughly do that — but "roughly" is exactly what this floor represents.
// Arithmetic on pixel widths cannot see the error, so it is added by hand.
export const minimumReferenceRelativeTolerance = 0.12;

// Below this the reference is too small in frame for its pixel width to mean
// anything: a card occupying 8 pixels measured to ±1 pixel is already ±12%
// before perspective is considered.
export const minimumReferencePixelSize = 40;

// A measurement worse than this is not worth showing. Reporting "between 1.8
// and 6.2 metres" is not a measurement, it is a way of appearing to answer.
export const maximumUsableRelativeTolerance = 0.35;

function positiveNumber(value) {
  const supplied = Number(value);
  return Number.isFinite(supplied) && supplied > 0 ? supplied : 0;
}

function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// Confidence bands, from how wide the tolerance actually is. Deliberately
// pessimistic wording: nothing a web application measures is "high" confidence
// in the sense a laser rangefinder is, and the top band here is "medium".
export function measurementConfidence(method, relativeTolerance) {
  if (method === "user-confirmed") return "high";
  if (!Number.isFinite(relativeTolerance) || relativeTolerance > maximumUsableRelativeTolerance) return "unusable";
  if (relativeTolerance <= 0.15) return "medium";
  return "low";
}

/**
 * Scale from a known-size reference visible in the same frame.
 *
 * Returns millimetres-per-pixel plus the relative uncertainty of that scale,
 * which every measurement derived from it inherits.
 */
export function referenceScale({ reference, referencePixels, referenceAxis = "width" } = {}) {
  const definition = referenceObjects[String(reference || "")];
  if (!definition) throw new TypeError("Choose a supported reference object.");
  const pixels = positiveNumber(referencePixels);
  if (pixels < minimumReferencePixelSize) {
    throw new TypeError(`The ${definition.label.toLowerCase()} is too small in the picture to measure from. Move closer and try again.`);
  }
  const realMm = referenceAxis === "height" ? definition.heightMm : definition.widthMm;
  // Two independent sources of error in the scale itself:
  //   - how well the real object matches its nominal size;
  //   - how well the box around it matches its true edges, taken as one pixel
  //     at each edge, which is optimistic for a hand-drawn box and about right
  //     for a detector.
  const dimensionalError = definition.uncertaintyMm / realMm;
  const pixelError = 2 / pixels;
  return Object.freeze({
    reference: String(reference),
    referenceLabel: definition.label,
    millimetresPerPixel: realMm / pixels,
    relativeUncertainty: dimensionalError + pixelError
  });
}

/**
 * One reference-calibrated measurement.
 *
 * Assumes the reference and the measured span lie in the same plane, at the
 * same distance from the lens. That assumption is the dominant error and is
 * why `minimumReferenceRelativeTolerance` exists.
 */
export function measureFromReference({ subject, scale, spanPixels } = {}) {
  if (!measurementSubjects.includes(String(subject || ""))) throw new TypeError("Choose a supported measurement subject.");
  if (!scale || !positiveNumber(scale.millimetresPerPixel)) throw new TypeError("A reference scale is required.");
  const pixels = positiveNumber(spanPixels);
  if (!pixels) throw new TypeError("A measured span is required.");
  const valueMm = pixels * scale.millimetresPerPixel;
  const relative = Math.max(
    minimumReferenceRelativeTolerance,
    positiveNumber(scale.relativeUncertainty) + 2 / pixels
  );
  const confidence = measurementConfidence("reference-calibrated", relative);
  return Object.freeze({
    subject: String(subject),
    method: "reference-calibrated",
    valueMm: Math.round(valueMm),
    toleranceMm: Math.round(valueMm * relative),
    relativeTolerance: roundTo(relative, 4),
    confidence,
    // A measurement too vague to be worth showing says so rather than being
    // quietly displayed with a wide band nobody reads.
    usable: confidence !== "unusable",
    reference: scale.reference,
    referenceLabel: scale.referenceLabel
  });
}

/**
 * A figure a person entered or corrected.
 *
 * The most accurate method a web application has, and the only one that may be
 * called settled — but still not exact, because people estimate too. The
 * tolerance is small and non-zero on purpose: a stated zero would make a typed
 * figure look like a laser reading.
 */
export function userConfirmedMeasurement({ subject, valueMm, toleranceMm } = {}) {
  if (!measurementSubjects.includes(String(subject || ""))) throw new TypeError("Choose a supported measurement subject.");
  const value = positiveNumber(valueMm);
  if (!value) throw new TypeError("A measurement must be a positive length.");
  if (value > 100_000) throw new TypeError("That measurement is outside the range this supports.");
  const tolerance = Number.isFinite(Number(toleranceMm)) && Number(toleranceMm) >= 0
    ? Math.round(Number(toleranceMm))
    : Math.round(value * 0.05);
  return Object.freeze({
    subject: String(subject),
    method: "user-confirmed",
    valueMm: Math.round(value),
    toleranceMm: tolerance,
    relativeTolerance: roundTo(tolerance / value, 4),
    confidence: "high",
    usable: true,
    reference: "",
    referenceLabel: ""
  });
}

/**
 * Floor area from a length and a width.
 *
 * Relative tolerances add. Two measurements each good to ±12% produce an area
 * good to ±24%, and that compounding is exactly why a floor area estimated from
 * a photograph must never be quoted as a figure. It is reported, with its band,
 * or it is not reported.
 */
export function derivedArea({ length, width } = {}) {
  if (!length?.valueMm || !width?.valueMm) throw new TypeError("Two measured lengths are required to derive an area.");
  const areaMm2 = length.valueMm * width.valueMm;
  const relative = positiveNumber(length.relativeTolerance) + positiveNumber(width.relativeTolerance);
  // Derived from two confirmed figures is still confirmed; derived from
  // anything estimated is not, whatever the arithmetic works out to.
  const bothConfirmed = length.method === "user-confirmed" && width.method === "user-confirmed";
  const confidence = bothConfirmed ? "high" : measurementConfidence("derived", relative);
  return Object.freeze({
    subject: "floor-area",
    method: "derived",
    valueMm: Math.round(areaMm2),
    // Square metres to one decimal place, because a floor area good to ±24% has
    // no business being reported to the square centimetre.
    squareMetres: roundTo(areaMm2 / 1_000_000, 1),
    toleranceSquareMetres: roundTo((areaMm2 * relative) / 1_000_000, 1),
    toleranceMm: Math.round(areaMm2 * relative),
    relativeTolerance: roundTo(relative, 4),
    confidence,
    usable: confidence !== "unusable",
    derivedFrom: Object.freeze([length.method, width.method])
  });
}

const subjectWords = Object.freeze({
  "room-length": "Length", "room-width": "Width", "ceiling-height": "Ceiling height",
  "floor-area": "Floor area", "wall-area": "Wall area"
});

const methodWords = Object.freeze({
  "reference-calibrated": "estimated from a %s in the photo",
  "user-confirmed": "confirmed by you",
  derived: "worked out from the length and width",
  sensor: "measured by the device"
});

/**
 * How a measurement is written for a customer.
 *
 * Always a range, never a single number, unless a person confirmed it. "3.4m
 * ± 0.4m, estimated from a bank card in the photo" tells the truth in the same
 * space that "3.4m" tells a lie.
 */
export function measurementLabel(measurement) {
  if (!measurement?.subject) return "";
  const subject = subjectWords[measurement.subject] || measurement.subject;
  const method = String(methodWords[measurement.method] || "").replace("%s", (measurement.referenceLabel || "reference").toLowerCase());
  if (measurement.subject === "floor-area") {
    const area = roundTo(measurement.valueMm / 1_000_000, 1);
    const band = roundTo((measurement.valueMm * measurement.relativeTolerance) / 1_000_000, 1);
    return band > 0
      ? `${subject} ${area}m² ± ${band}m², ${method}`
      : `${subject} ${area}m², ${method}`;
  }
  const metres = roundTo(measurement.valueMm / 1000, 2);
  const band = roundTo(measurement.toleranceMm / 1000, 2);
  return band > 0 ? `${subject} ${metres}m ± ${band}m, ${method}` : `${subject} ${metres}m, ${method}`;
}

/**
 * Normalises a client-supplied measurement set for storage.
 *
 * Anything without a supported method and subject is dropped rather than
 * stored with a guessed method. A measurement whose provenance is unknown is
 * worse than no measurement: it looks like the others.
 */
export function normalizedMeasurements(value) {
  const supplied = Array.isArray(value) ? value : [];
  const kept = [];
  const seen = new Set();
  for (const entry of supplied.slice(0, 20)) {
    const subject = String(entry?.subject || "");
    const method = String(entry?.method || "");
    if (!measurementSubjects.includes(subject) || !measurementMethods.includes(method)) continue;
    // 'sensor' is unreachable in a web application. A client claiming it would
    // be claiming an accuracy no browser can deliver, so it is refused at the
    // boundary rather than trusted and stored.
    if (method === "sensor") continue;
    if (seen.has(subject)) continue;
    const valueMm = positiveNumber(entry?.valueMm);
    if (!valueMm || valueMm > 100_000_000) continue;
    const toleranceMm = Math.max(0, Math.round(positiveNumber(entry?.toleranceMm)));
    const relativeTolerance = roundTo(toleranceMm / valueMm, 4);
    // A stored measurement with a zero tolerance and an estimated method would
    // read as exact for ever after. Estimated methods must carry a band.
    if (method !== "user-confirmed" && !toleranceMm) continue;
    seen.add(subject);
    kept.push(Object.freeze({
      subject,
      method,
      valueMm: Math.round(valueMm),
      toleranceMm,
      relativeTolerance,
      confidence: measurementConfidence(method, relativeTolerance),
      reference: measurementMethods.includes(method) && referenceObjects[String(entry?.reference || "")] ? String(entry.reference) : ""
    }));
  }
  return Object.freeze(kept);
}
