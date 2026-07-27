import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAnthropicRoomVision } from "../src/marketplace/room-vision.mjs";

// Naming a worktop is the easy half. Whether it needs degreasing is what the
// customer is paying for, and it was the half the scanner was worst at: one grade
// for a whole room, a free-text note, no confidence, and no way to say "clean".

const source = readFileSync(new URL("../src/marketplace/room-vision.mjs", import.meta.url), "utf8");
const overlay = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");

function readerReturning(payload) {
  return createAnthropicRoomVision({
    apiKey: "test-key",
    client: { messages: { create: () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(payload) }] }) } }
  });
}
const box = { x: 10, y: 10, width: 20, height: 20 };
const read = (detections, condition = "light") =>
  readerReturning({ condition, detections, tasks: [] }).readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen" });

/* ── Condition is per item, not per room ── */

{
  const result = await read([
    { label: "Worktop", condition: "heavy", soiling: ["grease"], confidence: 0.9, evidence: "dark glossy streaks by the hob", ...box },
    { label: "Window", condition: "light", soiling: ["dust"], confidence: 0.8, evidence: "grey film on the sill", ...box }
  ]);
  assert.equal(result.detections[0].condition, "heavy", "An item's own condition is not reported, so a greasy worktop and a dusty window look identical to whoever prices the job.");
  assert.equal(result.detections[1].condition, "light", "A second item did not keep its own condition.");
  assert.deepEqual([...result.detections[0].soiling], ["grease"], "The kind of soiling is not reported, so nothing distinguishes grease from limescale.");
}

/* ── "Clean" has to be a real answer ── */

// If every named object is implicitly dirty, the assessment is worthless: a
// well-kept home reads the same as a neglected one, and the customer stops
// believing any of it.
{
  const result = await read([{ label: "Sink", condition: "clean", soiling: [], confidence: 0.95, evidence: "", ...box }]);
  assert.equal(result.detections[0].condition, "clean", "A clean object cannot be reported as clean, so the scanner cannot distinguish an object that needs cleaning from one that does not.");
  assert.deepEqual([...result.detections[0].soiling], [], "A clean object carried soiling.");
}

/* ── Uncertainty is not presented as fact ── */

{
  const result = await read([{ label: "Shower screen", condition: "unknown", soiling: [], confidence: 0.2, evidence: "", ...box }]);
  assert.equal(result.detections[0].condition, "", "An 'unknown' condition was turned into a grade. A guess presented as an assessment changes what a customer is charged.");
  assert.equal(result.detections[0].confidence, 0.2, "Low confidence was not carried through, so an uncertain reading looks as definite as a sure one.");
}

// A model that omits confidence must not be treated as fully confident.
{
  const result = await read([{ label: "Hob", condition: "medium", soiling: ["grease"], evidence: "spits around the burners", ...box }]);
  assert.equal(result.detections[0].confidence, 0, "A missing confidence defaulted to certain. Absent evidence of confidence is not evidence of confidence.");
}
for (const [supplied, expected] of [[1.6, 1], [-3, 0], ["0.7", 0.7], [null, 0], ["nonsense", 0]]) {
  const result = await read([{ label: "Bath", condition: "light", soiling: [], confidence: supplied, evidence: "", ...box }]);
  assert.equal(result.detections[0].confidence, expected, `A confidence of ${JSON.stringify(supplied)} was not clamped into 0-1.`);
}

/* ── Labels and categories stay consistent ── */

// Free text produced "limescale", "lime scale", "scale", "water marks" and
// "calcium" for one thing, which nothing downstream could group or price.
{
  const result = await read([{ label: "Tap", condition: "medium", soiling: ["limescale", "water marks", "LIMESCALE", "calcium"], confidence: 0.8, evidence: "white crust at the base", ...box }]);
  assert.deepEqual([...result.detections[0].soiling], ["limescale"], `Soiling types are not constrained to the shared vocabulary: ${JSON.stringify(result.detections[0].soiling)}. Invented and duplicate categories cannot be grouped or priced.`);
}
{
  const result = await read([{ label: "Oven", condition: "filthy", soiling: ["grease"], confidence: 0.9, evidence: "baked-on deposits", ...box }]);
  assert.equal(result.detections[0].condition, "", "A condition outside the shared scale was accepted rather than treated as no assessment.");
}

/* ── The evidence is kept, because it is what makes a grade checkable ── */

{
  const result = await read([{ label: "Shower screen", condition: "medium", soiling: ["soap-scum"], confidence: 0.85, evidence: "cloudy film across the lower half", ...box }]);
  assert.match(result.detections[0].note, /Soap scum/, "The soiling type is not shown to the customer, so they cannot tell what the grade was based on.");
  assert.match(result.detections[0].note, /cloudy film/, "The model's own evidence is discarded, so a wrong grade cannot be argued with.");
}

/* ── The prompt teaches what these things look like ── */

// The model was previously told only "judge condition from visible soiling",
// with no description of any soil type and no definition of the scale — so it
// invented both, differently each time.
for (const term of ["limescale", "grease", "mould", "dust", "soap-scum", "stain"]) {
  assert.ok(source.toLowerCase().includes(term), `The prompt never describes ${term}, so the model has to guess what it looks like in a photograph.`);
}
assert.match(source, /chalky/, "The prompt does not describe limescale's appearance, which is the single most-reported miss.");
assert.match(source, /clean: you can see the surface clearly/, "The prompt does not define 'clean', so the model has no licence to report a tidy home as tidy.");
assert.match(source, /Do not infer condition from the type of object/, "The prompt does not warn against grading from priors — an oven reported heavy because ovens are usually dirty is not an assessment of this oven.");
assert.match(source, /If you cannot name the evidence, you are guessing/, "The prompt does not tie a grade to nameable evidence.");

/* ── The image has to be good enough to judge from ── */

// Limescale, grease film and dust are fine high-frequency texture, and that is
// the first thing downscaling and JPEG discard. At 1280px and quality 0.82 the
// evidence was being destroyed before the model ever saw it, and no prompt could
// recover it.
assert.match(overlay, /1600 \/ Math\.max\(regionWidth, regionHeight\)/, "The frame that condition is graded from was reduced again. Fine texture is the evidence, and it does not survive aggressive downscaling.");
assert.match(overlay, /toDataURL\("image\/jpeg", 0\.9/, "The confirmation frame's JPEG quality was lowered again, which smooths away exactly the speckle and film that distinguish a limescaled tap from a white one.");
assert.match(overlay, /toDataURL\("image\/jpeg", 0\.88\)/, "Item crops were compressed harder. A crop is a close-up of the one item being judged and is the last place to save bytes.");

console.log("Room condition tests passed: every object carries its own condition, soiling type, confidence and evidence; 'clean' and 'unknown' are real answers rather than coerced grades; invented categories and out-of-scale grades are rejected; and the frame condition is judged from is sent at a quality that preserves the texture the judgement depends on.");
