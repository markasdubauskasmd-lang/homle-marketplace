#!/usr/bin/env node

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStagingAccountAccess } from "../src/marketplace/staging-account-access.mjs";
import { postgresVerificationEnvironment } from "./postgres-verification-runner.mjs";

const toolPath = fileURLToPath(import.meta.url);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stagingDatabasePattern = /_(?:tideway|homle)_staging$/i;
const restrictedDatabaseUsers = new Set(["tideway_app", "tideway_worker"]);
const zeroUserId = "00000000-0000-4000-8000-000000000000";
const requiredBookingStatuses = Object.freeze([
  "pending-cleaner-acceptance", "confirmed", "cleaner-en-route", "cleaner-arrived",
  "cleaning-in-progress", "awaiting-review", "completed"
]);
const requiredRealtimeKinds = Object.freeze([
  "booking-status", "journey-location", "journey-location-stopped", "cleaning-progress", "booking-message"
]);
const requiredProviderEvents = Object.freeze([
  "authorization-succeeded", "capture-succeeded", "refund-succeeded", "transfer-succeeded", "transfer-reversed"
]);

export const hostedParticipantRehearsalConfirmation = "VERIFY ONE PRIVATE HOMLE HOSTED BOOKING REHEARSAL";

function exact(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredFlag(value, expected, name) {
  if (exact(value).toLowerCase() !== String(expected)) throw new TypeError(`${name} must be explicitly ${expected} for hosted rehearsal verification.`);
}

function integer(value, name) {
  const selected = Number(value);
  if (!Number.isSafeInteger(selected) || selected < 0) throw new Error(`The staging database returned an invalid ${name}.`);
  return selected;
}

function strings(value, name) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`The staging database returned invalid ${name}.`);
  return [...new Set(value)].sort();
}

function requireEvery(actual, expected, message) {
  const selected = new Set(actual);
  const missing = expected.filter((item) => !selected.has(item));
  if (missing.length) throw new Error(`${message}: ${missing.join(", ")}.`);
}

export function prepareHostedParticipantRehearsal(input = {}, baseEnvironment = process.env) {
  if (input.confirmation !== hostedParticipantRehearsalConfirmation) {
    throw new TypeError(`Set HOMLE_HOSTED_REHEARSAL_CONFIRMATION exactly to: ${hostedParticipantRehearsalConfirmation}`);
  }
  requiredFlag(input.stagingAccountsOnly, true, "STAGING_ACCOUNTS_ONLY");
  requiredFlag(input.marketplaceEnabled, true, "MARKETPLACE_ENABLED");
  requiredFlag(input.paymentsEnabled, true, "PAYMENTS_ENABLED");
  const stripeSecretKey = exact(input.stripeSecretKey);
  if (!/^sk_test_[A-Za-z0-9_]{16,200}$/.test(stripeSecretKey)) throw new TypeError("Hosted rehearsal verification requires a Stripe test secret key; live keys are prohibited.");

  const bookingId = exact(input.bookingId);
  if (!uuidPattern.test(bookingId)) throw new TypeError("HOMLE_HOSTED_REHEARSAL_BOOKING_ID must be one booking UUID from the private launch rehearsal.");
  const connectionUrl = exact(input.connectionUrl);
  if (!connectionUrl || connectionUrl.length > 8192) throw new TypeError("HOMLE_HOSTED_REHEARSAL_DATABASE_URL is invalid.");
  const database = postgresVerificationEnvironment(connectionUrl, baseEnvironment);
  if (restrictedDatabaseUsers.has(database.summary.user)) throw new TypeError("Hosted rehearsal verification requires the migration-owner database account, never the web or worker role.");
  if (!stagingDatabasePattern.test(database.summary.database)) throw new TypeError("Hosted rehearsal verification only accepts a database ending in _homle_staging or _tideway_staging.");
  const localHost = new Set(["localhost", "127.0.0.1", "::1"]).has(database.summary.host.toLowerCase());
  if (!localHost && database.summary.sslMode !== "verify-full") throw new TypeError("Remote hosted rehearsal verification requires sslmode=verify-full.");

  const approvedAccounts = createStagingAccountAccess({
    STAGING_ACCOUNTS_ONLY: "true",
    STAGING_ACCOUNT_EMAIL_SHA256: input.approvedEmailSha256
  });
  return Object.freeze({ bookingId, connectionUrl, database: database.summary, approvedAccounts });
}

