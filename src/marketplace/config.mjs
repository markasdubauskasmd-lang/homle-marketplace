const providerRequirements = Object.freeze({
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  apple: ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
  facebook: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]
});

function present(env, key) {
  return typeof env[key] === "string" && env[key].trim().length > 0;
}

function providerState(env, keys) {
  const supplied = keys.filter((key) => present(env, key));
  return { enabled: supplied.length === keys.length, partial: supplied.length > 0 && supplied.length < keys.length, missing: keys.filter((key) => !present(env, key)) };
}

export function marketplaceEnvironment(env = process.env) {
  const providers = Object.fromEntries(Object.entries(providerRequirements).map(([name, keys]) => [name, providerState(env, keys)]));
  const databaseConfigured = present(env, "DATABASE_URL");
  const sessionConfigured = present(env, "SESSION_SECRET") && env.SESSION_SECRET.trim().length >= 32;
  const authTokenConfigured = present(env, "AUTH_TOKEN_SECRET") && env.AUTH_TOKEN_SECRET.trim().length >= 32;
  const emailConfigured = present(env, "SMTP_URL") && present(env, "EMAIL_FROM");
  const appOrigin = present(env, "APP_ORIGIN") ? env.APP_ORIGIN.trim() : "";
  const objectStorageConfigured = ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY"].every((key) => present(env, key));
  const encryptionConfigured = present(env, "DATA_ENCRYPTION_KEY") && env.DATA_ENCRYPTION_KEY.trim().length >= 32;
  return {
    production: env.NODE_ENV === "production",
    databaseConfigured,
    sessionConfigured,
    authTokenConfigured,
    emailConfigured,
    appOrigin,
    objectStorageConfigured,
    encryptionConfigured,
    providers,
    capabilities: {
      emailPassword: databaseConfigured && sessionConfigured && authTokenConfigured && emailConfigured && Boolean(appOrigin),
      passwordReset: databaseConfigured && sessionConfigured && authTokenConfigured && emailConfigured && Boolean(appOrigin),
      emailVerification: databaseConfigured && sessionConfigured && authTokenConfigured && emailConfigured && Boolean(appOrigin),
      google: databaseConfigured && sessionConfigured && Boolean(appOrigin) && providers.google.enabled,
      apple: databaseConfigured && sessionConfigured && Boolean(appOrigin) && providers.apple.enabled,
      facebook: databaseConfigured && sessionConfigured && Boolean(appOrigin) && providers.facebook.enabled
    }
  };
}

export function validateMarketplaceEnvironment(env = process.env) {
  const state = marketplaceEnvironment(env);
  const errors = [];
  for (const [provider, status] of Object.entries(state.providers)) {
    if (status.partial) errors.push(`${provider} sign-in is partially configured; missing ${status.missing.join(", ")}.`);
  }
  if (present(env, "DATABASE_URL") && !/^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL.trim())) errors.push("DATABASE_URL must use PostgreSQL.");
  if (present(env, "SESSION_SECRET") && !state.sessionConfigured) errors.push("SESSION_SECRET must contain at least 32 characters.");
  if (present(env, "AUTH_TOKEN_SECRET") && !state.authTokenConfigured) errors.push("AUTH_TOKEN_SECRET must contain at least 32 characters.");
  if (state.sessionConfigured && state.authTokenConfigured && env.SESSION_SECRET.trim() === env.AUTH_TOKEN_SECRET.trim()) errors.push("AUTH_TOKEN_SECRET must be different from SESSION_SECRET.");
  if (state.appOrigin) {
    try {
      const origin = new URL(state.appOrigin);
      if (origin.origin !== state.appOrigin.replace(/\/$/, "") || (state.production && origin.protocol !== "https:")) errors.push("APP_ORIGIN must be an exact HTTPS origin in production, with no path or credentials.");
    } catch {
      errors.push("APP_ORIGIN must be a valid absolute origin.");
    }
  }
  const objectStorageKeys = ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY"];
  const suppliedObjectStorage = objectStorageKeys.filter((key) => present(env, key));
  if (suppliedObjectStorage.length > 0 && suppliedObjectStorage.length < objectStorageKeys.length) errors.push(`Object storage is partially configured; missing ${objectStorageKeys.filter((key) => !present(env, key)).join(", ")}.`);
  if (present(env, "DATA_ENCRYPTION_KEY") && !state.encryptionConfigured) errors.push("DATA_ENCRYPTION_KEY must contain at least 32 characters.");
  if (state.production) {
    if (!state.databaseConfigured) errors.push("DATABASE_URL is required in production.");
    if (!state.sessionConfigured) errors.push("A 32-character SESSION_SECRET is required in production.");
    if (!state.authTokenConfigured) errors.push("A separate 32-character AUTH_TOKEN_SECRET is required in production.");
    if (!state.appOrigin) errors.push("APP_ORIGIN is required in production.");
    if (!state.encryptionConfigured) errors.push("A 32-character DATA_ENCRYPTION_KEY is required in production.");
  }
  return { ok: errors.length === 0, errors, state };
}

export function publicAuthenticationCapabilities(env = process.env, runtimeReady = false) {
  const { capabilities } = marketplaceEnvironment(env);
  return {
    ...Object.fromEntries(Object.entries(capabilities).map(([name, configured]) => [name, runtimeReady === true && configured === true])),
    roles: ["cleaner", "landlord"]
  };
}
