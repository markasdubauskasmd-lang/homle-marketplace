import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPrivacyRequestRepository } from "../src/marketplace/privacy-request-repository.mjs";
import { createPrivacyRequestService } from "../src/marketplace/privacy-request-service.mjs";

const actor = Object.freeze({ userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] });
const createdAt = "2026-07-16T14:30:00.000Z";
const calls = [];
const repository = {
  async list(selectedActor) { calls.push({ kind: "list", actor: selectedActor }); return [{ requestId: "22222222-2222-4222-8222-222222222222", requestType: "export", status: "requested", createdAt, verifiedAt: null, completedAt: null }]; },
  async request(selectedActor, input) { calls.push({ kind: "request", actor: selectedActor, input }); return { requestId: input.requestId, requestType: input.requestType, status: "requested", createdAt, verifiedAt: null, completedAt: null, created: true }; }
};
const service = createPrivacyRequestService(repository);
const listed = await service.list(actor);
assert.equal(listed.length, 1);
assert.equal(listed[0].requestType, "export");
assert.ok(Object.isFrozen(listed) && Object.isFrozen(listed[0]));
const requested = await service.request(actor, { requestId: "33333333-3333-4333-8333-333333333333", requestType: "DELETION" });
assert.equal(requested.requestType, "deletion");
assert.equal(requested.created, true);
assert.equal(calls.at(-1).input.requestId, "33333333-3333-4333-8333-333333333333");
await assert.rejects(() => service.request(actor, { requestId: "not-a-uuid", requestType: "export" }), /valid privacy request retry id/);
await assert.rejects(() => service.request(actor, { requestId: "33333333-3333-4333-8333-333333333333", requestType: "erase-everything" }), /Choose data export or account deletion/);
await assert.rejects(() => service.list({ roles: ["landlord"] }), /signed-in Tideway account/);

let captured;
const repositoryBoundary = createPrivacyRequestRepository({
  async withUserTransaction(selectedActor, operation) {
    captured = { selectedActor };
    return operation({ async query(text, values) { captured = { ...captured, text, values }; return { rows: [{ result: { ok: true } }] }; } });
  }
});
await repositoryBoundary.request(actor, { requestId: "44444444-4444-4444-8444-444444444444", requestType: "export" });
assert.match(captured.text, /request_my_privacy_action\(\$1::uuid,\$2::text\)/);
assert.deepEqual(captured.values, ["44444444-4444-4444-8444-444444444444", "export"]);
await repositoryBoundary.list(actor);
assert.match(captured.text, /get_my_privacy_requests\(\)/);

const [migration, grants] = await Promise.all([
  readFile(new URL("../db/migrations/035_account_privacy_request_intake.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8")
]);
assert.ok(migration.includes("privacy_requests_one_active_type_per_user_idx") && migration.includes("pg_advisory_xact_lock") && migration.includes("privacy-request.created") && migration.includes("LIMIT 20"), "Privacy intake migration omitted concurrency safety, audit evidence or bounded owner history.");
assert.ok(grants.includes("request_my_privacy_action(uuid,text)") && grants.includes("REVOKE SELECT, INSERT, UPDATE, DELETE ON privacy_requests"), "Privacy requests are not confined to the actor-bound function boundary.");

console.log("Privacy request tests passed: authenticated validation, safe projections, retry identity, function-only writes, active-request concurrency and audit evidence.");
