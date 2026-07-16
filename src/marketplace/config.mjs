const providerRequirements = Object.freeze({
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  apple: ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
  facebook: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "FACEBOOK_GRAPH_API_VERSION"]
});
const paymentRequirements = Object.freeze(["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"]);

function present(env, key) {
  return typeof env[key] === "string" && env[key].trim().length > 0;
}

function providerState(env, keys) {
  const supplied = keys.filter((key) => present(env, key));
  return { enabled: supplied.length === keys.length, partial: supplied.length > 0 && supplied.length < keys.length, missing: keys.filter((key) => !present(env, key)) };
}

function booleanSetting(env, key) {
  const value = String(env[key] || "").trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return null;
}

export function marketplaceEnvironment(env = process.env) {
  const providers = Object.fromEntries(Object.entries(providerRequirements).map(([name, keys]) => [name, providerState(env, keys)]));
  const databaseConfigured = present(env, "DATABASE_URL");
  const sessionConfigured = present(env, "SESSION_SECRET") && env.SESSION_SECRET.trim().length >= 32;
  const authTokenConfigured = present(env, "AUTH_TOKEN_SECRET") && env.AUTH_TOKEN_SECRET.trim().length >= 32;
  const emailConfigured = present(env, "SMTP_URL") && present(env, "EMAIL_FROM");
  const appOrigin = present(env, "APP_ORIGIN") ? env.APP_ORIGIN.trim() : "";
  const objectStorageConfigured = ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_REGION", "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY"].every((key) => present(env, key));
  const encryptionConfigured = present(env, "DATA_ENCRYPTION_KEY") && env.DATA_ENCRYPTION_KEY.trim().length >= 32;
  const suppliedPaymentKeys = paymentRequirements.filter((key) => present(env, key));
  const paymentsRequested = booleanSetting(env, "PAYMENTS_ENABLED") === true;
  const marketplaceRequested = booleanSetting(env, "MARKETPLACE_ENABLED") === true;
  const stripeConfigured = suppliedPaymentKeys.length === paymentRequirements.length;
  return {
    production: env.NODE_ENV === "production",
    marketplace: { requested: marketplaceRequested },
    databaseConfigured,
    sessionConfigured,
    authTokenConfigured,
    emailConfigured,
    appOrigin,
    objectStorageConfigured,
    encryptionConfigured,
    payments: {
      requested: paymentsRequested,
      stripeConfigured,
      partial: suppliedPaymentKeys.length > 0 && !stripeConfigured,
      missing: paymentRequirements.filter((key) => !present(env, key))
    },
    providers,
    capabilities: {
      emailPassword: databaseConfigured && sessionConfigured && authTokenConfigured && emailConfigured && Boolean(appOrigin),
      passwordReset: databaseConfigured && sessionConfigured && authTokenConfigured && emailConfigured && Boolean(appOrigin),
      emailVerification: databaseConfigured && sessionConfigured && authTokenConfigured && emailConfigured && Boolean(appOrigin),
      google: databaseConfigured && sessionConfigured && authTokenConfigured && Boolean(appOrigin) && providers.google.enabled,
      apple: databaseConfigured && sessionConfigured && authTokenConfigured && Boolean(appOrigin) && providers.apple.enabled,
      facebook: databaseConfigured && sessionConfigured && authTokenConfigured && emailConfigured && Boolean(appOrigin) && providers.facebook.enabled
    }
  };
}

