const windows = new Set([7, 30, 90]);

export function funnelWindow(value) {
  const selected = Number(value);
  if (!Number.isInteger(selected) || !windows.has(selected)) throw new TypeError("Choose a 7, 30 or 90 day window.");
  return selected;
}

export function stagePercent(value, cohort) {
  if (!Number.isInteger(value) || value < 0 || !Number.isInteger(cohort) || cohort < 0 || value > cohort) throw new TypeError("Funnel totals are unavailable.");
  return cohort === 0 ? null : Math.round((value / cohort) * 100);
}

export function percentLabel(value, cohort) {
  const percent = stagePercent(value, cohort);
  return percent == null ? "No matured cohort yet" : `${percent}% of cohort`;
}

// The visitor lane, in funnel order.
//
// Kept separate from the lanes above because it counts a different population:
// those are built from accounts and bookings and so begin at somebody who has
// already signed up, while these begin at somebody who merely arrived. See
// DECISIONS.md D11 for why the counts are anonymous and cookieless.
export const visitorStages = Object.freeze([
  Object.freeze(["funnel.landing.viewed", "Page viewed"]),
  Object.freeze(["funnel.landing.cta", "Call to action pressed"]),
  Object.freeze(["funnel.signup.started", "Signup opened"]),
  Object.freeze(["funnel.signup.completed", "Account created"]),
  Object.freeze(["funnel.property.added", "Property added"]),
  Object.freeze(["funnel.scan.completed", "Room scan completed"]),
  Object.freeze(["funnel.price.shown", "Price shown"]),
  Object.freeze(["funnel.slot.chosen", "Slot chosen"]),
  Object.freeze(["funnel.payment.authorised", "Payment authorised"])
]);

/**
 * Visitor counts in stage order, or null when the lane is unavailable.
 *
 * Null rather than a throw for an absent lane: the account-derived report is
 * what an Administrator opened the page for, and losing the visitor counts
 * must not lose that too.
 *
 * A missing metric reads as zero rather than as an error, because a metric
 * nobody has triggered yet legitimately has no row.
 */
export function visitorCounts(visitors) {
  if (visitors == null) return null;
  const totals = visitors.totals;
  if (!totals || typeof totals !== "object" || Array.isArray(totals)) throw new TypeError("Visitor counts are unavailable.");
  return Object.freeze(visitorStages.map(([metric, label]) => {
    const value = totals[metric] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000_000) throw new TypeError("Visitor counts are unavailable.");
    return Object.freeze({ metric, label, count: value });
  }));
}

/**
 * How a stage compares with the widest one above it.
 *
 * Deliberately NOT `stagePercent`: these are not a strict funnel. Somebody can
 * arrive straight onto a signup page without ever loading an instrumented
 * landing page, so a later stage can legitimately exceed an earlier one, and a
 * strict funnel helper would throw and take the whole page with it.
 */
export function visitorShare(count, cohort) {
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(cohort) || cohort < 0) throw new TypeError("Visitor counts are unavailable.");
  if (cohort === 0) return null;
  return Math.min(100, Math.round((count / cohort) * 100));
}
