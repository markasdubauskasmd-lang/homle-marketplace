const windows = new Set([7, 30, 90]);

function integer(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 10_000_000) throw new Error(`${label} is unavailable.`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

function lane(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is unavailable.`);
  return Object.freeze(Object.fromEntries(fields.map(([field, fieldLabel]) => [field, integer(value[field], fieldLabel)])));
}

function ensureDescending(values, label) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[index - 1]) throw new Error(`${label} totals are unavailable.`);
  }
}

export function createAdministratorFunnelService(repository) {
  if (!repository || typeof repository.get !== "function") throw new TypeError("A complete Administrator funnel repository is required.");
  return Object.freeze({
    async get(actor, input = {}) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("administrator")) throw Object.assign(new Error("A Homle Administrator account is required."), { statusCode: 403, code: "administrator-required" });
      const windowDays = input.windowDays == null || input.windowDays === "" ? 30 : Number(input.windowDays);
      if (!Number.isInteger(windowDays) || !windows.has(windowDays)) throw new TypeError("Choose a 7, 30 or 90 day funnel window.");
      const value = await repository.get(actor, { windowDays });
      if (!value || typeof value !== "object") throw new Error("The funnel report is unavailable.");

      const onboarding = lane(value.onboarding, [
        ["accountCount", "Landlord account count"],
        ["profileCount", "Landlord profile count"],
        ["propertyCount", "Property count"]
      ], "Onboarding funnel");
      const requestJourney = lane(value.requestJourney, [
        ["requestCount", "Request count"],
        ["scanCount", "Scan count"],
        ["submittedCount", "Submitted request count"],
        ["bookingCount", "Booking count"],
        ["completedCount", "Completed booking count"],
        ["reviewCount", "Review count"]
      ], "Request funnel");
      const payments = lane(value.payments, [
        ["bookingCount", "Payment cohort booking count"],
        ["paymentRecordCount", "Payment record count"],
        ["authorizedCount", "Authorized payment count"],
        ["capturedCount", "Captured payment count"],
        ["refundedCount", "Refunded payment count"]
      ], "Payment funnel");

      ensureDescending(Object.values(onboarding), "Onboarding funnel");
      ensureDescending(Object.values(requestJourney), "Request funnel");
      ensureDescending(Object.values(payments).slice(0, 4), "Payment funnel");
      if (payments.refundedCount > payments.capturedCount) throw new Error("Payment funnel totals are unavailable.");

      const cohortStartAt = timestamp(value.cohortStartAt, "Funnel cohort start");
      const cohortEndAt = timestamp(value.cohortEndAt, "Funnel cohort end");
      if (Date.parse(cohortStartAt) >= Date.parse(cohortEndAt)) throw new Error("Funnel cohort dates are unavailable.");
      return Object.freeze({
        windowDays: windows.has(value.windowDays) ? value.windowDays : (() => { throw new Error("The funnel window is unavailable."); })(),
        generatedAt: timestamp(value.generatedAt, "Funnel generation time"),
        cohortStartAt,
        cohortEndAt,
        maturityHours: value.maturityHours === 24 ? 24 : (() => { throw new Error("Funnel maturity boundary is unavailable."); })(),
        privacyScope: String(value.privacyScope || "").slice(0, 300),
        cohortPolicy: String(value.cohortPolicy || "").slice(0, 300),
        onboarding,
        requestJourney,
        payments
      });
    }
  });
}
