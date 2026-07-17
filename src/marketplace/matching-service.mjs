const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

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

export function rankRequestCandidates(records, pricingPolicy, now) {
  if (!Array.isArray(records)) throw new TypeError("Matching candidates must be an array.");
  if (!pricingPolicy || typeof pricingPolicy.quote !== "function") throw Object.assign(new Error("Cleaner matching is unavailable until the private pricing policy is configured."), { statusCode: 503, code: "pricing-not-configured" });
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("Matching clock must return a valid Date.");
  const priced = [];
  for (const record of records) {
    try {
      const quote = pricingPolicy.quote(record, now);
      const budget = record.budget_pence == null ? null : Number(record.budget_pence);
      if (budget != null && quote.customerPricePence > budget) continue;
      priced.push({ record, quote });
    } catch (error) {
      if (error?.statusCode === 409) continue;
      throw error;
    }
  }
  const lowestPrice = priced.length ? Math.min(...priced.map(({ quote }) => quote.customerPricePence)) : null;
  return priced.map(({ record, quote }, sourceIndex) => {
    const priceScore = Math.min(25, 25 * lowestPrice / quote.customerPricePence);
    return { record, quote, priceScore, sourceIndex, overallScore: Number(record.base_match_score) + priceScore };
  }).sort((left, right) =>
    right.overallScore - left.overallScore ||
    left.quote.customerPricePence - right.quote.customerPricePence ||
    (left.record.distance_km == null ? Number.MAX_SAFE_INTEGER : Number(left.record.distance_km)) - (right.record.distance_km == null ? Number.MAX_SAFE_INTEGER : Number(right.record.distance_km)) ||
    left.sourceIndex - right.sourceIndex ||
    String(left.record.public_slug).localeCompare(String(right.record.public_slug))
  );
}

export function createMatchingService(repository, options = {}) {
  if (!repository || typeof repository.recommendForRequest !== "function") throw new TypeError("A request matching repository is required.");
  const pricingPolicy = options.pricingPolicy || null;
  const clock = options.clock || (() => new Date());
  return Object.freeze({
    async recommendForRequest(actor, cleaningRequestId) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.some((role) => role === "landlord" || role === "administrator")) throw new TypeError("A Landlord account is required to match a cleaning request.");
      const requestId = uuid(cleaningRequestId, "cleaning request id");
      const records = (await repository.recommendForRequest(actor, requestId, 25)).filter((record) => String(record.cleaner_id || "").toLowerCase() !== actor.userId.toLowerCase());
      const now = clock();
      const ranked = rankRequestCandidates(records, pricingPolicy, now);
      return {
        cleaningRequestId: requestId,
        generatedAt: now.toISOString(),
        candidates: ranked.map((candidate, index) => publicCandidate(candidate.record, candidate.quote, index + 1))
      };
    }
  });
}
