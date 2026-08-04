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
