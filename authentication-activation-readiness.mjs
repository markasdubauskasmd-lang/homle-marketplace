import path from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { validateProductionDeployment } from "./deployment-readiness.mjs";
import { marketplaceEnvironment } from "./src/marketplace/config.mjs";

const supportedSocialProviders = Object.freeze(["google", "facebook"]);

function exact(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function expectedAuthenticationProviders(value) {
  const entries = Array.isArray(value) ? value : exact(value).split(",");
  const normalized = entries.map((entry) => exact(entry).toLowerCase()).filter(Boolean);
  if (!normalized.length) throw new TypeError("Choose at least one expected social provider: google or facebook.");
  if (normalized.some((entry) => !supportedSocialProviders.includes(entry))) throw new TypeError("Expected social providers may contain only google and facebook.");
  if (new Set(normalized).size !== normalized.length) throw new TypeError("Expected social providers must not contain duplicates.");
  return Object.freeze(normalized);
}

function callbackOrigin(value) {
  const supplied = exact(value);
  try {
    const url = new URL(supplied);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && url.origin === supplied && !url.port && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash && !isIP(hostname) && hostname.includes(".")
      ? url.origin
      : "";
  } catch {
    return "";
  }
}

function providerConfiguration(state, provider) {
  if (provider === "google") return state.capabilities.google === true;
  return state.capabilities.facebook === true;
}

export function authenticationActivationReadiness(env = process.env, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.dirname(fileURLToPath(import.meta.url)));
  let expected;
  try {
    expected = expectedAuthenticationProviders(options.expectedProviders ?? env.TIDEWAY_EXPECT_SOCIAL_PROVIDERS);
  } catch (error) {
    expected = Object.freeze([]);
    const deployment = validateProductionDeployment(env, { projectRoot });
    return Object.freeze({
      ok: false,
      configurationReady: false,
      origin: callbackOrigin(env.APP_ORIGIN) || null,
      expectedProviders: expected,
      callbacks: Object.freeze({}),
      checks: Object.freeze({ productionDeployment: deployment.ok, marketplaceCore: false, emailFallback: false, socialProviders: false }),
      errors: Object.freeze([...deployment.errors, error.message]),
      nextEvidence: Object.freeze([])
    });
  }

  const deployment = validateProductionDeployment(env, { projectRoot });
  const state = marketplaceEnvironment(env);
  const origin = callbackOrigin(env.APP_ORIGIN);
  const marketplaceCore = deployment.ok
    && state.marketplace.requested === true
    && state.databaseConfigured === true
    && state.sessionConfigured === true
    && state.authTokenConfigured === true
    && state.encryptionConfigured === true
    && state.emailConfigured === true
    && state.objectStorageConfigured === true;
  const emailFallback = state.capabilities.emailPassword === true;
  const providerChecks = Object.fromEntries(supportedSocialProviders.map((provider) => [provider, Object.freeze({
    expected: expected.includes(provider),
    configured: providerConfiguration(state, provider),
    callback: origin ? `${origin}/api/marketplace/auth/${provider}/callback` : null
  })]));
  const expectedProvidersConfigured = expected.every((provider) => providerChecks[provider].configured === true);
  const errors = [...deployment.errors];
  if (!state.marketplace.requested) errors.push("MARKETPLACE_ENABLED must be true for authenticated accounts.");
  if (!emailFallback) errors.push("Email sign-up, verification and password reset require the complete database, session, token, SMTP and HTTPS-origin configuration.");
  for (const provider of expected) if (!providerChecks[provider].configured) errors.push(`${provider[0].toUpperCase()}${provider.slice(1)} sign-in credentials are incomplete.`);
  const configurationReady = marketplaceCore && emailFallback && expectedProvidersConfigured;
  const nextEvidence = configurationReady ? Object.freeze([
    "Start the marketplace in managed staging and require its database, SMTP, private-storage and monitoring probes to pass.",
    `Run the external domain verifier with TIDEWAY_EXPECT_SOCIAL_PROVIDERS=${expected.join(",")}.`,
    "Complete new-account, repeat-login, role-onboarding, logout and account-collision tests with two non-customer staging accounts.",
    "Keep payments disabled until their separate test-mode approval and reconciliation gate passes."
  ]) : Object.freeze([]);
  return Object.freeze({
    ok: configurationReady,
    configurationReady,
    origin: origin || null,
    expectedProviders: expected,
    callbacks: Object.freeze(Object.fromEntries(expected.map((provider) => [provider, providerChecks[provider].callback]))),
    providers: Object.freeze(providerChecks),
    checks: Object.freeze({ productionDeployment: deployment.ok, marketplaceCore, emailFallback, socialProviders: expectedProvidersConfigured }),
    errors: Object.freeze([...new Set(errors)]),
    nextEvidence
  });
}
