import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessPrivateDataDirectory } from "./data-directory-safety.mjs";
import { marketplaceEnvironment, validateMarketplaceEnvironment } from "./src/marketplace/config.mjs";
import { createTrustedClientAddressResolver } from "./src/marketplace/trusted-client-key.mjs";
import { builtInMonitoringAdapter, validateMonitoringWebhookEnvironment } from "./src/marketplace/monitoring-webhook.mjs";

function exact(value) {
  return typeof value === "string" ? value.trim() : "";
}

function enabled(value) {
  return exact(value).toLowerCase() === "true";
}

function inside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function publicOrigin(value) {
  const supplied = exact(value);
  try {
    const parsed = new URL(supplied);
    if (parsed.origin !== supplied || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    const hostname = parsed.hostname.toLowerCase();
    return hostname !== "localhost" && hostname !== "localhost.localdomain" && isIP(hostname) === 0 && hostname.includes(".");
  } catch {
    return false;
  }
}

function safeAdminKey(value) {
  const supplied = typeof value === "string" ? value : "";
  return supplied.length >= 32 && supplied.length <= 256 && !/[\u0000-\u0020\u007f]/.test(supplied) && !/replace|example|changeme|password|admin-key/i.test(supplied);
}

function deploymentModule(value) {
  const supplied = exact(value);
  if (!supplied) return false;
  if (supplied === builtInMonitoringAdapter) return true;
  if (supplied.startsWith("file:")) {
    try { return new URL(supplied).protocol === "file:"; } catch { return false; }
  }
  return path.isAbsolute(supplied);
}

export function validateProductionDeployment(env = process.env, options = {}) {
  const errors = [];
  const projectRoot = path.resolve(options.projectRoot || path.dirname(fileURLToPath(import.meta.url)));
  const marketplace = marketplaceEnvironment(env);
  const marketplaceValidation = validateMarketplaceEnvironment(env);
  if (env.NODE_ENV !== "production") errors.push("NODE_ENV must be production.");
  if (!["true", "false"].includes(exact(env.PILOT_INTAKE_ENABLED).toLowerCase())) errors.push("PILOT_INTAKE_ENABLED must be explicitly true or false in production.");
  if (!["true", "false"].includes(exact(env.MARKETPLACE_ENABLED).toLowerCase())) errors.push("MARKETPLACE_ENABLED must be explicitly true or false in production.");
  if (!["true", "false"].includes(exact(env.PAYMENTS_ENABLED).toLowerCase())) errors.push("PAYMENTS_ENABLED must be explicitly true or false in production.");
  if (enabled(env.PILOT_INTAKE_ENABLED) && marketplace.marketplace.requested) errors.push("PILOT_INTAKE_ENABLED must be false when MARKETPLACE_ENABLED=true; production must use one private-data system.");
  if (!publicOrigin(env.APP_ORIGIN)) errors.push("APP_ORIGIN must be the exact public HTTPS domain origin with no path, credentials or IP address.");

  const host = exact(env.HOST);
  if (!host || (host !== "localhost" && isIP(host) === 0)) errors.push("HOST must be an explicit IP binding or localhost for a same-host reverse proxy.");
  const port = Number(exact(env.PORT));
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("PORT must be an explicit integer from 1 to 65535.");
  if (exact(env.LAN_PORT) && exact(env.LAN_PORT) !== "0") errors.push("LAN_PORT must be 0 in production; the local Wi-Fi preview cannot be deployed.");

  const dataDirectory = exact(env.DATA_DIR);
  if (!dataDirectory || !path.isAbsolute(dataDirectory)) errors.push("DATA_DIR must be an explicit absolute private-data directory.");
  else {
    if (inside(projectRoot, dataDirectory)) errors.push("DATA_DIR must be outside the deployed source directory.");
    if (!assessPrivateDataDirectory(dataDirectory, { explicitlyConfigured: true }).safeForPrivatePilot) errors.push("DATA_DIR must be outside OneDrive, Dropbox, Google Drive and iCloud.");
  }

  if (!enabled(env.ADMIN_REQUIRE_KEY)) errors.push("ADMIN_REQUIRE_KEY must be true in production.");
  if (!safeAdminKey(env.ADMIN_KEY)) errors.push("ADMIN_KEY must be a non-placeholder 32-256 character secret without whitespace.");
  let trustedProxy = false;
  if (!enabled(env.TRUST_PROXY)) errors.push("TRUST_PROXY must be true behind the required production HTTPS proxy.");
  else {
    try { createTrustedClientAddressResolver(env); trustedProxy = true; } catch (error) { errors.push(error.message); }
  }

  errors.push(...marketplaceValidation.errors);
  if (marketplace.marketplace.requested) {
    if (!marketplace.emailConfigured) errors.push("The enabled marketplace requires SMTP_URL and EMAIL_FROM.");
    if (!marketplace.objectStorageConfigured) errors.push("The enabled marketplace requires complete private object-storage configuration.");
    if (!deploymentModule(env.MARKETPLACE_ADAPTER_MODULE)) errors.push(`The enabled marketplace requires ${builtInMonitoringAdapter} or an absolute deployment monitoring adapter module.`);
    if (exact(env.MARKETPLACE_ADAPTER_MODULE) === builtInMonitoringAdapter) errors.push(...validateMonitoringWebhookEnvironment(env).errors);
  }

  return Object.freeze({
    ok: errors.length === 0,
    mode: marketplace.marketplace.requested ? "marketplace" : "public-site",
    marketplaceEnabled: marketplace.marketplace.requested,
    paymentsEnabled: marketplace.payments.requested,
    pilotIntakeEnabled: enabled(env.PILOT_INTAKE_ENABLED),
    checks: Object.freeze({
      production: env.NODE_ENV === "production",
      publicHttpsOrigin: publicOrigin(env.APP_ORIGIN),
      privateDataDirectory: Boolean(dataDirectory && path.isAbsolute(dataDirectory) && !inside(projectRoot, dataDirectory) && assessPrivateDataDirectory(dataDirectory, { explicitlyConfigured: true }).safeForPrivatePilot),
      protectedAdmin: enabled(env.ADMIN_REQUIRE_KEY) && safeAdminKey(env.ADMIN_KEY),
      trustedProxy,
      localNetworkPreviewDisabled: !exact(env.LAN_PORT) || exact(env.LAN_PORT) === "0"
    }),
    errors: Object.freeze([...new Set(errors)])
  });
}
