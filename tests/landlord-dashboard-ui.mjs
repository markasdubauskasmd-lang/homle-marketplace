import { readFile } from "node:fs/promises";
import { moneyToPence, requestStatusLabel, requestTasksFromLines, requestedWindow, tasksToLines } from "../public/landlord-dashboard-model.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function throws(operation, expected) {
  try { operation(); } catch (error) { return String(error.message).includes(expected); }
  return false;
}

const tasks = requestTasksFromLines("Kitchen: Wipe the worktops\nBathroom: Remove limescale");
assert(tasks.length === 2 && tasks[0].roomName === "Kitchen" && tasks[1].description === "Remove limescale" && tasksToLines(tasks) === "Kitchen: Wipe the worktops\nBathroom: Remove limescale", "Room-labelled draft tasks were not parsed and displayed losslessly.");
assert(throws(() => requestTasksFromLines("Wipe the worktops"), "must start with a room") && throws(() => requestTasksFromLines("Kitchen: Wipe sink\nKitchen: Wipe sink"), "unique"), "Unlabelled or duplicate request tasks were accepted.");
const now = new Date("2026-07-16T08:00:00.000Z");
const window = requestedWindow("2026-07-20", "10:00", 180, now);
assert(Date.parse(window.requestedEndAt) - Date.parse(window.requestedStartAt) === 180 * 60_000 && throws(() => requestedWindow("2026-07-15", "10:00", 180, now), "future"), "The draft request window lost its exact duration or accepted past work.");
assert(moneyToPence("125.50") === 12550 && moneyToPence("") === null && throws(() => moneyToPence("12.999"), "two decimal"), "Draft budget did not convert to exact integer pence or reject ambiguous decimals.");
assert(requestStatusLabel("draft").includes("scan not submitted") && requestStatusLabel("invented") === "Status unavailable", "Request status copy can imply unsupported progress.");

const [page, script, model, styles, server, authEntry] = await Promise.all([
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard-model.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/auth-entry.js", import.meta.url), "utf8")
]);

assert(server.includes('"/landlord/dashboard": "landlord-dashboard.html"') && page.includes('data-landlord-workspace hidden') && page.includes('data-landlord-state'), "The Landlord route or fail-closed initial workspace is missing.");
assert(script.includes('requestJson("/api/marketplace/account")') && script.includes('requestJson("/api/marketplace/properties")') && script.includes('requestJson("/api/marketplace/cleaning-requests")') && script.includes('"X-CSRF-Token": csrf'), "The workspace is not bound to authenticated account/owner records and CSRF-protected writes.");
assert(script.includes('method: "POST"') && script.includes('submit: false') && page.includes("Matching stays off") && page.includes("cannot start matching") && page.includes("cannot invite a Cleaner, confirm a booking or take payment"), "The account workspace can silently submit a request or imply a booking/payment.");
assert(page.includes('href="/request">Start working room scan</a>') && page.includes("photo/video storage is intentionally closed") && page.includes("Speech to concise bullets") && script.includes("checklistFromTranscript") && script.includes("scopeReviewed"), "The workspace downgraded the room scan, omitted truthful media limits or lost speech/checklist review.");
assert(script.includes("textContent") && script.includes("replaceChildren") && !script.includes("innerHTML") && script.includes("beforeunload") && script.includes("window.confirm"), "Private account records can enter unsafe HTML or forms lack unsaved/destructive-change protection.");
assert(page.includes('name="accessInstructions"') && page.includes("kept protected") && page.includes('name="savedChecklist"') && page.includes('name="requiredServices"') && page.includes('name="budget"'), "The property or request form omits protected access, saved scope, services or budget fields.");
assert(authEntry.includes('return "/cleaner/profile"') && authEntry.includes('return "/landlord/dashboard"') && authEntry.includes("openSignedInWorkspace"), "Email or social sign-in cannot hand an established account into its real role workspace.");
assert(styles.includes(".landlord-dashboard-page") && styles.includes(".landlord-speech-scope") && styles.includes("@media (max-width: 720px)") && page.includes('aria-live="polite"'), "The Landlord workspace lacks mobile or accessible feedback styling.");
assert(!/(Jane|Sarah|Maria|John|five-star|fully insured|background checked|DBS checked)/i.test(`${page}\n${script}\n${model}`), "The real Landlord workspace contains an invented person or unsupported trust claim.");

console.log("Landlord dashboard UI tests passed: owner APIs, role handoff, exact draft scope, speech bullets, scan-first boundary, safe rendering and mobile accessibility.");
