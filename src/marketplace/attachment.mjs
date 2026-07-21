import path from "node:path";
import { pathToFileURL } from "node:url";
import { marketplaceEnvironment, publicAuthenticationCapabilities, validateMarketplaceEnvironment } from "./config.mjs";
import { postgresPoolOptions, realtimePostgresPoolOptions } from "./database.mjs";
import { createPostgresRateLimiter } from "./postgres-rate-limiter.mjs";
import { bookingRealtimeChannel, createPostgresRealtimeSignalSource } from "./realtime-signal-source.mjs";
import { createMarketplaceRuntime } from "./runtime.mjs";
import { builtInMonitoringAdapter } from "./monitoring-webhook.mjs";
import { builtInRenderLogMonitoringAdapter } from "./render-log-monitoring.mjs";
import { createS3ObjectStorage } from "./s3-object-storage.mjs";
import { createTransactionalEmailDelivery } from "./email-delivery.mjs";
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
  if (supplied === builtInMonitoringAdapter) return new URL("./monitoring-webhook.mjs", import.meta.url).href;
  if (supplied === builtInRenderLogMonitoringAdapter) return new URL("./render-log-monitoring.mjs", import.meta.url).href;
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

export async function createDefaultRealtimePostgresPool(env = process.env) {
  let postgres;
  try {
    postgres = await import("pg");
  } catch (cause) {
    throw Object.assign(new Error("The marketplace requires the reviewed pg dependency; install the frozen lockfile before enablement."), { cause });
  }
  const Pool = postgres.Pool || postgres.default?.Pool;
  if (typeof Pool !== "function") throw new TypeError("The installed pg package does not expose a Pool constructor.");
  const options = realtimePostgresPoolOptions(env);
  if (!options) throw new TypeError("REALTIME_DATABASE_URL is required to construct the dedicated live-update pool.");
  return new Pool(options);
}

