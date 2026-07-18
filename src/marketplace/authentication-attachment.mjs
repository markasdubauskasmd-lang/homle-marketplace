import { createAuthenticationRuntime } from "./authentication-runtime.mjs";
import { loadMarketplaceDeploymentAdapters, createDefaultPostgresPool, probeMarketplaceDatabase } from "./attachment.mjs";
import { marketplaceEnvironment, publicAuthenticationCapabilities, validateMarketplaceEnvironment } from "./config.mjs";
import { createTransactionalEmailDelivery } from "./email-delivery.mjs";
import { createPostgresRateLimiter } from "./postgres-rate-limiter.mjs";
import { createTrustedClientKeyResolver } from "./trusted-client-key.mjs";

function enabledState(env) {
  const value = String(env.AUTHENTICATION_ENABLED || "").trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new TypeError("AUTHENTICATION_ENABLED must be true or false.");
}

function unavailableAttachment(env) {
  return Object.freeze({
    enabled: false,
    ready: false,
    authenticationHttpReady: false,
    authenticationCapabilities: publicAuthenticationCapabilities(env),
    router: null,
    async close() {}
  });
}

function requireAdapters(adapters) {
  if (typeof adapters?.onUnexpectedError !== "function") throw new TypeError("Authentication enablement requires private operational error monitoring.");
  if (typeof adapters?.close !== "function") throw new TypeError("Authentication monitoring must provide deterministic shutdown.");
}

export async function createAuthenticationAttachment(options = {}) {
  const env = options.env || process.env;
  if (!enabledState(env)) return unavailableAttachment(env);
  const validation = validateMarketplaceEnvironment(env);
  if (!validation.ok) throw new TypeError(`Authentication attachment configuration is invalid: ${validation.errors.join(" ")}`);
  const environment = marketplaceEnvironment(env);
  const required = [];
  if (!environment.databaseConfigured) required.push("DATABASE_URL");
  if (!environment.sessionConfigured) required.push("SESSION_SECRET");
  if (!environment.authTokenConfigured) required.push("AUTH_TOKEN_SECRET");
  if (!environment.appOrigin) required.push("APP_ORIGIN");
  if (required.length) throw new TypeError(`Authentication attachment requires ${required.join(", ")}.`);
  if (!environment.emailConfigured && !environment.capabilities.google) throw new TypeError("Authentication attachment requires one configured email provider or a complete Google OAuth client.");

  const clientKey = (options.createClientKeyResolver || createTrustedClientKeyResolver)(env);
  const adapters = options.adapters || await (options.loadAdapters || loadMarketplaceDeploymentAdapters)(env);
  requireAdapters(adapters);
  const createEmailDelivery = options.createEmailDelivery || createTransactionalEmailDelivery;
  const createPool = options.createPool || createDefaultPostgresPool;
  let emailDelivery;
  let pool;
  let runtime;
  try {
    if (environment.emailConfigured) {
      emailDelivery = await createEmailDelivery(env, { onUnexpectedError: adapters.onUnexpectedError });
      if (!emailDelivery || typeof emailDelivery.send !== "function" || typeof emailDelivery.verify !== "function" || typeof emailDelivery.close !== "function") throw new TypeError("Authentication email delivery did not compose completely.");
    }
    pool = await createPool(env);
    await (options.probeDatabase || probeMarketplaceDatabase)(pool);
    if (emailDelivery) await emailDelivery.verify();
    const rateLimiter = (options.createRateLimiter || createPostgresRateLimiter)(pool, { secret: env.SESSION_SECRET });
    runtime = (options.createRuntime || createAuthenticationRuntime)(pool, {
      env,
      emailDelivery,
      rateLimiter,
      clientKey,
      workspaceReady: options.workspaceReady === true,
      onUnexpectedError: adapters.onUnexpectedError
    });
    if (!runtime?.router || typeof runtime.router.handle !== "function" || runtime.authenticationHttpReady !== true) throw new TypeError("Authentication runtime did not compose its router completely.");
  } catch (error) {
    try { await emailDelivery?.close?.(); } catch {}
    try { await pool?.end?.(); } catch {}
    try { await adapters.close(); } catch {}
    throw error;
  }

  const authenticationCapabilities = publicAuthenticationCapabilities(env, {
    emailPassword: runtime.emailPasswordReady === true,
    passwordReset: runtime.emailPasswordReady === true,
    emailVerification: runtime.emailPasswordReady === true,
    google: runtime.googleOidcReady === true,
    apple: runtime.appleSignInReady === true,
    facebook: runtime.facebookLoginReady === true
  });
  let closed = false;
  return Object.freeze({
    enabled: true,
    ready: true,
    authenticationHttpReady: true,
    authenticationCapabilities,
    router: runtime.router,
    async close() {
      if (closed) return;
      closed = true;
      const failures = [];
      try { await emailDelivery?.close?.(); } catch (error) { failures.push(error); }
      try { await pool.end?.(); } catch (error) { failures.push(error); }
      try { await adapters.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, "Authentication resources did not close cleanly.");
    }
  });
}
