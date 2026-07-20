import { checklistFromTranscript, normaliseChecklistTask } from "../public/checklist.js";
import { detectPriceSensitiveScope } from "../public/scope-signals.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const exclusions = checklistFromTranscript("In the kitchen, don't clean inside the oven, wipe the worktops, and no need to clean inside the fridge. In the bedroom, skip cleaning the wardrobe interior and vacuum the floor.");
assert(JSON.stringify(exclusions) === JSON.stringify([
  "Kitchen: Do not clean inside the oven",
  "Kitchen: Wipe the worktops",
  "Kitchen: Do not clean inside the fridge",
  "Bedroom: Do not clean the wardrobe interior",
  "Bedroom: Vacuum the floor"
]), `Spoken exclusions were not converted into concise room-labelled safety instructions alongside valid tasks: ${JSON.stringify(exclusions)}`);

assert(normaliseChecklistTask("dont move the keys") === "Do not move the keys", "A speech-recognition apostrophe omission changed an exclusion into an unclear task.");
assert(normaliseChecklistTask("skip cleaning the oven") === "Do not clean the oven", "A spoken skip instruction was not made explicit for the Cleaner.");
assert(normaliseChecklistTask("the oven doesn't need cleaning") === "Do not clean the oven", "A passive contracted exclusion was not converted into a direct Cleaner instruction.");

const naturalWalkthrough = checklistFromTranscript("This is the kitchen. Please wipe the worktops and mop the floor. We're moving into the bathroom now. The shower screen needs wiping and disinfect the toilet. Next is the living room. Dust the shelves and vacuum the rug.");
assert(JSON.stringify(naturalWalkthrough) === JSON.stringify([
  "Kitchen: Wipe the worktops",
  "Kitchen: Mop the floor",
  "Bathroom: Wipe the shower screen",
  "Bathroom: Disinfect the toilet",
  "Living room: Dust the shelves",
  "Living room: Vacuum the rug"
]), `Natural room-transition narration became a Cleaner task or lost its room context: ${JSON.stringify(naturalWalkthrough)}`);

const compactWalkthrough = checklistFromTranscript("Moving into the kitchen, wipe the worktops and mop the floor. Now the bathroom, scrub the bath and clean the toilet.");
assert(JSON.stringify(compactWalkthrough) === JSON.stringify([
  "Kitchen: Wipe the worktops",
  "Kitchen: Mop the floor",
  "Bathroom: Scrub the bath",
  "Bathroom: Clean the toilet"
]), `Compact spoken room transitions were not converted into room-labelled tasks: ${JSON.stringify(compactWalkthrough)}`);

const describedConditions = checklistFromTranscript("This is the kitchen. There is grease around the hob and crumbs on the worktops. The sink is full of dishes. Please mop the floor. Moving into the bathroom. Lots of limescale on the shower screen, marks on the mirror and the toilet is dirty. That is everything in here.");
assert(JSON.stringify(describedConditions) === JSON.stringify([
  "Kitchen: Degrease around the hob",
  "Kitchen: Remove crumbs from the worktops",
  "Kitchen: Wash the dishes in the sink",
  "Kitchen: Mop the floor",
  "Bathroom: Remove limescale from the shower screen",
  "Bathroom: Remove marks from the mirror",
  "Bathroom: Clean the toilet"
]), `Supported condition descriptions did not become direct Cleaner actions or pure narration leaked into the checklist: ${JSON.stringify(describedConditions)}`);

const passiveBoundaryInstruction = checklistFromTranscript("Now the bedroom. Clothes on the floor should be left alone. There is dust on the shelves. Bedding needs changing.");
assert(JSON.stringify(passiveBoundaryInstruction) === JSON.stringify([
  "Bedroom: Leave Clothes on the floor alone",
  "Bedroom: Dust the shelves",
  "Bedroom: Change Bedding"
]), `Condition speech or a passive leave-alone boundary became unsafe or ambiguous: ${JSON.stringify(passiveBoundaryInstruction)}`);

const excludedOnly = detectPriceSensitiveScope({
  transcript: "Do not clean inside the oven. The inside fridge does not need cleaning. Everything except inside the cupboards. Leave the windows alone.",
  checklist: ["Kitchen: Do not clean inside the oven", "Kitchen: Do not clean inside the fridge"]
});
assert(excludedOnly.length === 0, "Explicitly excluded work incorrectly triggered price-sensitive cleaning time.");

const mixed = detectPriceSensitiveScope({ transcript: "Do not clean inside the oven, but clean inside the fridge and change the bed linen." }).map((signal) => signal.code);
assert(JSON.stringify(mixed) === JSON.stringify(["fridge-freezer-interior", "linen-laundry"]), "A nearby exclusion hid later requested work or still priced the excluded item.");