export async function probeMarketplaceDatabase(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A PostgreSQL pool is required for marketplace readiness.");
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT current_user AS database_role,
        current_database() AS database_name,
        current_setting('server_version_num')::integer AS server_version_num,
        COALESCE((SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS role_is_safe,
        to_regprocedure('tideway_private.lookup_session(bytea)') IS NOT NULL AS lookup_session_ready,
        to_regprocedure('tideway_private.invite_cleaner(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer,integer)') IS NOT NULL
          AND to_regprocedure('tideway_private.recommend_cleaners_for_request_v2(uuid,integer)') IS NOT NULL AS booking_workflow_ready,
        to_regprocedure('tideway_private.list_my_booking_summaries(integer)') IS NOT NULL AS booking_summaries_ready,
        to_regprocedure('tideway_private.configure_automatic_dispatch(uuid,boolean,smallint)') IS NOT NULL AS automatic_dispatch_ready,
        to_regprocedure('tideway_private.get_cleaning_request_realtime_snapshot(uuid,bigint,integer)') IS NOT NULL AS request_realtime_ready,
        to_regprocedure('tideway_private.submit_cleaning_request(uuid,boolean,boolean)') IS NOT NULL
          AND to_regprocedure('tideway_private.withdraw_cleaning_request(uuid,text)') IS NOT NULL
          AND to_regprocedure('tideway_private.create_request_photo_upload_intent(uuid,uuid,text,text,text,text,text,integer,text,timestamp with time zone)') IS NOT NULL
          AND to_regprocedure('tideway_private.get_cleaning_request_scan(uuid)') IS NOT NULL AS request_room_scan_ready,
        to_regprocedure('tideway_private.consume_rate_limit(text,bytea)') IS NOT NULL AS rate_limit_ready,
        to_regprocedure('tideway_private.consume_pending_social_identity(bytea)') IS NOT NULL AS facebook_pending_identity_ready,
        to_regprocedure('tideway_private.connect_social_identity(authentication_provider,text,citext,boolean,text,text,jsonb)') IS NOT NULL AS provider_connection_ready,
        to_regprocedure('tideway_private.begin_booking_payment_authorization(uuid,uuid,text,bytea)') IS NOT NULL
          AND to_regclass('public.payment_one_live_refund_idx') IS NOT NULL
          AND to_regprocedure('tideway_private.get_my_cleaner_payout_onboarding()') IS NOT NULL
          AND to_regprocedure('tideway_private.begin_my_cleaner_payout_onboarding(uuid)') IS NOT NULL
          AND to_regprocedure('tideway_private.attach_my_cleaner_payout_account(uuid,text)') IS NOT NULL
          AND to_regprocedure('tideway_private.sync_my_cleaner_payout_account(text,boolean,boolean,boolean)') IS NOT NULL AS payment_ledger_ready,
        to_regprocedure('tideway_private.read_booking_payment(uuid)') IS NOT NULL
          AND to_regprocedure('tideway_private.list_administrator_payment_operations(text,integer,integer)') IS NOT NULL
          AND to_regprocedure('tideway_private.get_administrator_booking_payment_operation(uuid)') IS NOT NULL
          AND to_regprocedure('tideway_private.list_administrator_booking_operations(text,integer,integer)') IS NOT NULL AS payment_access_ready,
        to_regprocedure('tideway_private.current_booking_payment_authorized(uuid)') IS NOT NULL AS payment_journey_gate_ready,
        to_regprocedure('tideway_private.add_unexpected_cleaning_task(uuid,text,text,integer,boolean,text)') IS NOT NULL
          AND to_regprocedure('tideway_private.confirm_unexpected_task_frozen_terms(uuid,uuid)') IS NOT NULL AS unexpected_task_terms_ready,
        to_regprocedure('tideway_private.request_my_privacy_action(uuid,text)') IS NOT NULL
          AND to_regprocedure('tideway_private.get_my_privacy_requests()') IS NOT NULL AS privacy_request_ready,
        to_regprocedure('tideway_private.request_facebook_data_deletion(uuid,text,bytea,bytea)') IS NOT NULL
          AND to_regprocedure('tideway_private.get_facebook_data_deletion_status(bytea)') IS NOT NULL AS facebook_data_deletion_ready
    `);
    const row = result?.rows?.[0];
    if (!row || row.database_role !== "tideway_app") throw new Error("Marketplace DATABASE_URL must authenticate as tideway_app.");
    if (Number(row.server_version_num) < 160000) throw new Error("Marketplace PostgreSQL 16 or newer is required.");
    if (row.role_is_safe !== true) throw new Error("Marketplace database role must not be superuser or bypass row-level security.");
    if (row.lookup_session_ready !== true || row.booking_workflow_ready !== true || row.booking_summaries_ready !== true || row.automatic_dispatch_ready !== true || row.request_realtime_ready !== true || row.request_room_scan_ready !== true || row.rate_limit_ready !== true || row.facebook_pending_identity_ready !== true || row.provider_connection_ready !== true || row.payment_ledger_ready !== true || row.payment_access_ready !== true || row.payment_journey_gate_ready !== true || row.unexpected_task_terms_ready !== true || row.privacy_request_ready !== true || row.facebook_data_deletion_ready !== true) throw new Error("Marketplace database migrations or runtime grants are incomplete.");
    return Object.freeze({ databaseRole: row.database_role, databaseName: row.database_name, postgresqlVersionNumber: Number(row.server_version_num) });
  } finally {
    client.release();
  }
}

export async function probeRealtimeDatabase(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A dedicated PostgreSQL pool is required for real-time readiness.");
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT current_user AS database_role,
        current_database() AS database_name,
        current_setting('server_version_num')::integer AS server_version_num,
        COALESCE((SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS role_is_safe
    `);
    const row = result?.rows?.[0];
    if (!row || row.database_role !== "tideway_app") throw new Error("Marketplace REALTIME_DATABASE_URL must authenticate as tideway_app.");
    if (Number(row.server_version_num) < 160000) throw new Error("Marketplace real-time PostgreSQL 16 or newer is required.");
    if (row.role_is_safe !== true) throw new Error("Marketplace real-time database role must not be superuser or bypass row-level security.");
    await client.query(`LISTEN ${bookingRealtimeChannel}`);
    await client.query(`UNLISTEN ${bookingRealtimeChannel}`);
    return Object.freeze({ databaseRole: row.database_role, databaseName: row.database_name, postgresqlVersionNumber: Number(row.server_version_num), listenReady: true });
  } finally {
    client.release();
  }
}

