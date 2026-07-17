import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapFreshStagingDatabase, stagingBootstrapConfirmation } from "../tools/bootstrap-staging-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secret = "owner p@ssword/secret";
const connectionUrl = `postgresql://migration_owner:${encodeURIComponent(secret)}@db.example:5432/acme_homle_staging?sslmode=verify-full`;
const migrations = ["001_first.sql", "002_second.sql", "003_third.sql"];
const grants = ["runtime-role-grants.sql", "worker-role-grants.sql"];
const calls = [];
const result = await bootstrapFreshStagingDatabase({
  connectionUrl,
  confirmation: stagingBootstrapConfirmation,
  databaseDirectory: path.join(root, "db"),
  baseEnvironment: { PATH: "private-path", DATABASE_URL: "must-not-reach-psql", SMTP_URL: "must-not-reach-psql" },
  async verifyAssets() { return { ok: true, errors: [], migrations, grantFiles: grants }; },
  spawn(command, args, options) {
    calls.push({ command, args, options, file: path.basename(args.at(-1)) });
    return { status: 0, stdout: args.at(-1).endsWith("deployment-verification.sql") ? '{ "verified" : true }\n' : "ok\n", stderr: "" };
  }
});
assert.deepEqual(result, { database: "acme_homle_staging", host: "db.example", port: "5432", sslMode: "verify-full", migrationCount: 3, grantsApplied: 2, verified: true });
assert.deepEqual(calls.map((call) => call.file), ["assert-empty-staging.sql", ...migrations, ...grants, "deployment-verification.sql"]);
assert(calls.every((call) => call.command === "psql" && call.args.includes("--no-psqlrc") && call.args.every((argument) => !argument.includes(secret) && !argument.includes("postgresql://"))), "A database secret entered bootstrap process arguments.");
assert(calls.every((call) => call.options.env.PGPASSWORD === secret && call.options.env.PGAPPNAME === "homle-fresh-staging-bootstrap"), "The bootstrap lost its private libpq credential or application identity.");
assert(calls.every((call) => !Object.hasOwn(call.options.env, "DATABASE_URL") && !Object.hasOwn(call.options.env, "SMTP_URL")), "Unrelated deployment secrets entered the bootstrap process.");

await assert.rejects(bootstrapFreshStagingDatabase({ connectionUrl, confirmation: "yes", verifyAssets: async () => ({ ok: true, migrations, grantFiles: grants }) }), /Set HOMLE_DATABASE_BOOTSTRAP_CONFIRMATION/);
await assert.rejects(bootstrapFreshStagingDatabase({ connectionUrl: connectionUrl.replace("acme_homle_staging", "homle_production"), confirmation: stagingBootstrapConfirmation, verifyAssets: async () => ({ ok: true, migrations, grantFiles: grants }) }), /must end in/);
await assert.rejects(bootstrapFreshStagingDatabase({ connectionUrl: connectionUrl.replace("migration_owner", "tideway_app"), confirmation: stagingBootstrapConfirmation, verifyAssets: async () => ({ ok: true, migrations, grantFiles: grants }) }), /separate migration owner/);
await assert.rejects(bootstrapFreshStagingDatabase({ connectionUrl, confirmation: stagingBootstrapConfirmation, verifyAssets: async () => ({ ok: false, errors: ["checksum mismatch"] }) }), /checksum mismatch/);

const guardedCalls = [];
await assert.rejects(bootstrapFreshStagingDatabase({
  connectionUrl,
  confirmation: stagingBootstrapConfirmation,
  verifyAssets: async () => ({ ok: true, migrations, grantFiles: grants }),
  spawn(command, args) { guardedCalls.push(path.basename(args.at(-1))); return { status: 3, stdout: "", stderr: "database is not empty" }; }
}), /failed before staging initialization/);
assert.deepEqual(guardedCalls, ["assert-empty-staging.sql"], "A failed empty-staging guard allowed a migration to start.");

const partialCalls = [];
let partialError;
try {
  await bootstrapFreshStagingDatabase({
    connectionUrl,
    confirmation: stagingBootstrapConfirmation,
    verifyAssets: async () => ({ ok: true, migrations, grantFiles: grants }),
    spawn(command, args) {
      const file = path.basename(args.at(-1));
      partialCalls.push(file);
      return file === "002_second.sql" ? { status: 3, stdout: "", stderr: `failed ${connectionUrl}` } : { status: 0, stdout: "ok", stderr: "" };
    }
  });
} catch (error) { partialError = error; }
assert.match(partialError.message, /delete and recreate the empty staging database/);
assert(!partialError.bootstrapOutput.includes(secret) && partialError.bootstrapOutput.includes("[database-url-redacted]"), "Bootstrap failure output leaked a database credential.");
assert.deepEqual(partialCalls, ["assert-empty-staging.sql", "001_first.sql", "002_second.sql"], "Bootstrap continued after a failed migration.");

await assert.rejects(bootstrapFreshStagingDatabase({
  connectionUrl,
  confirmation: stagingBootstrapConfirmation,
  verifyAssets: async () => ({ ok: true, migrations, grantFiles: grants }),
  spawn() { return { error: { code: "ENOENT" } }; }
}), /psql client/);

console.log("Fresh staging bootstrap tests passed: exact confirmation, staging-only empty-target guard, locked order, restricted grants, secret-safe psql execution, stop-on-failure and final verification.");
