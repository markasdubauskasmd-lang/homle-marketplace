// The conversion funnel, counted without following anybody along it.
//
// DECISIONS.md D11: analytics here are first-party and cookieless. That is not
// a privacy flourish, it is what lets the measurement exist at all — the
// content security policy is `script-src 'self'` and `connect-src 'self'`, so a
// vendor tag is blocked without weakening it, and an analytics cookie would
// need a PECR consent banner and would contradict the cookie policy published
// in `75c50e9a`, which states plainly that Homle sets no analytics cookie.
//
// This module is the vocabulary. It is a deliberate mirror of the shape in
// `scan-telemetry.mjs`: an explicit list of names and an explicit list of
// labels, so that emitting anything else requires deleting code rather than
// forgetting to add it. Migration 124 restates the same lists at the database
// boundary, which is the one that actually decides what can be stored.
//
// What is deliberately NOT here, and must not be added without changing the
// cookie policy first:
//   * no visitor, session, account, property or booking identifier -- the
//     absence of anything joinable is precisely why this needs no consent;
//   * no URL, path, referrer or campaign tag. "Where" is one name from the
//     `surface` list, nothing more;
//   * no free text of any kind.

// The funnel, in order. Each name answers one question about the step before
// it, which is the only reason to record any of them.
export const funnelMetrics = Object.freeze([
  // Do people arrive, and does anything on the page move them?
  "funnel.landing.viewed",
  "funnel.landing.cta",
  // Do they start an account, and do they finish one?
  "funnel.signup.started",
  "funnel.signup.completed",
  // Do they get far enough to describe a home?
  "funnel.property.added",
  "funnel.scan.completed",
  // Do they see a price, and does the price stop them?
  "funnel.price.shown",
  "funnel.slot.chosen",
  // Does money actually move?
  //
  // The funnel stops at the authorization, which is the last step the customer
  // themselves takes. A confirmed booking waits on a Cleaner accepting, often
  // long after the browser has gone, so no page could count it honestly -- and
  // the account-derived lane on the same Administrator screen already counts it
  // exactly, from the bookings themselves. See DECISIONS.md D12.
  "funnel.payment.authorised"
]);

// Only names from fixed lists may label a metric. A free-text dimension is how
// a postcode, a campaign tag or a page title ends up in an analytics table.
export const allowedFunnelDimensions = Object.freeze({
  // Which pitch the visitor was reading. This is the dimension the business
  // actually needs: the stated growth channel is letting agents and landlords
  // with several properties, and without this there is no way to tell whether
  // that audience converts or only the one-off customer does.
  audience: Object.freeze(["customer", "landlord", "agent", "cleaner", "unknown"]),
  // Which page, from a fixed list -- never a URL and never a path carrying an
  // id.
  surface: Object.freeze(["landing", "for-landlords", "pricing", "signup", "app"])
});

// One request cannot carry more than a page's worth of events, and one event
// cannot claim a large number. Both bounds exist so an anonymous endpoint
// cannot be used to write an arbitrary amount into an aggregate.
export const maximumFunnelBatch = 40;
export const maximumFunnelCount = 1000;

function boundedDimensions(supplied) {
  const kept = {};
  for (const [name, allowed] of Object.entries(allowedFunnelDimensions)) {
    const value = supplied?.[name];
    if (value === undefined || value === null) continue;
    const text = String(value);
    // Dropped rather than rejected. An unrecognised label is worth losing a
    // dimension over; it is not worth failing a request that a visitor's page
    // is waiting on.
    if (allowed.includes(text)) kept[name] = text;
  }
  return kept;
}

/**
 * One funnel event in the shape the database accepts, or null.
 *
 * Null rather than a throw, for the same reason as the scanner's telemetry:
 * nothing measured here is important enough to interrupt somebody's visit.
 */
export function funnelEvent(metric, { count = 1, dimensions } = {}) {
  const name = String(metric || "");
  if (!funnelMetrics.includes(name)) return null;
  const amount = Number(count);
  // Bounded so a runaway client reports a large number rather than an
  // unbounded one, and so a negative count cannot decrement a counter.
  if (!Number.isInteger(amount) || amount < 1) return null;
  return Object.freeze({
    metric: name,
    dimensions: Object.freeze(boundedDimensions(dimensions)),
    count: Math.min(amount, maximumFunnelCount)
  });
}

/**
 * A submitted batch, normalized and bounded.
 *
 * Returns only the events that survive the allowlist, so a client sending one
 * unrecognised name still has the rest of its page counted. The caller reports
 * how many were accepted, which is how a client can tell that a name it sent
 * was dropped rather than believing it is being measured.
 */
export function funnelBatch(events) {
  if (!Array.isArray(events)) return [];
  const accepted = [];
  for (const entry of events.slice(0, maximumFunnelBatch)) {
    const event = funnelEvent(entry?.metric, { count: entry?.count, dimensions: entry?.dimensions });
    if (event) accepted.push(event);
  }
  return accepted;
}
