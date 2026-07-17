import assert from "node:assert/strict";
import { stagingAccountEmailSha256 } from "../src/marketplace/staging-account-access.mjs";
import { prepareStagingRoleRehearsal, stagingRoleRehearsalConfirmation, verifyStagingRoleRehearsal } from "../tools/verify-staging-role-rehearsal.mjs";

const landlordEmail = "landlord-test@example.com";
const cleanerEmail = "cleaner-test@example.com";
const approvedEmailSha256 = [stagingAccountEmailSha256(landlordEmail), stagingAccountEmailSha256(cleanerEmail)].join(",");
const connectionUrl = "postgresql://migration_owner:private-password@db.example:5432/homle_marketplace_homle_staging?sslmode=verify-full";
const input = {
  connectionUrl,
  landlordEmail,
  cleanerEmail,
  approvedEmailSha256,
  expectedProvider: "google",
  confirmation: stagingRoleRehearsalConfirmation,
  stagingAccountsOnly: "true",
  authenticationEnabled: "true",
  marketplaceEnabled: "false",
  pilotIntakeEnabled: "false",
  paymentsEnabled: "false"
};

const prepared = prepareStagingRoleRehearsal(input, { PATH: "safe-path" });
assert.equal(prepared.database.database, "homle_marketplace_homle_staging");
assert.equal(prepared.expectedProvider, "google");
assert(!JSON.stringify(prepared.database).includes("private-password") && !JSON.stringify(prepared.database).includes("postgresql://"), "Role-rehearsal preparation exposed database credentials.");

for (const invalid of [
  { confirmation: "yes" },
  { connectionUrl: connectionUrl.replace("migration_owner", "tideway_app") },
  { connectionUrl: connectionUrl.replace("migration_owner", "tideway_worker") },
  { connectionUrl: connectionUrl.replace("homle_marketplace_homle_staging", "homle_production") },
  { connectionUrl: connectionUrl.replace("verify-full", "require") },
  { cleanerEmail: landlordEmail },
  { approvedEmailSha256: stagingAccountEmailSha256(landlordEmail) },
  { expectedProvider: "apple" },
  { stagingAccountsOnly: "false" },
  { authenticationEnabled: "false" },
  { marketplaceEnabled: "true" },
  { pilotIntakeEnabled: "true" },
  { paymentsEnabled: "true" }
]) assert.throws(() => prepareStagingRoleRehearsal({ ...input, ...invalid }));

function zeroActivity(overrides = {}) {
  return {
    roles_granted_to_others: "0", properties: "0", property_photos: "0", cleaning_requests: "0", cleaning_request_status_events: "0",
    cleaning_request_photo_uploads: "0", bookings: "0", booking_status_events: "0", task_updates: "0", job_photos: "0", job_photo_uploads: "0",
    cleaner_locations: "0", job_pauses: "0", unexpected_task_decisions: "0", booking_progress_events: "0", messages: "0", booking_realtime_events: "0",
    notifications: "0", reviews: "0", favourites: "0", disputes: "0", privacy_requests: "0", booking_payments: "0", payment_commands: "0",
    payment_status_events: "0", payout_onboarding: "0", payout_accounts: "0", ...overrides
  };
}

