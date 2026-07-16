import assert from "node:assert/strict";
import { createDisputeRepository } from "../src/marketplace/dispute-repository.mjs";
import { createDisputeService } from "../src/marketplace/dispute-service.mjs";
import { caseResponsePolicyVersion } from "../src/marketplace/case-response-policy.mjs";

const bookingId = "55555555-5555-4555-8555-555555555555";
const disputeId = "66666666-6666-4666-8666-666666666666";
const requestId = "77777777-7777-4777-8777-777777777777";
const base = { disputeId, bookingId, category: "damage", description: "A kitchen cabinet door was damaged during the visit.", status: "open", resolutionNote: null, resolutionOutcome: null, createdAt: "2026-07-16T10:00:00.000Z", resolvedAt: null };
const calls = [];
const repository = {
  async open(actor, input) { calls.push({ kind: "open", actor, input }); return base; },
  async getForBooking(actor, id) { calls.push({ kind: "get", actor, id }); return base; },
  async listForAdministrator(actor, input) { calls.push({ kind: "list", actor, input }); return { disputes: [{ ...base, openedByRole: "landlord" }], limit: input.limit, offset: input.offset }; },
  async review(actor, id, input) { calls.push({ kind: "review", actor, id, input }); return { ...base, status: input.status, resolutionNote: input.resolutionNote, resolutionOutcome: input.resolutionOutcome, resolvedAt: input.status === "resolved" ? "2026-07-16T11:00:00.000Z" : null }; }
};
const service = createDisputeService(repository, { createId: () => disputeId });
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const admin = { userId: "22222222-2222-4222-8222-222222222222", roles: ["administrator"] };

const opened = await service.open(landlord, bookingId, { requestId, category: " DAMAGE ", description: "  A kitchen cabinet door was damaged during the visit.  " });
assert.equal(opened.status, "open");
assert.deepEqual(calls.at(-1).input, { bookingId, disputeId, requestId, category: "damage", description: base.description });
assert.equal((await service.getForBooking(landlord, bookingId)).disputeId, disputeId);
const queue = await service.listForAdministrator(admin, { status: "OPEN", limit: "25", offset: "0" });
assert.equal(queue.disputes[0].openedByRole, "landlord");
assert.equal(calls.at(-1).input.status, "open");
const resolutionAssurance = { policyVersion: caseResponsePolicyVersion, evidenceReviewed: true, sensitiveDataMinimised: true, noExternalActionConfirmed: true };
const resolved = await service.review(admin, disputeId, { status: "resolved", resolutionNote: "  The evidence was reviewed and a cancellation was recorded.  ", resolutionOutcome: "CANCELLED", ...resolutionAssurance });
assert.equal(resolved.resolutionOutcome, "cancelled");
assert.equal(calls.at(-1).input.resolutionNote, "The evidence was reviewed and a cancellation was recorded.");

for (const input of [
  { requestId: "bad", category: "damage", description: base.description },
  { requestId, category: "invented", description: base.description },
  { requestId, category: "damage", description: "Too short" },
  { requestId, category: "damage", description: `Valid until control ${String.fromCharCode(1)}` }
]) await assert.rejects(service.open(landlord, bookingId, input), /valid|category|description|invalid/i);
await assert.rejects(service.open(admin, bookingId, { requestId, category: "damage", description: base.description }), /authorised booking account/i);
await assert.rejects(service.listForAdministrator(landlord), /Administrator/i);
await assert.rejects(service.review(admin, disputeId, { status: "resolved", resolutionNote: "Too short", resolutionOutcome: "cancelled", ...resolutionAssurance }), /Resolution note/i);
await assert.rejects(service.review(admin, disputeId, { status: "resolved", resolutionNote: "A complete and valid final case explanation.", resolutionOutcome: "refund", ...resolutionAssurance }), /outcome/i);
for (const missing of ["policyVersion", "evidenceReviewed", "sensitiveDataMinimised", "noExternalActionConfirmed"]) {
  const input = { status: "resolved", resolutionNote: "A complete evidence-based final case explanation.", resolutionOutcome: "completed", ...resolutionAssurance };
  delete input[missing];
  await assert.rejects(service.review(admin, disputeId, input), /standard|evidence|data|minimisation|payment|external/i);
}

const databaseCalls = [];
const database = { async withUserTransaction(actor, operation) { return operation({ async query(text, values) { databaseCalls.push({ actor, text, values }); return { rows: [{ result: base }] }; } }); } };
const realRepository = createDisputeRepository(database);
await realRepository.open(landlord, { bookingId, disputeId, requestId, category: "damage", description: base.description });
await realRepository.getForBooking(landlord, bookingId);
await realRepository.listForAdministrator(admin, { status: "open", limit: 50, offset: 0 });
await realRepository.review(admin, disputeId, { status: "reviewing", resolutionNote: null, resolutionOutcome: null });
assert.deepEqual(databaseCalls.map((call) => call.text.match(/tideway_private\.([a-z_]+)/)?.[1]), ["open_booking_dispute", "get_booking_dispute", "list_admin_booking_disputes", "review_booking_dispute"]);

console.log("Booking-case service tests passed: participant-only opening, bounded categories/details, retry identity, server-enforced resolution assurances, administrator queue/resolution and narrow function-only persistence.");
