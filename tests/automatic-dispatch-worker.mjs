import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createBookingPricingPolicy } from "../src/marketplace/booking-workflow.mjs";
import { createAutomaticDispatchRepository } from "../src/marketplace/automatic-dispatch-repository.mjs";
import { createAutomaticDispatchWorker } from "../src/marketplace/automatic-dispatch-worker.mjs";

const requestId = "66666666-6666-4666-8666-666666666666";
const leaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const firstBookingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const secondBookingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = new Date("2026-07-16T08:00:00.000Z");
const common = {
  requested_start_at: "2026-07-20T09:00:00.000Z", requested_end_at: "2026-07-20T12:00:00.000Z",
  required_services: ["regular-domestic"], budget_pence: 20000, base_match_score: "60", distance_km: "1.0",
  services: [{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 2000 }]
};
const best = { ...common, cleaner_id: "22222222-2222-4222-8222-222222222222", public_slug: "best", base_match_score: "72" };
const backup = { ...common, cleaner_id: "33333333-3333-4333-8333-333333333333", public_slug: "backup", base_match_score: "60", distance_km: "2.0" };
const manual = { ...common, cleaner_id: "44444444-4444-4444-8444-444444444444", public_slug: "manual", base_match_score: "90", services: [{ serviceCode: "regular-domestic", pricingModel: "quote", pricePence: null }] };
const pricing = createBookingPricingPolicy({ targetMarginBasisPoints: 2000, labourOnCostBasisPoints: 1000, paymentFeeBasisPoints: 300, paymentFeeFixedPence: 20, travelCostPence: 500, suppliesCostPence: 250, otherCostPence: 0, invitationTtlMinutes: 180 });

const actions = [];
const ids = [leaseId, firstBookingId, secondBookingId];
const repository = {
  async claimDue(token, limit, seconds) { actions.push({ kind: "claim", token, limit, seconds }); return [{ cleaningRequestId: requestId, leaseExpiresAt: "2026-07-16T08:02:00.000Z" }]; },
  async getCandidates(id, token, limit) { actions.push({ kind: "candidates", id, token, limit }); return [backup, manual, best]; },
  async complete(input) { actions.push({ kind: "complete", input }); if (input.cleanerId === best.cleaner_id) throw Object.assign(new Error("stale"), { code: "candidate-stale" }); return { bookingId: input.bookingId }; },
  async release(id, token, outcome, retryAt) { actions.push({ kind: "release", id, token, outcome, retryAt }); }
};
const worker = createAutomaticDispatchWorker(repository, pricing, { createId: () => ids.shift(), clock: () => new Date(now), retryMinutes: 15 });
const result = await worker.runOnce();
assert.deepEqual(result, { claimed: 1, invited: 1, noMatch: 0, stale: 0, deferred: 0 });
const attempts = actions.filter((action) => action.kind === "complete");
assert.equal(attempts.length, 2);
assert.equal(attempts[0].input.cleanerId, best.cleaner_id, "The most suitable profitable Cleaner was not attempted first.");
assert.equal(attempts[1].input.cleanerId, backup.cleaner_id, "A stale best match did not fall through to the next profitable Cleaner.");
assert.ok(Number.isInteger(attempts[1].input.customerPricePence) && attempts[1].input.customerPricePence > attempts[1].input.cleanerPayPence && !actions.some((action) => action.kind === "release"), "Automatic invitation lost private margin terms or released a successful lease.");

const noMatchActions = [];
const noMatchWorker = createAutomaticDispatchWorker({
  async claimDue() { return [{ cleaningRequestId: requestId, leaseExpiresAt: "2026-07-16T08:02:00.000Z" }]; },
  async getCandidates() { return [manual]; }, async complete() { throw new Error("must not invite"); },
  async release(id, token, outcome, retryAt) { noMatchActions.push({ id, token, outcome, retryAt }); }
}, pricing, { createId: () => leaseId, clock: () => new Date(now), retryMinutes: 10 });
assert.deepEqual(await noMatchWorker.runOnce(), { claimed: 1, invited: 0, noMatch: 1, stale: 0, deferred: 0 });
assert.equal(noMatchActions[0].outcome, "no-eligible-candidate");
assert.equal(noMatchActions[0].retryAt, "2026-07-16T08:10:00.000Z");

const staleActions = [];
const staleIds = [leaseId, firstBookingId, secondBookingId];
const staleWorker = createAutomaticDispatchWorker({
  async claimDue() { return [{ cleaningRequestId: requestId, leaseExpiresAt: "2026-07-16T08:02:00.000Z" }]; },
  async getCandidates() { return [best, backup]; }, async complete() { throw Object.assign(new Error("changed"), { code: "candidate-stale" }); },
  async release(id, token, outcome, retryAt) { staleActions.push({ id, token, outcome, retryAt }); }
}, pricing, { createId: () => staleIds.shift(), clock: () => new Date(now) });
assert.deepEqual(await staleWorker.runOnce(), { claimed: 1, invited: 0, noMatch: 0, stale: 1, deferred: 0 });
assert.equal(staleActions[0].outcome, "candidates-stale");

