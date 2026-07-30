import assert from "node:assert/strict";
import { createAdministratorCoverageRepository } from "../src/marketplace/administrator-coverage-repository.mjs";
import { createAdministratorCoverageService } from "../src/marketplace/administrator-coverage-service.mjs";

const administrator = { userId: "11111111-1111-4111-8111-111111111111", roles: ["administrator"] };
const report = {
  windowDays: 30,
  generatedAt: "2026-07-30T20:00:00.000Z",
  matchingMode: "marketplace",
  privacyScope: "Outward-postcode aggregates only.",
  summary: {
    submittedRequestCount: 3, openUnmatchedRequestCount: 1, expiredUnmatchedRequestCount: 0,
    zeroMatchRequestCount: 0, atRiskRequestCount: 1, areaCount: 1, gapAreaCount: 0,
    activeListedCleanerCount: 2, oldestUnmatchedHours: 4
  },
  areas: [{
    outwardPostcode: "SW1A", submittedRequestCount: 3, openUnmatchedRequestCount: 1,
    expiredUnmatchedRequestCount: 0, zeroMatchRequestCount: 0, atRiskRequestCount: 1,
    minimumEligibleCleanerCount: 1, maximumEligibleCleanerCount: 1, eligibleCountCapped: false,
    oldestUnmatchedHours: 4, demandServiceCodes: ["standard-clean"], zeroMatchServiceCodes: []
  }]
};

const calls = [];
const service = createAdministratorCoverageService({
  async get(actor, input) { calls.push({ actor, input }); return report; }
});
const result = await service.get(administrator, { windowDays: "30" });
assert(Object.isFrozen(result) && Object.isFrozen(result.summary) && Object.isFrozen(result.areas) && Object.isFrozen(result.areas[0]));
assert.deepEqual(calls[0], { actor: administrator, input: { windowDays: 30 } });
assert.equal(result.areas[0].outwardPostcode, "SW1A");
await assert.rejects(service.get({ userId: "22222222-2222-4222-8222-222222222222", roles: ["landlord"] }), /Administrator/);
await assert.rejects(service.get(administrator, { windowDays: "365" }), /7, 30 or 90/);

for (const unsafe of [
  { areas: [{ ...report.areas[0], outwardPostcode: "SW1A 1AA" }] },
  { areas: [{ ...report.areas[0], minimumEligibleCleanerCount: 3, maximumEligibleCleanerCount: 1 }] },
  { summary: { ...report.summary, areaCount: 2 } },
  { matchingMode: "browser-selected" },
  { areas: [{ ...report.areas[0], demandServiceCodes: ["standard-clean", "standard-clean"] }] }
]) {
  const malformed = createAdministratorCoverageService({ async get() { return { ...report, ...unsafe }; } });
  await assert.rejects(malformed.get(administrator), /unavailable/);
}

const queries = [];
const database = {
  withUserTransaction(actor, callback) {
    return callback({
      async query(text, values) {
        queries.push({ actor, text, values });
        return { rows: [{ result: report }] };
      }
    });
  }
};
const repository = createAdministratorCoverageRepository(database, { requirePayoutReady: true });
assert.deepEqual(await repository.get(administrator, { windowDays: 7 }), report);
assert(queries[0].text.includes("get_administrator_coverage_report") && queries[0].values[0] === 7 && queries[0].values[1] === true, "The browser could influence payment-mode eligibility.");
assert.throws(() => createAdministratorCoverageRepository(database, {}), /explicit payment-mode boundary/);

console.log("Administrator coverage service tests passed: privacy shape, stored-output integrity, role isolation and server-owned payment mode.");
