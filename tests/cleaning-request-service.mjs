import { readFile } from "node:fs/promises";
import { createCleaningRequestRepository } from "../src/marketplace/cleaning-request-repository.mjs";
import { cleaningRequestScopeFingerprint, createCleaningRequestService, normalizedCleaningRequest } from "../src/marketplace/cleaning-request-service.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function throws(operation, fragment) {
  try { operation(); } catch (error) { return String(error.message).includes(fragment); }
  return false;
}

async function rejects(operation, fragment) {
  try { await operation(); } catch (error) { return String(error.message).includes(fragment); }
  return false;
}

const now = new Date("2026-07-15T14:00:00.000Z");
const landlordId = "11111111-1111-4111-8111-111111111111";
const propertyId = "44444444-4444-4444-8444-444444444444";
const requestId = "66666666-6666-4666-8666-666666666666";
const input = {
  id: requestId,
  propertyId,
  requestedStartAt: "2026-07-20T09:00:00.000Z",
  requestedEndAt: "2026-07-20T12:00:00.000Z",
  cleaningType: "rental-turnovers",
  requiredServices: ["rental-turnovers", "deep-cleans"],
  specialInstructions: "Focus on the kitchen before the inventory appointment.",
  budgetPence: 15000,
  frequency: "fortnightly",
  tasks: [
    { roomName: "Kitchen", description: "Clean worktops and cupboard fronts" },
    { roomName: "Bathroom", description: "Descale the shower and taps" }
  ]
};
const canonical = normalizedCleaningRequest(input, { clock: () => new Date(now) });
assert(canonical.id === requestId && canonical.status === "searching-for-cleaner" && canonical.submittedAt === now.toISOString() && canonical.recurrenceRule === "FREQ=WEEKLY;INTERVAL=2" && canonical.requiredServices.join(",") === "deep-cleans,rental-turnovers" && canonical.tasks[1].sortOrder === 1 && /^[0-9a-f]{64}$/.test(canonical.scopeFingerprint), "Cleaning request did not reach canonical submitted scope.");
const stable = normalizedCleaningRequest({ ...input, requiredServices: [...input.requiredServices].reverse(), specialInstructions: `  ${input.specialInstructions}  ` }, { clock: () => new Date(now) });
const changed = normalizedCleaningRequest({ ...input, tasks: [{ ...input.tasks[0], description: "Clean inside every cupboard" }, input.tasks[1]] }, { clock: () => new Date(now) });
assert(stable.scopeFingerprint === canonical.scopeFingerprint && changed.scopeFingerprint !== canonical.scopeFingerprint && cleaningRequestScopeFingerprint(canonical) === canonical.scopeFingerprint, "Request fingerprint changed with harmless ordering/whitespace or ignored a real task change.");
const draft = normalizedCleaningRequest({ ...input, submit: false, frequency: "one-time" }, { clock: () => new Date(now) });
assert(draft.status === "draft" && draft.submittedAt === null && draft.recurrenceRule === null, "A deliberate request draft appeared submitted or recurring.");
assert(
  throws(() => normalizedCleaningRequest({ ...input, requestedStartAt: "2026-07-14T09:00:00.000Z" }, { clock: () => new Date(now) }), "future")
  && throws(() => normalizedCleaningRequest({ ...input, requestedEndAt: "2026-07-20T09:15:00.000Z" }, { clock: () => new Date(now) }), "30 minutes")
  && throws(() => normalizedCleaningRequest({ ...input, requestedStartAt: "2026-02-30T09:00:00.000Z" }, { clock: () => new Date("2026-01-01T00:00:00.000Z") }), "valid timestamp")
  && throws(() => normalizedCleaningRequest({ ...input, requiredServices: ["invented-service"] }, { clock: () => new Date(now) }), "supported and unique")
  && throws(() => normalizedCleaningRequest({ ...input, cleaningType: "regular-domestic" }, { clock: () => new Date(now) }), "included")
   && throws(() => normalizedCleaningRequest({ ...input, tasks: [input.tasks[0], { ...input.tasks[0], roomName: "kitchen" }] }, { clock: () => new Date(now) }), "unique")
  && throws(() => normalizedCleaningRequest({ ...input, tasks: [{ roomName: "Kitchen", description: "clean everything" }] }, { clock: () => new Date(now) }), "specific Cleaner action")
   && throws(() => normalizedCleaningRequest({ ...input, frequency: "daily" }, { clock: () => new Date(now) }), "supported"),
  "Invalid time, service, task or recurrence entered a cleaning request."
);

