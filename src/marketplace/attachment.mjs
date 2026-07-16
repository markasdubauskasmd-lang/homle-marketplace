import path from "node:path";
import { pathToFileURL } from "node:url";
import { marketplaceEnvironment, publicAuthenticationCapabilities, validateMarketplaceEnvironment } from "./config.mjs";
import { postgresPoolOptions } from "./database.mjs";
import { createPostgresRateLimiter } from "./postgres-rate-limiter.mjs";
import { createMarketplaceRuntime } from "./runtime.mjs";
import { createTrustedClientKeyResolver } from "./trusted-client-key.mjs";

function enabledState(env) {
  const value = String(env.MARKETPLACE_ENABLED || "").trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new TypeError("MARKETPLACE_ENABLED must be true or false.");
}

function deploymentModuleSpecifier(value) {
  const supplied = String(value || "").trim();
  if (!supplied) throw new TypeError("MARKETPLACE_ADAPTER_MODULE is required when the marketplace is enabled.");
  if (supplied.startsWith("file:")) return new URL(supplied).href;
  if (!path.isAbsolute(supplied)) throw new TypeError("MARKETPLACE_ADAPTER_MODULE must be an absolute file path or file URL.");
  return pathToFileURL(supplied).href;
}

export async function loadMarketplaceDeploymentAdapters(env = process.env) {
  const module = await import(deploymentModuleSpecifier(env.MARKETPLACE_ADAPTER_MODULE));
  if (typeof module.createMarketplaceDeploymentAdapters !== "function") throw new TypeError("The marketplace adapter module must export createMarketplaceDeploymentAdapters.");
  const adapters = await module.createMarketplaceDeploymentAdapters({ env });
  if (!adapters || typeof adapters !== "object") throw new TypeError("The marketplace adapter factory returned an invalid result.");
  return adapters;
}

export async function createDefaultPostgresPool(env = process.env) {
  let postgres;
  try {
    postgres = await import("pg");
  } catch (cause) {
    throw Object.assign(new Error("The marketplace requires the reviewed pg dependency; install the frozen lockfile before enablement."), { cause });
  }
  const Pool = postgres.Pool || postgres.default?.Pool;
  if (typeof Pool !== "function") throw new TypeError("The installed pg package does not expose a Pool constructor.");
  const options = postgresPoolOptions(env);
  if (!options) throw new TypeError("DATABASE_URL is required to construct the marketplace pool.");
  return new Pool(options);
}

export async function probeMarketplaceDatabase(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A PostgreSQL pool is required for marketplace readiness.");
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT current_user AS database_role,
        current_setting('server_version_num')::integer AS server_version_num,
        COALESCE((SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS role_is_safe,
        to_regprocedure('tideway_private.lookup_session(bytea)') IS NOT NULL AS lookup_session_ready,
        to_regprocedure('tideway_private.invite_cleaner(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer)') IS NOT NULL AS booking_workflow_ready,
        to_regprocedure('tideway_private.consume_rate_limit(text,bytea)') IS NOT NULL AS rate_limit_ready
    `);
    const row = result?.rows?.[0];
    if (!row || row.database_role !== "tideway_app") throw new Error("Marketplace DATABASE_URL must authenticate as tideway_app.");
    if (Number(row.server_version_num) < 160000) throw new Error("Marketplace PostgreSQL 16 or newer is required.");
    if (row.role_is_safe !== true) throw new Error("Marketplace database role must not be superuser or bypass row-level security.");
    if (row.lookup_session_ready !== true || row.booking_workflow_ready !== true || row.rate_limit_ready !== true) throw new Error("Marketplace database migrations or runtime grants are incomplete.");
    return Object.freeze({ databaseRole: row.database_role, postgresqlVersionNumber: Number(row.server_version_num) });
  } finally {
    client.release();
  }
}

function requireAdapters(adapters) {
  if (!adapters?.emailDelivery || typeof adapters.emailDelivery.send !== "function") throw new TypeError("Marketplace enablement requires a trusted email-delivery adapter.");
  const storageMethods = ["createUploadUrl", "headObject", "inspectAndSanitizeImage", "createReadUrl", "deleteObject"];
  if (!adapters.objectStorage || !storageMethods.every((method) => typeof adapters.objectStorage[method] === "function")) throw new TypeError("Marketplace enablement requires complete private object storage.");
}

function unavailableAttachment(env, reason = "disabled") {
  const authenticationCapabilities = publicAuthenticationCapabilities(env);
  return Object.freeze({
    enabled: false,
    ready: false,
    reason,
    authenticationHttpReady: false,
    authenticationCapabilities,
    router: null,
    async close() {}
  });
}

export async function createMarketplaceAttachment(options = {}) {
  const env = options.env || process.env;
  if (!enabledState(env)) return unavailableAttachment(env);

  const validation = validateMarketplaceEnvironment(env);
  if (!validation.ok) throw new TypeError(`Marketplace attachment configuration is invalid: ${validation.errors.join(" ")}`);
  const environment = marketplaceEnvironment(env);
  if (!environment.databaseConfigured || !environment.sessionConfigured || !environment.authTokenConfigured || !environment.encryptionConfigured || !environment.appOrigin) throw new TypeError("Marketplace attachment requires database, session, token, encryption and exact-origin configuration.");
  if (!environment.emailConfigured) throw new TypeError("Marketplace attachment requires SMTP_URL and EMAIL_FROM.");
  if (!environment.objectStorageConfigured) throw new TypeError("Marketplace attachment requires complete private object-storage configuration.");

  const clientKey = (options.createClientKeyResolver || createTrustedClientKeyResolver)(env);

  const loadAdapters = options.loadAdapters || loadMarketplaceDeploymentAdapters;
  const adapters = options.adapters || await loadAdapters(env);
  requireAdapters(adapters);

  const createPool = options.createPool || createDefaultPostgresPool;
  const pool = await createPool(env);
  let runtime;
  try {
    await (options.probeDatabase || probeMarketplaceDatabase)(pool);
    const rateLimiter = (options.createRateLimiter || createPostgresRateLimiter)(pool, { secret: env.SESSION_SECRET });
    runtime = (options.createRuntime || createMarketplaceRuntime)(pool, {
      env,
      rateLimiter,
      clientKey,
      emailDelivery: adapters.emailDelivery,
      objectStorage: adapters.objectStorage,
      etaProvider: adapters.etaProvider,
      onUnexpectedError: adapters.onUnexpectedError
    });
  } catch (error) {
    try { await pool.end?.(); } catch {}
    throw error;
  }
  if (!runtime?.router || typeof runtime.router.handle !== "function" || runtime.authenticationHttpReady !== true) {
    try { await runtime?.realtimeSignalSource?.close?.(); } catch {}
    try { await pool.end?.(); } catch {}
    throw new TypeError("Marketplace runtime did not compose its router and authentication boundary completely.");
  }

  const authenticationCapabilities = publicAuthenticationCapabilities(env, {
    emailPassword: true,
    passwordReset: true,
    emailVerification: true,
    google: runtime.googleOidcReady === true,
    apple: false,
    facebook: false
  });
  let closed = false;
  return Object.freeze({
    enabled: true,
    ready: true,
    reason: "ready",
    authenticationHttpReady: true,
    authenticationCapabilities,
    router: runtime.router,
    async close() {
      if (closed) return;
      closed = true;
      const failures = [];
      try { await runtime.realtimeSignalSource?.close?.(); } catch (error) { failures.push(error); }
      try { await pool.end?.(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, "Marketplace resources did not close cleanly.");
    }
  });
}
