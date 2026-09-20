import { readFile } from "node:fs/promises";
import {
  allowedFunnelDimensions, funnelBatch, funnelEvent, funnelMetrics, maximumFunnelBatch, maximumFunnelCount
} from "../src/marketplace/funnel-telemetry.mjs";
import { createFunnelTelemetryRepository } from "../src/marketplace/funnel-telemetry-repository.mjs";
import { visitorCounts, visitorShare, visitorStages } from "../public/admin-funnel-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

/* ── Nothing identifying can get out ───────────────────────────────────── */

// DECISIONS.md D11: these analytics are consent-free precisely because there is
// nothing joinable in them. A name outside the list cannot be emitted, so
// adding one means editing the allowlist rather than forgetting to.
for (const attempt of [
  "funnel.visitor.id",
  "pageview",
  "funnel.landing.viewed ",
  "funnel.property.added.kitchen",
  "",
  null,
  undefined
]) {
  assert(funnelEvent(attempt) === null, `An unlisted metric was emitted: ${String(attempt)}`);
}

// A URL, a referrer, a campaign tag or an account id under an allowed metric
// name is dropped, not passed through. This is the failure that would turn a
// cookieless counter into a profile.
{
  const event = funnelEvent("funnel.landing.cta", {
    dimensions: {
      audience: "landlord",
      surface: "for-landlords",
      path: "/landlord/book?propertyId=8f2",
      referrer: "https://www.google.com/search?q=cleaner+london",
      utm_campaign: "spring",
      visitorId: "v-1",
      accountId: "u-1",
      postcode: "SW1A 1AA"
    }
  });
  assert(event, "A valid funnel event was refused.");
  assert(Object.keys(event.dimensions).length === 2, `An unlisted dimension survived: ${JSON.stringify(event.dimensions)}`);
  const serialised = JSON.stringify(event);
  assert(!/google|spring|v-1|u-1|SW1A|propertyId/.test(serialised), `Identifying content reached a funnel event: ${serialised}`);
}

// An unrecognised value in an allowed field is dropped, so a caller cannot
// smuggle free text through `audience` or `surface`.
{
  const event = funnelEvent("funnel.landing.viewed", { dimensions: { audience: "SW1A 1AA", surface: "/landlord/book" } });
  assert(Object.keys(event.dimensions).length === 0, `An unrecognised dimension value was kept: ${JSON.stringify(event.dimensions)}`);
}
assert(Object.keys(allowedFunnelDimensions).length === 2, "The funnel dimension allowlist grew; check it carries no identifier.");
assert(Object.values(allowedFunnelDimensions).every((values) => values.every((value) => typeof value === "string" && /^[a-z-]{1,20}$/.test(value))),
  "A funnel dimension value is not a short fixed name.");

/* ── Counts are bounded and cannot go backwards ────────────────────────── */

assert(funnelEvent("funnel.landing.cta", { count: 0 }) === null, "A zero count was emitted.");
assert(funnelEvent("funnel.landing.cta", { count: -4 }) === null, "A negative count could decrement a counter.");
assert(funnelEvent("funnel.landing.cta", { count: 1.5 }) === null, "A fractional count was emitted.");
assert(funnelEvent("funnel.landing.cta", { count: 1e9 }).count === maximumFunnelCount, "A runaway count was not bounded.");
assert(funnelEvent("funnel.landing.cta").count === 1, "A count defaulted to something other than one.");

/* ── A batch is bounded and filtered, never rejected wholesale ─────────── */

{
  const batch = funnelBatch([
    { metric: "funnel.landing.viewed", dimensions: { surface: "landing" } },
    { metric: "not.a.metric" },
    { metric: "funnel.landing.cta", dimensions: { audience: "agent" } }
  ]);
  assert(batch.length === 2, `A batch was not filtered to the allowlist: ${JSON.stringify(batch)}`);
  assert(batch.every((event) => funnelMetrics.includes(event.metric)), "An unlisted metric survived a batch.");
}
assert(funnelBatch(Array.from({ length: 500 }, () => ({ metric: "funnel.landing.cta" }))).length === maximumFunnelBatch,
  "An oversized batch was not bounded.");
for (const attempt of [null, undefined, "funnel.landing.cta", { metric: "funnel.landing.cta" }, 7]) {
  assert(funnelBatch(attempt).length === 0, `A non-array batch produced events: ${String(attempt)}`);
}

/* ── The repository passes through the anonymous connection ────────────── */

