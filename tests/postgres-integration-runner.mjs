import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { postgresIntegrationConfirmation, requiredLifecycleRealtimeKinds, runConcurrentPsql, runPostgresMarketplaceIntegration, runPostgresNotificationProbe } from "../tools/postgres-integration-runner.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const integrationDirectory = path.join(projectRoot, "db", "integration");
const requiredFiles = [
  "assert-integration-target.sql", "administrator-bootstrap-app-denied.sql", "administrator-bootstrap-owner.sql", "marketplace-integration-setup.sql", "public-cleaner-profile-behaviour.sql", "matching-self-exclusion.sql", "landlord-single-dispatch-authorization.sql", "cleaning-request-realtime-and-avatar.sql", "facebook-data-deletion-behaviour.sql", "marketplace-rls-behaviour.sql",
  "automatic-dispatch-rehearsal-setup.sql", "automatic-dispatch-claim-a.sql", "automatic-dispatch-claim-b.sql", "automatic-dispatch-first-invite-a.sql", "automatic-dispatch-first-invite-b.sql", "automatic-dispatch-first-invite-core.sql", "automatic-dispatch-first-expiry-setup.sql", "automatic-dispatch-requeue.sql", "automatic-dispatch-second-expiry-setup.sql", "automatic-dispatch-attempt-limit.sql", "automatic-dispatch-rehearsal-verify.sql", "automatic-dispatch-rehearsal-cleanup.sql",
  "accept-booking-a.sql", "accept-booking-b.sql", "marketplace-post-concurrency.sql",
  "participant-lifecycle-rehearsal-setup.sql", "participant-lifecycle-rehearsal.sql",
  "marketplace-dispute-setup.sql", "marketplace-dispute-behaviour.sql",
  "marketplace-payment-gate.sql", "marketplace-payment-ordering.sql", "marketplace-integration-verify.sql", "marketplace-integration-cleanup.sql"
];
const sources = new Map();
for (const file of requiredFiles) sources.set(file, await readFile(path.join(integrationDirectory, file), "utf8"));

