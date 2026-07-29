import {
  measurableSubjects, measurementConfirmation, measurementStep, minimumSpanPixels,
  offeredReferences, pixelDistance, referenceAxisFor
} from "../public/room-measure-model.js";
import { measureFromReference, referenceObjects, referenceScale } from "../src/marketplace/room-measurement.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
const line = (x1, y1, x2, y2) => ({ from: { x: x1, y: y1 }, to: { x: x2, y: y2 } });

/* ── Every offered reference must actually exist server-side ───────────── */

// A reference the server does not know is a dead end the customer only discovers
// after doing the work.
for (const entry of offeredReferences) {
  assert(referenceObjects[entry.reference], `The flow offers "${entry.reference}", which the server cannot scale from.`);
  assert(entry.hint.length > 0, `${entry.reference} is offered with no explanation of what to fetch.`);
}
// The most accurate option is offered first, because most people take the first.
assert(offeredReferences[0].reference === "bank-card", "The most accurate reference is not offered first.");
// The vaguest is offered last and says so.
assert(offeredReferences.at(-1).reference === "interior-door" && /vary/i.test(offeredReferences.at(-1).hint),
  "The least reliable reference does not warn that it varies.");

assert(measurableSubjects.every((entry) => entry.instruction.length > 0), "A measurable subject has no instruction.");

/* ── Geometry ──────────────────────────────────────────────────────────── */

assert(pixelDistance({ x: 0, y: 0 }, { x: 3, y: 4 }) === 5, "Pixel distance was wrong.");
assert(pixelDistance(null, null) === 0 && pixelDistance({ x: "a", y: 0 }, { x: 1, y: 1 }) === 0, "A malformed line produced a distance.");

// A bank card is 85.6mm wide and 54mm tall. Using the wrong figure is a 60%
// error in everything derived from it — larger than any tolerance this reports.
assert(referenceAxisFor({ x: 0, y: 0 }, { x: 100, y: 5 }) === "width", "A horizontal line was not read as the width axis.");
assert(referenceAxisFor({ x: 0, y: 0 }, { x: 5, y: 100 }) === "height", "A vertical line was not read as the height axis.");

/* ── The flow refuses what it cannot measure, at the tap ───────────────── */

assert(measurementStep({}).stage === "reference", "The flow did not start by asking for a reference.");
assert(measurementStep({ reference: "moon" }).stage === "reference", "An unsupported reference was accepted.");
{
  const step = measurementStep({ reference: "bank-card" });
  assert(step.stage === "reference-line" && /bank card/i.test(step.instruction),
    `The flow did not ask for the reference line: ${step.instruction}`);
}
// Two taps almost in the same place are one tap and a wobble, not a line.
{
  const step = measurementStep({ reference: "bank-card", referenceLine: line(10, 10, 20, 10) });
  assert(step.stage === "reference-line" && /same place/i.test(step.problem),
    `A degenerate reference line was accepted: ${JSON.stringify(step)}`);
  assert(minimumSpanPixels > 1, "The minimum span is not a real bound.");
}
{
  const step = measurementStep({ reference: "bank-card", referenceLine: line(10, 10, 200, 10) });
  assert(step.stage === "subject", "The flow did not go on to ask what is being measured.");
}
{
  const step = measurementStep({ reference: "bank-card", referenceLine: line(10, 10, 200, 10), subject: "room-length" });
  assert(step.stage === "subject-line" && /longer wall/i.test(step.instruction), `The subject instruction was wrong: ${step.instruction}`);
}
{
  const step = measurementStep({
    reference: "bank-card", referenceLine: line(10, 10, 200, 10),
    subject: "room-length", subjectLine: line(0, 500, 12, 500)
  });
  assert(/too short/i.test(step.problem), "A two-pixel subject line was accepted.");
}

// A span shorter than the reference means the lines were almost certainly drawn
// the wrong way round: nobody measures a room smaller than a bank card.
{
  const step = measurementStep({
    reference: "bank-card", referenceLine: line(0, 0, 400, 0),
    subject: "room-length", subjectLine: line(0, 500, 100, 500)
  });
  assert(/right way round/i.test(step.problem), `A transposed pair of lines was accepted: ${JSON.stringify(step)}`);
}

/* ── A completed flow hands the server exactly what it needs ────────────── */

{
  const step = measurementStep({
    reference: "bank-card", referenceLine: line(10, 10, 210, 10),
    subject: "room-length", subjectLine: line(0, 500, 4000, 500)
  });
  assert(step.stage === "ready", `A valid flow did not complete: ${JSON.stringify(step)}`);
  assert(step.referencePixels === 200 && step.spanPixels === 4000, "The spans handed over were wrong.");
  assert(step.referenceAxis === "width", "The reference axis was not carried through.");

  // The real test: the server accepts it and produces a labelled measurement.
  // A flow that produces something the maths rejects is a flow that wastes the
  // customer's effort.
  const scale = referenceScale({ reference: step.reference, referencePixels: step.referencePixels, referenceAxis: step.referenceAxis });
  const measurement = measureFromReference({ subject: step.subject, scale, spanPixels: step.spanPixels });
  assert(measurement.usable === true, "A completed flow produced an unusable measurement.");
  assert(measurement.method === "reference-calibrated", "The measurement lost its method.");
  // 200px = 85.6mm, so 4000px is about 1.712m. Nowhere near a real room, but the
  // arithmetic is what is under test.
  assert(Math.abs(measurement.valueMm - 1712) < 5, `The measured value was ${measurement.valueMm}mm.`);
  assert(measurement.toleranceMm > 0, "A reference-calibrated measurement carried no tolerance.");
}

/* ── The band is stated before the number is kept ──────────────────────── */

// Somebody who reads "3.4 metres" and skips "give or take 40 centimetres" has
// been misled by the ordering alone, and this figure can affect what they are
// quoted.
{
  const message = measurementConfirmation({ valueMm: 3400, toleranceMm: 410, usable: true });
  assert(/about/i.test(message), `The estimate was not hedged: ${message}`);
  assert(/give or take 0\.41/.test(message), `The band was not stated in plain words: ${message}`);
  assert(/estimate/i.test(message) && /correct it/i.test(message), `The customer was not invited to correct it: ${message}`);
}
{
  const message = measurementConfirmation({ valueMm: 3400, toleranceMm: 2000, usable: false });
  assert(/could not get a usable measurement/i.test(message), `An unusable measurement was reported as a number: ${message}`);
  assert(/type the size instead/i.test(message), "An unusable measurement offered no way forward.");
}
assert(measurementConfirmation(null) === "" && measurementConfirmation({}) === "", "A missing measurement produced a message.");
// A figure with no band is only ever a confirmed one, and reads plainly.
assert(measurementConfirmation({ valueMm: 2400, toleranceMm: 0, usable: true }) === "2.40 metres.",
  "An exact confirmed figure was hedged.");

console.log("Room measurement capture checks passed.");