const evidenceQuery = `
  SELECT
    booking.id, booking.status::text, booking.cleaning_request_id,
    booking.accepted_by_cleaner_at, booking.confirmed_at, booking.journey_started_at,
    booking.arrived_at, booking.location_sharing_stopped_at, booking.cleaning_started_at,
    booking.cleaning_finished_at, booking.completed_at,
    booking.customer_price_pence, booking.cleaner_pay_pence,
    landlord.email::text AS landlord_email, landlord.account_status AS landlord_account_status,
    landlord.email_verified_at AS landlord_email_verified_at, landlord.selected_role::text AS landlord_selected_role,
    EXISTS(SELECT 1 FROM landlord_profiles profile WHERE profile.user_id=landlord.id) AS landlord_profile_exists,
    cleaner.email::text AS cleaner_email, cleaner.account_status AS cleaner_account_status,
    cleaner.email_verified_at AS cleaner_email_verified_at, cleaner.selected_role::text AS cleaner_selected_role,
    EXISTS(SELECT 1 FROM cleaner_profiles profile WHERE profile.user_id=cleaner.id) AS cleaner_profile_exists,
    request.status AS request_status,
    (SELECT count(*) FROM cleaning_tasks task WHERE task.booking_id=booking.id) AS task_count,
    (SELECT count(*) FROM task_updates task_update WHERE task_update.booking_id=booking.id) AS task_update_count,
    (SELECT count(*) FROM cleaning_tasks task WHERE task.booking_id=booking.id
      AND (task.status NOT IN ('completed','skipped','issue-reported') OR (task.unexpected AND task.landlord_approval_status='pending'))) AS unresolved_task_count,
    (SELECT count(*) FROM job_photos photo WHERE photo.booking_id=booking.id AND photo.photo_type='before') AS before_photo_count,
    (SELECT count(*) FROM job_photos photo WHERE photo.booking_id=booking.id AND photo.photo_type='after') AS after_photo_count,
    (SELECT count(*) FROM cleaner_locations location WHERE location.booking_id=booking.id) AS current_location_count,
    COALESCE((SELECT array_agg(DISTINCT history.to_status::text ORDER BY history.to_status::text)
      FROM booking_status_history history WHERE history.booking_id=booking.id), ARRAY[]::text[]) AS booking_statuses,
    COALESCE((SELECT array_agg(DISTINCT event.event_kind ORDER BY event.event_kind)
      FROM booking_realtime_events event WHERE event.booking_id=booking.id), ARRAY[]::text[]) AS realtime_kinds,
    (SELECT count(*) FROM messages message WHERE message.booking_id=booking.id AND message.sender_user_id=booking.landlord_user_id AND message.deleted_at IS NULL) AS landlord_message_count,
    (SELECT count(*) FROM messages message WHERE message.booking_id=booking.id AND message.sender_user_id=booking.cleaner_user_id AND message.deleted_at IS NULL) AS cleaner_message_count,
    (SELECT count(*) FROM reviews review WHERE review.booking_id=booking.id) AS review_count,
    payment.status AS payment_status, payment.amount_pence, payment.amount_captured_pence, payment.amount_refunded_pence,
    COALESCE((SELECT array_agg(DISTINCT history.to_status ORDER BY history.to_status)
      FROM payment_status_history history WHERE history.payment_id=payment.id), ARRAY[]::text[]) AS payment_statuses,
    COALESCE((SELECT array_agg(DISTINCT command.command_kind || ':' || command.status ORDER BY command.command_kind || ':' || command.status)
      FROM payment_commands command WHERE command.payment_id=payment.id), ARRAY[]::text[]) AS payment_command_states,
    COALESCE((SELECT array_agg(DISTINCT event.event_kind ORDER BY event.event_kind)
      FROM tideway_private.payment_provider_events event WHERE event.payment_id=payment.id AND event.processed=true), ARRAY[]::text[]) AS provider_events
  FROM bookings booking
  JOIN users landlord ON landlord.id=booking.landlord_user_id
  JOIN users cleaner ON cleaner.id=booking.cleaner_user_id
  JOIN cleaning_requests request ON request.id=booking.cleaning_request_id
  LEFT JOIN booking_payments payment ON payment.booking_id=booking.id
  WHERE booking.id=$1::uuid
`;

