import { readFile } from "node:fs/promises";
import { applyCorrection, money, objectSummary, priceSummary, roomSummary, scanReview } from "../public/scan-review-render.js";
import { assessCleaningComplexity } from "../src/marketplace/cleaning-complexity.mjs";
import { estimateScanPrice } from "../src/marketplace/scan-pricing.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

const object = (inventoryKey, condition, extra = {}) => ({
  objectId: inventoryKey, inventoryKey, label: inventoryKey, quantity: 1, condition, soiling: [],
  confidenceLabel: 0.9, confidenceCondition: 0.9, conditionConfirmed: false, evidence: "", origin: "vision",
  needsConfirmation: false, ...extra
});
function assessed(rooms) {
  const complexity = assessCleaningComplexity({ rooms });
  return { rooms, complexity, estimate: estimateScanPrice({ rooms, complexity }) };
}

assert(money(2800) === "£28.00" && money(0) === "£0.00" && money("x") === "", "Money was not formatted.");

/* ── Nothing to review means no review, not an empty one ───────────────── */

// A review panel with nothing in it teaches people to scroll past the one place
// they are asked to check what we got wrong.
{
  const review = scanReview({ rooms: [], complexity: assessCleaningComplexity({ rooms: [] }) });
  assert(review.assessed === false, "An unassessed scan produced a review.");
  assert(review.rooms.length === 0 && review.questions.length === 0 && review.price === null, "An unassessed scan produced content.");
}

/* ── A confidence score is never shown to a customer ───────────────────── */

// "0.31" is not information to somebody looking at their own kitchen.
// "We could not tell — can you check?" is.
{
  const uncertain = objectSummary(object("hob", "", { needsConfirmation: true, confidenceCondition: 0.31 }));
  assert(uncertain.state === "We could not tell", `An uncertain object was described as "${uncertain.state}".`);
  assert(!JSON.stringify(uncertain).includes("0.31"), "A confidence score reached the customer-facing summary.");
  const confident = objectSummary(object("hob", "heavy", { soiling: ["grease"], evidence: "dark streaks around the burners" }));
  assert(confident.state === "heavily soiled", `A heavy object was described as "${confident.state}".`);
  // Named soiling then evidence, because "limescale — white deposits around the
  // tap base" is checkable against the actual tap and "medium" is not.
  assert(confident.detail === "grease — dark streaks around the burners", `The detail read "${confident.detail}".`);
}

// A grade the scan is sure of is not dressed up as a question.
{
  const clean = objectSummary(object("fridge", "clean"));
  assert(clean.state === "looks clean" && clean.needsConfirmation === false, "A clean object was flagged for checking.");
}

// Proven quantity reaches the customer so they can correct it.
{
  const many = objectSummary(object("chair", "medium", { quantity: 4 }));
  assert(many.displayLabel === "4 × chair" && many.quantity === 4, "A grouped quantity was lost.");
}

/* ── The recommendation is owned, and only follows a settled finding ───── */

// "Descale the tap" answers "what will be done about it". It comes from the
// deterministic mapping — never from model output — and never accompanies a
// verdict the review is still asking the customer to confirm.
{
  const limescaled = objectSummary(object("tap", "medium", { soiling: ["limescale"], evidence: "white deposits at the base" }));
  assert(limescaled.recommendation === "Descale the tap", `The finding produced "${limescaled.recommendation}" instead of the action a cleaner would take.`);
  const unsure = objectSummary(object("tap", "medium", { soiling: ["limescale"], needsConfirmation: true }));
  assert(unsure.recommendation === "", "An unconfirmed finding carried a recommendation, scheduling work the scan is not sure exists.");
  const clean = objectSummary(object("fridge", "clean"));
  assert(clean.recommendation === "", "A clean object carried a cleaning recommendation.");
}

// Only what a person can sensibly answer about their own home is editable.
{
  const editable = objectSummary(object("hob", "light")).editable;
  assert(editable.includes("label") && editable.includes("condition") && editable.includes("quantity") && editable.includes("removed"),
    "The customer cannot correct what they should be able to.");
  assert(!editable.includes("confidenceCondition") && !editable.includes("origin") && !editable.includes("inventoryKey"),
    "The customer was offered fields they cannot meaningfully judge.");
}

/* ── The price is a range, and the range is the headline ───────────────── */

// A single number would be read as a quote, and the estimate's own uncertainty
// is what a customer most needs before agreeing to anything.
{
  const review = scanReview(assessed([{ roomName: "Kitchen", measurements: [], objects: [
    object("hob", "heavy", { soiling: ["grease"] }), object("worktop", "medium", { soiling: ["grease"] })
  ] }]));
  assert(review.price, "A priceable scan produced no price.");
  assert(/^£/.test(review.price.total) && /Likely £/.test(review.price.range), `The price range was missing: ${JSON.stringify(review.price)}`);
  assert(review.price.lines.length > 0, "The price had no breakdown.");
  assert(review.ratesNote.includes("published rates"), "The review did not say where the rates came from.");
}

