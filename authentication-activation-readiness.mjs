import path from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { validateProductionDeployment } from "./deployment-readiness.mjs";
import { normalizeExpectedReleaseCommit, packagedReleaseIdentityMatches } from "./release-identity.mjs";
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
  const deployment = validateProductionDeployment(env, { projectRoot });
  let expectedRelease = null;
  let releaseError = null;
  try { expectedRelease = normalizeExpectedReleaseCommit(options.expectedReleaseCommit ?? env.TIDEWAY_EXPECT_RELEASE); }
  catch (error) { releaseError = error.message; }
  const runningRelease = options.releaseIdentity || Object.freeze({ source: "unidentified", sourceCommit: null, builtAt: null, migrationCount: null });
  const releaseIdentityReady = expectedRelease !== null && packagedReleaseIdentityMatches(runningRelease, expectedRelease);
  let expected;
  try {
    expected = expectedAuthenticationProviders(options.expectedProviders ?? env.TIDEWAY_EXPECT_SOCIAL_PROVIDERS);
  } catch (error) {
    expected = Object.freeze([]);
    return Object.freeze({
      ok: false,
      configurationReady: false,
      origin: callbackOrigin(env.APP_ORIGIN) || null,
      expectedProviders: expected,
      callbacks: Object.freeze({}),
      facebookDataDeletion: null,
      release: Object.freeze({ expectedCommit: expectedRelease, runningCommit: runningRelease.sourceCommit || null }),
      checks: Object.freeze({ productionDeployment: deployment.ok, releaseIdentity: releaseIdentityReady, authenticationCore: false, emailFallback: false, socialProviders: false }),
      errors: Object.freeze([...deployment.errors, ...(releaseError ? [releaseError] : []), error.message]),
      nextEvidence: Object.freeze([])
    });
  }

  const state = marketplaceEnvironment(env);
  const origin = callbackOrigin(env.APP_ORIGIN);
  const authenticationCore = deployment.ok
    && (state.authentication.requested === true || state.marketplace.requested === true)
    && state.databaseConfigured === true
    && state.sessionConfigured === true
    && state.authTokenConfigured === true
    && state.emailConfigured === true;
  const emailFallback = state.capabilities.emailPassword === true;
  const providerChecks = Object.fromEntries(supportedSocialProviders.map((provider) => [provider, Object.freeze({
    expected: expected.includes(provider),
    configured: providerConfiguration(state, provider),
    callback: origin ? `${origin}/api/marketplace/auth/${provider}/callback` : null
  })]));
  const expectedProvidersConfigured = expected.every((provider) => providerChecks[provider].configured === true);
  const errors = [...deployment.errors];
  if (!state.authentication.requested && !state.marketplace.requested) errors.push("AUTHENTICATION_ENABLED or MARKETPLACE_ENABLED must be true for authenticated accounts.");
  if (!emailFallback) errors.push("Email sign-up, verification and password reset require the complete database, session, token, email-provider and HTTPS-origin configuration.");
  for (const provider of expected) if (!providerChecks[provider].configured) errors.push(`${provider[0].toUpperCase()}${provider.slice(1)} sign-in credentials are incomplete.`);
  if (releaseError) errors.push(releaseError);
  else if (!releaseIdentityReady) errors.push(`The running Homle package does not match expected release ${expectedRelease}.`);
  const configurationReady = releaseIdentityReady && authenticationCore && emailFallback && expectedProvidersConfigured;
  const nextEvidence = configurationReady ? Object.freeze([
    "Start the authentication service in managed staging and require its database, email-provider and monitoring probes to pass.",
    `Run the external domain verifier with TIDEWAY_EXPECT_RELEASE=${expectedRelease} and TIDEWAY_EXPECT_SOCIAL_PROVIDERS=${expected.join(",")}.`,
    "Complete new-account, repeat-login, role-onboarding, logout and account-collision tests with two non-customer staging accounts.",
    ...(expected.includes("facebook") ? ["Register the signed Facebook data-deletion callback and public status URL in Meta, then prove a non-customer deletion request reaches the private privacy queue."] : []),
    "Keep payments disabled until their separate test-mode approval and reconciliation gate passes."
  ]) : Object.freeze([]);
  return Object.freeze({
    ok: configurationReady,
    configurationReady,
    origin: origin || null,
    expectedProviders: expected,
    callbacks: Object.freeze(Object.fromEntries(expected.map((provider) => [provider, providerChecks[provider].callback]))),
    facebookDataDeletion: expected.includes("facebook") && origin ? Object.freeze({
      callback: `${origin}/api/marketplace/auth/facebook/data-deletion`,
      statusPage: `${origin}/facebook-data-deletion`
    }) : null,
    release: Object.freeze({ expectedCommit: expectedRelease, runningCommit: runningRelease.sourceCommit || null }),
    providers: Object.freeze(providerChecks),
    checks: Object.freeze({ productionDeployment: deployment.ok, releaseIdentity: releaseIdentityReady, authenticationCore, emailFallback, socialProviders: expectedProvidersConfigured }),
    errors: Object.freeze([...new Set(errors)]),
    nextEvidence
  });
}
