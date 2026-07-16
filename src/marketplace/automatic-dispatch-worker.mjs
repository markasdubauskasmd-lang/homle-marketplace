import { randomUUID } from "node:crypto";
import { rankRequestCandidates } from "./matching-service.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const staleCandidateCodes = new Set(["candidate-stale", "cleaner-already-tried"]);
const closedRequestCodes = new Set(["dispatch-lease-lost", "dispatch-attempt-limit", "request-not-matchable"]);

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

export function createAutomaticDispatchWorker(repository, pricingPolicy, options = {}) {
  if (!repository || !["claimDue", "getCandidates", "complete", "release"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete automatic-dispatch repository is required.");
  if (!pricingPolicy || typeof pricingPolicy.quote !== "function") throw new TypeError("A private profitable booking-pricing policy is required for automatic matching.");
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();
  const batchLimit = integer(options.batchLimit, 1, 50, 10, "Automatic-matching batch limit");
  const leaseSeconds = integer(options.leaseSeconds, 30, 600, 120, "Automatic-matching lease duration");
  const retryMinutes = integer(options.retryMinutes, 1, 1440, 15, "Automatic-matching retry delay");
  const candidateLimit = integer(options.candidateLimit, 1, 50, 25, "Automatic-matching candidate limit");

  async function release(claim, leaseToken, outcome, now) {
    const retryAt = new Date(now.getTime() + retryMinutes * 60000).toISOString();
    await repository.release(claim.cleaningRequestId, leaseToken, outcome, retryAt);
  }

  return Object.freeze({
    async runOnce() {
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
        try {
          ranked = rankRequestCandidates(await repository.getCandidates(claim.cleaningRequestId, leaseToken, candidateLimit), pricingPolicy, now);
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
            await repository.complete({ cleaningRequestId: claim.cleaningRequestId, leaseToken, bookingId: bookingId.toLowerCase(), cleanerId: candidate.record.cleaner_id, ...candidate.quote });
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
