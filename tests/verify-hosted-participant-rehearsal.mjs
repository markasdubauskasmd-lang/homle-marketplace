import assert from "node:assert/strict";
import { stagingAccountEmailSha256 } from "../src/marketplace/staging-account-access.mjs";
import {
  hostedParticipantRehearsalConfirmation,
  prepareHostedParticipantRehearsal,
  verifyHostedParticipantRehearsal
} from "../tools/verify-hosted-participant-rehearsal.mjs";

const bookingId = "4a8be4de-6b4e-4539-8666-af3f15cda11f";
const landlordEmail = "landlord-homle-staging@example.test";
const cleanerEmail = "cleaner-homle-staging@example.test";
const approvedEmailSha256 = [landlordEmail, cleanerEmail].map(stagingAccountEmailSha256).join(",");
const connectionUrl = "postgresql://homle_migration_owner:private@db.example:5432/homle_marketplace_homle_staging?sslmode=verify-full";
const stripeSecretKey = `sk_test_${"a".repeat(32)}`;
const input = Object.freeze({
  bookingId, connectionUrl, approvedEmailSha256, confirmation: hostedParticipantRehearsalConfirmation,
  stagingAccountsOnly: "true", marketplaceEnabled: "true", paymentsEnabled: "true", stripeSecretKey
});

const prepared = prepareHostedParticipantRehearsal(input, { PATH: "private-path", DATABASE_URL: "must-not-inherit" });
assert.equal(prepared.bookingId, bookingId);
assert.equal(prepared.database.database, "homle_marketplace_homle_staging");
assert.equal(prepared.database.user, "homle_migration_owner");
assert(prepared.approvedAccounts.allows(landlordEmail) && prepared.approvedAccounts.allows(cleanerEmail));

for (const [change, pattern] of [
  [{ confirmation: "yes" }, /exactly/],
  [{ bookingId: "not-a-booking" }, /booking UUID/],
  [{ stagingAccountsOnly: "false" }, /STAGING_ACCOUNTS_ONLY/],
  [{ marketplaceEnabled: "false" }, /MARKETPLACE_ENABLED/],
  [{ paymentsEnabled: "false" }, /PAYMENTS_ENABLED/],
  [{ stripeSecretKey: `sk_live_${"x".repeat(32)}` }, /test secret key|live keys/],
  [{ connectionUrl: connectionUrl.replace("homle_marketplace_homle_staging", "homle_production") }, /database ending/],
  [{ connectionUrl: connectionUrl.replace("homle_migration_owner", "tideway_app") }, /migration-owner/],
  [{ connectionUrl: connectionUrl.replace("sslmode=verify-full", "sslmode=require") }, /verify-full/]
]) assert.throws(() => prepareHostedParticipantRehearsal({ ...input, ...change }, {}), pattern);

const completeRow = Object.freeze({
  id: bookingId,
  status: "completed",
  cleaning_request_id: "7a8be4de-6b4e-4539-8666-af3f15cda11f",
  accepted_by_cleaner_at: "2026-08-21T10:00:00.000Z",
  confirmed_at: "2026-08-21T10:01:00.000Z",
  journey_started_at: "2026-08-21T11:00:00.000Z",
  arrived_at: "2026-08-21T11:20:00.000Z",
  location_sharing_stopped_at: "2026-08-21T11:20:01.000Z",
  cleaning_started_at: "2026-08-21T11:22:00.000Z",
  cleaning_finished_at: "2026-08-21T13:20:00.000Z",
  completed_at: "2026-08-21T13:24:00.000Z",
  customer_price_pence: 5600,
  cleaner_pay_pence: 4200,
  landlord_email: landlordEmail,
  landlord_account_status: "active",
  landlord_email_verified_at: "2026-08-21T09:00:00.000Z",
  landlord_selected_role: "landlord",
  landlord_profile_exists: true,
  cleaner_email: cleanerEmail,
  cleaner_account_status: "active",
  cleaner_email_verified_at: "2026-08-21T09:00:00.000Z",
  cleaner_selected_role: "cleaner",
  cleaner_profile_exists: true,
  request_status: "matched",
  task_count: "2",
  task_update_count: "2",
  unresolved_task_count: "0",
  before_photo_count: "1",
  after_photo_count: "1",
  current_location_count: "0",
  booking_statuses: ["pending-cleaner-acceptance", "confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed"],
  realtime_kinds: ["booking-status", "journey-location", "journey-location-stopped", "cleaning-progress", "booking-message"],
  landlord_message_count: "1",
  cleaner_message_count: "1",
  review_count: "1",
  payment_status: "refunded",
  amount_pence: 5600,
  amount_captured_pence: 5600,
  amount_refunded_pence: 5600,
  payment_statuses: ["authorized", "captured", "refunded"],
  payment_command_states: ["capture:reconciled", "refund:reconciled", "transfer:provider-failed"],
  provider_events: ["authorization-succeeded", "capture-succeeded", "refund-succeeded", "transfer-succeeded", "transfer-reversed"]
});

