import assert from "node:assert/strict";
import path from "node:path";
import { bootstrapRenderStagingDatabase, removePsqlMetaCommands, restrictedDatabaseUrl } from "../src/marketplace/render-staging-bootstrap.mjs";

const appPassword = "app-password-that-is-long-and-unique-123";
const workerPassword = "worker-password-that-is-long-and-unique-456";
const ownerUrl = "postgresql://homle_migration_owner:owner-secret@private-db.example:5432/homle_marketplace_homle_staging";
const renderOwnerUrl = "postgresql://homle_migration_owner:owner-secret@dpg-d9csr9b7uimc73f0m8d0-a:5432/homle_marketplace_homle_staging";
const assets = { ok: true, migrations: ["001_first.sql", "002_second.sql"], grantFiles: ["runtime-role-grants.sql", "worker-role-grants.sql"] };

function sqlFor(file) {
  const name = path.basename(file);
  if (name === "assert-empty-staging.sql") return "\\set ON_ERROR_STOP on\nBEGIN TRANSACTION READ ONLY;\nSELECT 'guard';\nROLLBACK;";
  if (name === "deployment-verification.sql") return "\\set ON_ERROR_STOP on\n/* deployment-verification */ SELECT true;";
  return `BEGIN;\n/* ${name} */ SELECT true;\nCOMMIT;`;
}

function fakeClient({ objectCount = 0, verification = true, connectError = null, databaseName = "homle_marketplace_homle_staging" } = {}) {
  const calls = [];
  return {
    calls,
    async connect() { calls.push({ kind: "connect" }); if (connectError) throw connectError; },
    async end() { calls.push({ kind: "end" }); },
    async query(text, values = []) {
      calls.push({ kind: "query", text, values });
      if (text.includes("current_database() AS database_name")) {
        return { rows: [{ database_name: databaseName, owner_name: "homle_migration_owner", server_version_num: 160014, owner_can_login: true, owner_superuser: false, owner_bypass_rls: false, application_object_count: objectCount }] };
      }
      if (text.includes("deployment-verification")) return { rows: [{ tideway_deployment_verification: { verified: verification } }] };
      return { rows: [] };
    }
  };
}

function options(client, env = {}) {
  return {
    env: { NODE_ENV: "production", RENDER_STAGING_BOOTSTRAP_ENABLED: "true", DATABASE_BOOTSTRAP_URL: ownerUrl, TIDEWAY_APP_PASSWORD: appPassword, TIDEWAY_WORKER_PASSWORD: workerPassword, ...env },
    databaseDirectory: "C:/synthetic/db",
    verifyAssets: async () => assets,
    readFile: async (file) => sqlFor(file),
    createClient(configuration) { client.configuration = configuration; return client; }
  };
}

assert.equal(removePsqlMetaCommands("\\set ON_ERROR_STOP on\nBEGIN;\nSELECT 1;\nCOMMIT;"), "BEGIN;\nSELECT 1;\nCOMMIT;");
assert.throws(() => restrictedDatabaseUrl(ownerUrl, "unknown", appPassword), /restricted database role/);
const appUrl = new URL(restrictedDatabaseUrl(ownerUrl, "tideway_app", appPassword));
assert.equal(appUrl.username, "tideway_app");
assert.equal(appUrl.password, appPassword);
assert.equal(appUrl.searchParams.get("sslmode"), "verify-full");

const renderPrivate = fakeClient();
const renderPrivateResult = await bootstrapRenderStagingDatabase(options(renderPrivate, {
  RENDER: "true",
  RENDER_SERVICE_TYPE: "web",
  DATABASE_BOOTSTRAP_URL: renderOwnerUrl
}));
assert.equal(renderPrivate.configuration.ssl, false, "The trusted Render-internal PostgreSQL URL incorrectly attempted public-certificate verification.");
assert.equal(new URL(renderPrivateResult.runtimeUrl).hostname, "dpg-d9csr9b7uimc73f0m8d0-a");
assert.equal(new URL(renderPrivateResult.runtimeUrl).searchParams.has("sslmode"), false, "The restricted Render-internal URL re-enabled the failing public TLS mode.");

