import "../public/proposal-economics.js";

const economics = globalThis.TidewayProposalEconomics;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(economics?.version === 1, "The shared proposal-economics model did not load.");

const assumptions = {
  labourOnCostPercent: 12.5,
  paymentFeePercent: 2.9,
  paymentFeeFixed: 0.3,
  travelCostPerJob: 3.75,
  suppliesCostPerJob: 2.4,
  riskContingencyPercent: 4
};
const exact = economics.calculateProposalEconomics({
  hours: 0.5,
  customerRate: 28.9,
  cleanerRate: 10,
  assumptions
});
assert(exact.customerTotal === 14.45, "Customer totals must be rounded to payable pennies.");
assert(exact.cleanerPay === 5 && exact.labourOnCosts === 0.63, "Cleaner pay and labour costs must be rounded independently.");
assert(exact.marginPercent < 9.5, "The regression fixture must prove the former algebraic penny rate misses the exact margin floor.");

const safe = economics.minimumSafeCustomerRate({
  hours: 0.5,
  cleanerRate: 10,
  targetMarginPercent: 9.5,
  assumptions
});
assert(safe.available, "An exact safe rate should be available for valid assumptions.");
assert(safe.customerRate === 28.91, "The shared solver must advance to the smallest exact safe penny rate.");
assert(safe.economics.marginPercent >= 9.5 && safe.economics.contribution > 0, "The displayed safe rate must pass the exact server margin checks.");
const preceding = economics.calculateProposalEconomics({ hours: 0.5, customerRate: safe.customerRate - 0.01, cleanerRate: 10, assumptions });
assert(preceding.marginPercent < 9.5, "The safe rate must not be padded above the smallest passing penny rate.");

const impossible = economics.minimumSafeCustomerRate({
  hours: 2,
  cleanerRate: 15,
  targetMarginPercent: 95,
  assumptions: { paymentFeePercent: 4, riskContingencyPercent: 2 }
});
assert(!impossible.available && impossible.reason === "invalid-inputs", "A non-viable margin/cost combination must fail closed.");

console.log("Proposal economics tests passed.");
