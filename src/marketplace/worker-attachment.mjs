import { bookingPricingPolicyFromEnvironment } from "./booking-workflow.mjs";
import { postgresPoolOptions, postgresTransportSecurity } from "./database.mjs";
import { loadMarketplaceDeploymentAdapters } from "./attachment.mjs";
import { createS3ObjectStorage } from "./s3-object-storage.mjs";
import { createTransactionalEmailDelivery, emailDeliveryEnvironment } from "./email-delivery.mjs";
import { createMarketplaceWorkerRuntime } from "./worker-runtime.mjs";
import { normalizeExpectedReleaseCommit, packagedReleaseIdentityMatches } from "../../release-identity.mjs";
import { marketplaceEnvironment } from "./config.mjs";

function booleanValue(env, name, fallback = false) {
  const supplied = String(env[name] ?? "").trim().toLowerCase();
  if (!supplied) return fallback;
  if (supplied === "true") return true;
  if (supplied === "false") return false;
  throw new TypeError(`${name} must be true or false.`);
}

export function workerPoolEnvironment(env) {
  const supplied = String(env.WORKER_DATABASE_URL || "").trim();
  if (!supplied) throw new TypeError("WORKER_DATABASE_URL is required when marketplace workers are enabled.");
  let parsed;
  try { parsed = new URL(supplied); } catch { throw new TypeError("WORKER_DATABASE_URL must be a valid PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.pathname || parsed.pathname === "/" || parsed.pathname.slice(1).includes("/")) throw new TypeError("WORKER_DATABASE_URL must name one PostgreSQL database and user.");
  let username;
  try { username = decodeURIComponent(parsed.username); } catch { throw new TypeError("WORKER_DATABASE_URL contains invalid username encoding."); }
  if (username !== "tideway_worker") throw new TypeError("WORKER_DATABASE_URL must authenticate as tideway_worker.");
  const local = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase());
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode && !new Set(["disable", "prefer", "require", "verify-ca", "verify-full"]).has(sslMode)) throw new TypeError("WORKER_DATABASE_URL contains an unsupported sslmode.");
  if (env.NODE_ENV === "production" && !local) {
    const transport = postgresTransportSecurity(supplied, env);
    if (transport.mode === "verified-tls" && sslMode !== "verify-full") throw new TypeError("A remote production WORKER_DATABASE_URL outside Render's private network must use sslmode=verify-full.");
  }
  return { ...env, DATABASE_URL: supplied, DATABASE_POOL_MAX: env.WORKER_DATABASE_POOL_MAX || "5" };
}

export async function createDefaultWorkerPool(env = process.env) {
  let postgres;
  try { postgres = await import("pg"); } catch (cause) { throw Object.assign(new Error("Marketplace workers require the reviewed pg dependency; install the frozen lockfile before enablement."), { cause }); }
  const Pool = postgres.Pool || postgres.default?.Pool;
  if (typeof Pool !== "function") throw new TypeError("The installed pg package does not expose a Pool constructor.");
  return new Pool(postgresPoolOptions(workerPoolEnvironment(env)));
}

const requiredWorkerFunctions = Object.freeze([
  "expire_due_cleaner_invitations(integer)",
  "queue_due_booking_payment_reminders(integer)",
  "queue_due_booking_visit_reminders(integer)",
  "purge_expired_cleaner_locations(integer)",
  "expire_due_job_photo_uploads(integer)",
  "expire_due_request_photo_uploads(integer)",
  "claim_due_email_notifications(uuid,integer,integer)",
  "complete_email_notification(uuid,uuid,text,text)",
  "purge_expired_sessions(integer)",
  "purge_expired_rate_limits(integer)",
  "purge_expired_pending_social_identities(integer)",
  "claim_due_automatic_dispatch(uuid,integer,integer)",
  "get_automatic_dispatch_candidates(uuid,uuid,integer,boolean)",
  "complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer,integer)",
  "release_automatic_dispatch_lease(uuid,uuid,text,timestamp with time zone)"
]);

export async function probeMarketplaceWorkerDatabase(pool) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A dedicated Homle worker PostgreSQL pool is required.");
  const result = await pool.query(`
    SELECT current_user AS database_role,
      current_setting('server_version_num')::integer AS server_version_num,
      COALESCE((SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname=current_user),false) AS role_is_safe,
      NOT EXISTS (
        SELECT 1 FROM pg_class relation
        WHERE relation.relnamespace='public'::regnamespace AND relation.relkind IN ('r','p')
          AND (has_table_privilege(current_user,relation.oid,'SELECT') OR has_table_privilege(current_user,relation.oid,'INSERT') OR has_table_privilege(current_user,relation.oid,'UPDATE') OR has_table_privilege(current_user,relation.oid,'DELETE'))
      ) AS no_public_table_access,
      ARRAY(
        SELECT signature FROM unnest($1::text[]) signature
        WHERE to_regprocedure('tideway_private.'||signature) IS NULL
          OR NOT has_function_privilege(current_user,to_regprocedure('tideway_private.'||signature),'EXECUTE')
      ) AS missing_functions
  `, [requiredWorkerFunctions]);
  const row = result?.rows?.[0];
  if (!row || row.database_role !== "tideway_worker") throw new Error("WORKER_DATABASE_URL must authenticate as tideway_worker.");
  if (Number(row.server_version_num) < 160000) throw new Error("Marketplace workers require PostgreSQL 16 or newer.");
  if (row.role_is_safe !== true || row.no_public_table_access !== true) throw new Error("Marketplace worker role must be non-bypass and function-only.");
  if (!Array.isArray(row.missing_functions) || row.missing_functions.length) throw new Error("Marketplace worker migrations or grants are incomplete.");
  return Object.freeze({ databaseRole: row.database_role, postgresqlVersionNumber: Number(row.server_version_num), functionCount: requiredWorkerFunctions.length });
}

