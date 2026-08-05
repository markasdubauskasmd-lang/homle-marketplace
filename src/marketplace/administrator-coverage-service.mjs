const windows = new Set([7, 30, 90]);
const matchingModes = new Set(["marketplace", "payout-ready"]);
const outwardPostcodePattern = /^(?:[A-Z]{1,2}[0-9][A-Z0-9]?|UNKNOWN)$/;
const serviceCodePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is unavailable.`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

function serviceCodes(value, label) {
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${label} are unavailable.`);
  const result = value.map((item) => String(item || "").trim().toLowerCase());
  if (result.some((item) => !serviceCodePattern.test(item)) || new Set(result).size !== result.length) throw new Error(`${label} are unavailable.`);
  return Object.freeze(result);
}

function optionalEligibleCount(value, label) {
  return value == null ? null : integer(value, 0, 50, label);
}

function area(value) {
  if (!value || typeof value !== "object") throw new Error("A coverage area is unavailable.");
  const outwardPostcode = String(value.outwardPostcode || "").trim().toUpperCase();
  if (!outwardPostcodePattern.test(outwardPostcode)) throw new Error("A coverage area is unavailable.");
  const minimumEligibleCleanerCount = optionalEligibleCount(value.minimumEligibleCleanerCount, "Minimum eligible Cleaner count");
  const maximumEligibleCleanerCount = optionalEligibleCount(value.maximumEligibleCleanerCount, "Maximum eligible Cleaner count");
  if ((minimumEligibleCleanerCount == null) !== (maximumEligibleCleanerCount == null)
    || (minimumEligibleCleanerCount != null && minimumEligibleCleanerCount > maximumEligibleCleanerCount)) throw new Error("Eligible Cleaner counts are unavailable.");
  return Object.freeze({
    outwardPostcode,
    submittedRequestCount: integer(value.submittedRequestCount, 0, 10_000_000, "Submitted request count"),
    openUnmatchedRequestCount: integer(value.openUnmatchedRequestCount, 0, 10_000_000, "Open unmatched request count"),
    expiredUnmatchedRequestCount: integer(value.expiredUnmatchedRequestCount, 0, 10_000_000, "Expired unmatched request count"),
    zeroMatchRequestCount: integer(value.zeroMatchRequestCount, 0, 10_000_000, "Zero-match request count"),
    atRiskRequestCount: integer(value.atRiskRequestCount, 0, 10_000_000, "At-risk request count"),
    minimumEligibleCleanerCount,
    maximumEligibleCleanerCount,
    eligibleCountCapped: value.eligibleCountCapped === true,
    oldestUnmatchedHours: integer(value.oldestUnmatchedHours, 0, 1_000_000, "Oldest unmatched age"),
    demandServiceCodes: serviceCodes(value.demandServiceCodes, "Demand service codes"),
    zeroMatchServiceCodes: serviceCodes(value.zeroMatchServiceCodes, "Zero-match service codes")
  });
}

function summary(value) {
  if (!value || typeof value !== "object") throw new Error("The coverage summary is unavailable.");
  return Object.freeze({
    submittedRequestCount: integer(value.submittedRequestCount, 0, 10_000_000, "Submitted request count"),
    openUnmatchedRequestCount: integer(value.openUnmatchedRequestCount, 0, 10_000_000, "Open unmatched request count"),
    expiredUnmatchedRequestCount: integer(value.expiredUnmatchedRequestCount, 0, 10_000_000, "Expired unmatched request count"),
    zeroMatchRequestCount: integer(value.zeroMatchRequestCount, 0, 10_000_000, "Zero-match request count"),
    atRiskRequestCount: integer(value.atRiskRequestCount, 0, 10_000_000, "At-risk request count"),
    areaCount: integer(value.areaCount, 0, 100_000, "Area count"),
    gapAreaCount: integer(value.gapAreaCount, 0, 100_000, "Gap area count"),
    activeListedCleanerCount: integer(value.activeListedCleanerCount, 0, 10_000_000, "Listed Cleaner count"),
    oldestUnmatchedHours: integer(value.oldestUnmatchedHours, 0, 1_000_000, "Oldest unmatched age")
  });
}

export function createAdministratorCoverageService(repository) {
  if (!repository || typeof repository.get !== "function") throw new TypeError("A complete Administrator coverage repository is required.");
  return Object.freeze({
    async get(actor, input = {}) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("administrator")) throw Object.assign(new Error("A Homle Administrator account is required."), { statusCode: 403, code: "administrator-required" });
      const windowDays = input.windowDays == null || input.windowDays === "" ? 30 : Number(input.windowDays);
      if (!Number.isInteger(windowDays) || !windows.has(windowDays)) throw new TypeError("Choose a 7, 30 or 90 day coverage window.");
      const value = await repository.get(actor, { windowDays });
      if (!value || typeof value !== "object" || !matchingModes.has(value.matchingMode) || !Array.isArray(value.areas)) throw new Error("The coverage report is unavailable.");
      const selectedSummary = summary(value.summary);
      const areas = Object.freeze(value.areas.map(area));
      if (selectedSummary.areaCount !== areas.length || selectedSummary.gapAreaCount > selectedSummary.areaCount) throw new Error("Coverage area totals are unavailable.");
      return Object.freeze({
        windowDays: windows.has(value.windowDays) ? value.windowDays : (() => { throw new Error("The coverage window is unavailable."); })(),
        generatedAt: timestamp(value.generatedAt, "Coverage generation time"),
        matchingMode: value.matchingMode,
        privacyScope: String(value.privacyScope || "").slice(0, 300),
        summary: selectedSummary,
        areas
      });
    }
  });
}
