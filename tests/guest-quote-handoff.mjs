import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { landlordRequestDraftLifetimeMs } from "../public/landlord-request-draft.js";

// Day 3: what a visitor priced on the landing page reaches the booking
// journey after sign-in, once, for the signed-in owner only. The real
// function is executed from landlord-journey.js, not a copy of it.
const source = readFileSync(new URL("../public/landlord-journey.js", import.meta.url), "utf8");
const start = source.indexOf('const guestQuoteKey = "homleGuestQuoteV1";');
const end = source.indexOf("/* ── Navigation", start);
assert(start > 0 && end > start, "The guest-quote handoff is missing from the journey.");
const handoff = source.slice(start, end);
const journeyEntry = source.slice(source.indexOf("async function openAuthenticatedJourney"), source.indexOf("/* ── Wiring"));
assert(/if \(adoptScan\(\)\)[^\n]*\n\s*else if \(adoptGuestQuote\(\)\)/.test(journeyEntry), "The handoff does not run after sign-in, behind a finished scan.");
assert(!/address|access|postcode\s*=/.test(handoff.replace(/\/\/.*$/gm, "")), "The handoff writes more than the type of clean.");

function memoryStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}
function run({ owner = "11111111-1111-4111-8111-111111111111", session, local, draft = {}, now = Date.now() } = {}) {
  const saved = [];
  const context = {
    state: { draftOwner: owner, draft: { ...draft } },
    sessionStorage: session, localStorage: local,
    landlordRequestDraftLifetimeMs,
    setRequestScopeValue: (key, value) => { context.state.draft[key] = value; },
    saveDraft: () => saved.push({ ...context.state.draft }),
    Date: { now: () => now }, Number, JSON, Object
  };
  context.globalThis = context;
  vm.runInNewContext(`${handoff}\nresult = adoptGuestQuote();`, context);
  return { adopted: context.result, draft: context.state.draft, saved };
}
const quote = (overrides = {}) => JSON.stringify({ version: 1, savedAt: Date.now(), area: "SW1A", serviceType: "deep", rooms: { bedrooms: 2 }, ...overrides });

// The email path: only the localStorage copy survives the new tab.
let session = memoryStore(); let local = memoryStore({ homleGuestQuoteV1: quote() });
let outcome = run({ session, local });
assert.equal(outcome.adopted, true);
assert.equal(outcome.draft.serviceCode, "deep-cleans");
assert.equal(outcome.saved.length, 1, "The adopted choice was not saved into the owner-bound draft.");
assert.equal(local.values.size + session.values.size, 0, "The guest quote was left behind for the next account in this browser.");

for (const [serviceType, code] of [["standard", "regular-domestic"], ["end-of-tenancy", "end-of-tenancy"], ["rental-turnover", "rental-turnovers"]]) {
  assert.equal(run({ session: memoryStore({ homleGuestQuoteV1: quote({ serviceType }) }), local: memoryStore() }).draft.serviceCode, code);
}

// Nobody signed in yet: nothing is read, so it waits for the owner.
session = memoryStore({ homleGuestQuoteV1: quote() });
outcome = run({ owner: "", session, local: memoryStore() });
assert.equal(outcome.adopted, false);
assert.equal(session.values.size, 1, "The quote was consumed before an owner was known.");

// A draft the customer already started wins, and the quote is still discarded.
session = memoryStore({ homleGuestQuoteV1: quote() });
outcome = run({ session, local: memoryStore(), draft: { serviceCode: "end-of-tenancy" } });
assert.equal(outcome.adopted, false);
assert.equal(outcome.draft.serviceCode, "end-of-tenancy");
assert.equal(session.values.size, 0);

// Stale, from the future, the wrong version, an unknown service or corrupt: ignored and deleted.
for (const stored of [
  quote({ savedAt: Date.now() - landlordRequestDraftLifetimeMs - 1 }),
  quote({ savedAt: Date.now() + 10 * 60 * 1000 }),
  quote({ version: 2 }),
  quote({ serviceType: "commercial" }),
  "{not json"
]) {
  session = memoryStore({ homleGuestQuoteV1: stored }); local = memoryStore({ homleGuestQuoteV1: stored });
  outcome = run({ session, local });
  assert.equal(outcome.adopted, false, `A bad stored quote was adopted: ${stored}`);
  assert.equal(outcome.draft.serviceCode, undefined);
  assert.equal(session.values.size + local.values.size, 0, "A bad stored quote was kept.");
}

// Storage that throws does not break the journey.
const broken = { getItem() { throw new Error("blocked"); }, setItem() {}, removeItem() { throw new Error("blocked"); } };
assert.equal(run({ session: broken, local: broken }).adopted, false);

console.log("Guest quote handoff passed: carried into the owner-bound draft once, across the email tab, after sign-in only; an existing draft wins; stale, future, foreign-version, unknown, corrupt and blocked storage ignored and cleared.");