function unavailable(reason = "disabled") {
  return Object.freeze({ enabled: false, ready: false, reason, capabilities: Object.freeze({ email: false, media: false, dispatch: false }), supervisor: null, async close() {} });
}

export async function createMarketplaceWorkerAttachment(options = {}) {
  const env = options.env || process.env;
  if (!booleanValue(env, "MARKETPLACE_WORKER_ENABLED")) return unavailable();
  const expectedRelease = normalizeExpectedReleaseCommit(env.TIDEWAY_EXPECT_RELEASE);
  const releaseIdentity = options.releaseIdentity;
  if (!packagedReleaseIdentityMatches(releaseIdentity, expectedRelease)) throw new TypeError(`Marketplace worker package does not match expected release ${expectedRelease}.`);
  const emailEnabled = booleanValue(env, "WORKER_EMAIL_ENABLED");
  const mediaEnabled = booleanValue(env, "WORKER_MEDIA_ENABLED");
  const dispatchEnabled = booleanValue(env, "WORKER_AUTOMATIC_DISPATCH_ENABLED");
  if (dispatchEnabled && !booleanValue(env, "MARKETPLACE_ENABLED")) throw new TypeError("Automatic dispatch requires the marketplace runtime to be deliberately enabled.");
  workerPoolEnvironment(env);

  const adapters = options.adapters || await (options.loadAdapters || loadMarketplaceDeploymentAdapters)(env);
  if (typeof adapters?.onUnexpectedError !== "function") throw new TypeError("Marketplace workers require private operational error monitoring.");
  if (typeof adapters?.close !== "function") throw new TypeError("Marketplace worker monitoring must provide deterministic shutdown.");
  const createPool = options.createPool || createDefaultWorkerPool;
  const pool = await createPool(env);
  let emailDelivery;
  let objectStorage;
  let supervisor;
  try {
    await (options.probeDatabase || probeMarketplaceWorkerDatabase)(pool);
    if (emailEnabled) {
      if (!emailDeliveryEnvironment(env).configured || !env.APP_ORIGIN) throw new TypeError("Email workers require one configured HTTPS or SMTP provider, EMAIL_FROM and APP_ORIGIN.");
      emailDelivery = await (options.createEmailDelivery || createTransactionalEmailDelivery)(env, { onUnexpectedError: adapters.onUnexpectedError });
      await emailDelivery.verify();
    }
    if (mediaEnabled) {
      if (!env.OBJECT_STORAGE_ENDPOINT || !env.OBJECT_STORAGE_BUCKET || !env.OBJECT_STORAGE_ACCESS_KEY_ID || !env.OBJECT_STORAGE_SECRET_ACCESS_KEY) throw new TypeError("Media workers require complete private object-storage configuration.");
      objectStorage = await (options.createObjectStorage || createS3ObjectStorage)(env, { onUnexpectedError: adapters.onUnexpectedError });
      await objectStorage.verify();
    }
    const dispatchPricingPolicy = dispatchEnabled ? bookingPricingPolicyFromEnvironment(env) : null;
    if (dispatchEnabled && !dispatchPricingPolicy) throw new TypeError("Automatic dispatch requires complete approved private booking pricing.");
    const requirePayoutReady = marketplaceEnvironment(env).payments.requested;
    supervisor = (options.createRuntime || createMarketplaceWorkerRuntime)(pool, {
      onUnexpectedError: adapters.onUnexpectedError,
      emailDelivery,
      objectStorage,
      dispatchPricingPolicy,
      requirePayoutReady,
      appOrigin: env.APP_ORIGIN
    });
  } catch (error) {
    try { await emailDelivery?.close?.(); } catch {}
    try { await objectStorage?.close?.(); } catch {}
    try { await pool?.end?.(); } catch {}
    try { await adapters.close(); } catch {}
    throw error;
  }

  let closed = false;
  const capabilities = Object.freeze({ email: emailEnabled, media: mediaEnabled, dispatch: dispatchEnabled });
  return Object.freeze({
    enabled: true,
    ready: true,
    reason: "ready",
    capabilities,
    release: Object.freeze({ sourceCommit: releaseIdentity.sourceCommit, builtAt: releaseIdentity.builtAt, migrationCount: releaseIdentity.migrationCount }),
    supervisor,
    start(input) { return supervisor.start(input); },
    snapshot() { return Object.freeze({ ...supervisor.snapshot(), capabilities, release: Object.freeze({ sourceCommit: releaseIdentity.sourceCommit, migrationCount: releaseIdentity.migrationCount }) }); },
    async close() {
      if (closed) return;
      closed = true;
      const failures = [];
      try { await supervisor.close(); } catch (error) { failures.push(error); }
      try { await emailDelivery?.close?.(); } catch (error) { failures.push(error); }
      try { await objectStorage?.close?.(); } catch (error) { failures.push(error); }
      try { await pool?.end?.(); } catch (error) { failures.push(error); }
      try { await adapters.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, "Marketplace worker resources did not close cleanly.");
    }
  });
}

export { requiredWorkerFunctions };
