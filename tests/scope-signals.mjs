import assert from "node:assert/strict";
import { detectPriceSensitiveScope } from "../public/scope-signals.js";

// These signals tell an Administrator "this looks like paid, price-sensitive work" and
// feed the confirmation that prices a job. A false positive therefore charges a customer
// for work they explicitly refused, so the exclusion side matters more than the
// detection side.
//
// The regression these pin: the clause-boundary helper sliced one character past the
// delimiter. "Do not clean inside the oven" became "o not clean inside the oven", the
// exclusion guard stopped matching "do not", and the refusal was reported as a request.
// It survived because a ". " delimiter loses only a space and a "Kitchen:" prefix
// supplies its own ": " — but `detectPriceSensitiveScope` joins its inputs with "\n",
// which is exactly the case that broke.

const codes = (input) => detectPriceSensitiveScope(input).map((signal) => signal.code).sort();

/* ── Refusals must never be reported as requested scope ── */

const refusals = [
  { label: "newline-joined checklist", checklist: ["Wipe the worktops", "Do not clean inside the oven"] },
  { label: "second item excluded", checklist: ["Hoover throughout", "Do not clean inside the fridge"] },
  { label: "windows refused", checklist: ["Dust the shelves", "Do not clean the windows"] },
  { label: "refusal in the transcript", transcript: "Wipe the worktops.\nDo not clean inside the oven." },
  { label: "\"skip\" wording", checklist: ["Mop the floor", "Skip cleaning inside the oven"] },
  { label: "room-prefixed refusal", checklist: ["Kitchen: Do not clean inside the oven"] },
  // No delimiter at all before the refusal. This is the case a naive fix breaks: the
  // boundary sentinel must mean "start of string", not "one before the start".
  { label: "refusal is the entire input", transcript: "Do not clean inside the oven" },
  { label: "refusal first, request never made", checklist: ["Do not clean inside the fridge"] },
  { label: "passive leave-alone", transcript: "Leave the windows alone." },
  { label: "does not need cleaning", transcript: "The inside fridge does not need cleaning." }
];

for (const { label, ...input } of refusals) {
  assert.deepEqual(codes({ transcript: "", checklist: [], ...input }), [], `Refused work was reported as requested, priced scope: ${label}`);
}

/* ── Genuine requests must still be reported ── */

const requests = [
  { label: "oven asked for", checklist: ["Wipe the worktops", "Clean inside the oven"], expect: "oven-interior" },
  { label: "windows asked for", checklist: ["Clean the windows please"], expect: "window-cleaning" },
  { label: "room-prefixed request", checklist: ["Kitchen: Clean inside the oven"], expect: "oven-interior" },
  { label: "request stated in speech", transcript: "Please clean inside the oven as well.", expect: "oven-interior" },
  // A refusal of one item must not suppress a request for a different one.
  { label: "one refused, one requested", checklist: ["Do not clean inside the fridge", "Clean inside the oven"], expect: "oven-interior" }
];

for (const { label, expect, ...input } of requests) {
  const found = codes({ transcript: "", checklist: [], ...input });
  assert.ok(found.includes(expect), `A genuine request stopped being detected (${label}): got ${JSON.stringify(found)}`);
}

// The mixed case both ways round, since the fix is about clause boundaries and order
// is exactly what a boundary bug is sensitive to.
const mixed = codes({ transcript: "", checklist: ["Clean inside the oven", "Do not clean inside the fridge"] });
assert.ok(mixed.includes("oven-interior"), `The requested oven was lost when a refusal followed it: ${JSON.stringify(mixed)}`);
assert.ok(!mixed.includes("fridge-freezer-interior"), `The refused fridge was reported as requested: ${JSON.stringify(mixed)}`);

/* ── Shape handling ── */

assert.deepEqual(codes({}), [], "Empty input invented a signal.");
assert.deepEqual(codes({ transcript: null, checklist: null, photos: null }), [], "Null input was not handled.");
assert.deepEqual(codes({ checklist: "not an array" }), [], "A non-array checklist was not handled.");
assert.ok(Array.isArray(detectPriceSensitiveScope({})), "The result is not an array.");
// Photo notes are part of the source text and must honour a refusal too.
assert.deepEqual(codes({ photos: [{ note: "Do not clean inside the oven" }] }), [], "A refusal written on a photo note was reported as requested scope.");
assert.ok(codes({ photos: [{ note: "Clean inside the oven" }] }).includes("oven-interior"), "A request written on a photo note was missed.");

console.log("Price-sensitive scope tests passed: refusals are never reported as requested work — including a refusal with no preceding delimiter, one after a newline, a room-prefixed one and one on a photo note — while genuine requests, and requests mixed with an unrelated refusal in either order, are still detected.");
