import assert from "node:assert/strict";
import { createMaintenanceRepository } from "../src/marketplace/maintenance-repository.mjs";
import { createMarketplaceMaintenanceJobs } from "../src/marketplace/maintenance-worker.mjs";
import { createMarketplaceWorkerAttachment, probeMarketplaceWorkerDatabase, requiredWorkerFunctions, workerPoolEnvironment } from "../src/marketplace/worker-attachment.mjs";
import { createMarketplaceWorkerRuntime } from "../src/marketplace/worker-runtime.mjs";
import { createWorkerSupervisor } from "../src/marketplace/worker-supervisor.mjs";
import { runPostgresWorkerVerification, validateWorkerVerificationTarget, workerVerificationConfirmation } from "../tools/postgres-worker-verification-runner.mjs";

const workerRelease = Object.freeze({ source: "packaged", sourceCommit: "607f0113", builtAt: new Date(Date.now() - 60_000).toISOString(), migrationCount: 44 });
const workerEnvironment = Object.freeze({ MARKETPLACE_WORKER_ENABLED: "true", TIDEWAY_EXPECT_RELEASE: "607f0113", WORKER_DATABASE_URL: "postgresql://tideway_worker@127.0.0.1/test" });

let now = Date.parse("2026-07-16T09:00:00.000Z");
const timers = [];
const monitorCalls = [];
const timerFactory = (callback, delay) => {
  const timer = { callback, delay, cleared: false, unrefCalled: false, unref() { this.unrefCalled = true; } };
  timers.push(timer);
  return timer;
};
let successRuns = 0;
const supervisor = createWorkerSupervisor([{ name: "safe-job", intervalMs: 5000, retryMs: 1000, async runOnce() { successRuns += 1; return { processed: 2, privateDetail: "must-not-appear", invalid_number: -1 }; } }], {
  clock: () => new Date(now++),
  setTimer: timerFactory,
  clearTimer: (timer) => { timer.cleared = true; },
  onUnexpectedError(error, context) { monitorCalls.push({ error, context }); }
});
assert.equal(supervisor.start({ runImmediately: false }).healthy, false, "A worker was healthy before its first successful run.");
assert.equal(timers[0].delay, 5000);
assert.equal(timers[0].unrefCalled, false, "A standalone worker timer was detached and could let the process exit.");
assert.deepEqual(await supervisor.runNow("safe-job"), { ran: true, ok: true, result: { processed: 2 } });
assert.equal(supervisor.snapshot().healthy, true);
assert.equal(supervisor.snapshot().jobs[0].lastResult.privateDetail, undefined, "Worker health leaked a string result.");
assert.equal(successRuns, 1);

let releaseOverlap;
const overlap = createWorkerSupervisor([{ name: "overlap-job", intervalMs: 5000, runOnce: () => new Promise((resolve) => { releaseOverlap = resolve; }) }], { onUnexpectedError() {} });
const firstOverlap = overlap.runNow("overlap-job");
assert.deepEqual(await overlap.runNow("overlap-job"), { ran: false, reason: "already-running" });
releaseOverlap({ processed: 1 });
assert.equal((await firstOverlap).ok, true);
await overlap.close();

let fail = true;
const recovering = createWorkerSupervisor([{ name: "recovery-job", intervalMs: 5000, retryMs: 1000, async runOnce() { if (fail) throw new Error("private worker failure"); return { processed: 0 }; } }], { onUnexpectedError(error, context) { monitorCalls.push({ error, context }); } });
recovering.start({ runImmediately: false });
assert.equal((await recovering.runNow("recovery-job")).ok, false);
assert.equal(recovering.snapshot().healthy, false);
assert.equal(monitorCalls.at(-1).context.job, "recovery-job");
fail = false;
assert.equal((await recovering.runNow("recovery-job")).ok, true);
assert.equal(recovering.snapshot().healthy, true);
await recovering.close();
assert.equal(recovering.snapshot().closed, true);