function row(record) {
  return {
    id: record.id,
    property_id: record.propertyId,
    status: record.status,
    requested_start_at: record.requestedStartAt,
    requested_end_at: record.requestedEndAt,
    cleaning_type: record.cleaningType,
    required_services: record.requiredServices,
    special_instructions: record.specialInstructions,
    budget_pence: record.budgetPence,
    recurrence_rule: record.recurrenceRule,
    scope_fingerprint: record.scopeFingerprint,
    submitted_at: record.submittedAt,
    created_at: now.toISOString(),
    automatic_dispatch_authorized_at: null,
    automatic_dispatch_revoked_at: null,
    automatic_dispatch_attempt_limit: null,
    automatic_dispatch_attempt_count: 0,
    automatic_dispatch_next_attempt_at: null,
    automatic_dispatch_last_result: null,
    tasks: record.tasks
  };
}

const calls = [];
let stored;
const fakeRepository = {
  async createOwnRequest(actor, record) { calls.push({ kind: "create", actor, record }); stored = row(record); return stored; },
  async listOwnRequests(actor) { calls.push({ kind: "list", actor }); return [stored]; },
  async submitOwnRequest(actor, suppliedRequestId, choice) { calls.push({ kind: "submit", actor, suppliedRequestId, choice }); return { cleaningRequestId: suppliedRequestId, status: "searching-for-cleaner", submittedAt: now.toISOString(), scopeConfirmedAt: now.toISOString(), cleanerPreviewAuthorized: choice.cleanerPreviewAuthorized, photoCount: 2, taskCount: 2 }; },
  async configureAutomaticDispatch(actor, suppliedRequestId, choice) { calls.push({ kind: "dispatch", actor, suppliedRequestId, choice }); return { cleaningRequestId: suppliedRequestId, enabled: choice.enabled, attemptLimit: choice.attemptLimit, attemptCount: 0, maximumCustomerPricePence: choice.approvedMaximumPricePence, authorizedAt: choice.enabled ? now.toISOString() : null, lastResult: choice.enabled ? "authorized" : null }; },
  async withdrawOwnRequest(actor, suppliedRequestId, choice) { calls.push({ kind: "withdraw", actor, suppliedRequestId, choice }); return { cleaningRequestId: suppliedRequestId, status: "cancelled", previousStatus: "searching-for-cleaner", reasonCode: choice.reasonCode, withdrawnAt: now.toISOString() }; }
};
const service = createCleaningRequestService(fakeRepository, { clock: () => new Date(now) });
const landlord = { userId: landlordId, roles: ["landlord"] };
const created = await service.createOwnRequest(landlord, { ...input, landlordUserId: "22222222-2222-4222-8222-222222222222" });
const listed = await service.listOwnRequests(landlord);
const submitted = await service.submitOwnRequest(landlord, requestId, { scopeReviewed: true, cleanerPreviewAuthorized: true });
const dispatch = await service.configureAutomaticDispatch(landlord, requestId, { enabled: true, attemptLimit: 3, approvedMaximumPricePence: 15000 });
assert(calls[0].actor.userId === landlordId && calls[0].record.status === "draft" && !Object.hasOwn(calls[0].record, "landlordUserId") && created.requestId === requestId && created.tasks.length === 2 && listed[0].scopeFingerprint === canonical.scopeFingerprint && listed[0].automaticDispatch.enabled === false && !Object.hasOwn(created, "landlordUserId"), "Cleaning-request service trusted a submitted owner, bypassed the private-draft boundary, lost frozen scope or leaked its owner field.");
assert(submitted.status === "searching-for-cleaner" && submitted.photoCount === 2 && calls.at(-2).kind === "submit" && calls.at(-2).choice.cleanerPreviewAuthorized === true, "Reviewed room-scan submission was not explicit, owner-bound or safely projected.");
assert(dispatch.enabled && dispatch.attemptLimit === 3 && dispatch.maximumCustomerPricePence === 15000 && calls.at(-1).kind === "dispatch" && calls.at(-1).actor.userId === landlordId && calls.at(-1).choice.approvedMaximumPricePence === 15000, "Explicit Landlord automatic-matching consent was not owner-bound, price-capped or safely projected.");
const withdrawn = await service.withdrawOwnRequest(landlord, requestId, { reasonCode: "date-changed" });
assert(withdrawn.status === "cancelled" && withdrawn.previousStatus === "searching-for-cleaner" && withdrawn.reasonCode === "date-changed" && calls.at(-1).kind === "withdraw" && calls.at(-1).actor.userId === landlordId, "Pre-booking withdrawal was not explicit, owner-bound or safely projected.");
assert(await rejects(() => service.createOwnRequest({ userId: "cleaner", roles: ["cleaner"] }, input), "Landlord account"), "A Cleaner could create a Landlord cleaning request.");
assert(await rejects(() => service.submitOwnRequest(landlord, requestId, { scopeReviewed: false, cleanerPreviewAuthorized: false }), "Review and confirm") && await rejects(() => service.submitOwnRequest(landlord, requestId, { scopeReviewed: true }), "Choose whether"), "Request submission accepted missing scope review or an implicit photo-preview choice.");
assert(await rejects(() => service.configureAutomaticDispatch({ userId: "cleaner", roles: ["cleaner"] }, requestId, { enabled: true }), "Landlord account") && await rejects(() => service.configureAutomaticDispatch(landlord, requestId, { enabled: "yes" }), "Choose whether") && await rejects(() => service.configureAutomaticDispatch(landlord, requestId, { enabled: true, attemptLimit: 6 }), "between 1 and 5") && await rejects(() => service.configureAutomaticDispatch(landlord, requestId, { enabled: true, attemptLimit: 1 }), "approve the maximum"), "Automatic matching accepted the wrong role, implicit consent, an unbounded attempt limit or a missing price approval.");
assert(await rejects(() => service.withdrawOwnRequest({ userId: "cleaner", roles: ["cleaner"] }, requestId, { reasonCode: "other" }), "Landlord account") && await rejects(() => service.withdrawOwnRequest(landlord, requestId, { reasonCode: "invented" }), "supported reason"), "Request withdrawal accepted the wrong role or an invented reason.");

