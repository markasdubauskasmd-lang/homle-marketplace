import { cleanerHandoffPreview, isChecklistExclusion, splitChecklistTask, wholePropertyLabel } from "../public/cleaner-handoff-preview.js";
import { briefReadiness, briefRoomOptions } from "../public/brief-readiness.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const preview = cleanerHandoffPreview({
  photographedAreas: ["Kitchen", "Bathroom", "Kitchen"],
  roomOptions: briefRoomOptions,
  tasks: [
    "Kitchen: Wipe the worktops",
    "Kitchen: Do not clean inside the oven",
    "Bathroom: Do not move the toiletries",
    "Do not move the keys",
    "Hallway: Vacuum the floor"
  ]
});

assert(preview.groups.map((group) => group.room).join("|") === `Kitchen|Bathroom|${wholePropertyLabel}|Hallway`, "Cleaner preview did not preserve photographed-room priority and task order.");
assert(preview.workCount === 2 && preview.exclusionCount === 3, "Cleaner preview mixed cleaning work with leave-alone boundaries.");
assert(preview.groups[0].work[0] === "Wipe the worktops" && preview.groups[0].exclusions[0] === "Do not clean inside the oven", "Room prefix or instruction content was lost.");
assert(preview.missingWorkAreas.join(",") === "Bathroom", "A photographed room with only an exclusion was treated as cleanable scope.");
assert(isChecklistExclusion("Do not move the keys") && isChecklistExclusion("Leave the cupboard alone") && !isChecklistExclusion("Clean the cupboard"), "Checklist exclusion classification is unsafe.");
assert(splitChecklistTask("Bathroom 2: Mop the floor", briefRoomOptions).room === "Bathroom 2", "Longest canonical room prefix was not selected.");

const exclusionOnlyReadiness = briefReadiness({
  requestId: "REQ-1234ABCD",
  email: "customer@example.com",
  transcript: "In the kitchen do not clean inside the oven.",
  tasks: ["Kitchen: Do not clean inside the oven"],
  photos: [{ area: "Kitchen", note: "Oven is excluded" }],
  checklistCurrent: true,
  scopeCompleteConfirmed: true,
  consent: true
});
assert(!exclusionOnlyReadiness.checks.conciseTasks && !exclusionOnlyReadiness.checks.roomCoverage && exclusionOnlyReadiness.uncoveredAreas[0] === "Kitchen", "Exclusions alone passed as a quotable photographed-room scope.");
assert(exclusionOnlyReadiness.items.find((item) => item.key === "conciseTasks")?.label.includes("exclusions alone"), "The customer was not told why exclusion-only scope is incomplete.");

console.log("Cleaner handoff preview tests passed: room grouping, boundary isolation, photographed-room coverage and exclusion-only blocking.");
