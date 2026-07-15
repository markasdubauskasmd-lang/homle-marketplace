import { checklistChangeReview } from "../public/checklist-change-review.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const changed = checklistChangeReview(
  ["Kitchen: Wipe the worktops", "Kitchen: Mop the floor", "Do not move the keys"],
  ["Kitchen: Wipe the worktops", "Kitchen: Clean the hob", "Do not move the keys"]
);
assert(changed.changed && changed.added[0] === "Kitchen: Clean the hob" && changed.removed[0] === "Kitchen: Mop the floor" && changed.unchangedCount === 2, "Checklist comparison did not isolate added, removed and unchanged scope.");

const same = checklistChangeReview(["Kitchen: Wipe worktops"], ["  kitchen:   wipe worktops  ", "Kitchen: Wipe worktops"]);
assert(!same.changed && same.next.length === 1, "Harmless checklist whitespace or duplicates triggered a replacement review.");

const reordered = checklistChangeReview(["Kitchen: Wipe", "Kitchen: Mop"], ["Kitchen: Mop", "Kitchen: Wipe"]);
assert(reordered.changed && reordered.orderChanged && !reordered.added.length && !reordered.removed.length, "A pure order change was silently applied over the customer's checklist.");

const removal = checklistChangeReview(["Kitchen: Wipe", "Bathroom: Clean"], []);
assert(removal.changed && removal.removed.length === 2 && removal.next.length === 0, "An empty proposed summary did not preserve a complete removal warning.");

console.log("Checklist change-review tests passed: added/removed scope, harmless equality, order review and empty-summary preservation.");
