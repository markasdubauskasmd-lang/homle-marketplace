#!/usr/bin/env node

import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { normalizedEmail } from "../src/marketplace/auth-repository.mjs";
import { createStagingAccountAccess } from "../src/marketplace/staging-account-access.mjs";
import { postgresVerificationEnvironment } from "./postgres-verification-runner.mjs";
import { stagingAccountActivityQuery, stagingAccountActiveSignals } from "./purge-staging-account.mjs";

const toolPath = fileURLToPath(import.meta.url);
const controlCharacters = /[\u0000-\u001f\u007f]/;
const restrictedDatabaseUsers = new Set(["tideway_app", "tideway_worker"]);
const stagingDatabasePattern = /_(?:tideway|homle)_staging$/i;
const supportedProviders = new Set(["google", "facebook", "password"]);
export const stagingRoleRehearsalConfirmation = "VERIFY TWO APPROVED HOMLE STAGING ROLE PROFILES";

function exact(value) {
  return typeof value === "string" ? value.trim() : "";
}

function bounded(value, minimum, maximum, label) {
  const selected = exact(value);
  if (selected.length < minimum || selected.length > maximum || controlCharacters.test(selected)) throw new TypeError(`${label} is invalid.`);
  return selected;
}

function requiredBoolean(value, expected, name) {
  if (exact(value).toLowerCase() !== String(expected)) throw new TypeError(`${name} must be explicitly ${expected} for the account-only role rehearsal.`);
}

export function prepareStagingRoleRehearsal(input = {}, baseEnvironment = process.env) {
  if (input.confirmation !== stagingRoleRehearsalConfirmation) throw new TypeError(`Set STAGING_ROLE_REHEARSAL_CONFIRMATION exactly to: ${stagingRoleRehearsalConfirmation}`);
  requiredBoolean(input.stagingAccountsOnly, true, "STAGING_ACCOUNTS_ONLY");
  requiredBoolean(input.authenticationEnabled, true, "AUTHENTICATION_ENABLED");
  requiredBoolean(input.marketplaceEnabled, false, "MARKETPLACE_ENABLED");
  requiredBoolean(input.pilotIntakeEnabled, false, "PILOT_INTAKE_ENABLED");
  requiredBoolean(input.paymentsEnabled, false, "PAYMENTS_ENABLED");

  const connectionUrl = bounded(input.connectionUrl, 1, 8192, "STAGING_ROLE_REHEARSAL_DATABASE_URL");
  const database = postgresVerificationEnvironment(connectionUrl, baseEnvironment);
  if (restrictedDatabaseUsers.has(database.summary.user)) throw new TypeError("Role-rehearsal verification requires the migration-owner database account, never the web or worker role.");
  if (!stagingDatabasePattern.test(database.summary.database)) throw new TypeError("Role-rehearsal verification only accepts a database ending in _homle_staging or _tideway_staging.");
  const localHost = new Set(["localhost", "127.0.0.1", "::1"]).has(database.summary.host.toLowerCase());
  if (!localHost && database.summary.sslMode !== "verify-full") throw new TypeError("Remote role-rehearsal verification requires sslmode=verify-full.");

  const landlordEmail = normalizedEmail(bounded(input.landlordEmail, 3, 254, "Approved staging Landlord email"));
  const cleanerEmail = normalizedEmail(bounded(input.cleanerEmail, 3, 254, "Approved staging Cleaner email"));
  if (landlordEmail === cleanerEmail) throw new TypeError("The Landlord and Cleaner rehearsal require two distinct approved accounts.");
  const access = createStagingAccountAccess({ STAGING_ACCOUNTS_ONLY: "true", STAGING_ACCOUNT_EMAIL_SHA256: input.approvedEmailSha256 });
  if (!access.allows(landlordEmail) || !access.allows(cleanerEmail)) throw new TypeError("Both rehearsal accounts must be on the approved staging-account fingerprint list.");
  const expectedProvider = bounded(input.expectedProvider || "google", 1, 20, "Expected staging sign-in provider").toLowerCase();
  if (!supportedProviders.has(expectedProvider)) throw new TypeError("Expected staging sign-in provider must be google, facebook or password.");
  return Object.freeze({ connectionUrl, landlordEmail, cleanerEmail, expectedProvider, database: database.summary });
}

function count(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`The staging database returned an invalid ${label}.`);
  return parsed;
}

function strings(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`The staging database returned invalid ${label}.`);
  return [...new Set(value)].sort();
}

