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
await assert.rejects(() => service.list({ roles: ["landlord"] }), /signed-in Homle account/);

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

// Fulfilment. Intake has existed since migration 035 and nothing could read
// it: a statutory request was written to a table nobody looked at, while UK
// GDPR's one-month clock ran. A request nobody can see is a breach on a timer.
{
  const { readFile } = await import("node:fs/promises");
  const { createPrivacyRequestService: buildService } = await import("../src/marketplace/privacy-request-service.mjs");
  const administrator = { userId: "11111111-1111-4111-8111-111111111111", roles: ["administrator"] };
  const customer = { userId: "22222222-2222-4222-8222-222222222222", roles: ["landlord"] };
  const requestId = "33333333-3333-4333-8333-333333333333";
  const queueRow = {
    requestId,
    accountId: customer.userId,
    email: "person@example.com",
    requestType: "export",
    status: "requested",
    createdAt: "2026-09-01T09:00:00.000Z",
    verifiedAt: null,
    completedAt: null,
    dueAt: "2026-10-01T09:00:00.000Z",
    overdue: true
  };
  const calls = [];
  const repository = {
    async list() { return []; },
    async request() { return { requestId, requestType: "export", status: "requested", createdAt: queueRow.createdAt }; },
    async listForAdministrator(actor, input) { calls.push({ kind: "list", actor, input }); return { requests: [queueRow], openCount: 1, overdueCount: 1, limit: 50, offset: 0 }; },
    async recordProgress(actor, input) { calls.push({ kind: "progress", actor, input }); return { requestId, requestType: "export", status: input.status, createdAt: queueRow.createdAt, completedAt: "2026-09-20T10:00:00.000Z" }; }
  };
  const service = buildService(repository);

  const queue = await service.listForAdministrator(administrator, {});
  if (queue.requests.length !== 1 || queue.openCount !== 1 || queue.overdueCount !== 1) throw new Error("The data-protection queue does not report outstanding statutory work.");
  // The deadline is the point of the queue. A reader must not have to work it out.
  if (queue.requests[0].dueAt !== queueRow.dueAt || queue.requests[0].overdue !== true) throw new Error("The queue does not surface the one-month statutory deadline.");
  if (queue.requests[0].email !== "person@example.com") throw new Error("The queue omits the verified address a subject access response must be sent to.");

  // The queue is for scheduling statutory work, not for browsing customers.
  const projected = Object.keys(queue.requests[0]);
  for (const forbidden of ["displayName", "avatarUrl", "phone", "address", "passwordHash"]) {
    if (projected.includes(forbidden)) throw new Error(`The data-protection queue projects ${forbidden}, which answering a request does not require.`);
  }

  for (const stranger of [customer, { userId: customer.userId, roles: [] }, {}]) {
    let refused = false;
    try { await service.listForAdministrator(stranger, {}); } catch (error) { refused = true; if (error.code && error.code !== "administrator-required") throw new Error("The wrong refusal was given for a non-administrator queue read."); }
    if (!refused) throw new Error("A non-administrator read every account's data-protection requests.");
    refused = false;
    try { await service.recordProgress(stranger, requestId, { status: "completed" }); } catch { refused = true; }
    if (!refused) throw new Error("A non-administrator closed a data-protection request.");
  }

  const progressed = await service.recordProgress(administrator, requestId, { status: "processing" });
  if (progressed.status !== "processing") throw new Error("A data-protection request could not be moved through its lifecycle.");

  // Refusing somebody's statutory request is a decision that has to be
  // explained, to them and to a regulator asking why.
  let rejectedWithoutReason = false;
  try { await service.recordProgress(administrator, requestId, { status: "rejected" }); } catch { rejectedWithoutReason = true; }
  if (!rejectedWithoutReason) throw new Error("A data-protection request was refused with no recorded reason.");
  const refusedWithReason = await service.recordProgress(administrator, requestId, { status: "rejected", note: "Identity could not be verified." });
  if (refusedWithReason.status !== "rejected") throw new Error("A reasoned refusal was not recorded.");

  for (const invalid of ["requested", "deleted", "", "nonsense"]) {
    let threw = false;
    try { await service.recordProgress(administrator, requestId, { status: invalid, note: "x" }); } catch { threw = true; }
    if (!threw) throw new Error(`Status ${invalid || "(blank)"} was accepted as a fulfilment step.`);
  }

  const migration = await readFile(new URL("../db/migrations/118_privacy_request_fulfilment.sql", import.meta.url), "utf8");
  for (const required of ["list_privacy_requests_for_administrator", "record_privacy_request_progress", "administrator-required", "privacy-rejection-reason-required", "privacy-request-already-closed", "interval '1 month'", "audit_logs", "GRANT EXECUTE"]) {
    if (!migration.includes(required)) throw new Error(`The data-protection fulfilment migration omitted ${required}.`);
  }
  // A finished request stays finished: reopening restarts a statutory clock
  // that has already been answered.
  if (!/status IN \('completed','rejected'\)[\s\S]{0,200}privacy-request-already-closed/.test(migration)) throw new Error("A closed data-protection request can be reopened.");
  // Every progression is attributable. "Who decided, and when" is the first
  // thing a regulator asks.
  if (!/INSERT INTO audit_logs[\s\S]{0,400}actor_id/.test(migration)) throw new Error("A data-protection decision is recorded without who made it.");
  // The table has no updated_at column; writing one would fail at runtime.
  if (/UPDATE privacy_requests[\s\S]{0,300}updated_at/.test(migration)) throw new Error("The fulfilment update writes a column privacy_requests does not have.");

  const httpSource = await readFile(new URL("../src/marketplace/marketplace-http.mjs", import.meta.url), "utf8");
  if (!/admin\/privacy-requests"[\s\S]{0,200}roles: \["administrator"\]/.test(httpSource)) throw new Error("The data-protection queue route is missing or is not administrator-only.");
  if (!/adminPrivacyRequestPath[\s\S]{0,300}roles: \["administrator"\]/.test(httpSource)) throw new Error("The fulfilment route is missing or is not administrator-only.");

  console.log("Data-protection fulfilment tests passed: an administrator can see outstanding requests with their statutory deadline, move one through its lifecycle, and cannot refuse one without a recorded reason or reopen one already answered.");
}

// The subject access response itself. The queue made a request visible and
// answerable; this is what actually answers it.
{
  const { readFile } = await import("node:fs/promises");
  const { createPrivacyRequestService: buildExportService } = await import("../src/marketplace/privacy-request-service.mjs");
  const customer = { userId: "44444444-4444-4444-8444-444444444444", roles: ["landlord"] };
  const baseRepository = { async list() { return []; }, async request() { return { requestId: "55555555-5555-4555-8555-555555555555", requestType: "export", status: "requested", createdAt: "2026-09-01T09:00:00.000Z" }; } };

  let sawActor = null;
  const withExport = buildExportService(baseRepository, {
    assembleExport: async (actor) => { sawActor = actor; return { generatedAt: "2026-09-20T10:00:00.000Z", accountId: actor.userId, sections: { properties: [] } }; }
  });
  const document = await withExport.buildExport(customer);
  if (document.accountId !== customer.userId || sawExportActorWrong(sawActor, customer)) throw new Error("The export was not assembled for the requesting account.");
  function sawExportActorWrong(seen, expected) { return !seen || seen.userId !== expected.userId; }

  let refused = false;
  try { await withExport.buildExport({}); } catch { refused = true; }
  if (!refused) throw new Error("An unauthenticated caller could download an export.");

  // A deployment without the assembler must say so rather than return an empty
  // document that looks like "Homle holds nothing about you".
  const withoutExport = buildExportService(baseRepository);
  let unavailable = false;
  try { await withoutExport.buildExport(customer); } catch (error) { unavailable = error?.code === "export-unavailable"; }
  if (!unavailable) throw new Error("A deployment with no export assembler returns something rather than admitting it cannot.");

  const runtimeSource = await readFile(new URL("../src/marketplace/runtime.mjs", import.meta.url), "utf8");
  // Assembled from the requester's own authenticated reads, so it cannot
  // contain a field those screens would not and cannot reach another person's
  // records — the projections already decided both, and they are tested.
  for (const ownRead of ["propertyService.listOwnProperties(actor)", "cleaningRequestService.listOwnRequests(actor)", "bookingWorkflowService.listParticipantBookings(actor", "notificationService.listNotifications(actor"]) {
    if (!runtimeSource.includes(ownRead)) throw new Error(`The export does not include ${ownRead}, or reads it by some route other than the owner-scoped service.`);
  }
  // Sections follow the roles the account holds. Reporting a Landlord's
  // non-existent Cleaner profile as "unavailable" would read as "Homle is
  // holding something it will not show you", which is the opposite of what a
  // subject access response is for.
  if (!/roles\.includes\(role\)/.test(runtimeSource)) throw new Error("The export asks for sections the account's roles cannot have, and reports the refusal as withheld data.");
  if (!/\["cleanerProfile"[\s\S]{0,80}"cleaner"\]/.test(runtimeSource)) throw new Error("Cleaner sections are not gated on the cleaner role.");
  if (!/\["properties"[\s\S]{0,80}"landlord"\]/.test(runtimeSource)) throw new Error("Landlord sections are not gated on the landlord role.");
  // A failing section must not fail the whole response. A partial export inside
  // the statutory month, saying which part is missing, beats a complete one
  // that arrives late.
  if (!/exportSection[\s\S]{0,200}unavailable: true/.test(runtimeSource)) throw new Error("One failing section takes the whole subject access response down with it.");
  // Downloaded, not emailed: a complete personal record must not be sent to an
  // address nobody re-verified.
  const httpSource = await readFile(new URL("../src/marketplace/marketplace-http.mjs", import.meta.url), "utf8");
  if (!/privacy-requests\/export"[\s\S]{0,400}Content-Disposition/.test(httpSource)) throw new Error("The export is not delivered as a download.");
  if (/privacy-requests\/export"[\s\S]{0,400}emailDelivery/.test(httpSource)) throw new Error("The export is emailed rather than downloaded.");
  console.log("Data export tests passed: a signed-in person can download their own record, assembled from their own authenticated reads, with a failing section admitted rather than silently omitted and nothing emailed.");
}
