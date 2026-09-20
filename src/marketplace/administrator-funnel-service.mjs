const windows = new Set([7, 30, 90]);
// A year is offered for revenue and not for the funnel. The funnel's lanes are
// cohorts whose stages are still moving; a year of revenue is simply a year of
// money that has already been taken.
const revenueWindows = new Set([7, 30, 90, 365]);

function pence(value, label) {
  // A numeric string is accepted because PostgreSQL returns bigint as a string
  // through this driver. `isSafeInteger` is what actually matters: it refuses a
  // fraction and refuses a total large enough to have lost precision on the way
  // here, which is the only way these numbers can quietly become wrong.
  const parsed = Number(value);
  // Negative is impossible for every one of these EXCEPT the platform take,
  // which genuinely can be negative -- that is what an over-transferred
  // booking looks like, and hiding it would turn the one number worth acting
  // on into a zero.
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is unavailable.`);
  if (parsed < 0 && !label.startsWith("Platform")) throw new Error(`${label} is unavailable.`);
  return parsed;
}

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
    /**
     * What the money did.
     *
     * The funnel report states outright that it excludes monetary data, and
     * this deliberately does not change that: it is a separate read for a
     * separate screen. Every figure is summed from the same definitions
     * migration 121 uses per payment, because two ways of computing "what the
     * platform kept" is how a business ends up with two answers.
     *
     * It is contribution, not profit. Provider fees, the AI provider, hosting
     * and anybody's time are all outside this ledger, which is why the planned
     * contribution is carried alongside rather than a margin being claimed.
     */
    async revenue(actor, input = {}) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("administrator")) throw Object.assign(new Error("A Homle Administrator account is required."), { statusCode: 403, code: "administrator-required" });
      if (typeof repository.revenue !== "function") throw new TypeError("The Administrator revenue report is unavailable.");
      const windowDays = input.windowDays == null || input.windowDays === "" ? 30 : Number(input.windowDays);
      if (!Number.isInteger(windowDays) || !revenueWindows.has(windowDays)) throw new TypeError("Choose a 7, 30, 90 or 365 day revenue window.");
      const value = await repository.revenue(actor, windowDays);
      if (!value || typeof value !== "object") throw new Error("The revenue report is unavailable.");
      const capturedPence = pence(value.capturedPence, "Captured total");
      const refundedPence = pence(value.refundedPence, "Refunded total");
      const netCustomerPence = pence(value.netCustomerPence, "Net customer total");
      const transferredPence = pence(value.transferredPence, "Transferred total");
      const platformTakePence = pence(value.platformTakePence, "Platform contribution");
      // The arithmetic is re-checked rather than trusted. A summary that does
      // not add up is worse than no summary, because somebody will act on it.
      if (netCustomerPence !== capturedPence - refundedPence) throw new Error("The revenue totals do not reconcile.");
      if (platformTakePence !== netCustomerPence - transferredPence) throw new Error("The revenue totals do not reconcile.");
      if (refundedPence > capturedPence) throw new Error("The revenue totals do not reconcile.");
      return Object.freeze({
        windowDays,
        generatedAt: timestamp(value.generatedAt, "Revenue generation time"),
        capturedCount: integer(Number(value.capturedCount), "Captured payment count"),
        refundedCount: integer(Number(value.refundedCount), "Refunded payment count"),
        awaitingTransferCount: integer(Number(value.awaitingTransferCount), "Awaiting-transfer count"),
        capturedPence,
        refundedPence,
        netCustomerPence,
        transferredPence,
        platformTakePence,
        plannedContributionPence: pence(value.plannedContributionPence, "Planned contribution total")
      });
    },
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
      ensureDescending(["requestCount", "submittedCount", "bookingCount", "completedCount", "reviewCount"].map(field => requestJourney[field]), "Request funnel");
      if (requestJourney.scanCount > requestJourney.requestCount) throw new Error("Scan participation totals are unavailable.");
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