const databaseCalls = [];
let propertyOwned = true;
let dispatchBudgetPence = 15000;
const database = {
  async withUserTransaction(actor, operation) {
    return operation({ async query(text, values) {
      databaseCalls.push({ actor, text, values });
      if (text.startsWith("SELECT id FROM properties")) return { rows: propertyOwned ? [{ id: propertyId }] : [] };
      if (text.startsWith("INSERT INTO cleaning_requests")) return { rows: [row(canonical)] };
      if (text.startsWith("SELECT request.*")) return { rows: [row(canonical)] };
      if (text.startsWith("SELECT tideway_private.submit_cleaning_request")) return { rows: [{ submission: { cleaningRequestId: requestId, status: "searching-for-cleaner", submittedAt: now.toISOString(), scopeConfirmedAt: now.toISOString(), cleanerPreviewAuthorized: false, photoCount: 2, taskCount: 2 } }] };
      if (text.startsWith("SELECT budget_pence")) return { rows: [{ budget_pence: dispatchBudgetPence }] };
      if (text.startsWith("SELECT tideway_private.configure_automatic_dispatch")) return { rows: [{ dispatch: { cleaningRequestId: requestId, enabled: true, attemptLimit: 3, attemptCount: 0, authorizedAt: now.toISOString(), lastResult: "authorized" } }] };
      if (text.startsWith("SELECT tideway_private.withdraw_cleaning_request")) return { rows: [{ withdrawal: { cleaningRequestId: requestId, status: "cancelled", previousStatus: "searching-for-cleaner", reasonCode: "no-longer-needed", withdrawnAt: now.toISOString() } }] };
      return { rows: [] };
    } });
  }
};
const repository = createCleaningRequestRepository(database);
await repository.createOwnRequest(landlord, canonical);
await repository.listOwnRequests(landlord);
await repository.submitOwnRequest(landlord, requestId, { scopeReviewed: true, cleanerPreviewAuthorized: false });
const repositoryDispatch = await repository.configureAutomaticDispatch(landlord, requestId, { enabled: true, attemptLimit: 3, approvedMaximumPricePence: 15000 });
await repository.withdrawOwnRequest(landlord, requestId, { reasonCode: "no-longer-needed" });
assert(repositoryDispatch.maximumCustomerPricePence === 15000 && databaseCalls[0].text.includes("id=$1::uuid AND landlord_user_id=$2::uuid") && databaseCalls[0].values[1] === landlordId && databaseCalls[1].values[1] === landlordId && databaseCalls[2].text.includes("unnest($2::text[], $3::text[], $4::integer[])") && databaseCalls[3].text.includes("cleaning_request_status_history") && databaseCalls[3].values[2] === landlordId && databaseCalls[4].text.includes("request.landlord_user_id=$1::uuid") && databaseCalls[5].text.includes("submit_cleaning_request($1::uuid,$2::boolean,$3::boolean)") && databaseCalls[6].text.includes("SELECT budget_pence") && databaseCalls[6].values[1] === landlordId && databaseCalls[7].text.includes("configure_automatic_dispatch($1::uuid,$2::boolean,$3::smallint)") && databaseCalls[8].text.includes("withdraw_cleaning_request($1::uuid,$2::text)") && databaseCalls[8].values[1] === "no-longer-needed", "Cleaning-request repository did not atomically verify the owner-approved maximum, parameterize writes or preserve the function-only request lifecycle.");
dispatchBudgetPence = 14000;
assert(await rejects(() => repository.configureAutomaticDispatch(landlord, requestId, { enabled: true, attemptLimit: 1, approvedMaximumPricePence: 15000 }), "approved maximum does not match"), "Automatic matching could be authorized after the saved request maximum changed.");
propertyOwned = false;
assert(await rejects(() => repository.createOwnRequest(landlord, canonical), "Property was not found"), "A Landlord could create a request against another account's property.");