// A reduction must read as a reduction. A condition discount shown positive
// would look like a surcharge.
{
  const tidy = scanReview(assessed([{ roomName: "Bedroom", measurements: [], objects: [object("bed", "clean"), object("floor", "clean")] }]));
  const condition = tidy.price.lines.find((line) => /Light maintenance/.test(line.label));
  assert(condition && condition.amount.startsWith("−"), `A discount was not shown as a reduction: ${JSON.stringify(condition)}`);
}

assert(priceSummary({ priceable: false }) === null, "A refused estimate produced a price.");

/* ── A refusal is shown, not a missing price ───────────────────────────── */

// Somebody whose property needs looking at first is better served by being told
// than by an estimate quietly failing to appear.
{
  const review = scanReview(assessed([{ roomName: "Bathroom", measurements: [], objects: [
    object("sealant", "heavy", { soiling: ["mould"], confidenceCondition: 0.92 })
  ] }]));
  assert(review.price === null, "A specialist-review scan was given a price.");
  assert(review.refusal.length > 0 && /mould/i.test(review.refusal), `The refusal did not explain itself: ${review.refusal}`);
  assert(review.level === 5 && review.levelScale === "Level 5 of 5", "The level was not stated on its scale.");
}

/* ── An unsettled level says so ────────────────────────────────────────── */

// A level presented as settled when the scan is unsure about half of it is the
// confident-but-wrong assessment this feature exists to avoid.
{
  const review = scanReview(assessed([{ roomName: "Kitchen", measurements: [], objects: [
    object("hob", "", { needsConfirmation: true, confidenceCondition: 0 }),
    object("sink", "light", { needsConfirmation: true, confidenceCondition: 0.1 })
  ] }]));
  assert(review.provisional.length > 0, "An unsettled level was presented as settled.");
  assert(review.questions.length > 0 && review.questions[0].question.length > 0, "An unsettled level asked nothing.");
  assert(review.rooms[0].unresolvedCount === 2, "The room did not report how much was unclear.");
}
{
  const settled = scanReview(assessed([{ roomName: "Bedroom", measurements: [], objects: [object("bed", "light"), object("floor", "light")] }]));
  assert(settled.provisional === "", "A settled level was hedged anyway.");
  assert(settled.questions.length === 0, "A settled scan invented a question.");
}

/* ── Unusable measurements are not shown ───────────────────────────────── */

{
  const summary = roomSummary({ roomName: "Kitchen", objects: [], measurements: [
    { subject: "room-length", confidence: "high", label: "Length 3.4m, confirmed by you" },
    { subject: "room-width", confidence: "unusable", label: "Width 2.6m ± 1.8m" }
  ] });
  assert(summary.measurements.length === 1 && /confirmed by you/.test(summary.measurements[0]),
    "An unusable measurement was shown to the customer.");
}

/* ── Corrections keep the original ─────────────────────────────────────── */