{
  const calls = [];
  const repository = createFunnelTelemetryRepository({
    withAuthenticationTransaction: async (run) => {
      calls.push("anonymous");
      return run({ query: async (text, values) => { calls.push([text, values]); return { rows: [{ recorded: 3 }] }; } });
    },
    withUserTransaction: async (actor, run) => {
      calls.push(["user", actor]);
      return run({ query: async () => ({ rows: [{ snapshot: { windowDays: 30, counters: {}, totals: {} } }] }) });
    }
  });

  const stored = await repository.recordBatch([{ metric: "funnel.landing.viewed", dimensions: {}, count: 1 }]);
  assert(stored === 3, `The stored count was not returned: ${stored}`);
  // The beacon has no actor by design. Writing it through the authenticated
  // connection would mean the ingest path could see a session, which is exactly
  // what must not be possible.
  assert(calls[0] === "anonymous", "The funnel beacon did not use the anonymous connection.");
  assert(calls[1][0].includes("record_public_funnel_batch"), "The funnel beacon called the wrong database function.");

  const snapshot = await repository.snapshot({ userId: "a", roles: ["administrator"] }, 30);
  assert(snapshot.windowDays === 30, "The administrator snapshot was not returned.");
  assert(calls[2][0] === "user", "The administrator read did not use the authenticated connection.");
}

// An unavailable snapshot reads as empty rather than as undefined, so the
// administrator page renders a zeroed lane instead of throwing.
{
  const repository = createFunnelTelemetryRepository({
    withAuthenticationTransaction: async (run) => run({ query: async () => ({ rows: [] }) }),
    withUserTransaction: async (actor, run) => run({ query: async () => ({ rows: [] }) })
  });
  assert(await repository.recordBatch([]) === 0, "A missing stored count was not zero.");
  const snapshot = await repository.snapshot({ userId: "a", roles: ["administrator"] }, 7);
  assert(snapshot.windowDays === 7 && Object.keys(snapshot.totals).length === 0, "A missing snapshot was not an empty one.");
}

/* ── The administrator lane survives an absent or partial read ─────────── */

assert(visitorCounts(null) === null, "An absent visitor lane was not reported as absent.");
assert(visitorCounts(undefined) === null, "An absent visitor lane was not reported as absent.");
{
  const counts = visitorCounts({ windowDays: 30, totals: { "funnel.landing.viewed": 400, "funnel.payment.authorised": 7 } });
  assert(counts.length === visitorStages.length, "The visitor lane dropped a stage.");
  assert(counts[0].count === 400 && counts.at(-1).count === 7, "A visitor count was misread.");
  // A metric nobody has triggered yet has no row, which is a zero and not an
  // error.
  assert(counts[1].count === 0, "A metric with no rows was not read as zero.");
}
for (const attempt of [{ totals: null }, { totals: [] }, { totals: { "funnel.landing.viewed": -1 } }, { totals: { "funnel.landing.viewed": 1.5 } }]) {
  let threw = false;
  try { visitorCounts(attempt); } catch { threw = true; }
  assert(threw, `An impossible visitor total was accepted: ${JSON.stringify(attempt)}`);
}

// Deliberately not a strict funnel: somebody can arrive straight onto an
// instrumented page part-way along, so a later stage may exceed an earlier one
// and must not take the page down with it.
assert(visitorShare(0, 0) === null, "An empty cohort did not report as empty.");
assert(visitorShare(50, 200) === 25, "A share was miscalculated.");
assert(visitorShare(300, 200) === 100, "A stage larger than the first threw or exceeded 100%.");

/* ── The three copies of the vocabulary agree ──────────────────────────── */

// The list exists in the server module, in the browser beacon and in the
// database. Three copies is the price of a guarantee that does not depend on
// anybody remembering; a test that they match is the price of three copies.
{
  const beacon = await readFile(new URL("../public/funnel.js", import.meta.url), "utf8");
  const migration = await readFile(new URL("../db/migrations/124_public_funnel_telemetry.sql", import.meta.url), "utf8");
  for (const metric of funnelMetrics) {
    assert(beacon.includes(`"${metric}"`), `The browser beacon is missing ${metric}.`);
    assert(migration.includes(`'${metric}'`), `Migration 124 is missing ${metric}.`);
  }
  for (const [name, values] of Object.entries(allowedFunnelDimensions)) {
    for (const value of values) {
      assert(beacon.includes(`"${value}"`), `The browser beacon is missing the ${name} value ${value}.`);
      assert(migration.includes(`'${value}'`), `Migration 124 is missing the ${name} value ${value}.`);
    }
  }
  for (const [metric] of visitorStages) {
    assert(funnelMetrics.includes(metric), `The administrator lane shows ${metric}, which cannot be recorded.`);
  }
  assert(visitorStages.length === funnelMetrics.length, "The administrator lane and the vocabulary have drifted apart.");
}

// The beacon must not acquire a visitor identifier. If any of these appear, the
// cookie policy published in `75c50e9a` has become untrue and a consent banner
// is required — change the policy before changing this test.
{
  const beacon = await readFile(new URL("../public/funnel.js", import.meta.url), "utf8");
  const code = beacon.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const forbidden of ["document.cookie", "localStorage", "sessionStorage", "indexedDB", "crypto.randomUUID", "document.referrer", "location.href", "location.search", "location.pathname"]) {
    assert(!code.includes(forbidden), `The cookieless funnel beacon reads ${forbidden}.`);
  }
  assert(code.includes('credentials: "omit"'), "The funnel beacon sends credentials.");
}

console.log("Funnel telemetry checks passed: fixed vocabulary, dropped identifiers, bounded counts and batches, anonymous ingest, administrator lane and the three vocabularies in agreement.");
