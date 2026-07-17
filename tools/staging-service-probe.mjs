#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMarketplaceAttachment } from "../src/marketplace/attachment.mjs";
import { marketplaceEnvironment, validateMarketplaceEnvironment } from "../src/marketplace/config.mjs";

const toolPath = fileURLToPath(import.meta.url);
export const stagingServiceProbeConfirmation = "PROBE HOMLE MANAGED STAGING SERVICES";
const secretNames = Object.freeze([
  "DATABASE_URL", "REALTIME_DATABASE_URL", "SESSION_SECRET", "AUTH_TOKEN_SECRET", "DATA_ENCRYPTION_KEY", "SMTP_URL",
  "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY", "MONITORING_WEBHOOK_TOKEN",
  "GOOGLE_CLIENT_SECRET", "FACEBOOK_APP_SECRET", "APPLE_PRIVATE_KEY", "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"
]);

function exact(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stagingDatabaseTarget(value, name = "DATABASE_URL") {
  let url;
  try { url = new URL(exact(value)); } catch { throw new TypeError(`${name} must be a valid managed PostgreSQL staging URL.`); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || !url.pathname || url.pathname === "/") {
    throw new TypeError(`${name} must contain the managed staging database, tideway_app user and private credential.`);
  }
  let user;
  let database;
  try {
    user = decodeURIComponent(url.username);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch { throw new TypeError(`${name} contains invalid encoded account or database details.`); }
  if (user !== "tideway_app") throw new TypeError("The staging service probe must authenticate as tideway_app.");
  if (!/_(?:tideway|homle)_staging$/i.test(database)) throw new TypeError("The staging service probe database name must end in _tideway_staging or _homle_staging.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) throw new TypeError("The managed staging service probe refuses a local database endpoint.");
  if (url.searchParams.get("sslmode") !== "verify-full") throw new TypeError(`Managed staging ${name} must use sslmode=verify-full.`);
  return Object.freeze({ database, role: user, tls: "verify-full" });
}

function validationError(errors) {
  return new TypeError([...new Set(errors)].join(" "));
}

export function validateStagingServiceProbeEnvironment(env = process.env, confirmation = env.HOMLE_STAGING_SERVICE_PROBE_CONFIRMATION) {
  const errors = [];
  if (confirmation !== stagingServiceProbeConfirmation) errors.push(`Set HOMLE_STAGING_SERVICE_PROBE_CONFIRMATION exactly to: ${stagingServiceProbeConfirmation}`);
  if (env.NODE_ENV !== "production") errors.push("NODE_ENV must be production so every managed-service client uses its production TLS boundary.");
  if (exact(env.MARKETPLACE_ENABLED).toLowerCase() !== "true") errors.push("MARKETPLACE_ENABLED must be true for this isolated composition probe.");
  if (exact(env.PAYMENTS_ENABLED).toLowerCase() !== "false") errors.push("PAYMENTS_ENABLED must be false; this probe never contacts a payment provider.");
  const marketplace = validateMarketplaceEnvironment(env);
  errors.push(...marketplace.errors);
  const state = marketplaceEnvironment(env);
  if (!state.databaseConfigured || !state.sessionConfigured || !state.authTokenConfigured || !state.encryptionConfigured) errors.push("Database and three separate 32-character application secrets are required.");
  if (!state.emailConfigured) errors.push("Complete SMTP_URL and EMAIL_FROM are required.");
  if (!state.objectStorageConfigured) errors.push("Complete private object-storage configuration is required.");
  if (!exact(env.MARKETPLACE_ADAPTER_MODULE)) errors.push("A private monitoring adapter is required.");
  let database = null;
  let realtimeDatabase = null;
  try { database = stagingDatabaseTarget(env.DATABASE_URL); } catch (error) { errors.push(error.message); }
  try { realtimeDatabase = stagingDatabaseTarget(env.REALTIME_DATABASE_URL, "REALTIME_DATABASE_URL"); } catch (error) { errors.push(error.message); }
  if (database && realtimeDatabase && database.database !== realtimeDatabase.database) errors.push("DATABASE_URL and REALTIME_DATABASE_URL must target the same managed staging database.");
  if (errors.length) throw validationError(errors);
  return Object.freeze({ database, providersConfigured: Object.freeze({ google: state.providers.google.enabled, facebook: state.providers.facebook.enabled }) });
}

export function sanitizeStagingServiceProbeError(error, env = process.env) {
  let message = error instanceof Error ? error.message : String(error || "Managed staging service probe failed.");
  for (const name of secretNames) {
    const value = typeof env[name] === "string" ? env[name] : "";
    if (value.length >= 4) message = message.split(value).join(`[${name.toLowerCase()}-redacted]`);
  }
  message = message
    .replace(/(?:postgres(?:ql)?|smtps?):\/\/[^\s'"<>]+/gi, "[service-url-redacted]")
    .replace(/\b(?:sk|pk)_test_[A-Za-z0-9_]+\b|\bwhsec_[A-Za-z0-9_]+\b/g, "[payment-secret-redacted]");
  return message.slice(0, 2000);
}

export async function probeMarketplaceStagingServices(options = {}) {
  const env = options.env || process.env;
  const configuration = validateStagingServiceProbeEnvironment(env, options.confirmation ?? env.HOMLE_STAGING_SERVICE_PROBE_CONFIRMATION);
  const createAttachment = options.createAttachment || createMarketplaceAttachment;
  let attachment;
  try {
    attachment = await createAttachment({ env });
    if (!attachment || attachment.enabled !== true || attachment.ready !== true || attachment.authenticationHttpReady !== true || attachment.paymentsReady !== false) {
      throw new Error("Marketplace staging services did not compose into a ready authentication runtime with payments disabled.");
    }
    const capabilities = attachment.authenticationCapabilities || {};
    if (capabilities.emailPassword !== true || capabilities.emailVerification !== true || capabilities.passwordReset !== true) {
      throw new Error("Marketplace staging email account capabilities did not attach completely.");
    }
    return Object.freeze({
      ok: true,
      database: configuration.database,
      probes: Object.freeze({
        databaseSchemaAndRole: true,
        smtpAuthentication: true,
        privateBucketAccess: true,
        monitoringAdapterComposition: true,
        authenticationRuntime: true,
        paymentsContacted: false
      }),
      providers: Object.freeze({ google: capabilities.google === true, facebook: capabilities.facebook === true, apple: false }),
      nextEvidence: Object.freeze([
        "Deliver one verification and one password-reset message to an approved non-customer staging inbox.",
        "Upload, read and delete one synthetic room image through the signed private-media flow, then confirm no object remains.",
        "Trigger one synthetic staging failure and prove the private monitoring event reaches the assigned operator alert.",
        "Complete the two-account, two-phone booking journey before exposing account controls publicly."
      ])
    });
  } finally {
    await attachment?.close?.();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    console.log(JSON.stringify(await probeMarketplaceStagingServices(), null, 2));
  } catch (error) {
    console.error(`Homle managed staging service probe failed: ${sanitizeStagingServiceProbeError(error)}`);
    process.exitCode = 1;
  }
}
