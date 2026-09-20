import assert from "node:assert/strict";
import { createAdministratorFunnelRepository } from "../src/marketplace/administrator-funnel-repository.mjs";
import { createAdministratorFunnelService } from "../src/marketplace/administrator-funnel-service.mjs";

const administrator = { userId: "11111111-1111-4111-8111-111111111111", roles: ["administrator"] };
const report = {
  windowDays: 30,
  generatedAt: "2026-08-04T12:00:00.000Z",
  cohortStartAt: "2026-07-05T12:00:00.000Z",
  cohortEndAt: "2026-08-03T12:00:00.000Z",
  maturityHours: 24,
  privacyScope: "Aggregate stage counts only.",
  cohortPolicy: "Each lane is an independent cohort.",
  onboarding: { accountCount: 10, profileCount: 8, propertyCount: 6 },
  requestJourney: { requestCount: 6, scanCount: 5, submittedCount: 4, bookingCount: 3, completedCount: 2, reviewCount: 1 },
  payments: { bookingCount: 3, paymentRecordCount: 2, authorizedCount: 2, capturedCount: 1, refundedCount: 1 }
};

const calls = [];
const service = createAdministratorFunnelService({ async get(actor, input) { calls.push({ actor, input }); return report; } });
const result = await service.get(administrator, { windowDays: "30" });
assert(Object.isFrozen(result) && Object.isFrozen(result.onboarding) && Object.isFrozen(result.requestJourney) && Object.isFrozen(result.payments));
assert.deepEqual(calls[0], { actor: administrator, input: { windowDays: 30 } });
assert.equal(result.requestJourney.reviewCount, 1);
await assert.rejects(service.get({ userId: "22222222-2222-4222-8222-222222222222", roles: ["landlord"] }), /Administrator/);
await assert.rejects(service.get(administrator, { windowDays: "365" }), /7, 30 or 90/);

for (const unsafe of [
  { onboarding: { ...report.onboarding, propertyCount: 11 } },
  { requestJourney: { ...report.requestJourney, bookingCount: 7 } },
  { requestJourney: { ...report.requestJourney, scanCount: 7 } },
  { payments: { ...report.payments, refundedCount: 2 } },
  { maturityHours: 0 },
  { cohortStartAt: report.cohortEndAt }
]) {
  const malformed = createAdministratorFunnelService({ async get() { return { ...report, ...unsafe }; } });
  await assert.rejects(malformed.get(administrator), /unavailable/);
}

const queries = [];
const database = {
  withUserTransaction(actor, callback) {
    return callback({ async query(text, values) { queries.push({ actor, text, values }); return { rows: [{ result: report }] }; } });
  }
};
const repository = createAdministratorFunnelRepository(database);
assert.deepEqual(await repository.get(administrator, { windowDays: 7 }), report);
assert(queries[0].text.includes("get_administrator_funnel_report") && queries[0].values[0] === 7, "The repository did not bind the reviewed aggregate projection and exact window.");

console.log("Administrator funnel service tests passed: cumulative cohorts, maturity boundary, stored-output integrity and role isolation.");

for (const scanCount of [0, 1, 6]) {
  const mixed = createAdministratorFunnelService({get:async()=>({...report,requestJourney:{...report.requestJourney,scanCount}})});
  const actual = await mixed.get(administrator);
  assert.equal(actual.requestJourney.submittedCount,4);
  assert.equal(actual.requestJourney.reviewCount,1);
  assert.equal(actual.requestJourney.scanCount,scanCount);
}
console.log("Manual and mixed request cohorts remain valid with optional scanning.");

/* ── The revenue summary ───────────────────────────────────────────────── */

