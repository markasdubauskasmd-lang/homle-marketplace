(function attachReadinessNavigator(globalObject) {
  const requirementFields = Object.freeze({
    "legal owner name": "legalOwnerName",
    "business structure": "businessStructure",
    "legal business name": "legalBusinessName",
    "trading address": "tradingAddress",
    "valid support email": "supportEmail",
    "valid support phone": "supportPhone",
    "valid public HTTPS website origin": "publicSiteUrl",
    "domain and deployment evidence naming this hostname": "publicSiteEvidenceNote",
    "public website verification date": "publicSiteVerifiedDate",
    "at least one valid outward postcode": "pilotPostcodes",
    "positive customer hourly rate": "customerHourlyRate",
    "positive cleaner hourly pay": "cleanerHourlyPay",
    "founder minimum booking hours": "minimumHours",
    "founder contribution-margin floor": "minimumContributionMarginPercent",
    "customer rate above cleaner pay": "customerHourlyRate",
    "reviewed labour on-cost, payment, travel, supplies and risk assumptions": "variableCostsConfirmed",
    "conservative travel distance for distance-based pricing": "pricingTravelDistanceKm",
    "configured minimum job meets the contribution-margin floor": "customerHourlyRate",
    "viable margin and percentage-cost stack": "minimumContributionMarginPercent",
    "insurance marked active and verified": "insuranceStatus",
    "insurance provider": "insuranceProvider",
    "cover, limit and document-location summary": "insuranceEvidenceNote",
    "future policy expiry or review date": "insuranceReviewDate",
    "payment provider marked live and verified": "paymentProviderStatus",
    "payment provider name": "paymentProviderName",
    "documented refund process": "refundProcess",
    "provider verification evidence summary": "paymentProviderEvidenceNote",
    "provider verification date": "paymentProviderVerifiedDate",
    "decided cleaner engagement model": "cleanerModel",
    "customer cancellation rule": "cancellationPolicy",
    "customer payment timing": "paymentTiming",
    "customer quote response window": "customerQuoteValidityHours",
    "cleaner opportunity response window": "cleanerOpportunityValidityHours",
    "inactive-enquiry media retention period": "inactiveMediaRetentionDays",
    "completed-booking media retention period": "completedMediaRetentionDays"
  });

  function firstMappedRequirement(missing = []) {
    const label = missing.find((item) => requirementFields[item]) || "";
    return label ? { label, fieldName: requirementFields[label] } : null;
  }

  function navigationModel(readiness = {}) {
    const checks = readiness.checks || {};
    const missing = readiness.missing || {};
    const areas = Object.keys(checks).map((key) => ({
      key,
      complete: checks[key] === true,
      missingCount: Array.isArray(missing[key]) ? missing[key].length : 0,
      target: checks[key] === true ? null : firstMappedRequirement(missing[key])
    }));
    const nextTarget = readiness.next?.key ? areas.find((area) => area.key === readiness.next.key)?.target || null : null;
    return { areas, nextTarget };
  }

  globalObject.TidewayReadinessNavigator = Object.freeze({ requirementFields, firstMappedRequirement, navigationModel });
})(globalThis);
