import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProductionDeployment } from "../deployment-readiness.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "tideway-production-readiness-"));
const dataDirectory = path.join(fixtureRoot, "private-data");
const port = 4387;
let serverProcess = null;
const safePilot = Object.freeze({
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: String(port),
  LAN_PORT: "0",
  APP_ORIGIN: "https://tideway.example.com",
  DATA_DIR: dataDirectory,
  ADMIN_REQUIRE_KEY: "true",
  ADMIN_KEY: "unit-test-admin-secret-with-32-characters",
  PILOT_INTAKE_ENABLED: "false",
  TRUST_PROXY: "true",
  TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
  MARKETPLACE_ENABLED: "false",
  PAYMENTS_ENABLED: "false"
});

function invalid(change) {
  return validateProductionDeployment({ ...safePilot, ...change }, { projectRoot });
}

async function waitForStart(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Production server did not start. ${output}`)), 10_000);
    const onExit = (code) => { clearTimeout(timer); reject(new Error(`Production server exited before readiness (${code}). ${output}`)); };
    const onOutput = (chunk) => {
      output += chunk;
      if (output.includes("Homle is running")) {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.stdout.off("data", onOutput);
        resolve();
      }
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", onExit);
  });
}

async function directRequest(pathname, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path: pathname, method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

try {
  const pilot = validateProductionDeployment(safePilot, { projectRoot });
  assert.equal(pilot.ok, true, pilot.errors.join("\n"));
  assert.equal(pilot.mode, "public-site");
  assert.equal(pilot.marketplaceEnabled, false);
  assert.equal(pilot.paymentsEnabled, false);
  assert.equal(pilot.pilotIntakeEnabled, false);
  assert(!JSON.stringify(pilot).includes(safePilot.ADMIN_KEY), "Production readiness exposed the Administrator secret.");

  const renderPilot = validateProductionDeployment({
    ...safePilot,
    HOST: "0.0.0.0",
    TRUST_PROXY_PROVIDER: "render",
    TRUSTED_PROXY_CIDRS: "",
    RENDER: "true",
    RENDER_SERVICE_ID: "srv-abcdef123456",
    RENDER_EXTERNAL_HOSTNAME: "homle-marketplace.onrender.com"
  }, { projectRoot });
  assert.equal(renderPilot.ok, true, renderPilot.errors.join("\n"));
  assert.equal(renderPilot.checks.trustedProxy, true);

  for (const [change, evidence] of [
    [{ NODE_ENV: "development" }, "NODE_ENV"],
    [{ APP_ORIGIN: "http://tideway.example.com" }, "HTTPS"],
    [{ APP_ORIGIN: "https://127.0.0.1" }, "domain"],
    [{ DATA_DIR: path.join(projectRoot, "private-data") }, "outside the deployed source"],
    [{ DATA_DIR: path.join(path.parse(projectRoot).root, "OneDrive", "Homle") }, "OneDrive"],
    [{ ADMIN_REQUIRE_KEY: "false" }, "ADMIN_REQUIRE_KEY"],
    [{ ADMIN_KEY: "short" }, "ADMIN_KEY"],
    [{ PILOT_INTAKE_ENABLED: "" }, "PILOT_INTAKE_ENABLED"],
    [{ TRUST_PROXY: "false" }, "TRUST_PROXY"],
    [{ TRUSTED_PROXY_CIDRS: "not-a-network" }, "valid IP"],
    [{ TRUST_PROXY_PROVIDER: "render", TRUSTED_PROXY_CIDRS: "", RENDER: "false", RENDER_SERVICE_ID: "srv-abcdef123456", RENDER_EXTERNAL_HOSTNAME: "homle-marketplace.onrender.com" }, "production Render"],
    [{ LAN_PORT: "4174" }, "LAN_PORT"],
    [{ PORT: "0" }, "PORT"],
    [{ MARKETPLACE_ENABLED: "" }, "MARKETPLACE_ENABLED"],
    [{ PILOT_INTAKE_ENABLED: "true", MARKETPLACE_ENABLED: "true" }, "one private-data system"],
    [{ PAYMENTS_ENABLED: "" }, "PAYMENTS_ENABLED"],
    [{ MARKETPLACE_ENABLED: "false", PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: `sk_test_${"a".repeat(32)}`, STRIPE_PUBLISHABLE_KEY: `pk_test_${"b".repeat(32)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"c".repeat(32)}` }, "MARKETPLACE_ENABLED"]
  ]) {
    const result = invalid(change);
    assert.equal(result.ok, false, `Unsafe deployment change was accepted: ${JSON.stringify(change)}`);
    assert(result.errors.some((error) => error.includes(evidence)), `Unsafe deployment did not report ${evidence}: ${result.errors.join(" ")}`);
  }

  const marketplace = validateProductionDeployment({
    ...safePilot,
    MARKETPLACE_ENABLED: "true",
    DATABASE_URL: "postgresql://tideway_app:private@db.example.com/tideway",
    REALTIME_DATABASE_URL: "postgresql://tideway_app:private@db-direct.example.com/tideway",
    SESSION_SECRET: "session-secret-with-at-least-32-characters",
    AUTH_TOKEN_SECRET: "different-auth-secret-with-at-least-32-chars",
    DATA_ENCRYPTION_KEY: "third-encryption-secret-with-32-characters",
    SMTP_URL: "smtps://mailer.example.com:465",
    EMAIL_FROM: "Homle <no-reply@example.com>",
    OBJECT_STORAGE_ENDPOINT: "https://objects.example.com",
    OBJECT_STORAGE_BUCKET: "tideway-private-media",
    OBJECT_STORAGE_REGION: "eu-west-2",
    OBJECT_STORAGE_ACCESS_KEY_ID: "private-access-key",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "private-storage-secret",
    MARKETPLACE_ADAPTER_MODULE: path.join(projectRoot, "deployment", "monitoring-adapter.mjs")
  }, { projectRoot });
  assert.equal(marketplace.ok, true, marketplace.errors.join("\n"));
  assert.equal(marketplace.mode, "marketplace");
  const builtInMonitoringEnvironment = {
    ...safePilot,
    MARKETPLACE_ENABLED: "true",
    DATABASE_URL: "postgresql://tideway_app:private@db.example.com/tideway",
    REALTIME_DATABASE_URL: "postgresql://tideway_app:private@db-direct.example.com/tideway",
    SESSION_SECRET: "session-secret-with-at-least-32-characters",
    AUTH_TOKEN_SECRET: "different-auth-secret-with-at-least-32-chars",
    DATA_ENCRYPTION_KEY: "another-distinct-encryption-secret-32-chars",
    SMTP_URL: "smtps://smtp.example.com",
    EMAIL_FROM: "Homle <test@example.com>",
    OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
    OBJECT_STORAGE_BUCKET: "homle-private-staging",
    OBJECT_STORAGE_REGION: "eu-west-2",
    OBJECT_STORAGE_ACCESS_KEY_ID: "private-access-key",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "private-storage-secret",
    MARKETPLACE_ADAPTER_MODULE: "homle:monitoring-webhook",
    MONITORING_WEBHOOK_URL: "https://monitoring.example.com/homle/events",
    MONITORING_WEBHOOK_TOKEN: "private-monitoring-token-with-32-characters"
  };
  const builtInMonitoring = validateProductionDeployment(builtInMonitoringEnvironment, { projectRoot });
  assert.equal(builtInMonitoring.ok, true, builtInMonitoring.errors.join("\n"));
  const missingBuiltInMonitoring = validateProductionDeployment({ ...builtInMonitoringEnvironment, MONITORING_WEBHOOK_URL: "", MONITORING_WEBHOOK_TOKEN: "" }, { projectRoot });
  assert.equal(missingBuiltInMonitoring.ok, false);
  assert(missingBuiltInMonitoring.errors.some((error) => error.includes("MONITORING_WEBHOOK_URL")));
  const renderLogEnvironment = {
    ...builtInMonitoringEnvironment,
    MARKETPLACE_ADAPTER_MODULE: "homle:render-log-monitoring",
    MONITORING_WEBHOOK_URL: "",
    MONITORING_WEBHOOK_TOKEN: "",
    RENDER: "true",
    RENDER_SERVICE_TYPE: "web",
    RENDER_LOG_MONITORING_ACKNOWLEDGED: "true"
  };
  const renderLogMonitoring = validateProductionDeployment(renderLogEnvironment, { projectRoot });
  assert.equal(renderLogMonitoring.ok, true, renderLogMonitoring.errors.join("\n"));
  const unacknowledgedRenderLogs = validateProductionDeployment({ ...renderLogEnvironment, RENDER_LOG_MONITORING_ACKNOWLEDGED: "false" }, { projectRoot });
  assert.equal(unacknowledgedRenderLogs.ok, false);
  assert(unacknowledgedRenderLogs.errors.some((error) => error.includes("RENDER_LOG_MONITORING_ACKNOWLEDGED")));

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    env: {
      SYSTEMROOT: process.env.SYSTEMROOT,
      PATH: process.env.PATH,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      ...safePilot
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProcess = child;
  await waitForStart(child);
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { "X-Forwarded-For": "198.51.100.10" } });
  const health = await response.json();
  assert.equal(response.status, 200);
  assert.equal(health.ok, true);
  assert.deepEqual(health.release, { source: "unidentified", sourceCommit: null, builtAt: null, migrationCount: null });
  assert.equal(health.marketplace.enabled, false);
  assert.equal(health.pilot.intakeEnabled, false);
  assert.equal(health.localDemosEnabled, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const productionHomepage = await fetch(`http://127.0.0.1:${port}/`, { headers: { "X-Forwarded-For": "198.51.100.10" } });
  const productionCsp = productionHomepage.headers.get("content-security-policy") || "";
  assert.equal(productionHomepage.status, 200);
  for (const directive of ["default-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
    assert(productionCsp.includes(directive), `Production homepage CSP omitted ${directive}.`);
  }
  assert.equal(productionHomepage.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  const canonicalRedirect = await directRequest("/request?source=www", { "Host": "www.tideway.example.com", "X-Forwarded-For": "198.51.100.10" });
  assert.equal(canonicalRedirect.status, 308);
  assert.equal(canonicalRedirect.headers.location, "https://tideway.example.com/request?source=www");
  assert.equal(canonicalRedirect.headers["cache-control"], "public, max-age=300");
  const canonicalHead = await directRequest("/brief", { "Host": "www.tideway.example.com", "X-Forwarded-For": "198.51.100.10" }, "HEAD");
  assert.equal(canonicalHead.status, 308);
  assert.equal(canonicalHead.headers.location, "https://tideway.example.com/brief");
  assert.equal(canonicalHead.body, "");
  const nonCanonicalMutation = await directRequest("/api/cleaning-requests", { "Host": "www.tideway.example.com", "X-Forwarded-For": "198.51.100.10" }, "POST");
  assert.equal(nonCanonicalMutation.status, 403);
  assert.notEqual(nonCanonicalMutation.headers.location, "https://tideway.example.com/api/cleaning-requests");
  const canonicalApi = await directRequest("/api/health", { "Host": "tideway.example.com", "X-Forwarded-For": "198.51.100.10" });
  assert.equal(canonicalApi.status, 200);
  assert.equal(JSON.parse(canonicalApi.body).ok, true);
  const readOnlyMutation = await directRequest("/api/cleaning-requests", { "Host": "tideway.example.com", "Origin": "https://tideway.example.com", "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.10", "X-Forwarded-Proto": "https" }, "POST");
  assert.equal(readOnlyMutation.status, 503);
  assert.match(JSON.parse(readOnlyMutation.body).error, /read-only preview/i);
  const providersResponse = await fetch(`http://127.0.0.1:${port}/api/auth/providers`, { headers: { "X-Forwarded-For": "198.51.100.10" } });
  const providers = await providersResponse.json();
  assert.equal(providersResponse.status, 200);
  assert.equal(providers.providers.emailPassword, false);
  assert.equal(providers.providers.google, false);
  assert.equal(providers.providers.facebook, false);
  assert.equal(providers.providers.apple, false);
  for (const [method, pathname] of [["GET", "/tracking-test"], ["GET", "/tracking-test.html"], ["GET", "/tracking-test.js"], ["POST", "/api/tracking-test/session"]]) {
    const localDemo = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers: { "X-Forwarded-For": "198.51.100.10" } });
    assert.equal(localDemo.status, 404, `${method} ${pathname} exposed a local location-test utility in production.`);
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;

  console.log("Production deployment readiness tests passed: read-only detached preview, canonical www redirect, mutation isolation, public HTTPS origin, private data location, protected admin, trusted proxy, disabled local preview and marketplace-specific gates.");
} finally {
  if (serverProcess?.exitCode === null && serverProcess?.signalCode === null) {
    const exited = new Promise((resolve) => serverProcess.once("exit", resolve));
    serverProcess.kill();
    await exited;
  }
  await rm(fixtureRoot, { recursive: true, force: true });
}