const queries = [];
const repository = createMaintenanceRepository({ async query(text, values) {
  queries.push({ text, values });
  if (text.includes("expire_due_cleaner_invitations")) return { rows: [{ id: "a" }, { id: "b" }] };
  if (text.includes("queue_due_booking_payment_reminders")) return { rows: [{ booking_id: "booking" }] };
  if (text.includes("queue_due_booking_visit_reminders")) return { rows: [{ notification_id: "notification" }] };
  if (text.includes("purge_expired_cleaner_locations")) return { rows: [] };
  if (text.includes("purge_expired_sessions")) return { rows: [{ deleted_count: 1, batch_full: false }] };
  if (text.includes("purge_expired_rate_limits")) return { rows: [{ processed_count: 3 }] };
  if (text.includes("purge_expired_pending_social_identities")) return { rows: [{ processed_count: 0 }] };
  return { rows: [{ upload_id: "upload", quarantine_storage_key: "quarantine/key", final_storage_key: "final/key" }] };
} });
assert.deepEqual(await repository.expireInvitations(100), { processedCount: 2, batchFull: false });
assert.deepEqual(await repository.queuePaymentReadinessReminders(100), { processedCount: 1, batchFull: false });
assert.deepEqual(await repository.queueBookingVisitReminders(100), { processedCount: 1, batchFull: false });
assert.deepEqual(await repository.purgeLocations(500), { processedCount: 0, batchFull: false });
assert.deepEqual(await repository.purgeSessions(500), { processedCount: 1, batchFull: false });
assert.deepEqual(await repository.purgeRateLimits(1000), { processedCount: 3, batchFull: false });
assert.equal((await repository.expireJobPhotoUploads(500)).uploads[0].finalStorageKey, "final/key");
assert.ok(queries.every((query) => query.text.includes("$1") && query.values.length === 1), "Maintenance repository did not parameterize every bounded function call.");

const drainBatches = [{ processedCount: 100, batchFull: true }, { processedCount: 0, batchFull: false }];
const deletedObjects = [];
const maintenanceJobs = createMarketplaceMaintenanceJobs({
  async expireInvitations() { return drainBatches.shift(); },
  async queuePaymentReadinessReminders() { return { processedCount: 0, batchFull: false }; },
  async queueBookingVisitReminders() { return { processedCount: 0, batchFull: false }; },
  async purgeLocations() { return { processedCount: 0, batchFull: false }; },
  async purgeSessions() { return { processedCount: 0, batchFull: false }; },
  async purgeRateLimits() { return { processedCount: 0, batchFull: false }; },
  async purgePendingSocialIdentities() { return { processedCount: 0, batchFull: false }; },
  async expireJobPhotoUploads() { return { processedCount: 1, batchFull: false, uploads: [{ quarantineStorageKey: "q/job", finalStorageKey: "f/job" }] }; },
  async expireRequestPhotoUploads() { return { processedCount: 0, batchFull: false, uploads: [] }; }
}, { objectStorage: { async deleteObject(key) { deletedObjects.push(key); } } });
assert.equal(maintenanceJobs.length, 9);
assert.deepEqual(await maintenanceJobs.find((job) => job.name === "invitation-expiry").runOnce(), { batches: 2, processed: 100, moreMayRemain: false });
assert.deepEqual(await maintenanceJobs.find((job) => job.name === "job-photo-upload-expiry").runOnce(), { batches: 1, processed: 1, objectsDeleted: 2, moreMayRemain: false });
assert.deepEqual(deletedObjects, ["q/job", "f/job"]);

const zeroRepository = Object.fromEntries(["expireInvitations", "queuePaymentReadinessReminders", "queueBookingVisitReminders", "purgeLocations", "purgeSessions", "purgeRateLimits", "purgePendingSocialIdentities"].map((name) => [name, async () => ({ processedCount: 0, batchFull: false })]));
const runtime = createMarketplaceWorkerRuntime({ query() {} }, { createMaintenanceRepository: () => zeroRepository, onUnexpectedError() {} });
assert.deepEqual(runtime.snapshot().jobs.map((job) => job.name), ["invitation-expiry", "location-expiry", "payment-readiness-reminders", "booking-visit-reminders", "session-expiry", "rate-limit-retention", "social-identity-retention"]);
await runtime.close();

