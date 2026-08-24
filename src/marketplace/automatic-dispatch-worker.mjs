import { randomUUID } from "node:crypto";
import { rankRequestCandidates } from "./matching-service.mjs";
import { defaultPricingEconomics, normalizedPricingEconomics, quoteEconomics } from "./pricing-economics.mjs";
import { uuidPattern } from "./validation.mjs";

const staleCandidateCodes = new Set(["candidate-stale", "cleaner-already-tried"]);
const closedRequestCodes = new Set(["dispatch-lease-lost", "dispatch-attempt-limit", "dispatch-price-cap-required", "request-not-matchable"]);

function integer(value, minimum, maximum, fallback, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}

function clockValue(clock) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError("Automatic-matching clock must return a valid Date.");
  return value;
}

/**
 * Terms for an automatically dispatched booking.
 *
 * The customer price is the one already frozen onto the request and shown to
 * the customer. The cleaner is paid the published share of it, by the same
 * function that splits every other booking — this worker computes no money of
 * its own and has no rate card to consult.
 *
 * Returns null when the request carries no frozen quote. Such a request is
 * SKIPPED rather than priced some other way: an automatic booking made at a
 * number nobody has shown the customer is exactly what this exists to prevent.
 */
function dispatchTerms(candidate, economics, invitationTtlMinutes, now) {
  const customerPricePence = Number(candidate?.quoted_total_pence);
  const quotedMinutes = Number(candidate?.quoted_minutes);
  if (!Number.isInteger(customerPricePence) || customerPricePence < 1) return null;

  const settled = quoteEconomics(customerPricePence, quotedMinutes, economics);
  // Re-checked at dispatch time. The stored total is immutable, but an operator
  // can change the share between the quote and the invitation, and dispatching
  // an unhealthy booking with nobody watching is worse than not dispatching.
  if (!settled.healthy) return null;

  const start = new Date(candidate.requested_start_at);
  if (Number.isNaN(start.getTime())) return null;
  const responseDeadline = new Date(Math.min(start.getTime(), now.getTime() + invitationTtlMinutes * 60000));
  if (responseDeadline.getTime() <= now.getTime()) return null;

  return {
    customerPricePence,
    cleanerPayPence: settled.cleanerPayoutPence,
    labourOnCostPence: 0,
    paymentFeePence: settled.paymentFeePence,
    travelCostPence: 0,
    suppliesCostPence: 0,
    otherCostPence: 0,
    targetMarginBasisPoints: settled.grossMarginBasisPoints,
    targetContributionPence: settled.grossMarginPence,
    responseDeadline: responseDeadline.toISOString()
  };
}

export function createAutomaticDispatchWorker(repository, options = {}) {
  if (!repository || !["claimDue", "getCandidates", "complete", "release"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete automatic-dispatch repository is required.");
  const invitationTtlMinutes = integer(options.invitationTtlMinutes, 15, 1440, 180, "Automatic-matching invitation lifetime");
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();
  const batchLimit = integer(options.batchLimit, 1, 50, 10, "Automatic-matching batch limit");
  const leaseSeconds = integer(options.leaseSeconds, 30, 600, 120, "Automatic-matching lease duration");
  const retryMinutes = integer(options.retryMinutes, 1, 1440, 15, "Automatic-matching retry delay");
  const candidateLimit = integer(options.candidateLimit, 1, 50, 25, "Automatic-matching candidate limit");
  const requirePayoutReady = options.requirePayoutReady === true;

  async function release(claim, leaseToken, outcome, now) {
    const retryAt = new Date(now.getTime() + retryMinutes * 60000).toISOString();
    await repository.release(claim.cleaningRequestId, leaseToken, outcome, retryAt);
  }

  return Object.freeze({
    async runOnce() {
      // Read once per BATCH, not per claim and not at construction. Per claim
      // would let two requests in the same run settle on different shares if an
      // operator published in between; at construction would mean a rate change
      // never reached a long-lived worker at all.
      //
      // Nothing published falls back to the shipped economics, so an
      // unconfigured deployment dispatches at the same share as a configured
      // one — the same rule every other reader of the price list follows.
      let economics;
      try {
        economics = normalizedPricingEconomics(
          (typeof repository.activeEconomics === "function" ? await repository.activeEconomics() : null) || defaultPricingEconomics
        );
      } catch {
        economics = normalizedPricingEconomics(defaultPricingEconomics);
      }

      const leaseToken = createId();
      if (!uuidPattern.test(leaseToken || "")) throw new TypeError("The automatic-matching lease generator must return a UUID.");
      const claims = await repository.claimDue(leaseToken.toLowerCase(), batchLimit, leaseSeconds);
      if (!Array.isArray(claims) || claims.length > batchLimit) throw new Error("Automatic matching returned an invalid claim batch.");
      const result = { claimed: claims.length, invited: 0, noMatch: 0, stale: 0, deferred: 0 };
      for (const claim of claims) {
        const now = clockValue(clock);
        if (!claim || !uuidPattern.test(claim.cleaningRequestId || "") || Number.isNaN(Date.parse(claim.leaseExpiresAt)) || Date.parse(claim.leaseExpiresAt) <= now.getTime()) {
          result.deferred += 1;
          continue;
        }
        let ranked;
        let terms;
        try {
          const candidates = await repository.getCandidates(claim.cleaningRequestId, leaseToken, candidateLimit, requirePayoutReady);
          // One set of terms for the request, because the price is the request's
          // and not the cleaner's. A request with no frozen quote produces none,
          // and is released rather than invented a price for.
          terms = candidates.length ? dispatchTerms(candidates[0], economics, invitationTtlMinutes, now) : null;
          ranked = terms ? rankRequestCandidates(candidates, terms, now, { requireApprovedMaximum: true }) : [];
        } catch (error) {
          if (!closedRequestCodes.has(error?.code)) await release(claim, leaseToken, "transient-failure", now);
          result.deferred += 1;
          continue;
        }
        if (!ranked.length) {
          await release(claim, leaseToken, "no-eligible-candidate", now);
          result.noMatch += 1;
          continue;
        }
        let invited = false;
        for (const candidate of ranked) {
          const bookingId = createId();
          if (!uuidPattern.test(bookingId || "")) throw new TypeError("The automatic-matching booking generator must return a UUID.");
          try {
            await repository.complete({ cleaningRequestId: claim.cleaningRequestId, leaseToken, bookingId: bookingId.toLowerCase(), cleanerId: candidate.record.cleaner_id, ...terms });
            invited = true;
            result.invited += 1;
            break;
          } catch (error) {
            if (staleCandidateCodes.has(error?.code)) continue;
            if (!closedRequestCodes.has(error?.code)) await release(claim, leaseToken, "transient-failure", now);
            result.deferred += 1;
            invited = true;
            break;
          }
        }
        if (!invited) {
          await release(claim, leaseToken, "candidates-stale", now);
          result.stale += 1;
        }
      }
      return Object.freeze(result);
    }
  });
}
