import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { verifyDatabaseAssets } from "../../db/migration-assets.mjs";
import { postgresTransportSecurity } from "./database.mjs";

const { Client } = pg;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDirectory, "../..");
const defaultDatabaseDirectory = path.join(projectRoot, "db");
const stagingDatabasePattern = /_(?:tideway|homle)_staging$/i;
const passwordPattern = /^.{32,512}$/s;
const checksumPattern = /^[a-f0-9]{64}$/;
const migrationFilePattern = /^\d{3}_[a-z0-9_]+\.sql$/;
const restrictedRoles = Object.freeze(["tideway_app", "tideway_worker"]);

function requiredSecret(value, name) {
  if (typeof value !== "string" || !passwordPattern.test(value)) throw new TypeError(`${name} must contain between 32 and 512 characters.`);
  return value;
}

function parsePostgresUrl(value, name) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError(`${name} must be a valid PostgreSQL URL.`); }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.pathname.slice(1)) throw new TypeError(`${name} must include a PostgreSQL host, user and database.`);
  return parsed;
}

export function restrictedDatabaseUrl(ownerConnectionUrl, role, password, env = process.env) {
  if (!restrictedRoles.includes(role)) throw new TypeError("Only a Homle restricted database role may be selected.");
  const parsed = parsePostgresUrl(ownerConnectionUrl, "DATABASE_BOOTSTRAP_URL");
  parsed.username = role;
  parsed.password = requiredSecret(password, `${role} password`);
  const transport = postgresTransportSecurity(parsed.toString(), env);
  if (transport.mode === "render-private-network") parsed.searchParams.delete("sslmode");
  else if (!parsed.searchParams.has("sslmode")) parsed.searchParams.set("sslmode", "verify-full");
  return parsed.toString();
}

export function removePsqlMetaCommands(sql) {
  if (typeof sql !== "string") throw new TypeError("SQL text is required.");
  return sql.split(/\r?\n/).filter((line) => !/^\s*\\/.test(line)).join("\n");
}

function queryResults(result) {
  return Array.isArray(result) ? result : [result];
}

function verifiedDeployment(result) {
  return queryResults(result).some((entry) => (entry?.rows || []).some((row) => row?.tideway_deployment_verification?.verified === true));
}

async function targetState(client) {
  const result = await client.query(`
    SELECT current_database() AS database_name,
           current_user AS owner_name,
           current_setting('server_version_num')::integer AS server_version_num,
           role.rolcanlogin AS owner_can_login,
           role.rolsuper AS owner_superuser,
           role.rolbypassrls AS owner_bypass_rls,
           (SELECT count(*)::integer
              FROM pg_class relation
              JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
             WHERE namespace.nspname IN ('public', 'tideway_private')
               AND relation.relkind IN ('r', 'p', 'v', 'm', 'S')) AS application_object_count
      FROM pg_roles role
     WHERE role.rolname = current_user
  `);
  const row = result.rows?.[0];
  if (!row) throw new Error("The staging migration owner could not be inspected.");
  if (!stagingDatabasePattern.test(row.database_name || "")) throw new Error("Render bootstrap is restricted to a database ending _tideway_staging or _homle_staging.");
  if (Number(row.server_version_num) < 160000) throw new Error("Render bootstrap requires PostgreSQL 16 or newer.");
  if (!row.owner_can_login || row.owner_superuser || row.owner_bypass_rls || restrictedRoles.includes(row.owner_name)) throw new Error("Render bootstrap requires a separate non-superuser migration owner without BYPASSRLS.");
  return Object.freeze({ database: row.database_name, owner: row.owner_name, objectCount: Number(row.application_object_count) });
}

async function configureRestrictedRole(client, role, password) {
  const roleSql = role === "tideway_app"
    ? "CREATE ROLE tideway_app LOGIN NOINHERIT"
    : "CREATE ROLE tideway_worker LOGIN NOINHERIT";
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('homle.bootstrap_role_password', $1, true)", [password]);
    await client.query(`
      DO $homle_role$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          ${roleSql};
        END IF;
        IF EXISTS (
          SELECT 1 FROM pg_roles
           WHERE rolname = '${role}'
             AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
        ) THEN
          RAISE EXCEPTION 'Unsafe pre-existing restricted role: ${role}';
        END IF;
        EXECUTE format('ALTER ROLE ${role} PASSWORD %L', current_setting('homle.bootstrap_role_password'));
      END
      $homle_role$;
    `);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  }
}

