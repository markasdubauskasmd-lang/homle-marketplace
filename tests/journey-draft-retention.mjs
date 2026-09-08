/*
 * The booking journey's local draft must not outlive the retention the product
 * promises for it.
 *
 * `public/privacy.html` tells the customer that an incomplete cleaning request
 * keeps its property scope, timing, access and contact entries in the current
 * browser tab "for up to 30 minutes", and is removed after successful
 * submission, EXPIRY, explicit discard or tab closure. The same promise appears
 * on the landing page and the Landlord dashboard.
 *
 * `landlord-journey.js` wrote no timestamp and read none, so the draft lived for
 * the life of the tab. Ten sibling draft modules implement the expiry; the
 * journey — the one that holds the most, including the address, the access
 * notes and the dictated transcript — was the outlier. That is a published
 * retention statement the code did not honour, which is a legal exposure rather
 * than a UX nit, so it is asserted here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { landlordRequestDraftLifetimeMs } from "../public/landlord-request-draft.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const journey = read("public/landlord-journey.js");

/* ── The promise, read from the pages that make it ── */

const promises = [
  ["public/privacy.html", "the privacy notice"],
  ["public/home.html", "the landing page"],
  ["public/landlord-dashboard.html", "the Landlord dashboard"]
];
for (const [path, where] of promises) {
  assert.match(
    read(path).replace(/\s+/g, " "),
    /up to 30 minutes/,
    `${where} no longer states the 30-minute draft retention. If the promise changed, this test and the lifetime constant must change with it — do not delete the assertion to make it pass.`
  );
}
assert.equal(
  landlordRequestDraftLifetimeMs,
  30 * 60 * 1000,
  "The shared draft lifetime no longer matches the 30 minutes the product promises its customers."
);

/* ── The journey honours it ── */

assert.match(
  journey,
  /import \{ landlordRequestDraftLifetimeMs \}/,
  "The booking journey no longer imports the shared draft lifetime. Restating the number is how one promise becomes two."
);
assert.match(
  journey,
  /savedAt,\s*expiresAt:\s*savedAt \+ landlordRequestDraftLifetimeMs/,
  "The booking journey saves its draft without an expiry stamp, so nothing can tell whether it is inside the promised window."
);

// The read path is the one that matters: a stamp nobody checks is decoration.
const restore = journey.slice(journey.indexOf("function restoreDraft()"), journey.indexOf("// A finished room scan hands its checklist here."));
assert.match(restore, /Date\.now\(\) < expiresAt/, "The booking journey restores a draft without checking it has not expired.");
assert.match(restore, /discardDraft\(\)/, "An expired draft is not discarded, so it stays in storage past the promised window even if it is not shown.");
assert.match(
  restore,
  /expiresAt === savedAt \+ landlordRequestDraftLifetimeMs/,
  "The journey accepts any expiry a stored draft claims. A draft carrying a longer window than the product promises must be refused, not honoured."
);
assert.match(
  restore,
  /Date\.now\(\) >= savedAt - 5 \* 60 \* 1000/,
  "A draft stamped in the future is accepted. A clock change must not extend the retention window."
);

/* ── And on the way out ── */

assert.ok(
  journey.includes("function discardDraft()") && (journey.match(/discardDraft\(\)/g) || []).length >= 3,
  "The journey no longer has one owner for discarding the draft — it is defined once and used on expiry and on successful submission."
);

console.log("Journey draft retention tests passed: the 30-minute promise is stated on all three pages that make it, the shared lifetime matches it, and the booking journey stamps its draft, refuses one that is expired, unstamped, over-long or future-dated, and discards it in every case.");


// The property check must not carry another account's private draft into a new session.
{
  const { default: vm } = await import("node:vm");
  const now = Date.now();
  let stored = JSON.stringify({ step: "results", savedAt: now, expiresAt: now + landlordRequestDraftLifetimeMs,
    draft: { propertyId: "account-a-property", durationMinutes: 120, tasks: ["Kitchen: Synthetic account A task"],
      transcript: "Synthetic account A access note" } });
  const state = { step: "postcode", draft: { propertyId: "", durationMinutes: 120, tasks: [], transcript: "" }, properties: [] };
  const context = vm.createContext({ state, Date, JSON, Number, draftKey: "homle_journey_draft",
    landlordRequestDraftLifetimeMs, durationChoices: [120],
    sessionStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; }, removeItem: () => { stored = null; } },
    stepIndex: step => ["postcode", "service", "results", "when", "cleaner", "checkout"].indexOf(step),
    normalisedPostcode: value => value ? { full: value } : null,
    el: { accessRetry: {}, accessSignIn: {}, accessTitle: {}, accessCopy: {}, accessGate: {}, journeyShell: [] },
    loadAccount: async () => {
      state.properties = [{ propertyId: "account-b-property", exactAddress: { postcode: "SW1A 1AA" } }];
      return { status: "ready" };
    },
    location: { replace() { throw new Error("Unexpected redirect"); } },
    showJourneyAccessFailure() { throw new Error("Unexpected access failure"); }
  });
  const section = (from, until) => journey.slice(journey.indexOf(from), journey.indexOf(until, journey.indexOf(from)));
  vm.runInContext(section("function saveDraft()", "// A finished room scan hands its checklist here.")
    + section("function setRequestScopeValue(", "function currentNoteLines(")
    + section("async function openAuthenticatedJourney()", "/* ── Wiring"), context);
  vm.runInContext("restoreDraft()", context);
  assert.equal(await vm.runInContext("openAuthenticatedJourney()", context), true);
  console.log(JSON.stringify({ propertyCleared: state.draft.propertyId === "", oldTasksRetained: state.draft.tasks.length,
    oldNotesRetained: state.draft.transcript.includes("account A"), oldNotesResaved: String(stored).includes("account A") }));
  assert.equal(state.draft.tasks.length, 0, "Previous account's tasks survive account/property rejection");
  assert.equal(state.draft.transcript, "", "Previous account's private note survives account/property rejection");
  assert(!String(stored).includes("account A"), "Previous account's private draft was persisted again");
}