function accountEvidence(account, expectedRole, expectedProvider) {
  if (!account || account.account_status !== "active" || !Number.isFinite(Date.parse(account.created_at)) || !Number.isFinite(Date.parse(account.email_verified_at))) throw new Error(`The ${expectedRole} staging account is missing, inactive or unverified.`);
  const roles = strings(account.roles, `${expectedRole} roles`);
  const providers = strings(account.providers, `${expectedRole} providers`);
  if (account.selected_role !== expectedRole || roles.length !== 1 || roles[0] !== expectedRole) throw new Error(`The ${expectedRole} staging account does not have exactly its expected role.`);
  if (!providers.includes(expectedProvider)) throw new Error(`The ${expectedRole} staging account is not connected to the expected ${expectedProvider} provider.`);
  const correctProfile = expectedRole === "landlord" ? account.landlord_profile === true && account.cleaner_profile === false : account.cleaner_profile === true && account.landlord_profile === false;
  if (!correctProfile) throw new Error(`The ${expectedRole} staging account does not have exactly its expected role profile.`);
  const activeSessions = count(account.active_session_count, `${expectedRole} active-session count`);
  if (activeSessions < 1) throw new Error(`The ${expectedRole} staging account has no active session proving the mobile sign-in completed.`);
  return Object.freeze({ role: expectedRole, profileCreated: true, expectedProviderConnected: true, connectedProviderCount: providers.length, activeSessionCount: activeSessions, accountCreatedAt: new Date(account.created_at).toISOString() });
}

export async function verifyStagingRoleRehearsal(options = {}) {
  const environment = options.environment || process.env;
  const prepared = prepareStagingRoleRehearsal({
    connectionUrl: options.connectionUrl ?? environment.STAGING_ROLE_REHEARSAL_DATABASE_URL,
    landlordEmail: options.landlordEmail,
    cleanerEmail: options.cleanerEmail,
    approvedEmailSha256: options.approvedEmailSha256 ?? environment.STAGING_ACCOUNT_EMAIL_SHA256,
    expectedProvider: options.expectedProvider ?? environment.STAGING_ROLE_REHEARSAL_PROVIDER,
    confirmation: options.confirmation ?? environment.STAGING_ROLE_REHEARSAL_CONFIRMATION,
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
  const pool = await poolFactory({ connectionString: prepared.connectionUrl, max: 1, allowExitOnIdle: true, application_name: "homle-staging-role-rehearsal-verifier", connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
  if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") throw new TypeError("A PostgreSQL pool is required for role-rehearsal verification.");
  let client;
  try {
    client = await pool.connect();
    if (!client || typeof client.query !== "function") throw new TypeError("A PostgreSQL client is required for role-rehearsal verification.");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const accounts = await client.query(`
      SELECT account.id, account.email, account.account_status, account.email_verified_at, account.selected_role, account.created_at,
        COALESCE((SELECT array_agg(role.role::text ORDER BY role.role::text) FROM user_roles role WHERE role.user_id=account.id), ARRAY[]::text[]) AS roles,
        COALESCE((SELECT array_agg(identity.provider::text ORDER BY identity.provider::text) FROM authentication_identities identity WHERE identity.user_id=account.id), ARRAY[]::text[]) AS providers,
        (SELECT count(*) FROM sessions session WHERE session.user_id=account.id AND session.revoked_at IS NULL AND session.expires_at>now()) AS active_session_count,
        EXISTS(SELECT 1 FROM landlord_profiles profile WHERE profile.user_id=account.id) AS landlord_profile,
        EXISTS(SELECT 1 FROM cleaner_profiles profile WHERE profile.user_id=account.id) AS cleaner_profile
      FROM users account WHERE account.email=ANY($1::citext[]) ORDER BY account.email
    `, [[prepared.landlordEmail, prepared.cleanerEmail]]);
    if (!Array.isArray(accounts.rows) || accounts.rows.length !== 2) throw new Error("Exactly two approved staging accounts must exist for the role rehearsal.");
    const byEmail = new Map(accounts.rows.map((account) => [normalizedEmail(account.email), account]));
    const landlord = byEmail.get(prepared.landlordEmail);
    const cleaner = byEmail.get(prepared.cleanerEmail);
    const activity = [];
    for (const account of [landlord, cleaner]) {
      if (!account?.id) throw new Error("The staging database did not return both expected accounts.");
      const result = await client.query(stagingAccountActivityQuery, [account.id]);
      if (!Array.isArray(result.rows) || result.rows.length !== 1) throw new Error("The staging database did not return a complete account activity check.");
      activity.push(...stagingAccountActiveSignals(result.rows[0]));
    }
    if (activity.length) throw new Error(`Account-only role rehearsal found marketplace or business activity: ${[...new Set(activity)].sort().join(", ")}.`);
    const evidence = Object.freeze({
      status: "verified",
      provider: prepared.expectedProvider,
      landlord: accountEvidence(landlord, "landlord", prepared.expectedProvider),
      cleaner: accountEvidence(cleaner, "cleaner", prepared.expectedProvider),
      businessActivity: false,
      database: prepared.database.database,
      host: prepared.database.host
    });
    await client.query("COMMIT");
    return evidence;
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release?.();
    await pool.end();
  }
}

async function readRehearsalEmails() {
  if (!stdin.isTTY) {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    const lines = Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length !== 2) throw new TypeError("Provide exactly two lines: approved Landlord email, then approved Cleaner email.");
    return { landlordEmail: lines[0], cleanerEmail: lines[1] };
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return { landlordEmail: await prompt.question("Approved staging Landlord email: "), cleanerEmail: await prompt.question("Approved staging Cleaner email: ") };
  } finally { prompt.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    const result = await verifyStagingRoleRehearsal({ ...await readRehearsalEmails() });
    console.log(`Two-account staging role rehearsal verified: one Landlord profile, one Cleaner profile, ${result.provider} connected, active sessions present, and no marketplace or payment activity.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
