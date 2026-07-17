#!/usr/bin/env node

import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { normalizedEmail } from "../src/marketplace/auth-repository.mjs";
import { createStagingAccountAccess } from "../src/marketplace/staging-account-access.mjs";
import { postgresVerificationEnvironment } from "./postgres-verification-runner.mjs";

const toolPath = fileURLToPath(import.meta.url);
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controlCharacters = /[\u0000-\u001f\u007f]/;
const restrictedDatabaseUsers = new Set(["tideway_app", "tideway_worker"]);
const stagingDatabasePattern = /_(?:tideway|homle)_staging$/i;
export const stagingAccountPurgeConfirmation = "DELETE APPROVED ACCOUNT-ONLY HOMLE STAGING TEST";

const activityQuery = `
  SELECT
    (SELECT count(*) FROM user_roles WHERE granted_by=$1 AND user_id<>$1) AS roles_granted_to_others,
    (SELECT count(*) FROM properties WHERE landlord_user_id=$1) AS properties,
    (SELECT count(*) FROM property_photos WHERE uploaded_by=$1) AS property_photos,
    (SELECT count(*) FROM cleaning_requests WHERE landlord_user_id=$1) AS cleaning_requests,
    (SELECT count(*) FROM cleaning_request_status_history WHERE changed_by=$1) AS cleaning_request_status_events,
    (SELECT count(*) FROM cleaning_request_photo_uploads WHERE requested_by=$1) AS cleaning_request_photo_uploads,
    (SELECT count(*) FROM bookings WHERE landlord_user_id=$1 OR cleaner_user_id=$1) AS bookings,
    (SELECT count(*) FROM booking_status_history WHERE changed_by=$1) AS booking_status_events,
    (SELECT count(*) FROM task_updates WHERE actor_user_id=$1) AS task_updates,
    (SELECT count(*) FROM job_photos WHERE uploaded_by=$1) AS job_photos,
    (SELECT count(*) FROM job_photo_uploads WHERE requested_by=$1) AS job_photo_uploads,
    (SELECT count(*) FROM cleaner_locations WHERE cleaner_user_id=$1) AS cleaner_locations,
    (SELECT count(*) FROM job_pauses WHERE paused_by=$1 OR resumed_by=$1) AS job_pauses,
    (SELECT count(*) FROM unexpected_task_decisions WHERE landlord_user_id=$1) AS unexpected_task_decisions,
    (SELECT count(*) FROM booking_progress_events WHERE actor_user_id=$1) AS booking_progress_events,
    (SELECT count(*) FROM messages WHERE sender_user_id=$1) AS messages,
    (SELECT count(*) FROM booking_realtime_events WHERE actor_user_id=$1) AS booking_realtime_events,
    (SELECT count(*) FROM notifications WHERE recipient_user_id=$1) AS notifications,
    (SELECT count(*) FROM reviews WHERE landlord_user_id=$1 OR cleaner_user_id=$1 OR moderated_by=$1) AS reviews,
    (SELECT count(*) FROM favourite_cleaners WHERE landlord_user_id=$1 OR cleaner_user_id=$1) AS favourites,
    (SELECT count(*) FROM disputes WHERE opened_by=$1 OR assigned_admin_user_id=$1) AS disputes,
    (SELECT count(*) FROM privacy_requests WHERE user_id=$1) AS privacy_requests,
    (SELECT count(*) FROM booking_payments WHERE landlord_user_id=$1 OR cleaner_user_id=$1) AS booking_payments,
    (SELECT count(*) FROM payment_commands WHERE created_by=$1) AS payment_commands,
    (SELECT count(*) FROM payment_status_history WHERE changed_by=$1) AS payment_status_events,
    (SELECT count(*) FROM tideway_private.cleaner_payout_onboarding WHERE cleaner_user_id=$1) AS payout_onboarding,
    (SELECT count(*) FROM tideway_private.cleaner_payout_accounts WHERE cleaner_user_id=$1) AS payout_accounts
`;

