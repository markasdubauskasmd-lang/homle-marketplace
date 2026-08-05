import { readFile } from "node:fs/promises";
import { checklistChangeReview } from "../public/checklist-change-review.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const [dashboardScript, dashboardMarkup, dashboardStyles] = await Promise.all([
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.css", import.meta.url), "utf8"),
]);

/* ── The module is actually reachable ──────────────────────────────────────
   checklistChangeReview was fully written and covered by tests/checklist-change-
   review.mjs, but NOTHING imported it. It was dead code: the Landlord could edit
   a scanned checklist and approve it with no indication of what they had
   changed. A unit test on a module no page loads proves the maths, not the
   feature — which is exactly how this stayed invisible. */

assert(dashboardScript.includes('import { checklistChangeReview } from "./checklist-change-review.js"'),
  "The Landlord dashboard no longer imports the checklist change review, so a Landlord cannot see what they changed before approving scope.");
assert(dashboardScript.includes("checklistChangeReview(generatedChecklist, lines)"),
  "The change review is imported but never run against the generated checklist.");
assert(dashboardMarkup.includes("data-checklist-changes") && dashboardMarkup.includes("data-checklist-changes-body"),
  "The dashboard has no host element for the checklist diff, so nothing can render into it.");

/* ── The baseline is captured wherever a checklist is generated ───────────
   A diff is only honest if it compares against what was actually generated.
   All three producers — the room scan, the speech summary and a saved property
   checklist — must record their output, or edits to that source silently show
   as "no changes". */
const producers = ["scanned", "spoken", "saved"];
for (const source of producers) {
  assert(dashboardScript.includes(`generatedChecklistSource = "${source}"`),
    `The ${source} checklist does not record itself as the baseline, so the Landlord's edits to it would not be shown.`);
}
assert((dashboardScript.match(/generatedChecklist = /g) || []).length >= 4,
  "Not every checklist producer records its generated output as the comparison baseline.");

/* ── The diff can be undone ───────────────────────────────────────────────── */
assert(dashboardMarkup.includes("data-checklist-restore") && dashboardScript.includes("restoreGeneratedChecklist"),
  "A Landlord who edits the scanned checklist cannot get back to what the scan actually found.");
assert(dashboardScript.includes('checklistRestore?.addEventListener("click", restoreGeneratedChecklist)'),
  "The restore control exists in the markup but is not wired, so it is a dead button.");

/* ── Re-approval is forced whenever the scope changes ─────────────────────
   Editing scope after ticking the confirmation would otherwise carry the old
   approval onto work the Landlord never agreed to. */
assert(dashboardScript.includes("restoreGeneratedChecklist") &&
  /function restoreGeneratedChecklist\(\)[\s\S]{0,400}invalidateScopeReview\(/.test(dashboardScript),
  "Restoring the generated checklist does not clear the existing scope approval.");

/* ── Colour is never the only signal ──────────────────────────────────────
   Added and removed scope are colour-coded, which a red-green colourblind user
   cannot rely on. Each block must also be labelled in words. */
assert(dashboardScript.includes('section("You added"') && dashboardScript.includes('section("You removed"'),
  "Added and removed scope are distinguished only by colour, with no text label.");

/* ── The rendering matches what the module actually returns ───────────────
   Guards against the renderer drifting onto fields the module does not return —
   the failure mode would be a silently empty diff. */
const review = checklistChangeReview(
  ["Kitchen: Degrease the hob", "Bathroom: Remove limescale"],
  ["Kitchen: Degrease the hob", "Bathroom: Descale the shower screen"],
);
assert(review.changed === true, "A real scope change is not reported as changed.");
assert(review.added.length === 1 && review.removed.length === 1,
  "The change review no longer reports added and removed scope in the shape the dashboard renders.");
for (const field of ["changed", "added", "removed", "orderChanged"]) {
  assert(field in review, `The dashboard renders review.${field}, which the module no longer returns.`);
}
const unchanged = checklistChangeReview(["Kitchen: Degrease the hob"], ["Kitchen: Degrease the hob"]);
assert(unchanged.changed === false, "An unedited checklist would show a change panel to every Landlord.");

/* ── Styling exists for the states the renderer emits ─────────────────────── */
for (const rule of [".landlord-checklist-changes", ".landlord-checklist-change-added", ".landlord-checklist-change-removed"]) {
  assert(dashboardStyles.includes(rule), `${rule} is rendered but has no styling.`);
}

console.log("Landlord checklist review tests passed: the change review is imported, run against a recorded baseline from all three generators, rendered with text labels as well as colour, restorable, and re-approval is forced when scope changes.");
