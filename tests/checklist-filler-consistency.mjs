import assert from "node:assert/strict";
import { checklistFromTranscript, normaliseChecklistTask } from "../public/checklist.js";

// The leading-filler rule was written out twice with materially different word lists.
// `checklistFromTranscript` stripped "well", "yeah", "just", "basically", "actually" and
// a dozen more; `normaliseChecklistTask` stripped only six. So the same sentence spoken
// and typed produced two different checklist strings — and because tasks are deduped on
// their normalised text, one task could appear twice on the same checklist.
//
// These pin the two paths agreeing. They are not asserting a particular wording: only
// that whichever way a Landlord expresses an instruction, it lands as the same task.

const spokenPrefixes = [
  "Okay, well,", "Um,", "Erm,", "So,", "Yeah,", "Right,", "Now,", "And",
  "Also,", "Just", "Basically,", "Actually,", "Honestly,", "But", "However,"
];

const instruction = "hoover the lounge";
const baseline = normaliseChecklistTask(instruction);
assert.ok(baseline.length >= 3, `The plain instruction did not survive normalisation: ${JSON.stringify(baseline)}`);

for (const prefix of spokenPrefixes) {
  const typed = normaliseChecklistTask(`${prefix} ${instruction}`);
  assert.equal(
    typed,
    baseline,
    `Leading filler survived normalisation, so the same task typed with and without "${prefix}" becomes two different checklist items and is deduped as two: ${JSON.stringify(typed)} vs ${JSON.stringify(baseline)}`
  );
}

/* ── Both paths must agree, since a checklist mixes tasks from each ── */

for (const prefix of spokenPrefixes) {
  const sentence = `${prefix} ${instruction}.`;
  const [spoken] = checklistFromTranscript(sentence);
  const typed = normaliseChecklistTask(`${prefix} ${instruction}`);
  assert.ok(spoken, `The transcript path produced no task for ${JSON.stringify(sentence)}`);
  assert.equal(
    normaliseChecklistTask(spoken),
    typed,
    `The spoken and typed paths disagree on "${prefix} ${instruction}". A checklist holds tasks from both, so a divergence here shows the Landlord the same instruction twice.`
  );
}

/* ── "right" pointing at a place is not filler ── */

// This is why the rule carries a negative lookahead rather than a plain word list. The
// consolidated exclusion set is the union of the two former copies, so neither path may
// lose a location it used to keep.
for (const location of ["corner", "side", "hand side", "angle", "way", "through", "across", "down", "up", "by", "at", "of the room", "next to the sink"]) {
  const task = normaliseChecklistTask(`right ${location} needs a wipe`);
  assert.match(task, /right/i, `"right ${location}" is the customer pointing at a place, but "right" was stripped as filler: ${JSON.stringify(task)}`);
}

/* ── Filler must not be cut out of the middle of a genuine instruction ── */

for (const [input, keep] of [
  ["Clean the right hand cupboard", /right hand/i],
  ["Wipe down the well in the utility room", /well/i],
  ["Clean just above the hob", /just above/i]
]) {
  const task = normaliseChecklistTask(input);
  assert.match(task, keep, `A genuine word was cut out of the middle of an instruction: ${JSON.stringify(input)} became ${JSON.stringify(task)}`);
}

console.log("Checklist filler-consistency tests passed: leading spoken filler is stripped identically whichever path a task arrives by, so the same instruction never becomes two checklist items, while a locating \"right\" and mid-phrase words are kept.");