function requireAdapters(adapters) {
  if (typeof adapters?.onUnexpectedError !== "function") throw new TypeError("Marketplace enablement requires private operational error monitoring.");
  if (typeof adapters?.close !== "function") throw new TypeError("Marketplace monitoring must provide deterministic shutdown.");
}

function unavailableAttachment(env, reason = "disabled") {
  const authenticationCapabilities = publicAuthenticationCapabilities(env);
  return Object.freeze({
    enabled: false,
    ready: false,
    reason,
    authenticationHttpReady: false,
    authenticationCapabilities,
    emailReady: false,
    mediaReady: false,
    realtimeReady: false,
    geocodingReady: false,
    speechSummaryReady: false,
    roomVisionReady: false,
    matchingReady: false,
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
  const restrictedStaging = environment.launchApproval.stagingAccountsRestricted === true;
  if (!environment.databaseConfigured || !environment.sessionConfigured || !environment.authTokenConfigured || !environment.encryptionConfigured || !environment.appOrigin) throw new TypeError("Marketplace attachment requires database, session, token, encryption and exact-origin configuration.");
  if (!environment.emailConfigured && !restrictedStaging) throw new TypeError("Marketplace attachment requires one configured HTTPS or SMTP email provider and EMAIL_FROM.");
  if (!environment.objectStorageConfigured && !restrictedStaging) throw new TypeError("Marketplace attachment requires complete private object-storage configuration.");

  const clientKey = (options.createClientKeyResolver || createTrustedClientKeyResolver)(env);

  const loadAdapters = options.loadAdapters || loadMarketplaceDeploymentAdapters;
  const adapters = options.adapters || await loadAdapters(env);
  requireAdapters(adapters);

  const createPool = options.createPool || createDefaultPostgresPool;
  const createRealtimePool = options.createRealtimePool || createDefaultRealtimePostgresPool;
  const createRealtimeSignalSource = options.createRealtimeSignalSource || createPostgresRealtimeSignalSource;
  const createEmailDelivery = options.createEmailDelivery || createTransactionalEmailDelivery;
  const createObjectStorage = options.createObjectStorage || createS3ObjectStorage;
  const createPaymentProvider = options.createPaymentProvider || createStripePaymentProvider;
  let emailDelivery;
  let objectStorage;
  let pool;
  let realtimePool;
  let realtimeEvidence = null;
  let realtimeSignalSource;
  let runtime;
  let paymentProvider;
  try {
    if (environment.emailConfigured) {
      emailDelivery = await createEmailDelivery(env, { onUnexpectedError: adapters.onUnexpectedError });
      if (!emailDelivery || typeof emailDelivery.send !== "function" || typeof emailDelivery.verify !== "function" || typeof emailDelivery.close !== "function") throw new TypeError("Marketplace email delivery did not compose completely.");
    }
    if (environment.objectStorageConfigured) {
      objectStorage = await createObjectStorage(env, { onUnexpectedError: adapters.onUnexpectedError });
      const storageMethods = ["verify", "createUploadUrl", "headObject", "inspectAndSanitizeImage", "createReadUrl", "deleteObject", "close"];
      if (!objectStorage || !storageMethods.every((method) => typeof objectStorage[method] === "function")) throw new TypeError("Marketplace private object storage did not compose completely.");
    }
    pool = await createPool(env);
    const databaseEvidence = await (options.probeDatabase || probeMarketplaceDatabase)(pool);
    if (environment.realtimeDatabaseConfigured) {
      realtimePool = await createRealtimePool(env);
      realtimeEvidence = await (options.probeRealtimeDatabase || probeRealtimeDatabase)(realtimePool);
      if (databaseEvidence?.databaseName && realtimeEvidence?.databaseName && databaseEvidence.databaseName !== realtimeEvidence.databaseName) throw new Error("DATABASE_URL and REALTIME_DATABASE_URL must target the same marketplace database.");
    } else {
      realtimePool = pool;
    }
    await emailDelivery?.verify();
    await objectStorage?.verify();
    if (environment.payments.requested) {
      paymentProvider = await createPaymentProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET });
      if (!paymentProvider || paymentProvider.name !== "stripe" || !["verify", "createPayoutAccount", "retrievePayoutAccount", "createPayoutOnboardingLink"].every((method) => typeof paymentProvider[method] === "function")) throw new TypeError("Stripe payment adapter did not compose completely.");
      await paymentProvider.verify();
    }
    const rateLimiter = (options.createRateLimiter || createPostgresRateLimiter)(pool, { secret: env.SESSION_SECRET });
    realtimeSignalSource = createRealtimeSignalSource(realtimePool);
    runtime = (options.createRuntime || createMarketplaceRuntime)(pool, {
      env,
      rateLimiter,
      clientKey,
      emailDelivery,
      objectStorage,
      paymentProvider,
      realtimeSignalSource,
      etaProvider: adapters.etaProvider,
      onUnexpectedError: adapters.onUnexpectedError
    });
    if (!runtime?.router || typeof runtime.router.handle !== "function" || (emailDelivery && runtime.authenticationHttpReady !== true) || (environment.payments.requested && runtime.paymentReady !== true)) throw new TypeError("Marketplace runtime did not compose its router and requested provider boundaries completely.");
  } catch (error) {
    try { await realtimeSignalSource?.close?.(); } catch {}
    try { await emailDelivery?.close?.(); } catch {}
    try { await objectStorage?.close?.(); } catch {}
    if (realtimePool && realtimePool !== pool) try { await realtimePool.end?.(); } catch {}
    try { await pool?.end?.(); } catch {}
    try { await adapters.close(); } catch {}
    throw error;
  }

  const authenticationCapabilities = publicAuthenticationCapabilities(env, {
    emailPassword: true,
    passwordReset: true,
    emailVerification: true,
    google: runtime.googleOidcReady === true,
    apple: runtime.appleSignInReady === true,
    facebook: runtime.facebookLoginReady === true
  });
  let closed = false;
  return Object.freeze({
    enabled: true,
    ready: true,
    reason: "ready",
    authenticationHttpReady: runtime.authenticationHttpReady === true,
    authenticationCapabilities,
    emailReady: Boolean(emailDelivery),
    mediaReady: Boolean(objectStorage),
    realtimeReady: realtimeEvidence?.listenReady === true,
    geocodingReady: runtime.geocodingReady === true,
    speechSummaryReady: runtime.speechSummaryReady === true,
    roomVisionReady: runtime.roomVisionReady === true,
    matchingReady: runtime.matchingReady === true,
    paymentsReady: environment.payments.requested && runtime.paymentReady === true,
    router: runtime.router,
    async close() {
      if (closed) return;
      closed = true;
      const failures = [];
      try { await realtimeSignalSource.close?.(); } catch (error) { failures.push(error); }
      try { await emailDelivery?.close(); } catch (error) { failures.push(error); }
      try { await objectStorage?.close(); } catch (error) { failures.push(error); }
      if (realtimePool !== pool) try { await realtimePool.end?.(); } catch (error) { failures.push(error); }
      try { await pool.end?.(); } catch (error) { failures.push(error); }
      try { await adapters.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, "Marketplace resources did not close cleanly.");
    }
  });
}
