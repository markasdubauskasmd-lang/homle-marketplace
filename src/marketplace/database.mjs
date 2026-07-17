import { marketplaceRoles } from "./domain.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const renderInternalPostgresHostPattern = /^dpg-[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const renderDatabaseClientTypes = new Set(["web", "worker", "pserv", "cron"]);

function databaseActor(actor, allowNoRoles = false) {
  if (!actor) return { userId: "", roles: "" };
  if (!uuidPattern.test(actor.userId || "")) throw new TypeError("A valid authenticated user id is required for this database transaction.");
  const roles = [...new Set(Array.isArray(actor.roles) ? actor.roles : [])];
  if ((!allowNoRoles && !roles.length) || roles.some((role) => !marketplaceRoles.includes(role))) throw new TypeError("Only supported authenticated roles may enter the database context.");
  return { userId: actor.userId.toLowerCase(), roles: roles.sort().join(",") };
}

export function createMarketplaceDatabase(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A PostgreSQL-compatible connection pool is required.");

  async function transaction(actor, operation, allowNoRoles = false) {
    if (typeof operation !== "function") throw new TypeError("A database transaction operation is required.");
    const context = databaseActor(actor, allowNoRoles);
    const client = await pool.connect();
    let began = false;
    try {
      await client.query("BEGIN");
      began = true;
      await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.user_roles', $2, true)", [context.userId, context.roles]);
      const result = await operation(client);
      await client.query("COMMIT");
      began = false;
      return result;
    } catch (error) {
      if (began) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    withAccountTransaction(actor, operation) {
      if (!actor) throw new TypeError("Authenticated database work requires an account context.");
      return transaction(actor, operation, true);
    },
    withUserTransaction(actor, operation) {
      if (!actor) throw new TypeError("Authenticated database work requires a user context.");
      return transaction(actor, operation);
    },
    withAuthenticationTransaction(operation) {
      return transaction(null, operation);
    },
    withProvisioningTransaction(userId, operation) {
      return transaction({ userId, roles: [] }, operation, true);
    }
  };
}

export function postgresTransportSecurity(connectionString, env = process.env) {
  if (env.NODE_ENV !== "production") return Object.freeze({ mode: "development", ssl: undefined });
  let url;
  try { url = new URL(connectionString); } catch { throw new TypeError("PostgreSQL connection URL is invalid."); }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) || !url.hostname) throw new TypeError("PostgreSQL connection URL is invalid.");
  const renderPrivate = env.RENDER === "true"
    && renderDatabaseClientTypes.has(String(env.RENDER_SERVICE_TYPE || ""))
    && renderInternalPostgresHostPattern.test(url.hostname)
    && !url.hostname.includes(".");
  const sslMode = url.searchParams.get("sslmode");
  if (renderPrivate) {
    if (sslMode && sslMode !== "disable") throw new TypeError("Render private PostgreSQL URLs must not override their private-network transport mode.");
    return Object.freeze({ mode: "render-private-network", ssl: false });
  }
  if (sslMode === "disable" || sslMode === "allow" || sslMode === "prefer") throw new TypeError("Production PostgreSQL outside Render's private network requires verified TLS.");
  return Object.freeze({ mode: "verified-tls", ssl: Object.freeze({ rejectUnauthorized: true }) });
}

export function postgresPoolOptions(env = process.env) {
  if (!env.DATABASE_URL) return null;
  const transport = postgresTransportSecurity(env.DATABASE_URL, env);
  return {
    connectionString: env.DATABASE_URL,
    max: Number.isInteger(Number(env.DATABASE_POOL_MAX)) ? Math.min(50, Math.max(1, Number(env.DATABASE_POOL_MAX))) : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: env.NODE_ENV !== "production",
    ssl: transport.ssl
  };
}

export function realtimePostgresPoolOptions(env = process.env) {
  if (!env.REALTIME_DATABASE_URL) return null;
  const transport = postgresTransportSecurity(env.REALTIME_DATABASE_URL, env);
  return {
    connectionString: env.REALTIME_DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: env.NODE_ENV !== "production",
    ssl: transport.ssl
  };
}
