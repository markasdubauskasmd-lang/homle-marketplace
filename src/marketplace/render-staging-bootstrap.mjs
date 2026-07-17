import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { verifyDatabaseAssets } from "../../db/migration-assets.mjs";

const { Client } = pg;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDirectory, "../..");
const defaultDatabaseDirectory = path.join(projectRoot, "db");
const stagingDatabasePattern = /_(?:tideway|homle)_staging$/i;
const passwordPattern = /^.{32,512}$/s;
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

export function restrictedDatabaseUrl(ownerConnectionUrl, role, password) {
  if (!restrictedRoles.includes(role)) throw new TypeError("Only a Homle restricted database role may be selected.");
  const parsed = parsePostgresUrl(ownerConnectionUrl, "DATABASE_BOOTSTRAP_URL");
  parsed.username = role;
  parsed.password = requiredSecret(password, `${role} password`);
  if (!parsed.searchParams.has("sslmode")) parsed.searchParams.set("sslmode", "verify-full");
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
    ? "CREATE ROLE tideway_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT"
    : "CREATE ROLE tideway_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT";
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('homle.bootstrap_role_password', $1, true)", [password]);
    await client.query(`
      DO $homle_role$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          ${roleSql};
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}' AND (NOT rolcanlogin OR rolsuper OR rolbypassrls)) THEN
          RAISE EXCEPTION 'Unsafe pre-existing restricted role: ${role}';
        END IF;
        EXECUTE format('ALTER ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', current_setting('homle.bootstrap_role_password'));
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

  const createClient = options.createClient || ((configuration) => new Client(configuration));
  const client = createClient({
    connectionString: parsedOwnerUrl.toString(),
    ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
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
      return Object.freeze({
        database: target.database,
        status: "already-verified",
        migrationCount: assets.migrations.length,
        runtimeUrl: restrictedDatabaseUrl(ownerConnectionUrl, "tideway_app", appPassword),
        workerUrl: restrictedDatabaseUrl(ownerConnectionUrl, "tideway_worker", workerPassword)
      });
    }

    await configureRestrictedRole(client, "tideway_app", appPassword);
    await configureRestrictedRole(client, "tideway_worker", workerPassword);
    const guardPath = path.join(databaseDirectory, "bootstrap", "assert-empty-staging.sql");
    await client.query(await loadSql(guardPath, options.readFile));
    for (const migration of assets.migrations) {
      await client.query(await loadSql(path.join(databaseDirectory, "migrations", migration), options.readFile));
    }
    for (const grant of assets.grantFiles) {
      await client.query(await loadSql(path.join(databaseDirectory, grant), options.readFile));
    }
    const verification = await client.query(await loadSql(verificationPath, options.readFile));
    if (!verifiedDeployment(verification)) throw new Error("Post-bootstrap deployment verification returned no verified result.");
    return Object.freeze({
      database: target.database,
      status: "bootstrapped",
      migrationCount: assets.migrations.length,
      runtimeUrl: restrictedDatabaseUrl(ownerConnectionUrl, "tideway_app", appPassword),
      workerUrl: restrictedDatabaseUrl(ownerConnectionUrl, "tideway_worker", workerPassword)
    });
  } catch (error) {
    const wrapped = new Error(connected ? `Render staging database bootstrap failed: ${error.message}` : "Render staging database connection failed.");
    wrapped.cause = error;
    throw wrapped;
  } finally {
    try { await client.end(); } catch {}
  }
}