const photoExclusion = detectPriceSensitiveScope({ photos: [{ note: "Oven interior is out of scope" }, { note: "Clean the windows" }] }).map((signal) => signal.code);
assert(JSON.stringify(photoExclusion) === JSON.stringify(["window-cleaning"]), "A room-photo exclusion incorrectly entered the price-sensitive scope.");
assert(detectPriceSensitiveScope({ transcript: "Inside the oven isn't included. Cleaning inside the fridge isn't necessary." }).length === 0, "Contracted passive exclusions incorrectly triggered price-sensitive scope.");

// Browser speech recognition emits a continuous stream with almost no
// punctuation. Every case below is written the way it is actually dictated,
// because the earlier tests only covered tidy written sentences and the feature
// therefore passed while producing unusable bullets for real speakers.
const dictated = checklistFromTranscript("so the kitchen needs a proper clean the worktops are really greasy and the hob has burnt on stuff the floor needs mopping as well");
assert(dictated.includes("Kitchen: Degrease the worktops"), "A described condition in unpunctuated speech did not become the cleaning action it implies.");
assert(dictated.includes("Kitchen: Remove burnt-on residue from the hob") && dictated.includes("Kitchen: Mop the floor"), "Unpunctuated speech fused several instructions into one bullet instead of separating them.");
assert(dictated.every((task) => !/\b(?:and|but|or|then)$/i.test(task)), "A bullet ended on a dangling connective, so it reads as an unfinished sentence.");

// The worst possible failure here is sending a Cleaner to the wrong room.
const rooms = checklistFromTranscript("start in the living room hoover the carpet and dust the shelves then the bedroom just change the sheets and the hallway needs a quick mop");
assert(rooms.includes("Bedroom: Change the sheets"), "A bare spoken room change was missed, so one room's work stayed attributed to the previous room.");
assert(rooms.includes("Hallway: Mop the floor") && !rooms.some((task) => /^Living room: .*(?:hallway|sheets)/i.test(task)), "Work was attributed to the wrong room, which would send the Cleaner to the wrong part of the property.");
assert(!rooms.some((task) => /^(?:Start|Then|Next)$/i.test(task)), "A navigation fragment was published as if it were a cleaning task.");

// A room word can modify a surface rather than announce a room.
const modifier = checklistFromTranscript("clean the kitchen floor and wipe the kitchen worktops");
assert(modifier.length === 2 && modifier.every((task) => task.startsWith("Clean the kitchen floor") || task.startsWith("Wipe the kitchen worktops")), "A room word used to describe a surface was mistaken for a room change.");

// Filler, restatement and self-correction are how people actually talk.
const messy = checklistFromTranscript("um right so basically the bathroom yeah it's the shower screen it's got loads of limescale on it and erm the toilet needs doing properly and the mirror is all smudged");
assert(messy.includes("Bathroom: Remove limescale from the shower screen"), "Spoken filler and pronoun restatement were left inside the bullet.");
assert(messy.includes("Bathroom: Clean the toilet") && messy.includes("Bathroom: Polish the mirror"), "A fixture named inside a room was treated as a room change, moving later work out of the room it belongs to.");
assert(messy.every((task) => !/\b(?:um|erm|yeah|basically)\b/i.test(task)), "Spoken filler survived into the Cleaner's checklist.");

const corrected = checklistFromTranscript("the kitchen the kitchen needs doing sorry I mean the worktops need wiping down and also the kitchen floor mopping");
assert(corrected.includes("Kitchen: Wipe the worktops"), "A self-correction kept the abandoned false start instead of what the speaker meant.");
assert(corrected.includes("Kitchen: Mop the floor"), "Abandoning a false start also discarded the room the speaker was standing in.");

// Safety-critical: an exclusion must never be absorbed into the instruction it
// contradicts. An earlier version turned "the oven has grease but don't clean
// it" into "Degrease the oven" — the opposite of what the customer asked for,
// on an item that is separately priced.
const contradicted = checklistFromTranscript("in the kitchen the oven has grease but don't clean it");
assert(contradicted.some((task) => /^Kitchen: Do not clean the oven$/.test(task)), `A spoken exclusion was lost or inverted into an instruction: ${JSON.stringify(contradicted)}`);
assert(checklistFromTranscript("in the kitchen don't clean inside the oven").every((task) => !/^Kitchen: Clean inside the oven$/.test(task)), "A negation was split from its verb, publishing the opposite of the exclusion.");

// An instruction following a described condition must not be swallowed by it.
const followOn = checklistFromTranscript("in the kitchen the hob has grease wipe the worktops");
assert(followOn.includes("Kitchen: Wipe the worktops") && followOn.includes("Kitchen: Degrease the hob"), `An instruction spoken after a condition was silently dropped: ${JSON.stringify(followOn)}`);

