const renderApiOrigin = "https://api.render.com";
const pageLimit = 100;
const maximumPages = 20;

const accountSecretKeys = Object.freeze([
  "DATABASE_BOOTSTRAP_URL",
  "TIDEWAY_APP_PASSWORD",
  "TIDEWAY_WORKER_PASSWORD",
  "SESSION_SECRET",
  "AUTH_TOKEN_SECRET",
  "DATA_ENCRYPTION_KEY",
  "ADMIN_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "STAGING_ACCOUNT_EMAIL_SHA256"
]);

const objectStorageKeys = Object.freeze([
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY"
]);

const stripeTestKeys = Object.freeze([
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET"
]);

function exact(value) {
  return typeof value === "string" ? value.trim() : "";
}

function valueMap(entries) {
  if (!Array.isArray(entries)) throw new TypeError("Render environment entries must be an array.");
  const values = new Map();
  for (const entry of entries) {
    const key = exact(entry?.key);
    if (!key || !Object.hasOwn(entry || {}, "value") || typeof entry.value !== "string") throw new TypeError("Render environment entries require string key and value fields.");
    if (values.has(key)) throw new TypeError(`Render environment contains duplicate key ${key}.`);
    values.set(key, entry.value);
  }
  return values;
}

function missingPresentKeys(values, keys) {
  return keys.filter((key) => !exact(values.get(key)));
}

function exactFlag(values, key, expected) {
  return exact(values.get(key)).toLowerCase() === expected;
}