function exact(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedText(value, minimum, maximum, label) {
  const selected = exact(value);
  if (selected.length < minimum || selected.length > maximum || controlCharacters.test(selected)) throw new TypeError(`${label} is invalid.`);
  return selected;
}

function disabled(value, name) {
  if (exact(value).toLowerCase() !== "false") throw new TypeError(`${name} must be explicitly false before staging-account cleanup.`);
}

export function prepareStagingAccountPurge(input = {}, baseEnvironment = process.env) {
  if (input.confirmation !== stagingAccountPurgeConfirmation) throw new TypeError(`Set STAGING_ACCOUNT_PURGE_CONFIRMATION exactly to: ${stagingAccountPurgeConfirmation}`);
  if (exact(input.stagingAccountsOnly).toLowerCase() !== "true") throw new TypeError("STAGING_ACCOUNTS_ONLY must remain true for staging-account cleanup.");
  disabled(input.authenticationEnabled, "AUTHENTICATION_ENABLED");
  disabled(input.marketplaceEnabled, "MARKETPLACE_ENABLED");
  disabled(input.pilotIntakeEnabled, "PILOT_INTAKE_ENABLED");
  disabled(input.paymentsEnabled, "PAYMENTS_ENABLED");

  const connectionUrl = boundedText(input.connectionUrl, 1, 8192, "STAGING_ACCOUNT_PURGE_DATABASE_URL");
  const database = postgresVerificationEnvironment(connectionUrl, baseEnvironment);
  if (restrictedDatabaseUsers.has(database.summary.user)) throw new TypeError("Staging-account cleanup requires the migration-owner database account, never the web or worker role.");
  if (!stagingDatabasePattern.test(database.summary.database)) throw new TypeError("Staging-account cleanup only accepts a database ending in _homle_staging or _tideway_staging.");
  const localHost = new Set(["localhost", "127.0.0.1", "::1"]).has(database.summary.host.toLowerCase());
  if (!localHost && database.summary.sslMode !== "verify-full") throw new TypeError("Remote staging-account cleanup requires sslmode=verify-full.");

  const email = normalizedEmail(boundedText(input.email, 3, 254, "Approved staging email"));
  const access = createStagingAccountAccess({ STAGING_ACCOUNTS_ONLY: "true", STAGING_ACCOUNT_EMAIL_SHA256: input.approvedEmailSha256 });
  if (!access.allows(email)) throw new TypeError("The supplied account is not on the approved staging-account fingerprint list.");
  const requestId = boundedText(input.requestId, 36, 36, "STAGING_ACCOUNT_PURGE_REQUEST_ID").toLowerCase();
  if (!uuidV4Pattern.test(requestId)) throw new TypeError("STAGING_ACCOUNT_PURGE_REQUEST_ID must be a random UUID v4.");
  const reason = boundedText(input.reason, 20, 500, "STAGING_ACCOUNT_PURGE_REASON");
  return Object.freeze({ connectionUrl, email, requestId, reason, database: database.summary });
}

function count(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("The staging database returned an invalid activity count.");
  return parsed;
}

function activeSignals(row = {}) {
  return Object.entries(row).filter(([, value]) => count(value) > 0).map(([name]) => name);
}

function projectedResult({ account, auditCount, deleted, audit }, prepared) {
  if (!account || ![null, "cleaner", "landlord"].includes(account.selected_role) || !Number.isFinite(Date.parse(account.created_at))) throw new Error("The staging database returned an invalid account record.");
  if (!deleted || deleted.id !== account.id) throw new Error("The approved staging account was not deleted.");
  if (!audit || !Number.isFinite(Date.parse(audit.created_at))) throw new Error("The anonymous cleanup evidence was not recorded.");
  return Object.freeze({
    status: "purged",
    role: account.selected_role,
    identitiesDeleted: count(account.identity_count),
    sessionsDeleted: count(account.session_count),
    auditEventsRemoved: count(auditCount),
    accountCreatedAt: new Date(account.created_at).toISOString(),
    purgedAt: new Date(audit.created_at).toISOString(),
    requestId: prepared.requestId,
    database: prepared.database.database,
    host: prepared.database.host
  });
}

export async function runStagingAccountPurge(options = {}) {
  const environment = options.environment || process.env;
  const prepared = prepareStagingAccountPurge({
    connectionUrl: options.connectionUrl ?? environment.STAGING_ACCOUNT_PURGE_DATABASE_URL,
    email: options.email,
    approvedEmailSha256: options.approvedEmailSha256 ?? environment.STAGING_ACCOUNT_EMAIL_SHA256,
    requestId: options.requestId ?? environment.STAGING_ACCOUNT_PURGE_REQUEST_ID,
    reason: options.reason ?? environment.STAGING_ACCOUNT_PURGE_REASON,
    confirmation: options.confirmation ?? environment.STAGING_ACCOUNT_PURGE_CONFIRMATION,
    stagingAccountsOnly: options.stagingAccountsOnly ?? environment.STAGING_ACCOUNTS_ONLY,
    authenticationEnabled: options.authenticationEnabled ?? environment.AUTHENTICATION_ENABLED,
    marketplaceEnabled: options.marketplaceEnabled ?? environment.MARKETPLACE_ENABLED,
    pilotIntakeEnabled: options.pilotIntakeEnabled ?? environment.PILOT_INTAKE_ENABLED,
    paymentsEnabled: options.paymentsEnabled ?? environment.PAYMENTS_ENABLED
  }, options.baseEnvironment || environment);
  const poolFactory = options.poolFactory || (async (config) => {
    const { Pool } = await import("pg");
    return new Pool(config);
  });
  const pool = await poolFactory({ connectionString: prepared.connectionUrl, max: 1, allowExitOnIdle: true, application_name: "homle-staging-account-cleanup", connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
  if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") throw new TypeError("A PostgreSQL pool is required for staging-account cleanup.");
  let client;
  try {
    client = await pool.connect();
    if (!client || typeof client.query !== "function") throw new TypeError("A PostgreSQL client is required for staging-account cleanup.");
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const target = await client.query(`
      SELECT account.id, account.selected_role, account.created_at,
        (SELECT count(*) FROM authentication_identities identity WHERE identity.user_id=account.id) AS identity_count,
        (SELECT count(*) FROM sessions session WHERE session.user_id=account.id) AS session_count,
        EXISTS(SELECT 1 FROM user_roles role WHERE role.user_id=account.id AND role.role='administrator') AS is_administrator
      FROM users account WHERE account.email=$1::citext FOR UPDATE
    `, [prepared.email]);
    if (!Array.isArray(target.rows) || target.rows.length !== 1) throw new Error("Exactly one approved staging account must exist before cleanup.");
    const account = target.rows[0];
    if (account.is_administrator === true) throw new Error("Administrator accounts cannot be removed by the staging account-only cleanup tool.");
    const activity = await client.query(activityQuery, [account.id]);
    if (!Array.isArray(activity.rows) || activity.rows.length !== 1) throw new Error("The staging database did not return a complete activity check.");
    const signals = activeSignals(activity.rows[0]);
    if (signals.length) throw new Error(`Account-only cleanup refused an account with marketplace or business activity: ${signals.join(", ")}.`);
    const removedAudit = await client.query("DELETE FROM audit_logs WHERE actor_user_id=$1 OR (resource_type='user' AND resource_id=$1::text) RETURNING id", [account.id]);
    const deleted = await client.query("DELETE FROM users WHERE id=$1 RETURNING id", [account.id]);
    const evidence = await client.query(
      "INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,request_id,metadata) VALUES(NULL,'staging-account.purged','staging-account-cleanup',$1,$1::uuid,jsonb_build_object('selectedRole',$2::text,'accountCreatedAt',$3::timestamptz,'removedAuditEventCount',$4::integer,'reason',$5::text)) RETURNING created_at",
      [prepared.requestId, account.selected_role, account.created_at, removedAudit.rowCount, prepared.reason]
    );
    const result = projectedResult({ account, auditCount: removedAudit.rowCount, deleted: deleted.rows?.[0], audit: evidence.rows?.[0] }, prepared);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release?.();
    await pool.end();
  }
}

async function readPrivateEmail() {
  if (!stdin.isTTY) {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString("utf8").trim();
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  try { return await prompt.question("Approved staging email to remove: "); }
  finally { prompt.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    const result = await runStagingAccountPurge({ email: await readPrivateEmail() });
    console.log(`Approved account-only staging test purged. ${result.sessionsDeleted} session(s), ${result.identitiesDeleted} identity record(s), and ${result.auditEventsRemoved} account audit event(s) were removed. Cleanup evidence: ${result.requestId}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
