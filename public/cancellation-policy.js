// What a cancelled booking costs, and who gets it.
//
// Until now cancelling was a support ticket with no fee attached. A cleaner who
// turned down other work to hold a Tuesday morning and lost it at 7am on Tuesday
// received nothing, and nothing about the booking recorded that they should
// have.
//
// TIERED BY NOTICE, NOT BY BLAME
//
// The UK market is consistent here: free cancellation up to about a day ahead,
// then a rising fee. Housekeep allows changes until midday the day before and
// charges after that. The tiers below are the same shape, expressed as a share
// of the booking with a cash cap so that cancelling a £400 end-of-tenancy clean
// does not produce a £200 fee nobody will pay.
//
// The caps are what make this a deterrent rather than a revenue line. A customer
// who genuinely has to cancel should feel the loss of a slot, not be punished
// for it.
//
// SERVED TO THE BROWSER ON PURPOSE
//
// A customer is entitled to read the policy before they book, so the bands live
// in the public price list and this module is isomorphic like the engine beside
// it. What the CLEANER receives out of a fee is a commercial position and lives
// in pricing-economics.mjs, which is why cleanerShareOfCancellation() takes it
// as an argument rather than reading it from the config.

import { normalizedPricingConfig } from "./pricing-config.js";

const basisPointDivisor = 10000;

function money(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function formatPounds(pence) {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

/**
 * The fee for cancelling a booking now.
 *
 * @param booking { totalPence, scheduledStartAt, minimumVisitPence }
 * @param config  a pricing configuration
 * @param options { now, reason }  reason "no-access" selects the arrival band
 *
 * Returns a free result rather than throwing when the booking cannot be read.
 * A cancellation must never be blocked by an unparseable date — the customer
 * still gets to cancel, and a fee nobody can justify is not charged.
 */
export function cancellationFee(booking = {}, config = {}, options = {}) {
  const rules = config?.cancellationBands ? config : normalizedPricingConfig(config);
  const totalPence = money(booking?.totalPence);
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const startAt = Date.parse(booking?.scheduledStartAt ?? "");

  const free = (reason) => Object.freeze({
    chargeable: false,
    bandCode: "",
    label: "Free cancellation",
    feePence: 0,
    noticeHours: null,
    explanation: reason
  });

  if (!totalPence) return free("There is nothing to cancel yet.");
  if (!Number.isFinite(startAt) || Number.isNaN(now.getTime())) {
    return free("This booking has no confirmed start time, so no cancellation fee applies.");
  }

  // "No access" is not a notice period — the cleaner is standing outside. It is
  // selected by the caller rather than derived from the clock, because only the
  // job record knows whether anybody turned up.
  const noAccess = options.reason === "no-access";
  const noticeHours = (startAt - now.getTime()) / 3600000;

  const band = noAccess
    ? rules.cancellationBands.find((candidate) => candidate.code === "no-access")
    : rules.cancellationBands.find((candidate) => candidate.withinHours > 0 && noticeHours < candidate.withinHours);

  if (!band) {
    const widest = rules.cancellationBands.reduce((most, candidate) => Math.max(most, candidate.withinHours), 0);
    return free(`Cancelling more than ${widest} hours ahead is free.`);
  }

  // A no-access charge is taken against the minimum visit, not the booking
  // total: the cleaner travelled and lost the slot, but did not do the work.
  const chargeBasisPence = band.chargeMinimumVisitOnly
    ? money(booking?.minimumVisitPence ?? minimumVisitPence(rules, booking?.serviceType))
    : totalPence;

  const uncapped = Math.round(chargeBasisPence * band.basisPoints / basisPointDivisor);
  const feePence = Math.min(uncapped, band.maximumPence, totalPence);

  return Object.freeze({
    chargeable: feePence > 0,
    bandCode: band.code,
    label: band.label,
    feePence,
    noticeHours: noAccess ? 0 : Math.round(noticeHours * 10) / 10,
    explanation: feePence > 0
      ? `${band.label}: ${formatPounds(feePence)}${uncapped > feePence ? ` (capped from ${formatPounds(uncapped)})` : ""}.`
      : `${band.label}: no charge.`
  });
}

/**
 * The whole policy, in the order a customer reads it.
 *
 * Rendered rather than hand-written into a terms page, so the words on screen
 * and the arithmetic that charges can never disagree.
 */
export function cancellationPolicySummary(config = {}) {
  const rules = config?.cancellationBands ? config : normalizedPricingConfig(config);
  const timed = rules.cancellationBands.filter((band) => band.withinHours > 0);
  const widest = timed.reduce((most, band) => Math.max(most, band.withinHours), 0);

  const rows = [{
    code: "free",
    when: `More than ${widest} hours before`,
    charge: "Free"
  }];
  // Widest window first: the customer is reading down a scale of increasing
  // consequence, not up one.
  for (const band of [...timed].sort((first, second) => second.withinHours - first.withinHours)) {
    rows.push({
      code: band.code,
      when: band.label,
      charge: `${band.basisPoints / 100}% of the booking, up to ${formatPounds(band.maximumPence)}`
    });
  }
  const noAccess = rules.cancellationBands.find((band) => band.code === "no-access");
  if (noAccess) {
    rows.push({
      code: noAccess.code,
      when: noAccess.label,
      charge: `${noAccess.basisPoints / 100}% of the minimum visit, up to ${formatPounds(noAccess.maximumPence)}`
    });
  }
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

/**
 * How a charged cancellation fee is split.
 *
 * The economics are passed in rather than read from the price list, for the same
 * reason the cleaner's ordinary share is not in the price list: it is commercial
 * information and the browser holds a copy of everything in there.
 */
export function cancellationSettlement(feePence, economics = {}) {
  const fee = money(feePence);
  const shareBasisPoints = Number.isInteger(economics?.cancellationCleanerShareBasisPoints)
    ? economics.cancellationCleanerShareBasisPoints
    : 7000;
  const cleanerPence = Math.round(fee * shareBasisPoints / basisPointDivisor);
  return Object.freeze({
    feePence: fee,
    cleanerPence,
    platformPence: fee - cleanerPence
  });
}

/** The cash value of the minimum visit for a service, used by the no-access band. */
function minimumVisitPence(config, serviceType) {
  const service = config.serviceTypes?.[String(serviceType || "standard")] ?? config.serviceTypes?.standard;
  if (!service) return 0;
  return Math.round((config.minimumBookingMinutes / 60) * config.customerHourlyRatePence * service.multiplierBasisPoints / basisPointDivisor);
}
