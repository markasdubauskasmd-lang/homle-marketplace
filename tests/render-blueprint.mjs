import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

assert.match(blueprint, /^services:\s*$/m, "Render Blueprint has no service list.");
assert.equal((blueprint.match(/^\s+- type: web\s*$/gm) || []).length, 1, "Preview Blueprint must define exactly one web service.");
assert.equal((blueprint.match(/^databases:\s*$/gm) || []).length, 1, "Staging Blueprint must define one database list.");
assert.match(blueprint, /^\s+- name: homle-marketplace-staging-db\s*$/m, "Staging Blueprint omitted the approved database.");
assert.match(blueprint, /^\s+databaseName: homle_marketplace_homle_staging\s*$/m, "Staging database name must retain the guarded _homle_staging suffix.");
assert.match(blueprint, /^\s+user: homle_migration_owner\s*$/m, "Staging database must use a distinct migration owner.");
assert.match(blueprint, /^\s+postgresMajorVersion: "16"\s*$/m, "Staging database must use the tested PostgreSQL 16 boundary.");
assert.match(blueprint, /^\s+ipAllowList: \[\]\s*$/m, "Staging database must reject public network connections.");
assert.equal((blueprint.match(/^\s+plan: free\s*$/gm) || []).length, 2, "Only the approved free web and free database plans may be created.");
assert.equal((blueprint.match(/^\s+region: frankfurt\s*$/gm) || []).length, 2, "Web and database resources must share the Frankfurt region.");
assert.doesNotMatch(blueprint, /^\s*envVarGroups:\s*$/m, "Staging Blueprint must not create a shared secret group.");
assert.doesNotMatch(blueprint, /^\s+- type: (?:worker|cron|pserv)\s*$/m, "Preview Blueprint must not create a paid or background service.");
assert.doesNotMatch(blueprint, /^\s*(?:disk|domains|preDeployCommand|initialDeployHook):/m, "Preview Blueprint must not attach storage, publish a domain or run a mutating hook.");

for (const required of [
  "runtime: docker",
  "plan: free",
  "region: frankfurt",
  "branch: main",
  "autoDeployTrigger: \"off\"",
  "dockerfilePath: ./Dockerfile",
  "dockerContext: .",
  "dockerCommand: node scripts/render-staging-entrypoint.mjs",
  "healthCheckPath: /api/health"
]) assert(blueprint.includes(required), `Render Blueprint omitted ${required}.`);

function environmentEntry(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = blueprint.match(new RegExp(`^\\s+- key: ${escaped}\\s*\\r?\\n\\s+(value: (?:\\"[^\\"]*\\"|[^\\r\\n]+)|sync: false|generateValue: true)\\s*$`, "m"));
  return match?.[1] || "";
}

for (const key of ["PILOT_INTAKE_ENABLED", "MARKETPLACE_ENABLED", "MARKETPLACE_WORKER_ENABLED", "WORKER_EMAIL_ENABLED", "WORKER_MEDIA_ENABLED", "WORKER_AUTOMATIC_DISPATCH_ENABLED", "PAYMENTS_ENABLED"]) {
  assert.equal(environmentEntry(key), "value: \"false\"", `${key} must be explicitly false in the preview Blueprint.`);
}
assert.equal(environmentEntry("APP_ORIGIN"), 'value: "https://homle-marketplace-preview.onrender.com"', "APP_ORIGIN must match the assigned HTTPS preview origin without a manual secret step.");
assert.equal(environmentEntry("RENDER_STAGING_BOOTSTRAP_ENABLED"), 'value: "true"', "The staging database bootstrap must require an explicit deployment flag.");
assert.equal(environmentEntry("STAGING_ACCOUNTS_ONLY"), 'value: "true"', "The public preview must deny all account creation until approved email fingerprints are added privately.");
assert.equal(environmentEntry("STAGING_ACCOUNT_EMAIL_SHA256"), "", "Approved staging email fingerprints must not be committed to the Blueprint.");
assert.equal(environmentEntry("ADMIN_KEY"), "generateValue: true", "The preview Administrator key must be generated, not committed.");
assert.equal(environmentEntry("TIDEWAY_APP_PASSWORD"), "generateValue: true", "The restricted app-role password must be generated, not committed.");
assert.equal(environmentEntry("TIDEWAY_WORKER_PASSWORD"), "generateValue: true", "The restricted worker-role password must be generated, not committed.");
assert.equal(environmentEntry("SESSION_SECRET"), "generateValue: true", "The preview session secret must be independently generated, not committed or manually copied.");
assert.equal(environmentEntry("AUTH_TOKEN_SECRET"), "generateValue: true", "The preview authentication-token secret must be independently generated, not committed or manually copied.");
assert.equal(environmentEntry("DATA_ENCRYPTION_KEY"), "generateValue: true", "The preview property-encryption key must be independently generated, not committed or manually copied.");
assert.equal(environmentEntry("TRUST_PROXY_PROVIDER"), "value: \"render\"", "Render's verified client-identity mode is not enabled.");
assert.equal(environmentEntry("TRUSTED_PROXY_CIDRS"), "value: \"\"", "Generic trusted proxy networks must remain blank in Render mode.");
assert.equal(environmentEntry("MARKETPLACE_ADAPTER_MODULE"), "value: \"homle:render-log-monitoring\"", "The free preview must have privacy-minimal operational monitoring prepared before marketplace activation.");
assert.equal(environmentEntry("RENDER_LOG_MONITORING_ACKNOWLEDGED"), "value: \"false\"", "The Blueprint must not invent a restricted-log-access acknowledgement on the owner's behalf.");

for (const secret of ["DATABASE_URL", "REALTIME_DATABASE_URL", "SMTP_URL", "GOOGLE_CLIENT_SECRET", "FACEBOOK_APP_SECRET", "STRIPE_SECRET_KEY", "OBJECT_STORAGE_SECRET_ACCESS_KEY"]) {
  assert.equal(environmentEntry(secret), "", `Preview Blueprint unexpectedly provisions ${secret}.`);
}
assert.match(blueprint, /^\s+- key: DATABASE_BOOTSTRAP_URL\s*\r?\n\s+fromDatabase:\s*\r?\n\s+name: homle-marketplace-staging-db\s*\r?\n\s+property: connectionString\s*$/m, "The guarded bootstrap does not use Render's private database connection reference.");

console.log("Render Blueprint tests passed: one free Docker web service plus one isolated free PostgreSQL 16 staging database, guarded one-time schema bootstrap, no worker/disk/domain, generated secrets and all public marketplace/payment capabilities closed.");