let poolClosed = 0;
const disabled = await createMarketplaceWorkerAttachment({ env: { MARKETPLACE_WORKER_ENABLED: "false" }, createPool() { throw new Error("disabled worker created a pool"); } });
assert.equal(disabled.enabled, false);
assert.equal(workerPoolEnvironment({ WORKER_DATABASE_URL: "postgresql://tideway_worker@127.0.0.1/test?sslmode=disable" }).DATABASE_POOL_MAX, "5");
assert.throws(() => workerPoolEnvironment({ NODE_ENV: "production", WORKER_DATABASE_URL: "postgresql://tideway_worker@db.example/test?sslmode=disable" }), /verify-full/);
assert.throws(() => workerPoolEnvironment({ WORKER_DATABASE_URL: "postgresql://tideway_app@127.0.0.1/test" }), /tideway_worker/);
const fakeSupervisor = { start() { return {}; }, snapshot() { return { jobs: [] }; }, async close() {} };
const attached = await createMarketplaceWorkerAttachment({
  env: workerEnvironment,
  releaseIdentity: workerRelease,
  adapters: { onUnexpectedError() {}, async close() {} },
  createPool: async () => ({ async end() { poolClosed += 1; } }),
  probeDatabase: async () => ({ databaseRole: "tideway_worker" }),
  createRuntime: () => fakeSupervisor
});
assert.deepEqual(attached.capabilities, { email: false, media: false, dispatch: false });
assert.deepEqual(attached.release, { sourceCommit: "607f0113", builtAt: workerRelease.builtAt, migrationCount: 44 });
assert.deepEqual(attached.snapshot().release, { sourceCommit: "607f0113", migrationCount: 44 });
await attached.close();
await attached.close();
assert.equal(poolClosed, 1, "Worker attachment did not close its pool exactly once.");
await assert.rejects(() => createMarketplaceWorkerAttachment({ env: { ...workerEnvironment, TIDEWAY_EXPECT_RELEASE: "00000000" }, releaseIdentity: workerRelease }), /does not match expected release/);
await assert.rejects(() => createMarketplaceWorkerAttachment({ env: { ...workerEnvironment, TIDEWAY_EXPECT_RELEASE: "" }, releaseIdentity: workerRelease }), /eight-character source commit/);
await assert.rejects(() => createMarketplaceWorkerAttachment({ env: { ...workerEnvironment, WORKER_AUTOMATIC_DISPATCH_ENABLED: "true" }, releaseIdentity: workerRelease, adapters: { onUnexpectedError() {}, async close() {} } }), /marketplace runtime/);

const probePool = { async query(text, values) {
  assert.ok(text.includes("no_public_table_access") && text.includes("to_regprocedure") && values[0].length === requiredWorkerFunctions.length);
  return { rows: [{ database_role: "tideway_worker", server_version_num: 160014, role_is_safe: true, no_public_table_access: true, missing_functions: [] }] };
} };
assert.deepEqual(await probeMarketplaceWorkerDatabase(probePool), { databaseRole: "tideway_worker", postgresqlVersionNumber: 160014, functionCount: requiredWorkerFunctions.length });
await assert.rejects(() => probeMarketplaceWorkerDatabase({ async query() { return { rows: [{ database_role: "tideway_worker", server_version_num: 160014, role_is_safe: true, no_public_table_access: true, missing_functions: ["missing(integer)"] }] }; } }), /migrations or grants/);

const target = validateWorkerVerificationTarget("postgresql://tideway_worker@127.0.0.1/acme_tideway_test?sslmode=disable", workerVerificationConfirmation);
assert.equal(target.database, "acme_tideway_test");
assert.throws(() => validateWorkerVerificationTarget("postgresql://tideway_worker@127.0.0.1/production", workerVerificationConfirmation), /must end/);
assert.throws(() => validateWorkerVerificationTarget("postgresql://owner@127.0.0.1/acme_tideway_test", workerVerificationConfirmation), /tideway_worker/);
assert.throws(() => validateWorkerVerificationTarget("postgresql://tideway_worker@db.example/acme_tideway_test?sslmode=disable", workerVerificationConfirmation), /verify-full/);
assert.throws(() => validateWorkerVerificationTarget("postgresql://tideway_worker@127.0.0.1/acme_tideway_test", "wrong"), /confirmation/i);

let verificationPoolClosed = 0;
const verification = await runPostgresWorkerVerification({
  connectionUrl: "postgresql://tideway_worker@127.0.0.1/acme_tideway_test?sslmode=disable",
  confirmation: workerVerificationConfirmation,
  createPool: async () => ({ async end() { verificationPoolClosed += 1; } }),
  probeDatabase: async () => ({ postgresqlVersionNumber: 160014, functionCount: 15 }),
  createRuntime: () => ({ async runNow() { return { ran: true, ok: true }; }, async close() {} })
});
assert.deepEqual(verification, { database: "acme_tideway_test", postgresqlVersionNumber: 160014, functionCount: 15, jobs: 7, verified: true });
assert.equal(verificationPoolClosed, 1);

console.log("Marketplace worker tests passed: exact packaged release, restricted maintenance, non-overlap, monitored recovery, privacy-safe health, optional capabilities, clean shutdown and disposable PostgreSQL verification guard.");