function exactPublicOrigin(value) {
  const supplied = exact(value);
  try {
    const parsed = new URL(supplied);
    return parsed.protocol === "https:" && parsed.origin === supplied && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

function validPostgresUrl(value) {
  try {
    const parsed = new URL(exact(value));
    return /^postgres(?:ql)?:$/.test(parsed.protocol) && Boolean(parsed.hostname && parsed.username && parsed.pathname.slice(1));
  } catch {
    return false;
  }
}

function approvedFingerprintList(value) {
  const supplied = exact(value).toLowerCase();
  if (!supplied) return false;
  const entries = supplied.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 && entries.length <= 20 && new Set(entries).size === entries.length && entries.every((entry) => /^[a-f0-9]{64}$/.test(entry));
}

function testStripeConfigured(values) {
  if (missingPresentKeys(values, stripeTestKeys).length) return false;
  return exact(values.get("STRIPE_SECRET_KEY")).startsWith("sk_test_")
    && exact(values.get("STRIPE_PUBLISHABLE_KEY")).startsWith("pk_test_")
    && exact(values.get("STRIPE_WEBHOOK_SECRET")).startsWith("whsec_");
}

function nextAction(missing, checks) {
  if (missing.accounts.length) return Object.freeze({ key: "account-boundary", label: "Repair the restricted account boundary", missing: missing.accounts });
  if (!checks.safeAccountPreview) return Object.freeze({ key: "preview-safety", label: "Close unsafe preview feature flags", missing: ["restricted account-only feature flags"] });
  if (missing.transactionalEmail.length) return Object.freeze({ key: "transactional-email", label: "Connect a verified transactional email sender", missing: missing.transactionalEmail });
  if (missing.privateMedia.length) return Object.freeze({ key: "private-media", label: "Connect private room-photo storage", missing: missing.privateMedia });
  if (!checks.testPaymentsConfigured) return Object.freeze({ key: "test-payments", label: "Connect Stripe test mode after marketplace staging passes", missing: missing.testPayments });
  return Object.freeze({ key: "managed-staging-proof", label: "Run the guarded managed-staging activation proof", missing: [] });
}

export function renderEnvironmentActivationReport(entries) {
  const values = valueMap(entries);
  const missingAccounts = missingPresentKeys(values, accountSecretKeys);
  if (!exactPublicOrigin(values.get("APP_ORIGIN"))) missingAccounts.push("valid APP_ORIGIN");
  if (exact(values.get("DATABASE_BOOTSTRAP_URL")) && !validPostgresUrl(values.get("DATABASE_BOOTSTRAP_URL"))) missingAccounts.push("valid DATABASE_BOOTSTRAP_URL");
  if (exact(values.get("STAGING_ACCOUNT_EMAIL_SHA256")) && !approvedFingerprintList(values.get("STAGING_ACCOUNT_EMAIL_SHA256"))) missingAccounts.push("valid STAGING_ACCOUNT_EMAIL_SHA256");
  for (const key of ["TIDEWAY_APP_PASSWORD", "TIDEWAY_WORKER_PASSWORD", "SESSION_SECRET", "AUTH_TOKEN_SECRET", "DATA_ENCRYPTION_KEY", "ADMIN_KEY"]) {
    const supplied = exact(values.get(key));
    if (supplied && (supplied.length < 32 || supplied.length > 512)) missingAccounts.push(`${key} with 32-512 characters`);
  }
  const trustSecrets = ["TIDEWAY_APP_PASSWORD", "TIDEWAY_WORKER_PASSWORD", "SESSION_SECRET", "AUTH_TOKEN_SECRET", "DATA_ENCRYPTION_KEY", "ADMIN_KEY"].map((key) => exact(values.get(key))).filter(Boolean);
  if (new Set(trustSecrets).size !== trustSecrets.length) missingAccounts.push("distinct database, session, token, encryption and Administrator secrets");
  if (!/^[0-9a-f]{8}$/i.test(exact(values.get("TIDEWAY_EXPECT_RELEASE")))) missingAccounts.push("valid TIDEWAY_EXPECT_RELEASE");
  if (exact(values.get("TIDEWAY_EXPECT_SOCIAL_PROVIDERS")).toLowerCase() !== "google") missingAccounts.push("TIDEWAY_EXPECT_SOCIAL_PROVIDERS=google");
  if (exact(values.get("MARKETPLACE_ADAPTER_MODULE")) !== "homle:render-log-monitoring") missingAccounts.push("MARKETPLACE_ADAPTER_MODULE");
  if (!exactFlag(values, "RENDER_LOG_MONITORING_ACKNOWLEDGED", "true")) missingAccounts.push("RENDER_LOG_MONITORING_ACKNOWLEDGED=true");

  const emailProvider = exact(values.get("RESEND_API_KEY")) ? "resend" : exact(values.get("SMTP_URL")) ? "smtp" : null;
  const transactionalEmailMissing = [
    ...(!emailProvider ? ["RESEND_API_KEY or SMTP_URL"] : []),
    ...(!exact(values.get("EMAIL_FROM")) ? ["EMAIL_FROM"] : [])
  ];
  const privateMediaMissing = missingPresentKeys(values, objectStorageKeys);
  const testPaymentsMissing = testStripeConfigured(values) ? [] : stripeTestKeys;

  const checks = Object.freeze({
    stagingAccountsRestricted: exactFlag(values, "STAGING_ACCOUNTS_ONLY", "true"),
    authenticationEnabled: exactFlag(values, "AUTHENTICATION_ENABLED", "true"),
    marketplaceClosed: exactFlag(values, "MARKETPLACE_ENABLED", "false"),
    paymentsClosed: exactFlag(values, "PAYMENTS_ENABLED", "false"),
    pilotIntakeClosed: exactFlag(values, "PILOT_INTAKE_ENABLED", "false"),
    automaticDispatchClosed: exactFlag(values, "WORKER_AUTOMATIC_DISPATCH_ENABLED", "false"),
    accountConfigurationComplete: missingAccounts.length === 0,
    transactionalEmailConfigured: transactionalEmailMissing.length === 0,
    privateMediaConfigured: privateMediaMissing.length === 0,
    testPaymentsConfigured: testPaymentsMissing.length === 0,
    safeAccountPreview: false
  });
  const safeAccountPreview = checks.stagingAccountsRestricted && checks.authenticationEnabled && checks.marketplaceClosed && checks.paymentsClosed && checks.pilotIntakeClosed && checks.automaticDispatchClosed;
  const finalizedChecks = Object.freeze({ ...checks, safeAccountPreview });
  const missing = Object.freeze({
    accounts: Object.freeze([...new Set(missingAccounts)]),
    transactionalEmail: Object.freeze(transactionalEmailMissing),
    privateMedia: Object.freeze(privateMediaMissing),
    testPayments: Object.freeze(testPaymentsMissing)
  });

  return Object.freeze({
    ok: finalizedChecks.accountConfigurationComplete && finalizedChecks.safeAccountPreview,
    environmentCount: values.size,
    mode: finalizedChecks.safeAccountPreview ? "restricted-account-preview" : "unsafe-or-incomplete",
    checks: finalizedChecks,
    activation: Object.freeze({
      accounts: finalizedChecks.accountConfigurationComplete && finalizedChecks.safeAccountPreview,
      marketplaceDependencies: finalizedChecks.accountConfigurationComplete && finalizedChecks.transactionalEmailConfigured && finalizedChecks.privateMediaConfigured,
      testPaymentDependencies: finalizedChecks.testPaymentsConfigured
    }),
    missing,
    next: nextAction(missing, finalizedChecks)
  });
}

function renderServiceId(value) {
  const supplied = exact(value);
  if (!/^srv-[a-z0-9]+$/i.test(supplied)) throw new TypeError("HOMLE_RENDER_SERVICE_ID must be a valid Render service ID.");
  return supplied;
}

function renderApiKey(value) {
  const supplied = exact(value);
  if (supplied.length < 20 || /\s/.test(supplied)) throw new TypeError("RENDER_API_KEY must be supplied privately.");
  return supplied;
}

export async function listRenderServiceEnvironment(options = {}) {
  const serviceId = renderServiceId(options.serviceId);
  const apiKey = renderApiKey(options.apiKey);
  const fetchImpl = options.fetchImpl || fetch;
  const entries = [];
  const cursors = new Set();
  let cursor = "";

  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
    const url = new URL(`/v1/services/${encodeURIComponent(serviceId)}/env-vars`, renderApiOrigin);
    url.searchParams.set("limit", String(pageLimit));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: options.signal || AbortSignal.timeout(15_000),
      headers: Object.freeze({ Accept: "application/json", Authorization: `Bearer ${apiKey}` })
    });
    if (!response?.ok) throw new Error(`Render environment inventory failed with HTTP ${Number(response?.status) || 0}.`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new TypeError("Render environment inventory returned an invalid page.");
    for (const item of page) {
      const entry = item?.envVar || item;
      entries.push(Object.freeze({ key: exact(entry?.key), value: typeof entry?.value === "string" ? entry.value : null }));
    }
    if (page.length < pageLimit) return Object.freeze(entries);
    const nextCursor = exact(page.at(-1)?.cursor);
    if (!nextCursor || cursors.has(nextCursor)) throw new Error("Render environment inventory pagination did not advance; no replacement is safe.");
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error("Render environment inventory exceeded the safe pagination limit.");
}
