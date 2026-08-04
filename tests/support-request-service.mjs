import assert from "node:assert/strict";
import { createSupportRequestService } from "../src/marketplace/support-request-service.mjs";

const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const administrator = { userId: "33333333-3333-4333-8333-333333333333", roles: ["administrator"] };
const supportRequestId = "44444444-4444-4444-8444-444444444444";
const retryId = "55555555-5555-4555-8555-555555555555";
const bookingId = "66666666-6666-4666-8666-666666666666";
const proposedStartAt = "2026-08-12T09:00:00.000Z";
const calls = [];
const base = {
  supportRequestId,
  category: "room-scan",
  subject: "The room camera will not start",
  description: "The camera permission is allowed, but the room scanner remains on the loading state.",
  status: "open",
  resolutionSummary: null,
  createdAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-30T10:00:00.000Z",
  resolvedAt: null
};
const repository = {
  async create(actor, input) { calls.push({ kind: "create", actor, input }); return base; },
  async createBookingChange(actor, input) { calls.push({ kind: "create-booking-change", actor, input }); return { ...base, category: "booking-change", subject: "Request to reschedule confirmed booking", bookingId, bookingChangeKind: input.bookingChangeKind, proposedStartAt: input.proposedStartAt }; },
  async listOwn(actor, input) { calls.push({ kind: "list-own", actor, input }); return { supportRequests: [base], limit: input.limit, offset: input.offset }; },
  async listForAdministrator(actor, input) { calls.push({ kind: "list-admin", actor, input }); return { supportRequests: [base], limit: input.limit, offset: input.offset }; },
  async review(actor, id, input) {
    calls.push({ kind: "review", actor, id, input });
    return input.status === "reviewing"
      ? { ...base, status: "reviewing", updatedAt: "2026-07-30T10:05:00.000Z" }
      : { ...base, status: "resolved", resolutionSummary: input.resolutionSummary, updatedAt: "2026-07-30T10:10:00.000Z", resolvedAt: "2026-07-30T10:10:00.000Z" };
  }
};
const service = createSupportRequestService(repository, { createId: () => supportRequestId, clock: () => new Date("2026-08-04T09:00:00.000Z") });

const created = await service.create(landlord, {
  clientRequestId: retryId,
  category: "room-scan",
  subject: base.subject,
  description: base.description,
  confirmNoSensitiveData: true
});
assert.equal(created.supportRequestId, supportRequestId);
assert.deepEqual(calls.at(-1).input, { supportRequestId, clientRequestId: retryId, category: "room-scan", subject: base.subject, description: base.description });

const bookingChange = await service.create(landlord, {
  clientRequestId: retryId,
  category: "booking-change",
  bookingId,
  bookingChangeKind: "reschedule",
  proposedStartAt,
  description: "Please move this booking to the proposed morning because the property will be available then.",
  confirmNoSensitiveData: true
});
assert.equal(bookingChange.bookingId, bookingId);
assert.equal(bookingChange.bookingChangeKind, "reschedule");
assert.deepEqual(calls.at(-1).input, { supportRequestId, clientRequestId: retryId, bookingId, bookingChangeKind: "reschedule", proposedStartAt, description: "Please move this booking to the proposed morning because the property will be available then." });
await assert.rejects(() => service.create(landlord, { clientRequestId: retryId, category: "booking-change", bookingId, bookingChangeKind: "reschedule", proposedStartAt: "2026-07-01T09:00:00.000Z", description: "Please move this booking to the proposed morning because the property will be available then.", confirmNoSensitiveData: true }), /within the next year/);

await assert.rejects(() => service.create(cleaner, { clientRequestId: retryId }), (error) => error.statusCode === 403 && error.code === "landlord-required");
await assert.rejects(() => service.create(landlord, {
  clientRequestId: retryId,
  category: "room-scan",
  subject: base.subject,
  description: "The door code is 1234 and the camera fails after that.",
  confirmNoSensitiveData: true
}), /Remove passwords, access codes/);
await assert.rejects(() => service.create(landlord, {
  clientRequestId: retryId,
  category: "room-scan",
  subject: base.subject,
  description: "The payment failed for 4242 4242 4242 4242 after the scan.",
  confirmNoSensitiveData: true
}), /Remove passwords, access codes/);
await service.create(landlord, {
  clientRequestId: retryId,
  category: "booking-preparation",
  subject: "Booking reference 123456 needs checking",
  description: "The requested date was 30/07/2026 for two rooms, but the draft still shows 31/07/2026.",
  confirmNoSensitiveData: true
});
await assert.rejects(() => service.create(landlord, {
  clientRequestId: retryId,
  category: "room-scan",
  subject: base.subject,
  description: base.description,
  confirmNoSensitiveData: false
}), /Confirm that the request contains no access codes/);
await assert.rejects(() => service.create(landlord, {
  clientRequestId: retryId,
  category: "unsupported",
  subject: base.subject,
  description: base.description,
  confirmNoSensitiveData: true
}), /Choose what you need help with/);

const own = await service.listOwn(landlord, {});
assert.equal(own.supportRequests.length, 1);
assert.equal(calls.at(-1).input.limit, 25);
await assert.rejects(() => service.listOwn(cleaner), (error) => error.statusCode === 403 && error.code === "landlord-required");

const adminPage = await service.listForAdministrator(administrator, { status: "open", category: "room-scan", limit: 20 });
assert.equal(adminPage.supportRequests[0].category, "room-scan");
assert.deepEqual(calls.at(-1).input, { status: "open", category: "room-scan", limit: 20, offset: 0 });
await assert.rejects(() => service.listForAdministrator(landlord), (error) => error.statusCode === 403 && error.code === "administrator-required");

const reviewing = await service.review(administrator, supportRequestId, { status: "reviewing" });
assert.equal(reviewing.status, "reviewing");
const resolved = await service.review(administrator, supportRequestId, {
  status: "resolved",
  resolutionSummary: "Camera permissions were reset and the Landlord can retry the room scanner.",
  privacyConfirmed: true,
  noExternalActionConfirmed: true
});
assert.equal(resolved.status, "resolved");
assert.match(resolved.resolutionSummary, /permissions were reset/);
await assert.rejects(() => service.review(administrator, supportRequestId, {
  status: "resolved",
  resolutionSummary: "The door code was copied into the response for convenience.",
  privacyConfirmed: true,
  noExternalActionConfirmed: true
}), /Remove passwords, access codes/);
await assert.rejects(() => service.review(landlord, supportRequestId, { status: "reviewing" }), (error) => error.statusCode === 403 && error.code === "administrator-required");

const inconsistent = createSupportRequestService({ ...repository, async listOwn() {
  return { supportRequests: [{ ...base, status: "resolved", resolutionSummary: null, resolvedAt: null }], limit: 25, offset: 0 };
} });
await assert.rejects(() => inconsistent.listOwn(landlord), /resolution is inconsistent/);

console.log("Support-request service checks passed: Landlord-only intake, privacy guard, idempotent identifiers, bounded queues, Administrator-only triage and final-response integrity.");