// The scan that reaches the server is what was detected; the correction is
// replayed against it. That is what makes the original detection survive as a
// training label instead of being overwritten by the truth the customer asserted.
{
  const rooms = [{ name: "Kitchen", objects: [
    { inventoryKey: "tap", label: "Tap", condition: "light", quantity: 1, confidenceLabel: 0.7, confidenceCondition: 0.8 },
    { inventoryKey: "sink", label: "Sink", condition: "light", quantity: 1 }
  ] }];

  const renamed = applyCorrection(rooms, { roomName: "Kitchen", inventoryKey: "tap", field: "label", value: "Bathroom tap" });
  assert(renamed.rooms[0].objects[0].label === "Bathroom tap", "A rename was not applied.");
  assert(renamed.corrections[0].originalValue === "Tap", "The original label was not recorded.");
  // Renaming settles identity, not surface condition.
  assert(renamed.rooms[0].objects[0].confidenceLabel === 1, "A rename did not settle label confidence.");
  assert(renamed.rooms[0].objects[0].confidenceCondition === 0.8, "A rename overwrote unrelated condition confidence.");
  assert(renamed.rooms[0].objects[0].origin === "manual", "A renamed object was not marked as customer-corrected.");

  const graded = applyCorrection(rooms, { roomName: "Kitchen", inventoryKey: "tap", field: "condition", value: "heavy" });
  assert(graded.rooms[0].objects[0].conditionConfirmed === true, "A customer grade was not marked confirmed.");
  assert(graded.corrections[0].originalValue === "light", "The original grade was not recorded.");
  // The mirror of the rename case, and it matters for the same reason: grading a
  // surface says nothing about whether the object was named correctly, so the
  // label's own score must survive untouched.
  assert(graded.rooms[0].objects[0].confidenceLabel === 0.7, "A grade correction overwrote unrelated label confidence.");
  assert(graded.rooms[0].objects[0].label === "Tap", "A grade correction changed the object's name.");

  const counted = applyCorrection(rooms, { roomName: "Kitchen", inventoryKey: "sink", field: "quantity", value: "3" });
  assert(counted.rooms[0].objects[1].quantity === 3, "A quantity correction was not applied.");

  const removed = applyCorrection(rooms, { roomName: "Kitchen", inventoryKey: "tap", field: "removed" });
  assert(removed.rooms[0].objects.length === 1, "A removed object survived.");
  // A rejected detection is the most informative label there is.
  assert(removed.corrections[0].field === "removed" && removed.corrections[0].originalValue === "Tap",
    "Removing an object destroyed the record that it was rejected.");

  // Other rooms and other objects are untouched.
  const other = applyCorrection([...rooms, { name: "Bathroom", objects: [{ inventoryKey: "bath", label: "Bath" }] }],
    { roomName: "Kitchen", inventoryKey: "tap", field: "removed" });
  assert(other.rooms[1].objects.length === 1, "A correction in one room changed another.");
  const missing = applyCorrection(rooms, { roomName: "Nowhere", inventoryKey: "tap", field: "removed" });
  assert(missing.corrections.length === 0 && missing.rooms[0].objects.length === 2, "A correction to an unknown room changed something.");
}

/* ── The page and its wiring ───────────────────────────────────────────── */

const [page, script] = await Promise.all([
  readFile(new URL("../public/landlord-journey.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-journey.js", import.meta.url), "utf8")
]);

assert(/data-review[^-]/.test(page), "The journey has no review panel.");
assert(/data-review\b[^>]*hidden/.test(page), "The review panel is not hidden until there is something to review.");
assert(page.includes("data-review-question-list"), "The review panel cannot ask the customer anything.");
assert(page.includes("data-review-breakdown"), "The review panel cannot show how the price was worked out.");
// The word that stops an estimate being read as a quote.
assert(/not a quote/i.test(page), "The review panel does not say the price is an estimate rather than a quote.");
assert(/nothing is charged/i.test(page), "The review panel does not say nothing is charged yet.");
assert(script.includes("/api/marketplace/landlord/scan-preview"), "The journey never asks for an assessment.");
assert(script.includes("applyCorrection"), "The journey cannot apply a customer correction.");
// Rendering a customer-entered object name as markup would make the one screen
// they are asked to correct into an injection surface.
//
// The page has pre-existing `innerHTML = ""` clears and static templates with no
// interpolation, which are safe. What must never appear is an innerHTML
// assignment carrying an interpolated value.
for (const match of script.matchAll(/innerHTML\s*=\s*(.+)/g)) {
  const assigned = match[1];
  assert(!assigned.includes("${"), `An interpolated value is assigned as innerHTML: ${assigned.slice(0, 80)}`);
}
// The review renderer itself writes text, never markup.
const reviewSection = script.slice(script.indexOf("function renderReviewLevel"), script.indexOf("async function saveStructuredScan"));
assert(reviewSection.length > 500, "The review renderer was not found in the journey.");
assert(!/innerHTML/.test(reviewSection), "The review renderer assigns innerHTML.");
assert(/textContent/.test(reviewSection), "The review renderer does not write text content.");


/* ── A scan lost to one dropped response is lost for good ──────────────── */

// It lives only in this tab's memory and is deliberately never written to
// browser storage, so the save is retried rather than attempted once.
assert(/saveStructuredScanWithRetry/.test(script), "The scan save is not retried.");
assert(/attempt \* 700/.test(script), "The retry has no backoff.");
// The scan is idempotent by session id, which is what makes retrying safe.
assert(script.includes("state.scanSessionId"), "The retry has no stable session id, so a retry could duplicate the scan.");
// And when it ultimately fails, the customer is told rather than reassured.
assert(/could not be, so your cleaner will work from the checklist alone/.test(script),
  "A failed scan save is reported as success.");

/* ── Restrictions are persisted in their own shape ─────────────────────── */

// A restriction stored as a checklist task is an operational hazard, and the
// checklist text is where that mistake would be impossible to undo.
assert(script.includes("/voice-instructions"), "Classified spoken instructions are never persisted.");
assert(/saveVoiceInstructions\(csrf, requestId\)/.test(script), "Spoken instructions are not saved with the scan.");

console.log("Customer scan-review checks passed.");