function fakePool(row = completeRow, { outsiderAllowed = false } = {}) {
  const calls = [];
  let released = 0;
  let ended = 0;
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/FROM bookings booking/.test(sql)) return { rows: row ? [row] : [] };
      if (/SELECT tideway_private\.get_/.test(sql)) {
        if (outsiderAllowed) return { rows: [{}] };
        throw Object.assign(new Error("booking-not-found"), { code: "P0002" });
      }
      return { rows: [] };
    },
    release() { released += 1; }
  };
  return {
    poolFactory: async (configuration) => {
      assert.equal(configuration.max, 1);
      assert.equal(configuration.application_name, "homle-hosted-participant-rehearsal-verifier");
      return { async connect() { return client; }, async end() { ended += 1; } };
    },
    calls, state: () => ({ released, ended })
  };
}

const successPool = fakePool();
const verified = await verifyHostedParticipantRehearsal({ ...input, poolFactory: successPool.poolFactory, environment: {} });
assert.equal(verified.status, "verified");
assert.equal(verified.bookingFingerprint.length, 12);
assert.equal(verified.bookingLifecycle, "completed");
assert.equal(verified.checklist.tasks, 2);
assert.equal(verified.privateMedia.currentLocationRemoved, true);
assert.equal(verified.stripeTestCycle, "authorized-captured-transferred-reversed-and-refunded");
assert.equal(verified.outsiderAccess, "denied");
assert.equal(verified.writesPerformed, false);
assert(!JSON.stringify(verified).includes(landlordEmail) && !JSON.stringify(verified).includes(cleanerEmail) && !JSON.stringify(verified).includes(bookingId), "Private participant identifiers leaked into hosted rehearsal output.");
assert.equal(successPool.calls.filter(({ sql }) => /^SAVEPOINT outsider_/.test(sql)).length, 4);
assert.equal(successPool.calls.filter(({ sql }) => /^ROLLBACK TO SAVEPOINT outsider_/.test(sql)).length, 4);
assert.deepEqual(successPool.state(), { released: 1, ended: 1 });

for (const [change, pattern] of [
  [{ landlord_profile_exists: false }, /landlord account/],
  [{ cleaner_profile_exists: false }, /cleaner account/],
  [{ status: "awaiting-review" }, /completed booking/],
  [{ booking_statuses: ["confirmed", "completed"] }, /lifecycle is incomplete/],
  [{ realtime_kinds: ["booking-status"] }, /real-time evidence/],
  [{ unresolved_task_count: "1" }, /resolved Cleaner checklist/],
  [{ before_photo_count: "0" }, /before photo/],
  [{ current_location_count: "1" }, /retained current Cleaner location/],
  [{ cleaner_message_count: "0" }, /two-way private booking messaging/],
  [{ review_count: "2" }, /exactly one/],
  [{ payment_status: "captured" }, /full refund reconciliation/],
  [{ payment_statuses: ["authorized", "captured"] }, /payment history is incomplete/],
  [{ payment_command_states: ["capture:reconciled", "refund:reconciled", "transfer:reconciled"] }, /command cycle is incomplete/],
  [{ provider_events: ["authorization-succeeded", "capture-succeeded", "refund-succeeded"] }, /webhook evidence is incomplete/]
]) {
  const failurePool = fakePool({ ...completeRow, ...change });
  await assert.rejects(verifyHostedParticipantRehearsal({ ...input, poolFactory: failurePool.poolFactory, environment: {} }), pattern);
  assert.equal(failurePool.state().ended, 1);
}

const missingPool = fakePool(null);
await assert.rejects(verifyHostedParticipantRehearsal({ ...input, poolFactory: missingPool.poolFactory, environment: {} }), /not found/);

const outsiderPool = fakePool(completeRow, { outsiderAllowed: true });
await assert.rejects(verifyHostedParticipantRehearsal({ ...input, poolFactory: outsiderPool.poolFactory, environment: {} }), /unrelated account could read/);

console.log("Hosted participant rehearsal verifier tests passed.");
