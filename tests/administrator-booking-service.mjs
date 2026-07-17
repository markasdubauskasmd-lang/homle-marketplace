import assert from "node:assert/strict";
import { createAdministratorBookingService } from "../src/marketplace/administrator-booking-service.mjs";

const administrator = { userId: "11111111-1111-4111-8111-111111111111", roles: ["administrator"] };
const calls = [];
const repository = { async list(actor, input) { calls.push({ actor, input }); return { operations: [{ operationKind: "booking", requestId: "22222222-2222-4222-8222-222222222222", bookingId: "33333333-3333-4333-8333-333333333333", status: "confirmed", scheduledStartAt: "2026-07-20T10:00:00.000Z", scheduledEndAt: "2026-07-20T12:00:00.000Z", cleaningType: "End of tenancy", serviceCount: 2, taskCount: 5, completedTaskCount: 0, customerPricePence: 12000, cleanerPayPence: 7000, plannedCostsPence: 1500, plannedContributionPence: 3500, targetMarginBasisPoints: 2500, paymentStatus: null, caseStatus: null, needsAttention: true, nextAction: "Landlord payment authorization has not started.", updatedAt: "2026-07-17T20:00:00.000Z" }], limit: input.limit, offset: input.offset }; } };
const service = createAdministratorBookingService(repository);
const result = await service.list(administrator, { view: "attention", limit: "25", offset: "0" });
assert.equal(result.operations[0].plannedContributionPence, 3500);
assert.deepEqual(calls[0].input, { view: "attention", limit: 25, offset: 0 });
await assert.rejects(service.list({ userId: "44444444-4444-4444-8444-444444444444", roles: ["landlord"] }), /Administrator/);
await assert.rejects(service.list(administrator, { view: "private-addresses" }), /valid booking operations view/);
const badService = createAdministratorBookingService({ async list() { return { operations: [{ ...result.operations[0], plannedContributionPence: 3600 }], limit: 50, offset: 0 }; } });
await assert.rejects(badService.list(administrator), /economics are unavailable/);
console.log("Administrator booking service tests passed: role isolation, filters and exact frozen economics.");
