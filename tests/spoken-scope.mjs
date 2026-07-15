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

console.log("Spoken scope tests passed: natural room transitions, condition-to-action bullets, narration suppression, explicit exclusions and price-sensitive scope isolation.");