async function loadSql(file, read = readFile) {
  return removePsqlMetaCommands(await read(file, "utf8"));
}

function lockedMigrationEntries(assets) {
  const entries = assets?.migrationEntries;
  if (!Array.isArray(entries) || entries.length !== assets.migrations.length) throw new Error("Locked migration metadata is incomplete.");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] || {};
    if (entry.order !== index + 1 || entry.file !== assets.migrations[index] || !migrationFilePattern.test(entry.file || "") || !checksumPattern.test(entry.sha256 || "")) {
      throw new Error(`Locked migration metadata is invalid at position ${index + 1}.`);
    }
  }
  return entries;
}

function migrationBody(sql, file) {
  const lines = removePsqlMetaCommands(sql).split(/\r?\n/);
  const executable = lines.map((line, index) => ({ line: line.trim(), index })).filter(({ line }) => line && !line.startsWith("--"));
  if (executable[0]?.line !== "BEGIN;" || executable.at(-1)?.line !== "COMMIT;") throw new Error(`${file} is not transaction bounded.`);
  return lines.slice(executable[0].index + 1, executable.at(-1).index).join("\n");
}

function requestedBaselineCount(env, maximum) {
  const value = env.RENDER_STAGING_BASELINE_MIGRATION_COUNT;
  if (!/^\d+$/.test(value || "")) throw new Error("An existing staging database without a migration ledger requires RENDER_STAGING_BASELINE_MIGRATION_COUNT.");
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count >= maximum) throw new Error(`RENDER_STAGING_BASELINE_MIGRATION_COUNT must be between 1 and ${maximum - 1}.`);
  return count;
}

async function migrationLedger(client) {
  const exists = await client.query("SELECT to_regclass('tideway_private.schema_migrations')::text AS ledger_name");
  if (!exists.rows?.[0]?.ledger_name) return null;
  const result = await client.query("SELECT migration_order, filename, sha256, baselined FROM tideway_private.schema_migrations ORDER BY migration_order");
  return result.rows || [];
}

async function createMigrationLedger(client) {
  await client.query(`
    CREATE TABLE tideway_private.schema_migrations (
      migration_order integer PRIMARY KEY CHECK (migration_order > 0),
      filename text NOT NULL UNIQUE CHECK (filename ~ '^[0-9]{3}_[a-z0-9_]+[.]sql$'),
      sha256 character(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now(),
      baselined boolean NOT NULL DEFAULT false
    );
    REVOKE ALL ON TABLE tideway_private.schema_migrations FROM PUBLIC, tideway_app, tideway_worker;
  `);
}

function validateMigrationLedger(rows, entries) {
  if (!Array.isArray(rows) || rows.length > entries.length) throw new Error("The staging migration ledger contains an unsupported migration count.");
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const expected = entries[index];
    if (Number(row.migration_order) !== expected.order || row.filename !== expected.file || row.sha256 !== expected.sha256) {
      throw new Error(`The staging migration ledger does not match locked migration ${expected.order}.`);
    }
  }
}

