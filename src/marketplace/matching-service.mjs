import { uuid, uuidPattern } from "./validation.mjs";

function array(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function publicCandidate(record, quote, rank) {
  const distance = record.distance_km == null ? null : Number(record.distance_km);
  const priorJobs = Number(record.previous_completed_jobs) || 0;
  const reasons = [
    "Available for the full requested time",
    "Offers every required service",
    record.exact_postcode_area ? "Serves this property's postcode area" : `${distance.toFixed(1)} km from a declared service base`,
    record.budget_pence == null ? "Automatic price estimate is available" : "Automatic price estimate is within the stated budget"
  ];
  if (priorJobs > 0) reasons.push(`Completed ${priorJobs} previous ${priorJobs === 1 ? "job" : "jobs"} for this Landlord`);
  if (record.identity_verified) reasons.push("Identity check marked verified");
  return {
    rank,
    cleanerId: record.cleaner_id,
    publicSlug: record.public_slug,
    displayName: record.display_name,
    profilePhotoUrl: record.profile_photo_url || null,
    biography: record.biography || "",
    averageRating: Number(record.average_rating),
    reviewCount: Number(record.review_count),
    completedJobCount: Number(record.completed_job_count),
    yearsExperience: record.years_experience == null ? null : Number(record.years_experience),
    languages: array(record.languages),
    equipmentSupplied: array(record.equipment_supplied),
    productsSupplied: array(record.products_supplied),
    verifiedBadges: array(record.verified_badges),
    identityVerified: record.identity_verified === true,
    currentAvailabilityStatus: record.current_availability_status,
    distanceKm: distance,
    previousCompletedJobs: priorJobs,
    services: array(record.services).map((service) => ({
      serviceCode: service.serviceCode ?? service.service_code,
      pricingModel: service.pricingModel ?? service.pricing_model,
      pricePence: Number(service.pricePence ?? service.price_pence)
    })),
    estimatedCustomerPricePence: quote.customerPricePence,
    matchReasons: reasons
  };
}

/**
 * The cleaners worth showing, best first.
 *
 * WHAT CHANGED, AND WHY THE PRICE STOPPED BEING PART OF IT
 *
 * This used to take a pricing POLICY and quote every candidate separately,
 * awarding the cheapest a quarter of the match score. That made sense when the
 * customer price was derived from the invited cleaner's own rate card.
 *
 * Under platform pricing it does not: Homle sets the price, so the customer
 * pays the same whoever cleans. Scoring by a number that is identical for every
 * candidate ranks nothing — it only adds noise to a decision that should be
 * about who is best for the job. The ordering is now the match score the
 * database computes, then distance, then a stable tiebreak.
 *
 * @param records  the candidate rows
 * @param quote    ONE quote, for the request — not one per cleaner
 */
export function rankRequestCandidates(records, quote, now, options = {}) {
  if (!Array.isArray(records)) throw new TypeError("Matching candidates must be an array.");
  if (!quote || !Number.isInteger(Number(quote.customerPricePence)) || Number(quote.customerPricePence) < 1) {
    throw Object.assign(new Error("This request has no price yet, so no Cleaner can be matched to it."), { statusCode: 409, code: "request-not-priced" });
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("Matching clock must return a valid Date.");

  const customerPricePence = Number(quote.customerPricePence);
  // The budget is a property of the REQUEST and the price is the same for
  // everyone, so this either admits every candidate or none. Checked once
  // rather than per cleaner, which is what it always meant.
  const budget = records[0]?.budget_pence == null ? null : Number(records[0].budget_pence);
  if (options.requireApprovedMaximum === true && (!Number.isInteger(budget) || budget < 1 || budget > 10_000_000)) return [];
  if (budget != null && customerPricePence > budget) return [];

  return records
    .map((record, sourceIndex) => ({ record, quote, sourceIndex }))
    .sort((left, right) =>
      Number(right.record.base_match_score) - Number(left.record.base_match_score) ||
      (left.record.distance_km == null ? Number.MAX_SAFE_INTEGER : Number(left.record.distance_km)) - (right.record.distance_km == null ? Number.MAX_SAFE_INTEGER : Number(right.record.distance_km)) ||
      left.sourceIndex - right.sourceIndex ||
      String(left.record.public_slug).localeCompare(String(right.record.public_slug))
    );
}

export function createMatchingService(repository, options = {}) {
  if (!repository || typeof repository.recommendForRequest !== "function") throw new TypeError("A request matching repository is required.");
  // One quote for the request, from the same engine everything else uses.
  // Absent means matching cannot run, and says so, rather than falling back to
  // pricing each cleaner separately.
  const quoteRequest = typeof options.quoteRequest === "function" ? options.quoteRequest : null;
  const clock = options.clock || (() => new Date());
  const requirePayoutReady = options.requirePayoutReady === true;
  return Object.freeze({
    async recommendForRequest(actor, cleaningRequestId) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.some((role) => role === "landlord" || role === "administrator")) throw new TypeError("A Landlord account is required to match a cleaning request.");
      const requestId = uuid(cleaningRequestId, "cleaning request id");
      const records = (await repository.recommendForRequest(actor, requestId, 25, requirePayoutReady)).filter((record) => String(record.cleaner_id || "").toLowerCase() !== actor.userId.toLowerCase());
      const now = clock();
      if (!quoteRequest) throw Object.assign(new Error("Cleaner matching is unavailable until platform pricing is configured."), { statusCode: 503, code: "pricing-not-configured" });
      const ranked = rankRequestCandidates(records, await quoteRequest(actor, requestId), now);
      return {
        cleaningRequestId: requestId,
        generatedAt: now.toISOString(),
        candidates: ranked.map((candidate, index) => publicCandidate(candidate.record, candidate.quote, index + 1))
      };
    }
  });
}
