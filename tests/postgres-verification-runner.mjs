import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgresVerificationEnvironment, runPostgresDeploymentVerification } from "../tools/postgres-verification-runner.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sql = await readFile(path.join(projectRoot, "db", "integration", "deployment-verification.sql"), "utf8");
for (const required of [
  "BEGIN TRANSACTION READ ONLY", "server_version_num", "pgcrypto", "citext", "btree_gist", "rolbypassrls", "rolcanlogin",
  "relrowsecurity", "bookings_no_cleaner_overlap", "UNIQUE (booking_id)", "bookings_one_live_attempt_per_request_idx",
  "sessions_expiry_purge_idx", "bookings_require_current_payment_before_job_start", "current_booking_payment_authorized(uuid)", "require_current_payment_before_job_start()", "has_function_privilege", "has_table_privilege", "tideway_app", "tideway_worker",
  "purge_expired_sessions(integer)", "worker role has direct public-table privileges", "ROLLBACK"
]) assert.ok(sql.toLowerCase().includes(required.toLowerCase()), `Deployment verifier omitted ${required}.`);
assert.equal((sql.match(/'users','user_roles'/g) || []).length, 1, "The verifier lost its authoritative RLS table inventory.");
assert.ok(!/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\s+(?:TABLE|INTO|FROM|VIEW|FUNCTION|SCHEMA)\b/i.test(sql.replace(/'[^']*'/g, "''")), "The deployment verifier contains a database mutation statement.");

const secret = "p@ss word/with:symbols";
const encodedSecret = encodeURIComponent(secret);
const url = `postgresql://migration_owner:${encodedSecret}@db.internal.example:6543/tideway_staging?sslmode=verify-full&connect_timeout=12&sslrootcert=C%3A%5Ccerts%5Croot.pem`;
const prepared = postgresVerificationEnvironment(url, { PATH: "private-path", DATABASE_URL: "must-be-removed", DATABASE_VERIFICATION_URL: "must-be-removed", SMTP_URL: "must-not-reach-psql" });
assert.deepEqual(prepared.summary, { host: "db.internal.example", port: "6543", database: "tideway_staging", user: "migration_owner", sslMode: "verify-full" });
assert.equal(prepared.environment.PGPASSWORD, secret);
assert.equal(prepared.environment.PGSSLROOTCERT, "C:\\certs\\root.pem");
assert.ok(!Object.hasOwn(prepared.environment, "DATABASE_URL") && !Object.hasOwn(prepared.environment, "DATABASE_VERIFICATION_URL"));
assert.ok(!Object.hasOwn(prepared.environment, "SMTP_URL"), "Unrelated application secrets entered the psql environment.");

let invocation;
const successful = runPostgresDeploymentVerification({
  connectionUrl: url,
  baseEnvironment: { PATH: "private-path" },
  spawn(command, args, options) {
    invocation = { command, args, options };
    return { status: 0, stdout: '{"verified":true}\n', stderr: "" };
  }
});
assert.equal(successful.database, "tideway_staging");
assert.equal(invocation.command, "psql");
assert.deepEqual(invocation.args.slice(0, 4), ["-X", "--no-psqlrc", "--set", "ON_ERROR_STOP=1"]);
assert.ok(invocation.args.includes("--file") && invocation.args.every((argument) => !argument.includes(secret) && !argument.includes("migration_owner:") && !argument.includes("db.internal.example")), "Database credentials or connection URL entered the process arguments.");
assert.equal(invocation.options.env.PGPASSWORD, secret);
assert.ok(!JSON.stringify(successful).includes(secret), "Verification result leaked the database password.");

assert.throws(() => postgresVerificationEnvironment("https://example.com/database"), /use PostgreSQL/);
assert.throws(() => postgresVerificationEnvironment("postgresql://owner@localhost/"), /name one database/);
assert.throws(() => postgresVerificationEnvironment("postgresql://owner@localhost/tideway?application_name=unsafe"), /Unsupported/);
assert.throws(() => postgresVerificationEnvironment("postgresql://owner@localhost/tideway?connect_timeout=0"), /between 1 and 60/);
assert.throws(() => runPostgresDeploymentVerification({ connectionUrl: "postgresql://owner@localhost/tideway", spawn() { return { error: { code: "ENOENT" } }; } }), /psql client/);

let failed;
try {
  runPostgresDeploymentVerification({ connectionUrl: url, spawn() { return { status: 3, stdout: "", stderr: `connection failed ${url}` }; } });
} catch (error) { failed = error; }
assert.equal(failed.message, "PostgreSQL deployment verification failed.");
assert.ok(failed.verificationOutput.includes("[database-url-redacted]") && !failed.verificationOutput.includes(encodedSecret) && !failed.verificationOutput.includes(secret), "Failed verification output leaked a connection URL or password.");

console.log("PostgreSQL verification runner tests passed: read-only security checks, credential-safe psql invocation, TLS defaults, input rejection and sanitized failures.");