export function validateMarketplaceEnvironment(env = process.env) {
  const state = marketplaceEnvironment(env);
  const errors = [];
  for (const [provider, status] of Object.entries(state.providers)) {
    if (status.partial) errors.push(`${provider} sign-in is partially configured; missing ${status.missing.join(", ")}.`);
  }
  if (booleanSetting(env, "MARKETPLACE_ENABLED") === null) errors.push("MARKETPLACE_ENABLED must be true or false.");
  if (booleanSetting(env, "PAYMENTS_ENABLED") === null) errors.push("PAYMENTS_ENABLED must be true or false.");
  if (state.payments.requested && !state.marketplace.requested) errors.push("PAYMENTS_ENABLED requires MARKETPLACE_ENABLED=true.");
  if (state.payments.partial) errors.push(`Stripe payments are partially configured; missing ${state.payments.missing.join(", ")}.`);
  if (state.payments.requested && !state.payments.stripeConfigured) errors.push(`PAYMENTS_ENABLED requires ${state.payments.missing.join(", ")}.`);
  if (present(env, "STRIPE_SECRET_KEY") && !/^sk_test_[A-Za-z0-9_]{16,200}$/.test(env.STRIPE_SECRET_KEY.trim())) errors.push("STRIPE_SECRET_KEY must be a Stripe test secret key; live keys are prohibited by this adapter.");
  if (present(env, "STRIPE_PUBLISHABLE_KEY") && !/^pk_test_[A-Za-z0-9_]{16,200}$/.test(env.STRIPE_PUBLISHABLE_KEY.trim())) errors.push("STRIPE_PUBLISHABLE_KEY must be a Stripe test publishable key; live keys are prohibited by this checkout.");
  if (present(env, "STRIPE_WEBHOOK_SECRET") && !/^whsec_[A-Za-z0-9_]{16,200}$/.test(env.STRIPE_WEBHOOK_SECRET.trim())) errors.push("STRIPE_WEBHOOK_SECRET must be a valid Stripe webhook signing secret.");
  if (present(env, "DATABASE_URL") && !/^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL.trim())) errors.push("DATABASE_URL must use PostgreSQL.");
  if (present(env, "SESSION_SECRET") && !state.sessionConfigured) errors.push("SESSION_SECRET must contain at least 32 characters.");
  if (present(env, "AUTH_TOKEN_SECRET") && !state.authTokenConfigured) errors.push("AUTH_TOKEN_SECRET must contain at least 32 characters.");
  if (state.sessionConfigured && state.authTokenConfigured && env.SESSION_SECRET.trim() === env.AUTH_TOKEN_SECRET.trim()) errors.push("AUTH_TOKEN_SECRET must be different from SESSION_SECRET.");
  if (state.encryptionConfigured && state.sessionConfigured && env.DATA_ENCRYPTION_KEY.trim() === env.SESSION_SECRET.trim()) errors.push("DATA_ENCRYPTION_KEY must be different from SESSION_SECRET.");
  if (state.encryptionConfigured && state.authTokenConfigured && env.DATA_ENCRYPTION_KEY.trim() === env.AUTH_TOKEN_SECRET.trim()) errors.push("DATA_ENCRYPTION_KEY must be different from AUTH_TOKEN_SECRET.");
  if (state.appOrigin) {
    try {
      const origin = new URL(state.appOrigin);
      if (origin.origin !== state.appOrigin.replace(/\/$/, "") || (state.production && origin.protocol !== "https:")) errors.push("APP_ORIGIN must be an exact HTTPS origin in production, with no path or credentials.");
    } catch {
      errors.push("APP_ORIGIN must be a valid absolute origin.");
    }
  }
  if (present(env, "FACEBOOK_GRAPH_API_VERSION") && !/^v\d{1,2}\.\d{1,2}$/.test(env.FACEBOOK_GRAPH_API_VERSION.trim())) errors.push("FACEBOOK_GRAPH_API_VERSION must be explicitly configured as vN.N.");
  if (present(env, "FACEBOOK_APP_ID") && !/^\d{5,32}$/.test(env.FACEBOOK_APP_ID.trim())) errors.push("FACEBOOK_APP_ID must contain only the numeric Meta App ID.");
  if (present(env, "FACEBOOK_APP_SECRET") && !/^[a-f0-9]{32,128}$/i.test(env.FACEBOOK_APP_SECRET.trim())) errors.push("FACEBOOK_APP_SECRET must contain the exact Meta app secret.");
  const objectStorageKeys = ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_REGION", "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY"];
  const suppliedObjectStorage = objectStorageKeys.filter((key) => present(env, key));
  if (suppliedObjectStorage.length > 0 && suppliedObjectStorage.length < objectStorageKeys.length) errors.push(`Object storage is partially configured; missing ${objectStorageKeys.filter((key) => !present(env, key)).join(", ")}.`);
  if (present(env, "OBJECT_STORAGE_ENDPOINT")) {
    try {
      const endpoint = new URL(env.OBJECT_STORAGE_ENDPOINT.trim());
      const local = env.NODE_ENV !== "production" && (endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1");
      if (endpoint.origin !== env.OBJECT_STORAGE_ENDPOINT.trim().replace(/\/$/, "") || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || (!local && endpoint.protocol !== "https:")) throw new Error();
    } catch {
      errors.push("OBJECT_STORAGE_ENDPOINT must be an exact HTTPS origin, or a localhost origin for development.");
    }
  }
  if (present(env, "OBJECT_STORAGE_BUCKET") && (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.OBJECT_STORAGE_BUCKET.trim()) || env.OBJECT_STORAGE_BUCKET.includes("..") || /^\d+\.\d+\.\d+\.\d+$/.test(env.OBJECT_STORAGE_BUCKET.trim()))) errors.push("OBJECT_STORAGE_BUCKET must be a valid DNS-compatible private bucket name.");
  if (present(env, "OBJECT_STORAGE_FORCE_PATH_STYLE") && !["true", "false"].includes(env.OBJECT_STORAGE_FORCE_PATH_STYLE.trim().toLowerCase())) errors.push("OBJECT_STORAGE_FORCE_PATH_STYLE must be true or false.");
  if (present(env, "DATA_ENCRYPTION_KEY") && !state.encryptionConfigured) errors.push("DATA_ENCRYPTION_KEY must contain at least 32 characters.");
  if (state.production) {
    if (!state.appOrigin) errors.push("APP_ORIGIN is required in production.");
    if (state.marketplace.requested) {
      if (!state.databaseConfigured) errors.push("DATABASE_URL is required when the production marketplace is enabled.");
      if (!state.sessionConfigured) errors.push("A 32-character SESSION_SECRET is required when the production marketplace is enabled.");
      if (!state.authTokenConfigured) errors.push("A separate 32-character AUTH_TOKEN_SECRET is required when the production marketplace is enabled.");
      if (!state.encryptionConfigured) errors.push("A 32-character DATA_ENCRYPTION_KEY is required when the production marketplace is enabled.");
    }
  }
  return { ok: errors.length === 0, errors, state };
}

export function publicAuthenticationCapabilities(env = process.env, attachedCapabilities = {}) {
  const { capabilities } = marketplaceEnvironment(env);
  return {
    ...Object.fromEntries(Object.entries(capabilities).map(([name, configured]) => [name, attachedCapabilities?.[name] === true && configured === true])),
    roles: ["cleaner", "landlord"]
  };
}
