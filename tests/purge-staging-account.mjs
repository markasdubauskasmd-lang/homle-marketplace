import assert from "node:assert/strict";
import { stagingAccountEmailSha256 } from "../src/marketplace/staging-account-access.mjs";
import { prepareStagingAccountPurge, runStagingAccountPurge, stagingAccountPurgeConfirmation } from "../tools/purge-staging-account.mjs";

const email = "approved-tester@example.com";
const connectionUrl = "postgresql://migration_owner:private-password@db.example:5432/homle_marketplace_homle_staging?sslmode=verify-full";
const input = {
  connectionUrl,
  email,
  approvedEmailSha256: stagingAccountEmailSha256(email),
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reason: "Remove the completed non-customer account-only staging rehearsal.",
  confirmation: stagingAccountPurgeConfirmation,
  stagingAccountsOnly: "true",
  authenticationEnabled: "false",
  marketplaceEnabled: "false",
  pilotIntakeEnabled: "false",
  paymentsEnabled: "false"
};

const prepared = prepareStagingAccountPurge(input, { PATH: "safe-path" });
assert.equal(prepared.email, email);
assert.equal(prepared.database.database, "homle_marketplace_homle_staging");
assert.equal(prepared.database.user, "migration_owner");
assert(!JSON.stringify(prepared.database).includes("private-password") && !JSON.stringify(prepared.database).includes("postgresql://"), "Cleanup preparation exposed database credentials.");

for (const invalid of [
  { confirmation: "yes" },
  { connectionUrl: connectionUrl.replace("migration_owner", "tideway_app") },
  { connectionUrl: connectionUrl.replace("migration_owner", "tideway_worker") },
  { connectionUrl: connectionUrl.replace("homle_marketplace_homle_staging", "homle_production") },
  { connectionUrl: connectionUrl.replace("verify-full", "require") },
  { approvedEmailSha256: stagingAccountEmailSha256("someone-else@example.com") },
  { requestId: "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa" },
  { reason: "Too short" },
  { stagingAccountsOnly: "false" },
  { authenticationEnabled: "true" },
  { marketplaceEnabled: "true" },
  { pilotIntakeEnabled: "true" },
  { paymentsEnabled: "true" }
]) assert.throws(() => prepareStagingAccountPurge({ ...input, ...invalid }));

function fakePool({ activity = {}, administrator = false, failAt = "" } = {}) {
  const calls = [];
  let released = false;
  let ended = false;
  const account = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", selected_role: "landlord", created_at: "2026-07-17T08:00:00.000Z", identity_count: "1", session_count: "2", is_administrator: administrator };
  const zeroActivity = {
    roles_granted_to_others: "0", properties: "0", property_photos: "0", cleaning_requests: "0", cleaning_request_status_events: "0",
    cleaning_request_photo_uploads: "0", bookings: "0", booking_status_events: "0", task_updates: "0", job_photos: "0", job_photo_uploads: "0",
    cleaner_locations: "0", job_pauses: "0", unexpected_task_decisions: "0", booking_progress_events: "0", messages: "0", booking_realtime_events: "0",
    notifications: "0", reviews: "0", favourites: "0", disputes: "0", privacy_requests: "0", booking_payments: "0", payment_commands: "0",
    payment_status_events: "0", payout_onboarding: "0", payout_accounts: "0"
  };
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (failAt && text.includes(failAt)) throw new Error("safe-test-failure");
      if (text.includes("FROM users account")) return { rows: [account], rowCount: 1 };
      if (text.includes("roles_granted_to_others")) return { rows: [{ ...zeroActivity, ...activity }], rowCount: 1 };
      if (text.startsWith("DELETE FROM audit_logs")) return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }], rowCount: 3 };
      if (text.startsWith("DELETE FROM users")) return { rows: [{ id: account.id }], rowCount: 1 };
      if (text.startsWith("INSERT INTO audit_logs")) return { rows: [{ created_at: "2026-07-17T09:00:00.000Z" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; }
  };
  return {
    calls,
    state() { return { released, ended }; },
    factory: async () => ({ async connect() { return client; }, async end() { ended = true; } })
  };
}

const successful = fakePool();
let poolConfiguration;
const result = await runStagingAccountPurge({
  ...input,
  environment: {},
  async poolFactory(configuration) {
    poolConfiguration = configuration;
    return successful.factory(configuration);
  }
});
assert.deepEqual(result, {
  status: "purged", role: "landlord", identitiesDeleted: 1, sessionsDeleted: 2, auditEventsRemoved: 3,
  accountCreatedAt: "2026-07-17T08:00:00.000Z", purgedAt: "2026-07-17T09:00:00.000Z", requestId: input.requestId,
  database: "homle_marketplace_homle_staging", host: "db.example"
});
assert.equal(poolConfiguration.max, 1);
assert.equal(poolConfiguration.connectionString, connectionUrl);
assert.equal(successful.calls[0].text, "BEGIN ISOLATION LEVEL SERIALIZABLE");
assert.equal(successful.calls.at(-1).text, "COMMIT");
assert(successful.calls.some((call) => call.text.startsWith("DELETE FROM audit_logs")) && successful.calls.some((call) => call.text.startsWith("DELETE FROM users")), "Successful cleanup did not remove account audit evidence before the account.");
assert(successful.calls.every((call) => !call.text.includes(email) && !call.text.includes(input.reason)), "Cleanup interpolated private operator input into SQL.");
assert.deepEqual(successful.state(), { released: true, ended: true });

const active = fakePool({ activity: { cleaning_requests: "1" } });
await assert.rejects(runStagingAccountPurge({ ...input, environment: {}, poolFactory: active.factory }), /refused.*cleaning_requests/i);
assert(!active.calls.some((call) => call.text.startsWith("DELETE FROM")), "Cleanup deleted data after discovering marketplace activity.");
assert.equal(active.calls.at(-1).text, "ROLLBACK");
assert.deepEqual(active.state(), { released: true, ended: true });

const admin = fakePool({ administrator: true });
await assert.rejects(runStagingAccountPurge({ ...input, environment: {}, poolFactory: admin.factory }), /Administrator accounts cannot/);
assert(!admin.calls.some((call) => call.text.startsWith("DELETE FROM")), "Cleanup deleted an Administrator account.");
assert.equal(admin.calls.at(-1).text, "ROLLBACK");

const failure = fakePool({ failAt: "DELETE FROM users" });
await assert.rejects(runStagingAccountPurge({ ...input, environment: {}, poolFactory: failure.factory }), /safe-test-failure/);
assert.equal(failure.calls.at(-1).text, "ROLLBACK");
assert.deepEqual(failure.state(), { released: true, ended: true });

console.log("Staging account cleanup tests passed: approved fingerprint, disabled services, staging-only owner connection, business-activity refusal, Administrator refusal, parameterized deletion, anonymous evidence, rollback and resource cleanup.");