const migration = await readFile(new URL("../db/migrations/008_account_cleaning_requests.sql", import.meta.url), "utf8");
const scanMigration = await readFile(new URL("../db/migrations/030_private_request_room_scans.sql", import.meta.url), "utf8");
const withdrawalMigration = await readFile(new URL("../db/migrations/045_owner_request_withdrawal.sql", import.meta.url), "utf8");
const rls = await readFile(new URL("../db/migrations/002_marketplace_row_level_security.sql", import.meta.url), "utf8");
assert(migration.includes("cleaning_request_status_history") && migration.includes("request_history_owner_or_admin") && migration.includes("scope_fingerprint") && migration.includes("digest(concat_ws") && migration.includes("submitted_at") && migration.includes("UPDATE cleaning_requests SET status = CASE status"), "Request migration omitted safe legacy backfill, immutable scope evidence, submission state or owner-only audit history.");
assert(rls.includes("requests_owner_or_admin") && rls.includes("request_tasks_owner_or_admin"), "Cleaning request or room tasks lack row-level owner authorization.");
for (const required of ["submit_cleaning_request", "scope_reviewed IS NOT TRUE", "request-scan-incomplete", "submission_review_version=1", "cleaning_requests_reviewed_submission_guard", "scan_fingerprint", "customer_scope_confirmed_at", "cleaner_preview_authorized", "cleaning-request-submitted"]) assert(scanMigration.includes(required), `Reviewed request submission migration omitted ${required}.`);
for (const required of ["withdraw_cleaning_request", "request_record.status NOT IN ('draft','searching-for-cleaner')", "booking.status<>'cancelled'", "automatic_dispatch_next_attempt_at=NULL", "cleaning_request_status_history", "cleaning-request-withdrawn", "reasonCode", "REVOKE ALL ON FUNCTION"]) assert(withdrawalMigration.includes(required), `Owner request-withdrawal migration omitted ${required}.`);

console.log("Cleaning request tests passed: validated future scope, recurrence, room tasks, stable fingerprinting, owner-bound property writes, auditable submission/withdrawal and private projections.");
