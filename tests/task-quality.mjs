import { cleanerTaskGuidance, cleanerTaskQuality, unclearCleanerTasks } from "../public/task-quality.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const task of [
  "Kitchen: Wipe the worktops",
  "Bathroom: Remove limescale",
  "Bedroom: Vacuum",
  "Whole property: Empty the bins",
  "Kitchen: Do not clean inside the oven",
  "Bathroom: Skip the locked cupboard"
]) assert(cleanerTaskQuality(task).clear, `A concise, actionable Cleaner instruction was rejected: ${task}`);

for (const task of [
  "Kitchen",
  "Kitchen: test",
  "Kitchen: clean everything",
  "Bathroom: as discussed",
  "Bedroom: bbbbbcv",
  "Hallway: needs attention",
  "Kitchen: clean"
]) assert(!cleanerTaskQuality(task).clear, `An unclear or placeholder Cleaner instruction was accepted: ${task}`);

const unclear = unclearCleanerTasks(["Kitchen: Wipe the worktops", "Bathroom: test", "Bedroom: clean everything"]);
assert(unclear.length === 2 && unclear[0].index === 1 && cleanerTaskGuidance.includes("specific Cleaner action"), "Unclear task reporting lost its exact rows or useful correction guidance.");

console.log("Task quality tests passed: concise cleaning actions and boundaries remain valid while vague, placeholder and non-actionable checklist items are blocked.");
