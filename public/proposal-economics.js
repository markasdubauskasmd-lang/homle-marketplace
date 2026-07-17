(function attachProposalEconomics(globalObject) {
  const version = 2;
  const assumptionFields = [
    "labourOnCostPercent",
    "paymentFeePercent",
    "paymentFeeFixed",
    "travelCostPerJob",
    "travelCostPerKm",
    "travelDistanceMultiplier",
    "suppliesCostPerJob",
    "riskContingencyPercent"
  ];

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function moneyValue(value) {
    return Math.round((finiteNumber(value) + Number.EPSILON) * 100) / 100;
  }

  function normaliseAssumptions(assumptions = {}) {
    return Object.fromEntries(assumptionFields.map((field) => [field, field === "travelDistanceMultiplier"
      ? Math.max(1, finiteNumber(assumptions[field], 1))
      : Math.max(0, finiteNumber(assumptions[field]))]));
  }

  function calculateProposalEconomics({ hours, customerRate, cleanerRate, additionalCosts = 0, travelDistanceKm = 0, assumptions = {} } = {}) {
    const safeHours = Math.max(0, finiteNumber(hours));
    const safeCustomerRate = Math.max(0, finiteNumber(customerRate));
    const safeCleanerRate = Math.max(0, finiteNumber(cleanerRate));
    const safeAdditionalCosts = Math.max(0, finiteNumber(additionalCosts));
    const safeTravelDistanceKm = Math.max(0, finiteNumber(travelDistanceKm));
    const costAssumptions = normaliseAssumptions(assumptions);
    const customerTotal = moneyValue(safeHours * safeCustomerRate);
    const cleanerPay = moneyValue(safeHours * safeCleanerRate);
    const labourOnCosts = moneyValue(cleanerPay * costAssumptions.labourOnCostPercent / 100);
    const paymentFees = moneyValue(customerTotal * costAssumptions.paymentFeePercent / 100 + costAssumptions.paymentFeeFixed);
    const travelCosts = moneyValue(costAssumptions.travelCostPerJob + safeTravelDistanceKm * costAssumptions.travelCostPerKm * costAssumptions.travelDistanceMultiplier);
    const suppliesCosts = moneyValue(costAssumptions.suppliesCostPerJob);
    const riskContingency = moneyValue(customerTotal * costAssumptions.riskContingencyPercent / 100);
    const otherCosts = moneyValue(safeAdditionalCosts);
    const nonCleanerCosts = moneyValue(labourOnCosts + paymentFees + travelCosts + suppliesCosts + riskContingency + otherCosts);
    const contribution = moneyValue(customerTotal - cleanerPay - nonCleanerCosts);
    const marginPercent = customerTotal > 0 ? (contribution / customerTotal) * 100 : 0;
    return {
      customerTotal,
      cleanerPay,
      labourOnCosts,
      paymentFees,
      travelCosts,
      suppliesCosts,
      riskContingency,
      otherCosts,
      nonCleanerCosts,
      contribution,
      marginPercent,
      travelDistanceKm: safeTravelDistanceKm,
      costAssumptions
    };
  }

  function minimumSafeCustomerRate({ hours, cleanerRate, additionalCosts = 0, travelDistanceKm = 0, targetMarginPercent, targetContribution = 0, assumptions = {} } = {}) {
    const safeHours = finiteNumber(hours);
    const safeCleanerRate = finiteNumber(cleanerRate);
    const safeAdditionalCosts = finiteNumber(additionalCosts);
    const safeTravelDistanceKm = finiteNumber(travelDistanceKm);
    const safeTargetMargin = finiteNumber(targetMarginPercent);
    const safeTargetContribution = finiteNumber(targetContribution);
    const costAssumptions = normaliseAssumptions(assumptions);
    const percentageCosts = (costAssumptions.paymentFeePercent + costAssumptions.riskContingencyPercent) / 100;
    const targetFactor = 1 - percentageCosts - safeTargetMargin / 100;
    const contributionFactor = 1 - percentageCosts;
    const inputsValid = safeHours > 0
      && safeCleanerRate > 0
      && safeAdditionalCosts >= 0
      && safeTravelDistanceKm >= 0
      && safeTargetContribution >= 0
      && safeTargetMargin > 0
      && safeTargetMargin < 100
      && targetFactor > 0
      && contributionFactor > 0;
    if (!inputsValid) return { available: false, reason: "invalid-inputs", targetFactor, contributionFactor };

    const zeroRevenue = calculateProposalEconomics({
      hours: safeHours,
      customerRate: 0,
      cleanerRate: safeCleanerRate,
      additionalCosts: safeAdditionalCosts,
      travelDistanceKm: safeTravelDistanceKm,
      assumptions: costAssumptions
    });
    const fixedCosts = zeroRevenue.cleanerPay
      + zeroRevenue.labourOnCosts
      + zeroRevenue.paymentFees
      + zeroRevenue.travelCosts
      + zeroRevenue.suppliesCosts
      + zeroRevenue.otherCosts;
    const marginRatePence = Math.ceil((((fixedCosts / targetFactor) / safeHours) * 100) - 1e-9);
    const contributionRatePence = Math.ceil(((((fixedCosts + safeTargetContribution) / contributionFactor) / safeHours) * 100) - 1e-9);
    let candidatePence = Math.max(1, marginRatePence, contributionRatePence);

    // The algebraic candidate is close, but every real component is rounded to pennies.
    // Verify the exact result and move up by pennies until the enforced margin truly passes.
    for (let attempt = 0; attempt <= 10000; attempt += 1, candidatePence += 1) {
      const customerRate = candidatePence / 100;
      const economics = calculateProposalEconomics({
        hours: safeHours,
        customerRate,
        cleanerRate: safeCleanerRate,
        additionalCosts: safeAdditionalCosts,
        travelDistanceKm: safeTravelDistanceKm,
        assumptions: costAssumptions
      });
      if (economics.contribution > 0 && economics.contribution + 1e-9 >= safeTargetContribution && economics.marginPercent + 1e-9 >= safeTargetMargin) {
        return { available: true, customerRate, customerTotal: economics.customerTotal, economics, targetFactor, contributionFactor, targetContribution: safeTargetContribution };
      }
    }
    return { available: false, reason: "safe-rate-not-found", targetFactor, contributionFactor };
  }

  globalObject.TidewayProposalEconomics = Object.freeze({
    version,
    moneyValue,
    normaliseAssumptions,
    calculateProposalEconomics,
    minimumSafeCustomerRate
  });
})(globalThis);