async function recordMigrationHistory(client, entries, baselined) {
  await client.query("BEGIN");
  try {
    for (const entry of entries) {
      await client.query(
        "INSERT INTO tideway_private.schema_migrations (migration_order, filename, sha256, baselined) VALUES ($1, $2, $3, $4)",
        [entry.order, entry.file, entry.sha256, baselined]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  }
}

async function applyLockedMigration(client, entry, databaseDirectory, read = readFile) {
  const source = await read(path.join(databaseDirectory, "migrations", entry.file), "utf8");
  const body = migrationBody(source, entry.file);
  await client.query("BEGIN");
  try {
    if (body.trim()) await client.query(body);
    await client.query(
      "INSERT INTO tideway_private.schema_migrations (migration_order, filename, sha256, baselined) VALUES ($1, $2, $3, false)",
      [entry.order, entry.file, entry.sha256]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function bootstrapRenderStagingDatabase(options = {}) {
  const env = options.env || process.env;
  if (env.RENDER_STAGING_BOOTSTRAP_ENABLED !== "true") throw new Error("RENDER_STAGING_BOOTSTRAP_ENABLED must be explicitly true.");
  const ownerConnectionUrl = env.DATABASE_BOOTSTRAP_URL;
  const parsedOwnerUrl = parsePostgresUrl(ownerConnectionUrl, "DATABASE_BOOTSTRAP_URL");
  const appPassword = requiredSecret(env.TIDEWAY_APP_PASSWORD, "TIDEWAY_APP_PASSWORD");
  const workerPassword = requiredSecret(env.TIDEWAY_WORKER_PASSWORD, "TIDEWAY_WORKER_PASSWORD");
  if (appPassword === workerPassword) throw new Error("Restricted database role passwords must be different.");

  const databaseDirectory = path.resolve(options.databaseDirectory || defaultDatabaseDirectory);
  const verifyAssets = options.verifyAssets || verifyDatabaseAssets;
  const assets = await verifyAssets({ databaseDirectory });
  if (!assets?.ok || !assets.migrations?.length) throw new Error(`Locked database assets are invalid: ${(assets?.errors || ["missing migrations"]).join(" ")}`);
  const entries = lockedMigrationEntries(assets);

  const createClient = options.createClient || ((configuration) => new Client(configuration));
  const transport = postgresTransportSecurity(parsedOwnerUrl.toString(), env);
  const client = createClient({
    connectionString: parsedOwnerUrl.toString(),
    ssl: transport.ssl,
    application_name: "homle-render-staging-bootstrap"
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const target = await targetState(client);
    const verificationPath = path.join(databaseDirectory, "integration", "deployment-verification.sql");
    if (target.objectCount > 0) {
      const verification = await client.query(await loadSql(verificationPath, options.readFile));
      if (!verifiedDeployment(verification)) throw new Error("The existing staging schema is incomplete or failed deployment verification; do not continue or retry mutations.");
      await configureRestrictedRole(client, "tideway_app", appPassword);
      await configureRestrictedRole(client, "tideway_worker", workerPassword);
      let ledger = await migrationLedger(client);
      if (ledger === null) {
        const baselineCount = requestedBaselineCount(env, entries.length);
        await createMigrationLedger(client);
        await recordMigrationHistory(client, entries.slice(0, baselineCount), true);
        ledger = entries.slice(0, baselineCount).map((entry) => ({ migration_order: entry.order, filename: entry.file, sha256: entry.sha256, baselined: true }));
      }
      validateMigrationLedger(ledger, entries);
      const pending = entries.slice(ledger.length);
      for (const entry of pending) await applyLockedMigration(client, entry, databaseDirectory, options.readFile);
      if (pending.length) {
        for (const grant of assets.grantFiles) await client.query(await loadSql(path.join(databaseDirectory, grant), options.readFile));
        const finalVerification = await client.query(await loadSql(verificationPath, options.readFile));
        if (!verifiedDeployment(finalVerification)) throw new Error("The upgraded staging schema failed deployment verification; do not start the application.");
      }
      return Object.freeze({
        database: target.database,
        status: pending.length ? "upgraded" : "already-verified",
        migrationCount: assets.migrations.length,
        appliedMigrationCount: pending.length,
        runtimeUrl: restrictedDatabaseUrl(ownerConnectionUrl, "tideway_app", appPassword, env),
        workerUrl: restrictedDatabaseUrl(ownerConnectionUrl, "tideway_worker", workerPassword, env)
      });
    }

    await configureRestrictedRole(client, "tideway_app", appPassword);
    await configureRestrictedRole(client, "tideway_worker", workerPassword);
    const guardPath = path.join(databaseDirectory, "bootstrap", "assert-empty-staging.sql");
    await client.query(await loadSql(guardPath, options.readFile));
    for (const entry of entries) await client.query(await loadSql(path.join(databaseDirectory, "migrations", entry.file), options.readFile));
    await createMigrationLedger(client);
    await recordMigrationHistory(client, entries, false);
    for (const grant of assets.grantFiles) {
      await client.query(await loadSql(path.join(databaseDirectory, grant), options.readFile));
    }
    const verification = await client.query(await loadSql(verificationPath, options.readFile));
    if (!verifiedDeployment(verification)) throw new Error("Post-bootstrap deployment verification returned no verified result.");
    return Object.freeze({
      database: target.database,
      status: "bootstrapped",
      migrationCount: assets.migrations.length,
      appliedMigrationCount: assets.migrations.length,
      runtimeUrl: restrictedDatabaseUrl(ownerConnectionUrl, "tideway_app", appPassword, env),
      workerUrl: restrictedDatabaseUrl(ownerConnectionUrl, "tideway_worker", workerPassword, env)
    });
  } catch (error) {
    const wrapped = new Error(connected ? `Render staging database bootstrap failed: ${error.message}` : "Render staging database connection failed.");
    wrapped.cause = error;
    throw wrapped;
  } finally {
    try { await client.end(); } catch {}
  }
}
