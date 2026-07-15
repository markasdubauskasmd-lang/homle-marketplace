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

console.log("Spoken scope tests passed: explicit Cleaner exclusions, mixed requested work and price-sensitive scope isolation.");