function verifiedAccount(row, prefix, expectedRole, approvedAccounts) {
  if (row[`${prefix}_account_status`] !== "active" || !row[`${prefix}_email_verified_at`] || row[`${prefix}_selected_role`] !== expectedRole || row[`${prefix}_profile_exists`] !== true) {
    throw new Error(`The rehearsal ${expectedRole} account is missing, inactive, unverified or assigned the wrong role.`);
  }
  if (!approvedAccounts.allows(row[`${prefix}_email`])) throw new Error(`The rehearsal ${expectedRole} account is not on the approved staging allowlist.`);
}

function requireTimestamp(row, field, label) {
  if (!Number.isFinite(Date.parse(row[field]))) throw new Error(`The rehearsal is missing its ${label} timestamp.`);
}

async function proveOutsiderDenied(client, bookingId, functionCall, label) {
  const savepoint = `outsider_${label.replaceAll("-", "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query("SELECT set_config('app.user_id',$1,true), set_config('app.user_roles','landlord',true)", [zeroUserId]);
    await client.query(functionCall, [bookingId]);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (error?.code === "P0002" && error?.message === "booking-not-found") return true;
    throw error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  throw new Error(`An unrelated account could read the rehearsal ${label}.`);
}

export async function verifyHostedParticipantRehearsal(options = {}) {
  const environment = options.environment || process.env;
  const prepared = prepareHostedParticipantRehearsal({
    bookingId: options.bookingId ?? environment.HOMLE_HOSTED_REHEARSAL_BOOKING_ID,
    connectionUrl: options.connectionUrl ?? environment.HOMLE_HOSTED_REHEARSAL_DATABASE_URL,
    approvedEmailSha256: options.approvedEmailSha256 ?? environment.STAGING_ACCOUNT_EMAIL_SHA256,
    confirmation: options.confirmation ?? environment.HOMLE_HOSTED_REHEARSAL_CONFIRMATION,
    stagingAccountsOnly: options.stagingAccountsOnly ?? environment.STAGING_ACCOUNTS_ONLY,
    marketplaceEnabled: options.marketplaceEnabled ?? environment.MARKETPLACE_ENABLED,
    paymentsEnabled: options.paymentsEnabled ?? environment.PAYMENTS_ENABLED,
    stripeSecretKey: options.stripeSecretKey ?? environment.STRIPE_SECRET_KEY
  }, options.baseEnvironment || environment);
  const poolFactory = options.poolFactory || (async (config) => {
    const { Pool } = await import("pg");
    return new Pool(config);
  });
  const pool = await poolFactory({ connectionString: prepared.connectionUrl, max: 1, allowExitOnIdle: true, application_name: "homle-hosted-participant-rehearsal-verifier", connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
  if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") throw new TypeError("A PostgreSQL pool is required for hosted rehearsal verification.");
  let client;
  try {
    client = await pool.connect();
    if (!client || typeof client.query !== "function") throw new TypeError("A PostgreSQL client is required for hosted rehearsal verification.");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const result = await client.query(evidenceQuery, [prepared.bookingId]);
    if (!Array.isArray(result.rows) || result.rows.length !== 1) throw new Error("The selected hosted rehearsal booking was not found or has no complete request and participant pair.");
    const row = result.rows[0];
    verifiedAccount(row, "landlord", "landlord", prepared.approvedAccounts);
    verifiedAccount(row, "cleaner", "cleaner", prepared.approvedAccounts);
    if (row.status !== "completed" || row.request_status !== "matched") throw new Error("The hosted rehearsal has not reached one completed booking from a matched request.");
    for (const [field, label] of [
      ["accepted_by_cleaner_at", "Cleaner acceptance"], ["confirmed_at", "confirmation"],
      ["journey_started_at", "journey start"], ["arrived_at", "arrival"],
      ["location_sharing_stopped_at", "location stop"], ["cleaning_started_at", "cleaning start"],
      ["cleaning_finished_at", "cleaning finish"], ["completed_at", "Landlord completion"]
    ]) requireTimestamp(row, field, label);
    if (integer(row.customer_price_pence, "customer total") < 1 || integer(row.cleaner_pay_pence, "Cleaner pay") < 1 || Number(row.customer_price_pence) < Number(row.cleaner_pay_pence)) {
      throw new Error("The rehearsal booking does not retain valid frozen customer and Cleaner totals.");
    }
    requireEvery(strings(row.booking_statuses, "booking status history"), requiredBookingStatuses, "The rehearsal booking lifecycle is incomplete");
    requireEvery(strings(row.realtime_kinds, "real-time event kinds"), requiredRealtimeKinds, "The participant real-time evidence is incomplete");
    const taskCount = integer(row.task_count, "task count");
    if (taskCount < 1 || integer(row.task_update_count, "task update count") < taskCount || integer(row.unresolved_task_count, "unresolved task count") !== 0) {
      throw new Error("The hosted rehearsal does not prove a fully updated and resolved Cleaner checklist.");
    }
    if (integer(row.before_photo_count, "before-photo count") < 1 || integer(row.after_photo_count, "after-photo count") < 1) {
      throw new Error("The hosted rehearsal requires at least one private before photo and one private after photo.");
    }
    if (integer(row.current_location_count, "current-location count") !== 0) throw new Error("The rehearsal retained current Cleaner location after arrival or completion.");
    if (integer(row.landlord_message_count, "Landlord message count") < 1 || integer(row.cleaner_message_count, "Cleaner message count") < 1) {
      throw new Error("The hosted rehearsal does not prove two-way private booking messaging.");
    }
    if (integer(row.review_count, "review count") !== 1) throw new Error("The hosted rehearsal must retain exactly one verified-booking review.");
    if (row.payment_status !== "refunded" || integer(row.amount_pence, "payment amount") < 1 || Number(row.amount_captured_pence) !== Number(row.amount_pence) || Number(row.amount_refunded_pence) !== Number(row.amount_pence)) {
      throw new Error("The Stripe test payment has not completed authorization, capture and full refund reconciliation.");
    }
    requireEvery(strings(row.payment_statuses, "payment status history"), ["authorized", "captured", "refunded"], "The Stripe test payment history is incomplete");
    // A successful transfer is reconciled first; its later reversal deliberately
    // moves that same command to provider-failed. Requiring transfer:reconciled at
    // the final snapshot would reject the exact safely reversed state we need.
    requireEvery(strings(row.payment_command_states, "payment command states"), ["capture:reconciled", "refund:reconciled", "transfer:provider-failed"], "The Stripe test command cycle is incomplete");
    requireEvery(strings(row.provider_events, "processed provider events"), requiredProviderEvents, "The Stripe test webhook evidence is incomplete");

    // PostgreSQL clients are strictly sequential. Each denial uses a savepoint so the
    // expected exception cannot poison the surrounding repeatable-read transaction.
    const outsiderChecks = [];
    for (const [functionCall, label] of [
      ["SELECT tideway_private.get_cleaning_progress($1::uuid)", "progress"],
      ["SELECT tideway_private.get_booking_messages($1::uuid,NULL,NULL,50)", "messages"],
      ["SELECT tideway_private.get_booking_realtime_snapshot($1::uuid,0,100)", "realtime"],
      ["SELECT tideway_private.get_booking_review($1::uuid)", "review"]
    ]) outsiderChecks.push(await proveOutsiderDenied(client, prepared.bookingId, functionCall, label));
    if (!outsiderChecks.every(Boolean)) throw new Error("The unrelated-account denial proof was incomplete.");
    await client.query("COMMIT");
    return Object.freeze({
      status: "verified",
      bookingFingerprint: createHash("sha256").update(prepared.bookingId).digest("hex").slice(0, 12),
      accounts: Object.freeze({ landlord: "approved-and-verified", cleaner: "approved-and-verified" }),
      bookingLifecycle: "completed",
      checklist: Object.freeze({ tasks: taskCount, resolved: true }),
      privateMedia: Object.freeze({ beforeAndAfter: true, currentLocationRemoved: true }),
      messaging: "two-way",
      review: "exactly-one",
      stripeTestCycle: "authorized-captured-transferred-reversed-and-refunded",
      outsiderAccess: "denied",
      database: prepared.database.database,
      host: prepared.database.host,
      writesPerformed: false
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release?.();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    console.log(JSON.stringify(await verifyHostedParticipantRehearsal(), null, 2));
  } catch (error) {
    console.error(error?.message || "Hosted participant rehearsal verification failed.");
    process.exitCode = 1;
  }
}