// Per-booking economics existed and nothing summed them, so the platform could
// say how many bookings completed and not what they were worth.
{
  const { createAdministratorFunnelService: createService } = await import("../src/marketplace/administrator-funnel-service.mjs");
  const administrator = { userId: "44444444-4444-4444-8444-444444444444", roles: ["administrator"] };
  const outsider = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
  const base = {
    windowDays: 30, generatedAt: "2026-09-20T03:00:00.000Z",
    capturedCount: 3, refundedCount: 1, awaitingTransferCount: 1,
    capturedPence: 36000, refundedPence: 1500, netCustomerPence: 34500,
    transferredPence: 25200, platformTakePence: 9300, plannedContributionPence: 10800
  };
  function service(overrides = {}, calls = []) {
    return createService({
      async get() { throw new Error("the funnel report must not be used for revenue"); },
      async revenue(actor, windowDays) { calls.push({ actor, windowDays }); return { ...base, ...overrides }; }
    });
  }

  const calls = [];
  const revenue = await service({}, calls).revenue(administrator, { windowDays: "90" });
  assert.equal(calls[0].windowDays, 90);
  assert.equal(revenue.platformTakePence, 9300);
  assert.equal(revenue.plannedContributionPence, 10800);

  // The default is thirty days, and a year is offered here even though the
  // funnel stops at ninety.
  assert.equal((await service().revenue(administrator, {})).windowDays, 30);
  assert.equal((await service({ windowDays: 365 }).revenue(administrator, { windowDays: 365 })).windowDays, 365);
  for (const windowDays of [0, 31, 1000, "many", -7]) {
    await assert.rejects(() => service().revenue(administrator, { windowDays }), /7, 30, 90 or 365/, `An unsupported revenue window was accepted: ${windowDays}`);
  }
  await assert.rejects(() => service().revenue(outsider, {}), /Administrator/, "A Landlord read the platform revenue.");

  // The arithmetic is re-checked rather than trusted. A summary that does not
  // add up is worse than no summary, because somebody will act on it.
  for (const broken of [
    { netCustomerPence: 34499 },
    { platformTakePence: 9301 },
    { refundedPence: 40000, netCustomerPence: -4000 },
    { transferredPence: -1 },
    { capturedPence: 1.5 },
    { capturedPence: Number.MAX_SAFE_INTEGER + 2 }
  ]) {
    await assert.rejects(() => service(broken).revenue(administrator, {}), /unavailable|reconcile/,
      `An impossible revenue summary was reported: ${JSON.stringify(broken)}`);
  }

  // A whole number arriving as a string is accepted on purpose: PostgreSQL
  // returns bigint as a string through this driver, and refusing it would be a
  // fragile failure on a legitimate shape. What must not pass is a value that
  // is not a whole number, or one large enough to have lost precision.
  assert.equal((await service({ capturedPence: "36000" }).revenue(administrator, {})).capturedPence, 36000);

  // A negative platform take is REAL -- it is what an over-transferred booking
  // looks like -- and must survive, because it is the one figure here worth
  // acting on.
  const overTransferred = await service({
    capturedPence: 10000, refundedPence: 0, netCustomerPence: 10000,
    transferredPence: 12000, platformTakePence: -2000
  }).revenue(administrator, {});
  assert.equal(overTransferred.platformTakePence, -2000, "An over-transferred window was hidden instead of reported.");
}

/* ── The screen says what the numbers are, and are not ─────────────────── */

{
  const { poundsLabel, revenueLines, revenueWarning, revenueWindow } = await import("../public/admin-payments-model.js");
  assert.equal(poundsLabel(9300), "£93.00");
  assert.equal(poundsLabel(0), "£0.00");
  // Negative renders as negative rather than as zero or its absolute value.
  assert.equal(poundsLabel(-2000), "−£20.00");
  assert.throws(() => poundsLabel(1.5), /unavailable/);
  assert.throws(() => poundsLabel("lots"), /unavailable/);
  for (const bad of [0, 31, "many"]) assert.throws(() => revenueWindow(bad), /7, 30, 90 or 365/);

  const lines = revenueLines({
    capturedCount: 3, refundedCount: 1, awaitingTransferCount: 0,
    capturedPence: 36000, refundedPence: 1500, netCustomerPence: 34500,
    transferredPence: 25200, platformTakePence: 9300, plannedContributionPence: 10800
  });
  assert.equal(lines.length, 6);
  // Contribution, not profit, and the screen must say so: a figure labelled
  // profit that is not profit is the kind of thing a business plans against
  // for a year before noticing.
  assert.ok(lines.some((line) => /contribution, not profit/i.test(line.note)), "The summary no longer distinguishes contribution from profit.");
  assert.ok(lines.some((line) => /Money still in flight is not counted/.test(line.note)), "The summary no longer says unsettled transfers are excluded.");
  assert.ok(!lines.some((line) => /profit margin|net profit/i.test(line.label)), "The summary claims a profit figure it cannot compute.");

  assert.equal(revenueWarning({ awaitingTransferCount: 0 }), "");
  assert.match(revenueWarning({ awaitingTransferCount: 1 }), /has no confirmed transfer[\s\S]*higher than what Homle will actually keep/);
  assert.match(revenueWarning({ awaitingTransferCount: 4 }), /4 captured payments have/);
}
console.log("Revenue summary checks passed: validated windows, re-checked arithmetic, a real negative contribution preserved, and a screen that says contribution rather than profit.");