assert.match(sources.get("assert-integration-target.sql"), /_tideway_test\$/);
assert.match(sources.get("administrator-bootstrap-app-denied.sql"), /Runtime role provisioned an Administrator/);
assert.match(sources.get("administrator-bootstrap-owner.sql"), /Exact bootstrap retry was not idempotent/);
assert.match(sources.get("administrator-bootstrap-owner.sql"), /Unverified account received Administrator authority/);
assert.match(sources.get("administrator-bootstrap-owner.sql"), /Administrator bootstrap integration fixtures were not removed/);
assert.match(sources.get("marketplace-integration-setup.sql"), /integration-landlord@invalid\.example/);
assert.match(sources.get("marketplace-integration-setup.sql"), /invite_cleaner[\s\S]*invite_cleaner/);
assert.match(sources.get("marketplace-integration-setup.sql"), /cleaner_service_areas[\s\S]*SW1A/);
assert.match(sources.get("marketplace-integration-setup.sql"), /invite_cleaner_before_eligibility_hardening/);
assert.match(sources.get("marketplace-integration-setup.sql"), /cleaning_request_photos[\s\S]*submit_cleaning_request/);
assert.match(sources.get("public-cleaner-profile-behaviour.sql"), /Landlord cannot open an active, complete and public Cleaner profile/);
assert.match(sources.get("public-cleaner-profile-behaviour.sql"), /Public Cleaner lookup exposed private account, contact, precise location or operational data/);
assert.match(sources.get("public-cleaner-profile-behaviour.sql"), /Public Cleaner lookup returned an account without a public Cleaner profile/);
assert.match(sources.get("matching-self-exclusion.sql"), /A landlord was recommended as a cleaner for their own request/);
assert.match(sources.get("matching-self-exclusion.sql"), /The independent eligible cleaner was not recommended/);
assert.match(sources.get("automatic-dispatch-rehearsal-setup.sql"), /configure_automatic_dispatch[\s\S]*true,2::smallint/);
assert.match(sources.get("automatic-dispatch-claim-a.sql"), /AUTOMATIC_DISPATCH_CLAIM_A\|/);
assert.match(sources.get("automatic-dispatch-claim-b.sql"), /AUTOMATIC_DISPATCH_CLAIM_B\|/);
assert.match(sources.get("automatic-dispatch-first-invite-core.sql"), /exactly two independent eligible Cleaners/);
assert.match(sources.get("automatic-dispatch-requeue.sql"), /exclude the tried Cleaner and select the next eligible Cleaner/);
assert.match(sources.get("automatic-dispatch-attempt-limit.sql"), /exceeded the Landlord-approved attempt ceiling/);
assert.match(sources.get("automatic-dispatch-rehearsal-verify.sql"), /stop cleanly at the approved attempt limit/);
assert.match(sources.get("automatic-dispatch-rehearsal-cleanup.sql"), /cleanup left synthetic records/);
for (const file of requiredFiles.filter((name) => name.startsWith("automatic-dispatch-"))) assert.doesNotMatch(sources.get(file), /https?:\/\//, `${file} must not contact an external provider.`);
assert.match(sources.get("landlord-single-dispatch-authorization.sql"), /The Landlord one-Cleaner authorization was not stored exactly/);
assert.match(sources.get("landlord-single-dispatch-authorization.sql"), /An unrelated Landlord authorized Cleaner matching/);
assert.match(sources.get("cleaning-request-realtime-and-avatar.sql"), /An unrelated Landlord subscribed to a private cleaning request/);
assert.match(sources.get("cleaning-request-realtime-and-avatar.sql"), /verified account avatar was not retained/);
assert.match(sources.get("facebook-data-deletion-behaviour.sql"), /Known Facebook subject did not enter one stable deletion queue item/);
assert.match(sources.get("facebook-data-deletion-behaviour.sql"), /Unknown Facebook subject did not receive an honest completed confirmation/);
assert.match(sources.get("facebook-data-deletion-behaviour.sql"), /Runtime role can read private Facebook deletion confirmation material/);
assert.match(sources.get("facebook-data-deletion-behaviour.sql"), /Facebook deletion request identifier reuse did not fail closed/);
assert.match(sources.get("marketplace-rls-behaviour.sql"), /Unrelated account can read bookings/);
assert.match(sources.get("marketplace-rls-behaviour.sql"), /Unrelated account can read a private room scan/);
assert.match(sources.get("marketplace-rls-behaviour.sql"), /Pending Cleaner scope handoff bypassed separate Landlord photo-preview consent/);
assert.match(sources.get("marketplace-rls-behaviour.sql"), /insufficient_privilege/);
assert.match(sources.get("marketplace-rls-behaviour.sql"), /Privacy export intake lost active-request idempotency/);
assert.match(sources.get("marketplace-rls-behaviour.sql"), /Runtime role can read account privacy requests directly/);
assert.match(sources.get("marketplace-rls-behaviour.sql"), /Cleaner payout onboarding lost owner binding, stable retry or verified readiness state/);
assert.match(sources.get("marketplace-rls-behaviour.sql"), /Runtime role can read private Cleaner payout onboarding material/);
assert.match(sources.get("marketplace-post-concurrency.sql"), /Cleaner property access did not follow the accepted booking/);
assert.match(sources.get("participant-lifecycle-rehearsal-setup.sql"), /scheduled_start_at = now\(\) \+ interval '5 minutes'/);
assert.match(sources.get("participant-lifecycle-rehearsal.sql"), /start_cleaner_journey/);
assert.match(sources.get("participant-lifecycle-rehearsal.sql"), /finish_booking_cleaning/);
assert.match(sources.get("participant-lifecycle-rehearsal.sql"), /Landlord message or exact retry was not recorded once/);
assert.match(sources.get("participant-lifecycle-rehearsal.sql"), /Direct contact details were accepted in booking chat/);
assert.match(sources.get("participant-lifecycle-rehearsal.sql"), /blocked_messages[\s\S]*blocked_send/);
assert.match(sources.get("participant-lifecycle-rehearsal.sql"), /Cleaner could see an unapproved review/);
assert.match(sources.get("participant-lifecycle-rehearsal.sql"), /participant_realtime_catchup/);
assert.match(sources.get("participant-lifecycle-rehearsal.sql"), /get_booking_realtime_snapshot/);
assert.match(sources.get("participant-lifecycle-rehearsal.sql"), /blocked_realtime/);
assert.match(sources.get("participant-lifecycle-rehearsal.sql"), /Unrelated account gained participant lifecycle access/);
assert.doesNotMatch(sources.get("participant-lifecycle-rehearsal.sql"), /https?:\/\//, "The disposable participant rehearsal must not contact an external provider.");
assert.match(sources.get("marketplace-dispute-behaviour.sql"), /Runtime role can bypass the function-only dispute workflow/);
assert.match(sources.get("marketplace-dispute-behaviour.sql"), /Unrelated account opened a booking dispute/);
assert.match(sources.get("marketplace-dispute-behaviour.sql"), /Administrator dispute queue lost its safe case projection/);
assert.match(sources.get("marketplace-dispute-behaviour.sql"), /Post-completion dispute erased the recorded visit completion evidence/);
assert.match(sources.get("marketplace-payment-gate.sql"), /Journey started without a payment authorization/);
assert.match(sources.get("marketplace-payment-gate.sql"), /Stale payment authorization unlocked the journey transition/);
assert.match(sources.get("marketplace-payment-gate.sql"), /Current payment authorization did not unlock journey start/);
assert.match(sources.get("marketplace-payment-ordering.sql"), /A second event applied the same refund twice/);
assert.match(sources.get("marketplace-payment-ordering.sql"), /Cleaner transfer began while a refund was live/);
assert.match(sources.get("marketplace-payment-ordering.sql"), /A late authorization event regressed captured\/refunded payment state/);
assert.match(sources.get("marketplace-integration-verify.sql"), /pending-cleaner-acceptance/);
assert.match(sources.get("marketplace-integration-verify.sql"), /Confirmation history is not exactly once/);
assert.match(sources.get("marketplace-integration-verify.sql"), /Two-way participant messages are missing or duplicated/);
assert.match(sources.get("marketplace-integration-verify.sql"), /Facebook deletion callback audit evidence is missing or duplicated/);
for (const file of ["accept-booking-a.sql", "accept-booking-b.sql"]) {
  assert.match(sources.get(file), /respond_to_cleaner_invitation/);
  assert.match(sources.get(file), /pg_sleep\(1\.5\)/);
}
for (const idPrefix of ["10000000", "20000000", "30000000", "40000000"]) assert.ok(sources.get("marketplace-integration-cleanup.sql").includes(idPrefix));
assert.match(sources.get("marketplace-integration-cleanup.sql"), /DELETE FROM cleaner_service_areas/);
assert.match(sources.get("marketplace-integration-cleanup.sql"), /DELETE FROM privacy_requests/);
assert.match(sources.get("marketplace-integration-cleanup.sql"), /DELETE FROM tideway_private\.facebook_data_deletion_requests/);
assert.ok(sources.get("marketplace-integration-cleanup.sql").indexOf("DELETE FROM audit_logs") < sources.get("marketplace-integration-cleanup.sql").indexOf("DELETE FROM users"), "Fixture audit evidence must be removed before its actor users.");

const ownerPassword = "owner p@ss/secret";
const appPassword = "app p@ss/secret";
const workerPassword = "worker p@ss/secret";
const ownerUrl = `postgresql://migration_owner:${encodeURIComponent(ownerPassword)}@db.example:5432/acme_tideway_test?sslmode=verify-full`;
const appUrl = `postgresql://tideway_app:${encodeURIComponent(appPassword)}@db.example:5432/acme_tideway_test?sslmode=verify-full`;
const workerUrl = `postgresql://tideway_worker:${encodeURIComponent(workerPassword)}@db.example:5432/acme_tideway_test?sslmode=verify-full`;
const calls = [];
function successfulSpawn(command, args, options) {
  calls.push({ command, args, options, file: path.basename(args.at(-1)) });
  return { status: 0, stdout: "ok\n", stderr: "" };
}
const concurrentBatches = [];
const realtimeProbes = [];
let concurrentCall = 0;
const result = await runPostgresMarketplaceIntegration({
  ownerUrl,
  appUrl,
  workerUrl,
  confirmation: postgresIntegrationConfirmation,
  baseEnvironment: { PATH: "private-path", DATABASE_INTEGRATION_OWNER_URL: ownerUrl, DATABASE_INTEGRATION_APP_URL: appUrl, DATABASE_INTEGRATION_WORKER_URL: workerUrl, SMTP_URL: "unrelated-secret" },
  spawnSync: successfulSpawn,
  async runConcurrent(jobs) {
    concurrentBatches.push(jobs);
    concurrentCall += 1;
    if (concurrentCall === 1) return [
      { status: 0, stdout: "AUTOMATIC_DISPATCH_CLAIM_A|1", stderr: "" },
      { status: 0, stdout: "AUTOMATIC_DISPATCH_CLAIM_B|0", stderr: "" }
    ];
    return [
      { status: 0, stdout: "confirmed", stderr: "" },
      { status: 3, stdout: "", stderr: "ERROR: cleaner-schedule-conflict" }
    ];
  },
  async runRealtimeProbe({ connectionUrl, mutate }) {
    assert.equal(connectionUrl, appUrl);
    const mutationResult = await mutate();
    const bookingId = "40000000-0000-4000-8000-000000000001";
    const signals = requiredLifecycleRealtimeKinds.map((kind, index) => ({ bookingId, eventId: index + 1, kind }));
    realtimeProbes.push({ connectionUrl, signals });
    return { bookingId, signals, mutationResult };
  }
});

assert.deepEqual(result, { database: "acme_tideway_test", host: "db.example", verified: true, administratorBootstrap: true, publicCleanerProfilePrivacy: true, matchingSelfExclusion: true, automaticDispatchConcurrency: true, automaticDispatchRequeue: true, landlordSingleDispatch: true, requestRealtimeAndAvatar: true, facebookDataDeletion: true, rls: true, concurrentOverlap: true, participantLifecycle: true, participantRealtime: true, participantMessaging: true, disputes: true, paymentJourneyGate: true, paymentOrdering: true, fixturesRemoved: true });
assert.deepEqual(calls.map((call) => call.file), [
  "deployment-verification.sql", "assert-integration-target.sql", "administrator-bootstrap-app-denied.sql", "administrator-bootstrap-owner.sql", "marketplace-integration-setup.sql", "public-cleaner-profile-behaviour.sql",
  "matching-self-exclusion.sql", "automatic-dispatch-rehearsal-setup.sql", "automatic-dispatch-first-invite-a.sql", "automatic-dispatch-first-expiry-setup.sql", "automatic-dispatch-requeue.sql", "automatic-dispatch-second-expiry-setup.sql", "automatic-dispatch-attempt-limit.sql", "automatic-dispatch-rehearsal-verify.sql", "automatic-dispatch-rehearsal-cleanup.sql", "landlord-single-dispatch-authorization.sql", "cleaning-request-realtime-and-avatar.sql", "facebook-data-deletion-behaviour.sql", "marketplace-rls-behaviour.sql", "marketplace-post-concurrency.sql", "marketplace-payment-gate.sql", "participant-lifecycle-rehearsal-setup.sql", "participant-lifecycle-rehearsal.sql", "marketplace-dispute-setup.sql", "marketplace-dispute-behaviour.sql", "marketplace-payment-ordering.sql", "marketplace-integration-verify.sql",
  "marketplace-integration-cleanup.sql"
]);
for (const call of calls) {
  assert.equal(call.command, "psql");
  assert.ok(call.args.every((argument) => !argument.includes(ownerPassword) && !argument.includes(appPassword) && !argument.includes(workerPassword) && !argument.includes("postgresql://")));
}
assert.equal(calls.find((call) => call.file === "deployment-verification.sql").options.env.PGPASSWORD, ownerPassword);
assert.equal(calls.find((call) => call.file === "marketplace-rls-behaviour.sql").options.env.PGPASSWORD, appPassword);
assert.equal(calls.find((call) => call.file === "automatic-dispatch-requeue.sql").options.env.PGPASSWORD, workerPassword);
assert.ok(calls.every((call) => !Object.hasOwn(call.options.env, "DATABASE_INTEGRATION_OWNER_URL") && !Object.hasOwn(call.options.env, "DATABASE_INTEGRATION_APP_URL") && !Object.hasOwn(call.options.env, "DATABASE_INTEGRATION_WORKER_URL") && !Object.hasOwn(call.options.env, "SMTP_URL")));
assert.equal(concurrentBatches.length, 2);
assert.equal(realtimeProbes.length, 1);
assert.deepEqual(realtimeProbes[0].signals.map(({ kind }) => kind), requiredLifecycleRealtimeKinds);
assert.ok(concurrentBatches[0].every((job) => job.environment.PGUSER === "tideway_worker" && job.environment.PGPASSWORD === workerPassword));
assert.ok(concurrentBatches[1].every((job) => job.environment.PGUSER === "tideway_app" && job.environment.PGPASSWORD === appPassword));

await assert.rejects(
  runPostgresMarketplaceIntegration({ ownerUrl, appUrl, workerUrl, confirmation: "yes", spawnSync: successfulSpawn }),
  /Set TIDEWAY_DATABASE_TEST_CONFIRMATION/
);
await assert.rejects(
  runPostgresMarketplaceIntegration({ ownerUrl: ownerUrl.replace("acme_tideway_test", "production"), appUrl: appUrl.replace("acme_tideway_test", "production"), workerUrl: workerUrl.replace("acme_tideway_test", "production"), confirmation: postgresIntegrationConfirmation, spawnSync: successfulSpawn }),
  /must end in _tideway_test/
);
await assert.rejects(
  runPostgresMarketplaceIntegration({ ownerUrl, appUrl: appUrl.replace("tideway_app", "another_role"), workerUrl, confirmation: postgresIntegrationConfirmation, spawnSync: successfulSpawn }),
  /authenticate as tideway_app/
);
await assert.rejects(
  runPostgresMarketplaceIntegration({ ownerUrl, appUrl, workerUrl: workerUrl.replace("tideway_worker", "another_role"), confirmation: postgresIntegrationConfirmation, spawnSync: successfulSpawn }),
  /authenticate as tideway_worker/
);
await assert.rejects(
  runPostgresMarketplaceIntegration({ ownerUrl, appUrl: appUrl.replace("acme_tideway_test", "other_tideway_test"), workerUrl, confirmation: postgresIntegrationConfirmation, spawnSync: successfulSpawn }),
  /same PostgreSQL database endpoint/
);
await assert.rejects(
  runPostgresMarketplaceIntegration({ ownerUrl, appUrl, workerUrl: workerUrl.replace("acme_tideway_test", "other_tideway_test"), confirmation: postgresIntegrationConfirmation, spawnSync: successfulSpawn }),
  /same PostgreSQL database endpoint/
);

const cleanupCalls = [];
await assert.rejects(
  runPostgresMarketplaceIntegration({
    ownerUrl,
    appUrl,
    workerUrl,
    confirmation: postgresIntegrationConfirmation,
    spawnSync(command, args, options) {
      cleanupCalls.push(path.basename(args.at(-1)));
      return { status: 0, stdout: "ok", stderr: "" };
    },
    async runConcurrent(jobs) {
      if (jobs[0].file === "automatic-dispatch-claim-a.sql") return [
        { status: 0, stdout: "AUTOMATIC_DISPATCH_CLAIM_A|1" },
        { status: 0, stdout: "AUTOMATIC_DISPATCH_CLAIM_B|0" }
      ];
      return [{ status: 0 }, { status: 0 }];
    }
  }),
  /one success and one protected schedule conflict/
);
assert.equal(cleanupCalls.at(-1), "marketplace-integration-cleanup.sql", "Fixture cleanup did not run after a failed concurrency assertion.");

const realtimeQueries = [];
let realtimeConnections = 0;
let realtimeEnds = 0;
class FakeRealtimeClient extends EventEmitter {
  async connect() { realtimeConnections += 1; }
  async query(statement) { realtimeQueries.push(statement); return { rows: [] }; }
  async end() { realtimeEnds += 1; }
}
const fakeRealtimeClient = new FakeRealtimeClient();
const realtimeBookingId = "40000000-0000-4000-8000-000000000001";
const notificationProof = await runPostgresNotificationProbe({
  connectionUrl: appUrl,
  timeoutMs: 1_000,
  async clientFactory(configuration) {
    assert.equal(configuration.connectionString, appUrl);
    assert.equal(configuration.application_name, "tideway-integration-realtime-listener");
    return fakeRealtimeClient;
  },
  async mutate() {
    for (const [index, kind] of requiredLifecycleRealtimeKinds.entries()) {
      fakeRealtimeClient.emit("notification", { channel: "tideway_booking_events", payload: JSON.stringify({ bookingId: realtimeBookingId, eventId: index + 1, kind }) });
    }
    return "lifecycle-committed";
  }
});
assert.equal(notificationProof.bookingId, realtimeBookingId);
assert.equal(notificationProof.mutationResult, "lifecycle-committed");
assert.deepEqual(notificationProof.signals.map(({ kind }) => kind), requiredLifecycleRealtimeKinds);
assert.deepEqual(realtimeQueries, ["LISTEN tideway_booking_events", "UNLISTEN tideway_booking_events"]);
assert.equal(realtimeConnections, 1);
assert.equal(realtimeEnds, 1);

const privacyClient = new FakeRealtimeClient();
await assert.rejects(
  runPostgresNotificationProbe({
    connectionUrl: appUrl,
    timeoutMs: 1_000,
    async clientFactory() { return privacyClient; },
    async mutate() {
      privacyClient.emit("notification", { channel: "tideway_booking_events", payload: JSON.stringify({ bookingId: realtimeBookingId, eventId: 1, kind: "booking-status", email: "must-not-leak@invalid.example" }) });
    }
  }),
  /exposed fields beyond the privacy-minimal wake-up contract/
);

const asyncInvocations = [];
const asyncResults = await runConcurrentPsql([
  { file: "accept-booking-a.sql", environment: { PGPASSWORD: appPassword } },
  { file: "accept-booking-b.sql", environment: { PGPASSWORD: appPassword } }
], {
  command: "private-psql",
  spawnProcess(command, args, options) {
    asyncInvocations.push({ command, args, options });
    const callIndex = asyncInvocations.length;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.end("transaction complete");
      child.stderr.end("");
      child.emit("close", callIndex === 1 ? 0 : 3);
    });
    return child;
  }
});
assert.deepEqual(asyncResults.map((entry) => entry.status), [0, 3]);
assert.ok(asyncInvocations.every((entry) => entry.command === "private-psql" && entry.args.includes("--no-psqlrc") && entry.options.env.PGPASSWORD === appPassword));
assert.ok(asyncInvocations.every((entry) => entry.args.every((argument) => !argument.includes(appPassword))));
const spawnFailure = await runConcurrentPsql([{ file: "accept-booking-a.sql", environment: {} }], {
  spawnProcess() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }
});
assert.equal(spawnFailure[0].status, null);
assert.equal(spawnFailure[0].error.code, "ENOENT");

console.log("PostgreSQL integration harness tests passed: disposable-target guard, separate owner/app/worker credentials, two-worker dispatch lease evidence, RLS fixtures, concurrent overlap outcome, cleanup and secret-free process arguments.");
