(function attachProposalEconomics(globalObject) {
  const version = 1;
  const assumptionFields = [
    "labourOnCostPercent",
    "paymentFeePercent",
    "paymentFeeFixed",
    "travelCostPerJob",
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
    return Object.fromEntries(assumptionFields.map((field) => [field, Math.max(0, finiteNumber(assumptions[field]))]));
  }

  function calculateProposalEconomics({ hours, customerRate, cleanerRate, additionalCosts = 0, assumptions = {} } = {}) {
    const safeHours = Math.max(0, finiteNumber(hours));
    const safeCustomerRate = Math.max(0, finiteNumber(customerRate));
    const safeCleanerRate = Math.max(0, finiteNumber(cleanerRate));
    const safeAdditionalCosts = Math.max(0, finiteNumber(additionalCosts));
    const costAssumptions = normaliseAssumptions(assumptions);
    const customerTotal = moneyValue(safeHours * safeCustomerRate);
    const cleanerPay = moneyValue(safeHours * safeCleanerRate);
    const labourOnCosts = moneyValue(cleanerPay * costAssumptions.labourOnCostPercent / 100);
    const paymentFees = moneyValue(customerTotal * costAssumptions.paymentFeePercent / 100 + costAssumptions.paymentFeeFixed);
    const travelCosts = moneyValue(costAssumptions.travelCostPerJob);
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
      costAssumptions
    };
  }

  function minimumSafeCustomerRate({ hours, cleanerRate, additionalCosts = 0, targetMarginPercent, assumptions = {} } = {}) {
    const safeHours = finiteNumber(hours);
    const safeCleanerRate = finiteNumber(cleanerRate);
    const safeAdditionalCosts = finiteNumber(additionalCosts);
    const safeTargetMargin = finiteNumber(targetMarginPercent);
    const costAssumptions = normaliseAssumptions(assumptions);
    const percentageCosts = (costAssumptions.paymentFeePercent + costAssumptions.riskContingencyPercent) / 100;
    const targetFactor = 1 - percentageCosts - safeTargetMargin / 100;
    const inputsValid = safeHours > 0
      && safeCleanerRate > 0
      && safeAdditionalCosts >= 0
      && safeTargetMargin > 0
      && safeTargetMargin < 100
      && targetFactor > 0;
    if (!inputsValid) return { available: false, reason: "invalid-inputs", targetFactor };

    const zeroRevenue = calculateProposalEconomics({
      hours: safeHours,
      customerRate: 0,
      cleanerRate: safeCleanerRate,
      additionalCosts: safeAdditionalCosts,
      assumptions: costAssumptions
    });
    const fixedCosts = zeroRevenue.cleanerPay
      + zeroRevenue.labourOnCosts
      + zeroRevenue.paymentFees
      + zeroRevenue.travelCosts
      + zeroRevenue.suppliesCosts
      + zeroRevenue.otherCosts;
    let candidatePence = Math.max(1, Math.ceil((((fixedCosts / targetFactor) / safeHours) * 100) - 1e-9));

    // The algebraic candidate is close, but every real component is rounded to pennies.
    // Verify the exact result and move up by pennies until the enforced margin truly passes.
    for (let attempt = 0; attempt <= 10000; attempt += 1, candidatePence += 1) {
      const customerRate = candidatePence / 100;
      const economics = calculateProposalEconomics({
        hours: safeHours,
        customerRate,
        cleanerRate: safeCleanerRate,
        additionalCosts: safeAdditionalCosts,
        assumptions: costAssumptions
      });
      if (economics.contribution > 0 && economics.marginPercent + 1e-9 >= safeTargetMargin) {
        return { available: true, customerRate, customerTotal: economics.customerTotal, economics, targetFactor };
      }
    }
    return { available: false, reason: "safe-rate-not-found", targetFactor };
  }

  globalObject.TidewayProposalEconomics = Object.freeze({
    version,
    moneyValue,
    normaliseAssumptions,
    calculateProposalEconomics,
    minimumSafeCustomerRate
  });
})(globalThis);
