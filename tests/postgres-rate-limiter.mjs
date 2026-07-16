import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPostgresRateLimiter, postgresRateLimitScopes } from "../src/marketplace/postgres-rate-limiter.mjs";

const calls = [];
let databaseDecision = { allowed: true, retry_after_seconds: 0 };
const pool = {
  async query(text, values) {
    calls.push({ text, values });
    return { rows: databaseDecision == null ? [] : [databaseDecision] };
  }
};
const secret = "rate-limit-test-secret-longer-than-thirty-two-characters";
const limiter = createPostgresRateLimiter(pool, { secret });

const allowed = await limiter.consume({ scope: "login", key: "198.51.100.42" });
assert.deepEqual(allowed, { allowed: true });
assert.match(calls[0].text, /consume_rate_limit\(\$1::text, \$2::bytea\)/);
assert.equal(calls[0].values[0], "login");
assert.ok(Buffer.isBuffer(calls[0].values[1]) && calls[0].values[1].length === 32);
assert.ok(!calls[0].text.includes("198.51.100.42") && !calls[0].values.some((value) => value === "198.51.100.42"), "The trusted client key crossed into PostgreSQL without purpose-bound hashing.");

await limiter.consume({ scope: "login", key: "198.51.100.42" });
const firstLoginHash = calls.at(-1).values[1];
await limiter.consume({ scope: "signup", key: "198.51.100.42" });
assert.ok(firstLoginHash.equals(calls[0].values[1]) && !firstLoginHash.equals(calls.at(-1).values[1]), "Rate-limit hashing was not deterministic within a scope or allowed cross-scope key correlation.");

databaseDecision = { allowed: false, retry_after_seconds: 73 };
assert.deepEqual(await limiter.consume({ scope: "password-reset-request", key: "trusted:client" }), { allowed: false, retryAfterSeconds: 73 });

const callsBeforeInvalid = calls.length;
await assert.rejects(() => limiter.consume({ scope: "unreviewed-scope", key: "trusted:client" }), /no reviewed database policy/);
assert.equal(calls.length, callsBeforeInvalid, "An unreviewed rate-limit scope reached the database.");
databaseDecision = { allowed: "yes", retry_after_seconds: 0 };
await assert.rejects(() => limiter.consume({ scope: "login", key: "trusted:client" }), /invalid decision/);
databaseDecision = { allowed: false, retry_after_seconds: 0 };
await assert.rejects(() => limiter.consume({ scope: "login", key: "trusted:client" }), /invalid retry time/);
assert.throws(() => createPostgresRateLimiter({}, { secret }), /query-capable pool/);
assert.throws(() => createPostgresRateLimiter(pool, { secret: "short" }), /32-character secret/);
assert.equal(postgresRateLimitScopes.length, 13);

const migration = `${await readFile(new URL("../db/migrations/020_shared_rate_limits.sql", import.meta.url), "utf8")}\n${await readFile(new URL("../db/migrations/021_facebook_pending_identity.sql", import.meta.url), "utf8")}`;
const runtimeGrants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const workerGrants = await readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8");
const deploymentVerification = await readFile(new URL("../db/integration/deployment-verification.sql", import.meta.url), "utf8");
const behaviour = await readFile(new URL("../db/integration/marketplace-rls-behaviour.sql", import.meta.url), "utf8");
for (const scope of postgresRateLimitScopes) assert.ok(migration.includes(`'${scope}'`), `PostgreSQL policy omitted ${scope}.`);
for (const required of ["CREATE TABLE tideway_private.request_rate_limits", "PRIMARY KEY (scope, key_hash)", "octet_length(key_hash) = 32", "SECURITY DEFINER", "ON CONFLICT (scope, key_hash) DO UPDATE", "LEAST(existing.request_count + 1, maximum_requests + 1)", "FOR UPDATE SKIP LOCKED", "interval '2 hours'", "REVOKE ALL ON TABLE tideway_private.request_rate_limits FROM PUBLIC", "purge_expired_rate_limits"]) {
  assert.ok(migration.includes(required), `Shared rate-limit migration omitted ${required}.`);
}
assert.ok(runtimeGrants.includes("GRANT EXECUTE ON FUNCTION tideway_private.consume_rate_limit(text,bytea) TO tideway_app") && runtimeGrants.includes("REVOKE ALL ON TABLE tideway_private.request_rate_limits FROM tideway_app"), "Runtime role lacks function-only shared-limiter access.");
assert.ok(workerGrants.includes("GRANT EXECUTE ON FUNCTION tideway_private.purge_expired_rate_limits(integer) TO tideway_worker") && workerGrants.includes("REVOKE ALL ON TABLE tideway_private.request_rate_limits FROM tideway_worker"), "Worker role lacks function-only rate-limit retention access.");
assert.ok(deploymentVerification.includes("rate_limit_ready") || deploymentVerification.includes("consume_rate_limit(text,bytea)"));
assert.ok(deploymentVerification.includes("private rate-limit keys") && behaviour.includes("Shared login limiter failed to deny") && behaviour.includes("Runtime role can read private rate-limit keys"), "Real PostgreSQL verification does not cover limiter grants, privacy and threshold behavior.");

console.log("PostgreSQL rate-limit tests passed: purpose-bound private keys, exact reviewed scopes, atomic bounded policy, malformed-decision denial, function-only roles, retention and real-database behavior harness.");