const fresh = fakeClient();
const freshResult = await bootstrapRenderStagingDatabase(options(fresh));
assert.equal(freshResult.status, "bootstrapped");
assert.equal(freshResult.database, "homle_marketplace_homle_staging");
assert.equal(freshResult.migrationCount, 2);
assert.equal(new URL(freshResult.runtimeUrl).username, "tideway_app");
assert.equal(new URL(freshResult.workerUrl).username, "tideway_worker");
const freshSql = fresh.calls.filter((call) => call.kind === "query").map((call) => call.text);
assert(freshSql.findIndex((sql) => sql.includes("SELECT 'guard'")) < freshSql.findIndex((sql) => sql.includes("001_first.sql")));
assert(freshSql.findIndex((sql) => sql.includes("001_first.sql")) < freshSql.findIndex((sql) => sql.includes("002_second.sql")));
assert(freshSql.findIndex((sql) => sql.includes("worker-role-grants.sql")) < freshSql.findIndex((sql) => sql.includes("deployment-verification")));
assert(freshSql.every((sql) => !sql.includes(appPassword) && !sql.includes(workerPassword) && !sql.includes("owner-secret")), "Database credentials leaked into SQL text.");
assert.equal(fresh.calls.at(-1).kind, "end");
assert.equal(fresh.configuration.application_name, "homle-render-staging-bootstrap");

const existing = fakeClient({ objectCount: 52 });
const existingResult = await bootstrapRenderStagingDatabase(options(existing));
assert.equal(existingResult.status, "already-verified");
const existingSql = existing.calls.filter((call) => call.kind === "query").map((call) => call.text);
assert(existingSql.findIndex((sql) => sql.includes("deployment-verification")) < existingSql.findIndex((sql) => sql.includes("CREATE ROLE tideway_app")), "An existing schema was mutated before it passed verification.");
assert(!existingSql.some((sql) => sql.includes("001_first.sql")), "An existing verified schema replayed migrations.");

const incomplete = fakeClient({ objectCount: 4, verification: false });
await assert.rejects(bootstrapRenderStagingDatabase(options(incomplete)), /existing staging schema is incomplete/);
assert(!incomplete.calls.some((call) => call.kind === "query" && call.text.includes("CREATE ROLE tideway_app")), "An incomplete database was mutated before refusal.");
assert.equal(incomplete.calls.at(-1).kind, "end");

await assert.rejects(bootstrapRenderStagingDatabase(options(fakeClient(), { RENDER_STAGING_BOOTSTRAP_ENABLED: "false" })), /explicitly true/);
await assert.rejects(bootstrapRenderStagingDatabase(options(fakeClient({ databaseName: "homle_production" }), { DATABASE_BOOTSTRAP_URL: ownerUrl.replace("homle_marketplace_homle_staging", "homle_production") })), /restricted to a database ending/);
await assert.rejects(bootstrapRenderStagingDatabase(options(fakeClient(), { TIDEWAY_WORKER_PASSWORD: appPassword })), /passwords must be different/);
await assert.rejects(bootstrapRenderStagingDatabase({ ...options(fakeClient()), verifyAssets: async () => ({ ok: false, errors: ["checksum mismatch"], migrations: [] }) }), /checksum mismatch/);
const unavailable = fakeClient({ connectError: new Error("private host unavailable") });
await assert.rejects(bootstrapRenderStagingDatabase(options(unavailable)), /connection failed/);
assert.equal(unavailable.calls.at(-1).kind, "end");

console.log("Render staging bootstrap tests passed: guarded target, secret-safe restricted roles, locked migration order, verification-before-retry, durable connection URLs and deterministic close.");
