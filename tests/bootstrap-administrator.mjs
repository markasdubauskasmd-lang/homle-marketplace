import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { administratorProvisioningConfirmation, prepareAdministratorProvisioning, runAdministratorProvisioning } from "../tools/bootstrap-administrator.mjs";

const connectionUrl = "postgresql://migration_owner:private-password@db.example:5432/tideway?sslmode=verify-full";
const input = {
  connectionUrl,
  email: " Founder@Example.com ",
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  operatorReference: "CHANGE-2026-001",
  reason: "Provision the founder account for audited marketplace operations.",
  confirmation: administratorProvisioningConfirmation
};
const prepared = prepareAdministratorProvisioning(input, { PATH: "safe-path", ADMIN_PROVISION_DATABASE_URL: "must-not-inherit" });
assert.equal(prepared.email, "founder@example.com");
assert.equal(prepared.database.user, "migration_owner");
assert.equal(prepared.database.sslMode, "verify-full");
assert(!JSON.stringify(prepared.database).includes("private-password") && !JSON.stringify(prepared.database).includes("postgresql://"), "Safe provisioning summary exposed database credentials.");

for (const invalid of [
  { confirmation: "yes" },
  { connectionUrl: connectionUrl.replace("migration_owner", "tideway_app") },
  { connectionUrl: connectionUrl.replace("migration_owner", "tideway_worker") },
  { connectionUrl: connectionUrl.replace("verify-full", "require") },
  { email: "invalid" },
  { requestId: "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa" },
  { operatorReference: "short" },
  { reason: "Too short" }
]) assert.throws(() => prepareAdministratorProvisioning({ ...input, ...invalid }));

const calls = [];
let released = false;
let ended = false;
const fakeClient = {
  async query(text, values) {
    calls.push({ text, values });
    if (text.startsWith("SELECT * FROM")) return { rows: [{ provisioning_status: "provisioned", target_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", revoked_session_count: 2, provisioned_at: "2026-07-16T12:00:00.000Z" }] };
    return { rows: [] };
  },
  release() { released = true; }
};
let poolConfiguration;
const result = await runAdministratorProvisioning({
  ...input,
  environment: {},
  async poolFactory(configuration) {
    poolConfiguration = configuration;
    return { async connect() { return fakeClient; }, async end() { ended = true; } };
  }
});
assert.deepEqual(result, { status: "provisioned", sessionsRevoked: 2, provisionedAt: "2026-07-16T12:00:00.000Z", database: "tideway", host: "db.example" });
assert.equal(poolConfiguration.max, 1);
assert.equal(poolConfiguration.connectionString, connectionUrl);
assert.deepEqual(calls.map((call) => call.text), ["BEGIN", "SET LOCAL lock_timeout = '5s'", "SELECT * FROM tideway_private.provision_bootstrap_administrator($1::citext,$2::uuid,$3::text,$4::text)", "COMMIT"]);
assert.deepEqual(calls[2].values, ["founder@example.com", input.requestId, input.operatorReference, input.reason]);
assert(!calls[2].text.includes("founder@example.com") && !calls[2].text.includes(input.reason), "Provisioning query interpolated private operator input.");
assert(released && ended, "Provisioning did not release and close its database resources.");

const failureCalls = [];
let failureReleased = false;
let failureEnded = false;
await assert.rejects(runAdministratorProvisioning({
  ...input,
  environment: {},
  async poolFactory() {
    return {
      async connect() { return { async query(text) { failureCalls.push(text); if (text.startsWith("SELECT")) throw new Error("safe-test-failure"); return { rows: [] }; }, release() { failureReleased = true; } }; },
      async end() { failureEnded = true; }
    };
  }
}), /safe-test-failure/);
assert.equal(failureCalls.at(-1), "ROLLBACK");
assert(failureReleased && failureEnded, "Failed provisioning did not roll back and close resources.");

const [migration, appleEligibilityMigration, runtimeGrants, workerGrants, packageJson] = await Promise.all([
  readFile(new URL("../db/migrations/034_bootstrap_administrator_provisioning.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/067_apple_administrator_bootstrap.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);
assert(migration.includes("session_user::text <> owner_name") && migration.includes("administrator-already-provisioned") && migration.includes("administrator-bootstrap-account-ineligible"), "Bootstrap function lost owner-only, first-only or verified-account checks.");
assert(migration.includes("provider IN ('password','google','facebook')") && migration.includes("SET revoked_at=COALESCE(revoked_at,now())") && migration.includes("administrator.bootstrap.provisioned"), "Bootstrap function lost supported-identity, session-revocation or audit evidence.");
assert(appleEligibilityMigration.includes("CREATE OR REPLACE FUNCTION tideway_private.provision_bootstrap_administrator") && appleEligibilityMigration.includes("provider IN ('password','google','apple','facebook')") && appleEligibilityMigration.includes("session_user::text <> owner_name") && appleEligibilityMigration.includes("administrator.bootstrap.provisioned"), "Current bootstrap function does not give a verified Apple identity the same owner-only audited eligibility as the other account providers.");
assert(migration.includes("audit_logs_administrator_bootstrap_request_idx") && migration.includes("already-provisioned") && migration.includes("administrator-bootstrap-request-reused"), "Bootstrap retries are not exact or idempotent.");
assert(runtimeGrants.includes("REVOKE ALL ON FUNCTION tideway_private.provision_bootstrap_administrator") && workerGrants.includes("REVOKE ALL ON FUNCTION tideway_private.provision_bootstrap_administrator"), "A restricted runtime role can provision an Administrator.");
assert(packageJson.includes('"provision:administrator"') && packageJson.includes('"test:administrator-provisioning"') && packageJson.includes("tests/bootstrap-administrator.mjs"), "Administrator provisioning is outside repository quality gates.");

console.log("Administrator provisioning tests passed: exact confirmation, owner-only connection, verified existing account, first-only audit, session revocation, idempotency, parameterized input and resource cleanup.");
