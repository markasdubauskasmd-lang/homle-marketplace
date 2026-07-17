import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

assert.match(blueprint, /^services:\s*$/m, "Render Blueprint has no service list.");
assert.equal((blueprint.match(/^\s+- type: web\s*$/gm) || []).length, 1, "Preview Blueprint must define exactly one web service.");
assert.doesNotMatch(blueprint, /^\s*(?:databases|envVarGroups):\s*$/m, "Preview Blueprint must not create a database or shared secret group.");
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
assert.equal(environmentEntry("APP_ORIGIN"), "sync: false", "APP_ORIGIN must be supplied from the exact assigned HTTPS service origin.");
assert.equal(environmentEntry("ADMIN_KEY"), "generateValue: true", "The preview Administrator key must be generated, not committed.");
assert.equal(environmentEntry("TRUST_PROXY_PROVIDER"), "value: \"render\"", "Render's verified client-identity mode is not enabled.");
assert.equal(environmentEntry("TRUSTED_PROXY_CIDRS"), "value: \"\"", "Generic trusted proxy networks must remain blank in Render mode.");

for (const secret of ["DATABASE_URL", "SESSION_SECRET", "AUTH_TOKEN_SECRET", "DATA_ENCRYPTION_KEY", "SMTP_URL", "GOOGLE_CLIENT_SECRET", "FACEBOOK_APP_SECRET", "STRIPE_SECRET_KEY", "OBJECT_STORAGE_SECRET_ACCESS_KEY"]) {
  assert.equal(environmentEntry(secret), "", `Preview Blueprint unexpectedly provisions ${secret}.`);
}

console.log("Render Blueprint tests passed: one free Docker preview, manual deploy, no database/worker/disk/domain, generated Administrator key and all intake, marketplace, worker and payment capabilities closed.");
