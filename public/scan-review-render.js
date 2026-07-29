// Turns an assessed scan into what the customer reads at the review step.
//
// Pure: takes the preview response, returns plain data for the DOM. Kept free of
// the DOM so the wording rules below are testable, because they are the whole
// point of this file — the review step is the one place a customer is asked to
// check what the scan got wrong, and every decision here is about not
// overstating what we know.

const conditionWords = Object.freeze({
  clean: "looks clean", light: "light", medium: "needs proper attention", heavy: "heavily soiled"
});

const soilingWords = Object.freeze({
  dust: "dust", grease: "grease", limescale: "limescale", stain: "staining", mould: "mould",
  "soap-scum": "soap scum", "food-debris": "food debris", "pet-hair": "pet hair",
  damage: "damage", clutter: "clutter"
});

export function money(pence) {
  const amount = Number(pence);
  if (!Number.isFinite(amount)) return "";
  return `£${(Math.round(amount) / 100).toFixed(2)}`;
}

/**
 * The price line.
 *
 * Always a range, and the range is the headline rather than a footnote. A single
 * number would be read as a quote, and the estimate's own uncertainty is the
 * thing a customer most needs to see before they agree to anything.
 */
export function priceSummary(estimate) {
  if (!estimate?.priceable) return null;
  return {
    total: money(estimate.totalPence),
    range: estimate.lowPence === estimate.highPence
      ? ""
      : `Likely ${money(estimate.lowPence)}–${money(estimate.highPence)}`,
    lines: (Array.isArray(estimate.lines) ? estimate.lines : []).map((line) => ({
      label: String(line?.label || ""),
      // Signed, so a reduction reads as a reduction. A condition discount shown
      // as a positive number would look like a surcharge.
      amount: `${Number(line?.pence) < 0 ? "−" : ""}${money(Math.abs(Number(line?.pence) || 0))}`
    }))
  };
}

/**
 * One object, described the way its owner would recognise it.
 *
 * A confidence score is deliberately never shown. "0.31" is not information to
 * somebody looking at their own kitchen; "we could not tell — can you check?" is.
 */
export function objectSummary(object) {
  const label = String(object?.label || "").trim();
  const quantity = Number(object?.quantity);
  const displayLabel = Number.isInteger(quantity) && quantity > 1 ? `${quantity} × ${label}` : label;
  const kinds = (Array.isArray(object?.soiling) ? object.soiling : [])
    .map((kind) => soilingWords[kind]).filter(Boolean);
  const condition = String(object?.condition || "");

  let state;
  if (object?.needsConfirmation) state = "We could not tell";
  else if (!condition) state = "Not assessed";
  else state = conditionWords[condition] || condition;

  return {
    objectId: object?.objectId ?? "",
    inventoryKey: object?.inventoryKey ?? "",
    label,
    displayLabel,
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
    condition,
    state,
    // Named soiling, then the evidence. "Limescale — white deposits around the
    // tap base" is checkable against the actual tap; "medium" is not.
    detail: [kinds.join(", "), String(object?.evidence || "").trim()].filter(Boolean).join(" — "),
    needsConfirmation: object?.needsConfirmation === true,
    // Only what a person can sensibly answer about their own home. Confidence,
    // origin and identity keys are not offered for editing.
    editable: Object.freeze(["label", "condition", "quantity", "removed"])
  };
}

export function roomSummary(room) {
  const objects = (Array.isArray(room?.objects) ? room.objects : []).map(objectSummary);
  return {
    roomName: String(room?.roomName || ""),
    // The room grade is deliberately not shown as a number or a level. It is the
    // per-object findings a customer can actually check, and a whole-room grade
    // invites arguing with a summary instead of correcting the detail.
    objects,
    unresolvedCount: objects.filter((object) => object.needsConfirmation).length,
    measurements: (Array.isArray(room?.measurements) ? room.measurements : [])
      .filter((measurement) => measurement?.confidence !== "unusable")
      .map((measurement) => String(measurement?.label || "")).filter(Boolean)
  };
}

/**
 * The whole review.
 *
 * Returns `assessed: false` rather than an empty shell when there is nothing to
 * show, so the caller hides the panel instead of rendering a review of nothing.
 */
export function scanReview(scan) {
  const complexity = scan?.complexity;
  if (!complexity?.assessed) {
    return Object.freeze({ assessed: false, rooms: Object.freeze([]), questions: Object.freeze([]), price: null, refusal: "" });
  }
  const rooms = (Array.isArray(scan.rooms) ? scan.rooms : []).map(roomSummary);
  const estimate = scan.estimate;
  return Object.freeze({
    assessed: true,
    level: complexity.level,
    levelLabel: complexity.levelLabel,
    levelScale: `Level ${complexity.level} of 5`,
    explanation: complexity.explanation,
    // Said plainly. A level presented as settled when the scan is unsure about
    // half of it is the confident-but-wrong assessment this whole feature was
    // built to avoid.
    provisional: complexity.provisional === true
      ? complexity.questions?.length
        ? "This is a first read. Answering the questions below will settle it."
        : "This is a first read — the scan was not certain about some of what it saw."
      : "",
    rooms: Object.freeze(rooms),
    questions: Object.freeze((Array.isArray(complexity.questions) ? complexity.questions : []).map((question) => Object.freeze({
      code: question.code, roomName: question.roomName, question: question.question,
      objectIds: Object.freeze(Array.isArray(question.objectIds) ? [...question.objectIds] : [])
    }))),
    price: priceSummary(estimate),
    // A refusal is shown, not hidden behind a missing price. Somebody whose
    // property needs looking at first is better served by being told than by an
    // estimate quietly failing to appear.
    refusal: estimate && estimate.priceable === false ? String(estimate.reason || "") : "",
    ratesNote: estimate?.rulesetVersion
      ? `Worked out from Homle's published rates (version ${estimate.rulesetVersion}).`
      : ""
  });
}

/**
 * Applies a customer's correction to the in-memory scan.
 *
 * The originals are kept and the correction recorded separately, so the scan
 * that reaches the server is what was detected and the correction is replayed
 * against it afterwards. That is what makes the original detection survive as a
 * training label instead of being overwritten by the truth the customer
 * asserted.
 */
export function applyCorrection(rooms, { roomName, inventoryKey, field, value }) {
  const nextRooms = [];
  const recorded = [];
  for (const room of Array.isArray(rooms) ? rooms : []) {
    if (String(room?.name ?? room?.roomName ?? "") !== roomName) {
      nextRooms.push(room);
      continue;
    }
    const objects = [];
    for (const object of Array.isArray(room?.objects) ? room.objects : []) {
      if (object?.inventoryKey !== inventoryKey) {
        objects.push(object);
        continue;
      }
      if (field === "removed") {
        recorded.push({ roomName, inventoryKey, field, originalValue: String(object.label ?? ""), value: "removed" });
        continue;
      }
      const originalValue = String(object[field] ?? "");
      recorded.push({ roomName, inventoryKey, field, originalValue, value: String(value ?? "") });
      // A customer renaming an object settles its identity; it does not tell us
      // anything about the surface condition, which keeps its own score.
      objects.push(field === "label"
        ? { ...object, label: value, confidenceLabel: 1, origin: "manual" }
        : field === "condition"
          ? { ...object, condition: value, conditionConfirmed: true, confidenceCondition: 1 }
          : { ...object, quantity: Number(value) });
    }
    nextRooms.push({ ...room, objects });
  }
  return { rooms: nextRooms, corrections: recorded };
}
