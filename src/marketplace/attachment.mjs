import path from "node:path";
import { pathToFileURL } from "node:url";
import { marketplaceEnvironment, publicAuthenticationCapabilities, validateMarketplaceEnvironment } from "./config.mjs";
import { postgresPoolOptions } from "./database.mjs";
import { createPostgresRateLimiter } from "./postgres-rate-limiter.mjs";
import { createMarketplaceRuntime } from "./runtime.mjs";
import { createS3ObjectStorage } from "./s3-object-storage.mjs";
import { createSmtpEmailDelivery } from "./smtp-email-delivery.mjs";
import { createStripePaymentProvider } from "./stripe-payment-provider.mjs";
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
        to_regprocedure('tideway_private.list_my_booking_summaries(integer)') IS NOT NULL AS booking_summaries_ready,
        to_regprocedure('tideway_private.configure_automatic_dispatch(uuid,boolean,smallint)') IS NOT NULL AS automatic_dispatch_ready,
        to_regprocedure('tideway_private.submit_cleaning_request(uuid,boolean,boolean)') IS NOT NULL
          AND to_regprocedure('tideway_private.create_request_photo_upload_intent(uuid,uuid,text,text,text,text,text,integer,text,timestamp with time zone)') IS NOT NULL
          AND to_regprocedure('tideway_private.get_cleaning_request_scan(uuid)') IS NOT NULL AS request_room_scan_ready,
        to_regprocedure('tideway_private.consume_rate_limit(text,bytea)') IS NOT NULL AS rate_limit_ready,
        to_regprocedure('tideway_private.consume_pending_social_identity(bytea)') IS NOT NULL AS facebook_pending_identity_ready,
        to_regprocedure('tideway_private.connect_social_identity(authentication_provider,text,citext,boolean,text,text,jsonb)') IS NOT NULL AS provider_connection_ready,
        to_regprocedure('tideway_private.begin_booking_payment_authorization(uuid,uuid,text,bytea)') IS NOT NULL AS payment_ledger_ready,
        to_regprocedure('tideway_private.read_booking_payment(uuid)') IS NOT NULL AS payment_access_ready,
        to_regprocedure('tideway_private.current_booking_payment_authorized(uuid)') IS NOT NULL AS payment_journey_gate_ready
    `);
    const row = result?.rows?.[0];
    if (!row || row.database_role !== "tideway_app") throw new Error("Marketplace DATABASE_URL must authenticate as tideway_app.");
    if (Number(row.server_version_num) < 160000) throw new Error("Marketplace PostgreSQL 16 or newer is required.");
    if (row.role_is_safe !== true) throw new Error("Marketplace database role must not be superuser or bypass row-level security.");
    if (row.lookup_session_ready !== true || row.booking_workflow_ready !== true || row.booking_summaries_ready !== true || row.automatic_dispatch_ready !== true || row.request_room_scan_ready !== true || row.rate_limit_ready !== true || row.facebook_pending_identity_ready !== true || row.provider_connection_ready !== true || row.payment_ledger_ready !== true || row.payment_access_ready !== true || row.payment_journey_gate_ready !== true) throw new Error("Marketplace database migrations or runtime grants are incomplete.");
    return Object.freeze({ databaseRole: row.database_role, postgresqlVersionNumber: Number(row.server_version_num) });
  } finally {
    client.release();
  }
}

function requireAdapters(adapters) {
  if (typeof adapters?.onUnexpectedError !== "function") throw new TypeError("Marketplace enablement requires private operational error monitoring.");
}

function unavailableAttachment(env, reason = "disabled") {
  const authenticationCapabilities = publicAuthenticationCapabilities(env);
  return Object.freeze({
    enabled: false,
    ready: false,
    reason,
    authenticationHttpReady: false,
    authenticationCapabilities,
    paymentsReady: false,
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
  const createEmailDelivery = options.createEmailDelivery || createSmtpEmailDelivery;
  const createObjectStorage = options.createObjectStorage || createS3ObjectStorage;
  const createPaymentProvider = options.createPaymentProvider || createStripePaymentProvider;
  let emailDelivery;
  let objectStorage;
  let pool;
  let runtime;
  let paymentProvider;
  try {
    emailDelivery = await createEmailDelivery(env, { onUnexpectedError: adapters.onUnexpectedError });
    if (!emailDelivery || typeof emailDelivery.send !== "function" || typeof emailDelivery.verify !== "function" || typeof emailDelivery.close !== "function") throw new TypeError("Marketplace SMTP delivery did not compose completely.");
    objectStorage = await createObjectStorage(env, { onUnexpectedError: adapters.onUnexpectedError });
    const storageMethods = ["verify", "createUploadUrl", "headObject", "inspectAndSanitizeImage", "createReadUrl", "deleteObject", "close"];
    if (!objectStorage || !storageMethods.every((method) => typeof objectStorage[method] === "function")) throw new TypeError("Marketplace private object storage did not compose completely.");
    pool = await createPool(env);
    await (options.probeDatabase || probeMarketplaceDatabase)(pool);
    await emailDelivery.verify();
    await objectStorage.verify();
    if (environment.payments.requested) {
      paymentProvider = await createPaymentProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET });
      if (!paymentProvider || paymentProvider.name !== "stripe" || typeof paymentProvider.verify !== "function") throw new TypeError("Stripe payment adapter did not compose completely.");
      await paymentProvider.verify();
    }
    const rateLimiter = (options.createRateLimiter || createPostgresRateLimiter)(pool, { secret: env.SESSION_SECRET });
    runtime = (options.createRuntime || createMarketplaceRuntime)(pool, {
      env,
      rateLimiter,
      clientKey,
      emailDelivery,
      objectStorage,
      paymentProvider,
      etaProvider: adapters.etaProvider,
      onUnexpectedError: adapters.onUnexpectedError
    });
    if (!runtime?.router || typeof runtime.router.handle !== "function" || runtime.authenticationHttpReady !== true || (environment.payments.requested && runtime.paymentReady !== true)) throw new TypeError("Marketplace runtime did not compose its router, authentication and requested payment boundaries completely.");
  } catch (error) {
    try { await runtime?.realtimeSignalSource?.close?.(); } catch {}
    try { await emailDelivery?.close?.(); } catch {}
    try { await objectStorage?.close?.(); } catch {}
    try { await pool?.end?.(); } catch {}
    throw error;
  }

  const authenticationCapabilities = publicAuthenticationCapabilities(env, {
    emailPassword: true,
    passwordReset: true,
    emailVerification: true,
    google: runtime.googleOidcReady === true,
    apple: false,
    facebook: runtime.facebookLoginReady === true
  });
  let closed = false;
  return Object.freeze({
    enabled: true,
    ready: true,
    reason: "ready",
    authenticationHttpReady: true,
    authenticationCapabilities,
    paymentsReady: environment.payments.requested && runtime.paymentReady === true,
    router: runtime.router,
    async close() {
      if (closed) return;
      closed = true;
      const failures = [];
      try { await runtime.realtimeSignalSource?.close?.(); } catch (error) { failures.push(error); }
      try { await emailDelivery.close(); } catch (error) { failures.push(error); }
      try { await objectStorage.close(); } catch (error) { failures.push(error); }
      try { await pool.end?.(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, "Marketplace resources did not close cleanly.");
    }
  });
}