function fakePool(options = {}) {
  const calls = [];
  let released = false;
  let ended = false;
  const landlord = {
    id: "11111111-1111-4111-8111-111111111111", email: landlordEmail, account_status: "active", email_verified_at: "2026-07-17T10:00:00.000Z",
    selected_role: "landlord", created_at: "2026-07-17T10:00:00.000Z", roles: ["landlord"], providers: ["google"], active_session_count: "1",
    landlord_profile: true, cleaner_profile: false, ...(options.landlord || {})
  };
  const cleaner = {
    id: "22222222-2222-4222-8222-222222222222", email: cleanerEmail, account_status: "active", email_verified_at: "2026-07-17T10:05:00.000Z",
    selected_role: "cleaner", created_at: "2026-07-17T10:05:00.000Z", roles: ["cleaner"], providers: ["google"], active_session_count: "2",
    landlord_profile: false, cleaner_profile: true, ...(options.cleaner || {})
  };
  const accounts = options.accounts || [cleaner, landlord];
  let activityIndex = 0;
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (options.failAt && text.includes(options.failAt)) throw new Error("safe-test-failure");
      if (text.includes("FROM users account WHERE account.email=ANY")) return { rows: accounts, rowCount: accounts.length };
      if (text.includes("roles_granted_to_others")) {
        const row = activityIndex++ === 0 ? zeroActivity(options.firstActivity) : zeroActivity(options.secondActivity);
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; }
  };
  return {
    calls,
    state: () => ({ released, ended }),
    factory: async () => ({ async connect() { return client; }, async end() { ended = true; } })
  };
}

const successful = fakePool();
let poolConfiguration;
const result = await verifyStagingRoleRehearsal({
  ...input,
  environment: {},
  async poolFactory(configuration) { poolConfiguration = configuration; return successful.factory(configuration); }
});
assert.deepEqual(result, {
  status: "verified", provider: "google",
  landlord: { role: "landlord", profileCreated: true, expectedProviderConnected: true, connectedProviderCount: 1, activeSessionCount: 1, accountCreatedAt: "2026-07-17T10:00:00.000Z" },
  cleaner: { role: "cleaner", profileCreated: true, expectedProviderConnected: true, connectedProviderCount: 1, activeSessionCount: 2, accountCreatedAt: "2026-07-17T10:05:00.000Z" },
  businessActivity: false, database: "homle_marketplace_homle_staging", host: "db.example"
});
assert.equal(poolConfiguration.connectionString, connectionUrl);
assert.equal(poolConfiguration.max, 1);
assert.equal(successful.calls[0].text, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
assert.equal(successful.calls.at(-1).text, "COMMIT");
assert(successful.calls.every((call) => !/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i.test(call.text)), "Role-rehearsal verification attempted to mutate staging data.");
const accountQuery = successful.calls.find((call) => call.text.includes("FROM users account WHERE account.email=ANY"));
assert.deepEqual(accountQuery.values, [[landlordEmail, cleanerEmail]]);
assert(!accountQuery.text.includes(landlordEmail) && !accountQuery.text.includes(cleanerEmail), "Role-rehearsal verification interpolated private emails into SQL.");
assert.deepEqual(successful.state(), { released: true, ended: true });

for (const [fixture, message] of [
  [{ accounts: [] }, /Exactly two approved/],
  [{ landlord: { selected_role: "cleaner", roles: ["cleaner"] } }, /landlord.*expected role/i],
  [{ cleaner: { providers: ["password"] } }, /cleaner.*expected google/i],
  [{ cleaner: { landlord_profile: true } }, /cleaner.*role profile/i],
  [{ cleaner: { active_session_count: "0" } }, /cleaner.*no active session/i],
  [{ secondActivity: { bookings: "1" } }, /business activity.*bookings/i]
]) {
  const failed = fakePool(fixture);
  await assert.rejects(verifyStagingRoleRehearsal({ ...input, environment: {}, poolFactory: failed.factory }), message);
  assert.equal(failed.calls.at(-1).text, "ROLLBACK");
  assert.deepEqual(failed.state(), { released: true, ended: true });
}

const failedQuery = fakePool({ failAt: "FROM users account" });
await assert.rejects(verifyStagingRoleRehearsal({ ...input, environment: {}, poolFactory: failedQuery.factory }), /safe-test-failure/);
assert.equal(failedQuery.calls.at(-1).text, "ROLLBACK");
assert.deepEqual(failedQuery.state(), { released: true, ended: true });

console.log("Staging role-rehearsal verifier tests passed: two approved distinct accounts, exact role profiles, expected provider, active sessions, zero business activity, read-only SQL, secret-safe evidence, rollback and cleanup.");
