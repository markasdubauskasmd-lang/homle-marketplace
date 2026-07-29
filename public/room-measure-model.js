// Turning two taps on a photo into a measurement.
//
// Phase 5 built the maths and the storage; nothing asked the customer for the
// two things it needs. This is that ask, reduced to the smallest honest form: a
// known-size object in the picture, and a line across the thing being measured.
//
// Pure, so the geometry and the wording can be tested without a canvas. The
// tolerance arithmetic itself lives in src/marketplace/room-measurement.mjs and
// is not duplicated here — this module produces pixel spans and hands them over.

// Deliberately short. A list of fifteen reference objects is a list nobody reads;
// these are the ones actually to hand in a British home, cheapest error first.
export const offeredReferences = Object.freeze([
  { reference: "bank-card", label: "A bank card", hint: "Any card from your wallet. The most accurate thing you have." },
  { reference: "a4-paper", label: "A sheet of A4", hint: "Printer paper. Exact size, and easy to hold flat." },
  { reference: "socket-faceplate", label: "A plug socket", hint: "Already on the wall — nothing to fetch." },
  { reference: "interior-door", label: "An internal door", hint: "Useful for a whole wall, but doors vary between houses." }
]);

export const measurableSubjects = Object.freeze([
  { subject: "room-length", label: "Length of the room", instruction: "Draw a line along the longer wall, at floor level." },
  { subject: "room-width", label: "Width of the room", instruction: "Draw a line along the shorter wall, at floor level." },
  { subject: "ceiling-height", label: "Ceiling height", instruction: "Draw a line straight up from the floor to the ceiling." }
]);

// Two taps closer than this are almost certainly one tap and a wobble, not a
// line. Accepting them would produce a span of a few pixels and a tolerance so
// wide the measurement is refused anyway — better to say so at the tap.
export const minimumSpanPixels = 24;

export function pixelDistance(from, to) {
  const dx = Number(to?.x) - Number(from?.x);
  const dy = Number(to?.y) - Number(from?.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Which axis of the reference the customer measured across.
 *
 * A bank card laid flat is 85.6mm wide and 54mm tall, and using the wrong figure
 * is a 60% error in everything derived from it — far larger than any tolerance
 * this reports. So the axis is inferred from the line they actually drew rather
 * than assumed.
 */
export function referenceAxisFor(from, to) {
  const dx = Math.abs(Number(to?.x) - Number(from?.x));
  const dy = Math.abs(Number(to?.y) - Number(from?.y));
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return "width";
  return dy > dx ? "height" : "width";
}

/**
 * Validates one step of the flow and says what to do next, in the customer's
 * words.
 *
 * Returns a `problem` rather than throwing: this runs on every tap, and an
 * exception per mis-tap would be noise.
 */
export function measurementStep({ reference, referenceLine, subject, subjectLine } = {}) {
  if (!offeredReferences.some((entry) => entry.reference === reference)) {
    return { stage: "reference", problem: "", instruction: "Choose something in the photo whose size we already know." };
  }
  const referenceSpan = referenceLine ? pixelDistance(referenceLine.from, referenceLine.to) : 0;
  if (!referenceLine) {
    const chosen = offeredReferences.find((entry) => entry.reference === reference);
    return { stage: "reference-line", problem: "", instruction: `Tap each end of the ${chosen.label.replace(/^A(n)? /i, "").toLowerCase()} in the photo.` };
  }
  if (referenceSpan < minimumSpanPixels) {
    return { stage: "reference-line", problem: "Those two taps were almost in the same place. Tap each end of it.", instruction: "" };
  }
  const chosenSubject = measurableSubjects.find((entry) => entry.subject === subject);
  if (!chosenSubject) {
    return { stage: "subject", problem: "", instruction: "What are we measuring?" };
  }
  const subjectSpan = subjectLine ? pixelDistance(subjectLine.from, subjectLine.to) : 0;
  if (!subjectLine) return { stage: "subject-line", problem: "", instruction: chosenSubject.instruction };
  if (subjectSpan < minimumSpanPixels) {
    return { stage: "subject-line", problem: "That line was too short to measure from. Try again.", instruction: chosenSubject.instruction };
  }
  // A span shorter than the reference means the customer is measuring something
  // smaller than a bank card and calling it a room. Almost always the two lines
  // were drawn the wrong way round.
  if (subjectSpan < referenceSpan) {
    return {
      stage: "subject-line",
      problem: "That looks smaller than the object you measured against. Check you drew the lines the right way round.",
      instruction: chosenSubject.instruction
    };
  }
  return {
    stage: "ready",
    problem: "",
    instruction: "",
    reference,
    referenceAxis: referenceAxisFor(referenceLine.from, referenceLine.to),
    referencePixels: referenceSpan,
    subject,
    spanPixels: subjectSpan
  };
}

/**
 * What the customer is told before the number is kept.
 *
 * The band is stated first and in plain words. Somebody who reads "3.4 metres"
 * and skips the "give or take 40 centimetres" has been misled by the ordering
 * alone, and this figure can affect what they are quoted.
 */
export function measurementConfirmation(measurement) {
  if (!measurement?.valueMm) return "";
  const metres = (measurement.valueMm / 1000).toFixed(2);
  const band = (measurement.toleranceMm / 1000).toFixed(2);
  if (!measurement.usable) {
    return "We could not get a usable measurement from that photo. You can type the size instead, or skip it.";
  }
  return Number(band) > 0
    ? `About ${metres} metres, give or take ${band}. That is an estimate from the photo — correct it if you know the real size.`
    : `${metres} metres.`;
}