// Location words decide whether an oven interior or only its exterior was
// requested, which is a different job at a different price.
assert(checklistFromTranscript("in the kitchen inside of the oven needs cleaning").some((task) => /inside/i.test(task)), "A location qualifier was stripped, turning an interior clean into a generic one.");
assert(checklistFromTranscript("behind the large sofa needs vacuuming").some((task) => /behind/i.test(task)), "A location qualifier was stripped from the instruction.");

// Continuous speech runs imperatives together with no connective at all.
const runOn = checklistFromTranscript("in the kitchen wipe the worktops mop the floor clean the oven");
assert(runOn.length === 3 && runOn.includes("Kitchen: Mop the floor"), `Consecutive spoken imperatives were not separated: ${JSON.stringify(runOn)}`);

// Real one-word instructions must survive; navigation fragments must not.
assert(checklistFromTranscript("in the bedroom vacuum").includes("Bedroom: Vacuum"), "A valid one-word instruction was discarded as a stray fragment.");

// Scope words change the price, so they are never flattened into each other.
assert(checklistFromTranscript("in the hallway give it a quick clean").includes("Hallway: Quick clean"), "A quick clean was silently upgraded to a thorough one.");
assert(checklistFromTranscript("in the hallway give it a deep clean").includes("Hallway: Deep clean"), "A deep clean was silently reduced to a generic one.");

// A location word is not filler.
assert(checklistFromTranscript("in the bedroom right corner needs dusting").some((task) => /right corner/i.test(task)), "A spoken location was removed as if it were filler.");

// An explicit move word announces a room even when a surface or state follows.
assert(checklistFromTranscript("in the lounge clean the table then the bedroom floor mopping").includes("Bedroom: Mop the floor"), "An explicit room change was blocked by the surface guard and attributed to the previous room.");
assert(checklistFromTranscript("start in the bathroom clean the bath then the toilet needs a proper clean").some((task) => task.startsWith("Toilet:")), "An explicit move to a separate toilet room was forced back into the previous room.");
assert(checklistFromTranscript("the kitchen sorry I mean the bathroom clean the shower").includes("Bathroom: Clean the shower"), "A self-corrected room name kept the room the speaker abandoned.");

// An inferred method must suit the surface it is applied to.
assert(checklistFromTranscript("in the living room the painted wall is smudged").includes("Living room: Wipe the painted wall"), "An inferred method was prescribed that does not suit the surface described.");

// A negation must survive every way speech can separate it from its verb.
// Phone keyboards and speech engines emit a typographic apostrophe, which is
// the form that previously slipped through and published the affirmative.
for (const refusal of [
  "in the kitchen don’t clean the oven",
  "in the kitchen don't, clean the oven",
  "in the kitchen don't ever clean the oven",
  "in the kitchen clean the hob but do not also clean the oven"
]) {
  const result = checklistFromTranscript(refusal);
  assert(!result.some((task) => /^Kitchen: Clean the oven$/.test(task)), `A refusal was published as an instruction to do the work: ${JSON.stringify(result)}`);
  assert(result.some((task) => /do not/i.test(task) && /oven/i.test(task)), `A refusal was dropped instead of being recorded against the oven: ${JSON.stringify(result)}`);
  assert(!result.some((task) => /^Kitchen: Do ?n[o']?t$/i.test(task)), `A bare negation was published with nothing attached to it: ${JSON.stringify(result)}`);
}

// A pronoun exclusion belongs to the room it was spoken in.
assert(checklistFromTranscript("in the kitchen clean the oven. in the bathroom don't clean it").every((task) => !/^Bathroom: Do not clean the oven$/.test(task)), "An exclusion inherited a target from a different room.");
// The method is not the target: excluding "it" excludes the item, not one way of cleaning it.
assert(checklistFromTranscript("in the kitchen clean the oven with degreaser but don't clean it").includes("Kitchen: Do not clean the oven"), "A total exclusion was narrowed to a method-specific one.");

// Control markers are internal. Text that looks like one must be inert.
const spoofed = checklistFromTranscript("in the kitchen clean the ~~ROOMSWITCH~~ label and wipe the ~~NEGATION~~ shelf");
assert(spoofed.every((task) => !/~~/.test(task)), `An internal control marker reached a published bullet: ${JSON.stringify(spoofed)}`);
assert(spoofed.every((task) => task.startsWith("Kitchen:")), "Text resembling a control marker was able to force a room change.");

// One-word instructions are real instructions.
for (const single of ["wipe", "wash", "empty", "rinse", "degrease", "vacuum"]) {
  assert(checklistFromTranscript(`in the kitchen ${single}`).length === 1, `The one-word instruction "${single}" was silently discarded.`);
}

console.log("Spoken scope tests passed: natural room transitions, condition-to-action bullets, narration suppression, explicit exclusions, unpunctuated dictation, correct room attribution, filler and self-correction handling, and price-sensitive scope isolation.");
