import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgresVerificationEnvironment } from "./postgres-verification-runner.mjs";

const toolPath = fileURLToPath(import.meta.url);
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const controlCharacters = /[\u0000-\u001f\u007f]/;
const restrictedDatabaseUsers = new Set(["tideway_app", "tideway_worker"]);
export const administratorProvisioningConfirmation = "PROVISION FIRST TIDEWAY ADMINISTRATOR";

function boundedText(value, minimum, maximum, label) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (selected.length < minimum || selected.length > maximum || controlCharacters.test(selected)) throw new TypeError(`${label} is invalid.`);
  return selected;
}

function isLocalHost(value) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(value || "").toLowerCase());
}

export function prepareAdministratorProvisioning(input = {}, baseEnvironment = process.env) {
  if (input.confirmation !== administratorProvisioningConfirmation) throw new TypeError(`Set ADMIN_PROVISION_CONFIRMATION exactly to: ${administratorProvisioningConfirmation}`);
  const connectionUrl = boundedText(input.connectionUrl, 1, 8192, "ADMIN_PROVISION_DATABASE_URL");
  const database = postgresVerificationEnvironment(connectionUrl, baseEnvironment);
  if (restrictedDatabaseUsers.has(database.summary.user)) throw new TypeError("Administrator provisioning requires the migration-owner database account, never the web or worker role.");
  if (!isLocalHost(database.summary.host) && database.summary.sslMode !== "verify-full") throw new TypeError("Remote Administrator provisioning requires sslmode=verify-full.");
  const email = boundedText(input.email, 3, 254, "ADMIN_PROVISION_EMAIL").toLowerCase();
  if (!emailPattern.test(email)) throw new TypeError("ADMIN_PROVISION_EMAIL is invalid.");
  const requestId = boundedText(input.requestId, 36, 36, "ADMIN_PROVISION_REQUEST_ID").toLowerCase();
  if (!uuidV4Pattern.test(requestId)) throw new TypeError("ADMIN_PROVISION_REQUEST_ID must be a random UUID v4.");
  const operatorReference = boundedText(input.operatorReference, 6, 120, "ADMIN_PROVISION_OPERATOR_REFERENCE");
  const reason = boundedText(input.reason, 20, 500, "ADMIN_PROVISION_REASON");
  return Object.freeze({ connectionUrl, email, requestId, operatorReference, reason, database: database.summary });
}

function projectedResult(row, prepared) {
  if (!row || !["provisioned", "already-provisioned"].includes(row.provisioning_status) || !Number.isInteger(row.revoked_session_count) || row.revoked_session_count < 0 || !Number.isFinite(Date.parse(row.provisioned_at))) {
    throw new Error("The database returned an invalid Administrator provisioning result.");
  }
  return Object.freeze({
    status: row.provisioning_status,
    sessionsRevoked: row.revoked_session_count,
    provisionedAt: new Date(row.provisioned_at).toISOString(),
    database: prepared.database.database,
    host: prepared.database.host
  });
}

export async function runAdministratorProvisioning(options = {}) {
  const environment = options.environment || process.env;
  const prepared = prepareAdministratorProvisioning({
    connectionUrl: options.connectionUrl ?? environment.ADMIN_PROVISION_DATABASE_URL,
    email: options.email ?? environment.ADMIN_PROVISION_EMAIL,
    requestId: options.requestId ?? environment.ADMIN_PROVISION_REQUEST_ID,
    operatorReference: options.operatorReference ?? environment.ADMIN_PROVISION_OPERATOR_REFERENCE,
    reason: options.reason ?? environment.ADMIN_PROVISION_REASON,
    confirmation: options.confirmation ?? environment.ADMIN_PROVISION_CONFIRMATION
  }, options.baseEnvironment || environment);
  const poolFactory = options.poolFactory || (async (config) => {
    const { Pool } = await import("pg");
    return new Pool(config);
  });
  const pool = await poolFactory({ connectionString: prepared.connectionUrl, max: 1, allowExitOnIdle: true, application_name: "tideway-administrator-bootstrap", connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
  if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") throw new TypeError("A PostgreSQL pool is required for Administrator provisioning.");
  let client;
  try {
    client = await pool.connect();
    if (!client || typeof client.query !== "function") throw new TypeError("A PostgreSQL client is required for Administrator provisioning.");
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const response = await client.query(
      "SELECT * FROM tideway_private.provision_bootstrap_administrator($1::citext,$2::uuid,$3::text,$4::text)",
      [prepared.email, prepared.requestId, prepared.operatorReference, prepared.reason]
    );
    if (!Array.isArray(response.rows) || response.rows.length !== 1) throw new Error("Administrator provisioning returned an unexpected number of results.");
    const result = projectedResult(response.rows[0], prepared);
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

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    const result = await runAdministratorProvisioning();
    console.log(`First Tideway Administrator ${result.status === "provisioned" ? "provisioned" : "already provisioned"}; ${result.sessionsRevoked} session(s) revoked. Sign in again before opening /admin/cases.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