const transientActions = [];
const transientWorker = createAutomaticDispatchWorker({
  async claimDue() { return [{ cleaningRequestId: requestId, leaseExpiresAt: "2026-07-16T08:02:00.000Z" }]; },
  async getCandidates() { throw new Error("private database host"); }, async complete() {},
  async release(id, token, outcome) { transientActions.push({ id, token, outcome }); }
}, pricing, { createId: () => leaseId, clock: () => new Date(now) });
assert.deepEqual(await transientWorker.runOnce(), { claimed: 1, invited: 0, noMatch: 0, stale: 0, deferred: 1 });
assert.equal(transientActions[0].outcome, "transient-failure");

let sharedClaimed = false;
let concurrentInvitations = 0;
const concurrentRepository = {
  async claimDue() {
    if (sharedClaimed) return [];
    sharedClaimed = true;
    return [{ cleaningRequestId: requestId, leaseExpiresAt: "2026-07-16T08:02:00.000Z" }];
  },
  async getCandidates() { return [best]; },
  async complete() { concurrentInvitations += 1; },
  async release() {}
};
const concurrentIdsA = [leaseId, firstBookingId];
const concurrentIdsB = ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", secondBookingId];
const concurrentA = createAutomaticDispatchWorker(concurrentRepository, pricing, { createId: () => concurrentIdsA.shift(), clock: () => new Date(now) });
const concurrentB = createAutomaticDispatchWorker(concurrentRepository, pricing, { createId: () => concurrentIdsB.shift(), clock: () => new Date(now) });
const concurrentResults = await Promise.all([concurrentA.runOnce(), concurrentB.runOnce()]);
assert.equal(concurrentResults.reduce((total, entry) => total + entry.claimed, 0), 1);
assert.equal(concurrentInvitations, 1, "Two concurrent worker loops created more than one invitation for one leased request.");

const databaseCalls = [];
const pool = { async query(text, values) {
  databaseCalls.push({ text, values });
  if (text.includes("claim_due")) return { rows: [{ cleaning_request_id: requestId, lease_expires_at: "2026-07-16T08:02:00.000Z" }] };
  if (text.includes("get_automatic")) return { rows: [{ get_automatic_dispatch_candidates: best }] };
  if (text.includes("complete_automatic")) return { rows: [{ dispatch: { bookingId: firstBookingId } }] };
  return { rows: [{ release: { cleaningRequestId: requestId, outcome: "transient-failure" } }] };
} };
const databaseRepository = createAutomaticDispatchRepository(pool);
await databaseRepository.claimDue(leaseId, 10, 120);
await databaseRepository.getCandidates(requestId, leaseId, 25);
await databaseRepository.complete({ cleaningRequestId: requestId, leaseToken: leaseId, bookingId: firstBookingId, cleanerId: best.cleaner_id, responseDeadline: "2026-07-16T11:00:00.000Z", customerPricePence: 10000, cleanerPayPence: 7000, labourOnCostPence: 700, paymentFeePence: 320, travelCostPence: 500, suppliesCostPence: 250, otherCostPence: 0, targetMarginBasisPoints: 2000 });
await databaseRepository.release(requestId, leaseId, "transient-failure", "2026-07-16T08:15:00.000Z");
assert.equal(databaseCalls.length, 4);
assert.ok(databaseCalls.every((call) => call.text.includes("$1") && !call.text.includes(requestId) && !call.text.includes(leaseId)), "The worker repository interpolated request or lease identifiers into SQL.");
assert.deepEqual(databaseCalls[2].values.slice(0, 4), [requestId, leaseId, firstBookingId, best.cleaner_id]);

const [migration, runtimeGrants, workerGrants] = await Promise.all([
  readFile(new URL("../db/migrations/029_consent_bound_automatic_dispatch.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8")
]);
for (const required of ["automatic_dispatch_authorized_at", "automatic_dispatch_attempt_limit BETWEEN 1 AND 5", "FOR UPDATE SKIP LOCKED", "automatic_dispatch_lease_token=lease_token", "prior.cleaner_user_id=candidate.cleaner_id", "tideway_private.invite_cleaner", "change_source='system'", "automatic-dispatch-authorized", "REVOKE ALL ON FUNCTION tideway_private.complete_automatic_dispatch"]) assert.ok(migration.includes(required), `Automatic dispatch migration omitted ${required}.`);
assert.ok(runtimeGrants.includes("configure_automatic_dispatch(uuid,boolean,smallint)") && runtimeGrants.includes("REVOKE UPDATE, DELETE ON cleaning_requests"), "The web role can bypass consent-controlled request updates.");
for (const signature of ["claim_due_automatic_dispatch(uuid,integer,integer)", "get_automatic_dispatch_candidates(uuid,uuid,integer)", "complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer)", "release_automatic_dispatch_lease(uuid,uuid,text,timestamptz)"]) assert.ok(workerGrants.includes(signature), `The dedicated worker role cannot execute ${signature}.`);

console.log("Automatic dispatch tests passed: explicit consent, bounded concurrent leases/attempts, profitable best-match ranking, stale fallback, retry handling, parameterized worker access and function-only permissions.");
