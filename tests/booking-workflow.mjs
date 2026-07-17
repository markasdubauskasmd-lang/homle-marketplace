import { readFile } from "node:fs/promises";
import { createBookingRepository } from "../src/marketplace/booking-repository.mjs";
import { bookingPricingPolicyFromEnvironment, createBookingPricingPolicy, createBookingWorkflowService } from "../src/marketplace/booking-workflow.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }

const now = new Date("2026-07-15T10:00:00.000Z");
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const requestId = "66666666-6666-4666-8666-666666666666";
const bookingId = "55555555-5555-4555-8555-555555555555";
const candidate = {
  id: requestId,
  requested_start_at: "2026-07-20T09:00:00.000Z",
  requested_end_at: "2026-07-20T12:00:00.000Z",
  required_services: ["regular-domestic"],
  budget_pence: 20000,
  services: [{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 2500 }]
};
const policy = createBookingPricingPolicy({
  targetMarginBasisPoints: 2000,
  labourOnCostBasisPoints: 1000,
  paymentFeeBasisPoints: 300,
  paymentFeeFixedPence: 20,
  travelCostPence: 500,
  suppliesCostPence: 250,
  invitationTtlMinutes: 180
});
const quote = policy.quote(candidate, now);
const costs = quote.cleanerPayPence + quote.labourOnCostPence + quote.paymentFeePence + quote.travelCostPence + quote.suppliesCostPence + quote.otherCostPence;
assert(quote.cleanerPayPence === 7500 && quote.customerPricePence > costs && (quote.customerPricePence - costs) * 10000 >= quote.customerPricePence * 2000 && quote.responseDeadline === "2026-07-15T13:00:00.000Z", "Private pricing did not cover cleaner pay, costs, target margin and a bounded response window.");
assert(await rejects(() => Promise.resolve(createBookingPricingPolicy({ targetMarginBasisPoints: 0 })), "Target margin"), "A zero-margin policy was accepted.");
assert(await rejects(() => Promise.resolve(policy.quote({ ...candidate, services: [{ serviceCode: "regular-domestic", pricingModel: "quote", pricePence: null }] }, now)), "manual quote"), "A manual-quote service was silently priced.");
assert(bookingPricingPolicyFromEnvironment({}) === null && await rejects(() => Promise.resolve(bookingPricingPolicyFromEnvironment({ BOOKING_TARGET_MARGIN_BPS: "2000" })), "complete private"), "Missing or partial booking economics did not fail closed.");
const configuredPolicy = bookingPricingPolicyFromEnvironment({ BOOKING_TARGET_MARGIN_BPS: "2000", BOOKING_LABOUR_ON_COST_BPS: "1000", BOOKING_PAYMENT_FEE_BPS: "300", BOOKING_PAYMENT_FEE_FIXED_PENCE: "20", BOOKING_TRAVEL_COST_PENCE: "500", BOOKING_SUPPLIES_COST_PENCE: "250", BOOKING_OTHER_COST_PENCE: "0", BOOKING_INVITATION_TTL_MINUTES: "180" });
assert(configuredPolicy.quote(candidate, now).customerPricePence === quote.customerPricePence, "Complete private environment pricing did not compose deterministically.");

const calls = [];
const fakeRepository = {
  async listParticipantBookings(actor, limit) {
    calls.push({ kind: "list", actor, limit });
    const cleanerView = actor.roles.includes("cleaner");
    return [{
      bookingId, participantRole: cleanerView ? "cleaner" : "landlord", status: "confirmed",
      scheduledStartAt: candidate.requested_start_at, scheduledEndAt: candidate.requested_end_at,
      responseDeadline: null, pricePence: cleanerView ? quote.cleanerPayPence : quote.customerPricePence,
      pricePerspective: cleanerView ? "cleaner-pay" : "customer-total", propertyName: "Riverside flat", propertyArea: "SW1A",
      cleaningType: "regular-domestic", taskCount: 4, counterpartyName: cleanerView ? "Landlord" : "Assigned Cleaner",
      canRespond: false, activeJobAvailable: true, paymentAuthorizationReady: false, paymentStepAvailable: !cleanerView, paymentStepOpensAt: null, respondedAt: now.toISOString(), confirmedAt: now.toISOString()
    }];
  },
  async getInvitationCandidate(actor, suppliedRequestId, cleanerId) { calls.push({ kind: "candidate", actor, suppliedRequestId, cleanerId }); return candidate; },
  async inviteCleaner(actor, invitation) {
    calls.push({ kind: "invite", actor, invitation });
    return { id: bookingId, cleaning_request_id: requestId, landlord_user_id: landlord.userId, cleaner_user_id: cleaner.userId, status: "pending-cleaner-acceptance", scheduled_start_at: candidate.requested_start_at, scheduled_end_at: candidate.requested_end_at, cleaner_response_deadline: invitation.responseDeadline, customer_price_pence: invitation.customerPricePence, cleaner_pay_pence: invitation.cleanerPayPence, scope_fingerprint: "a".repeat(64), terms_fingerprint: "b".repeat(64), scope_snapshot: { tasks: [] }, responded_at: null, confirmed_at: null };
  },
  async respondToInvitation(actor, suppliedBookingId, response) {
    calls.push({ kind: "respond", actor, suppliedBookingId, response });
    return { id: bookingId, cleaning_request_id: requestId, landlord_user_id: landlord.userId, cleaner_user_id: cleaner.userId, status: response.decision === "accept" ? "confirmed" : "cancelled", scheduled_start_at: candidate.requested_start_at, scheduled_end_at: candidate.requested_end_at, cleaner_response_deadline: quote.responseDeadline, customer_price_pence: quote.customerPricePence, cleaner_pay_pence: quote.cleanerPayPence, scope_fingerprint: "a".repeat(64), terms_fingerprint: "b".repeat(64), scope_snapshot: { tasks: [] }, responded_at: now.toISOString(), confirmed_at: response.decision === "accept" ? now.toISOString() : null, expired_at: null };
  }
};
const workflow = createBookingWorkflowService(fakeRepository, { pricingPolicy: policy, clock: () => new Date(now) });
const [landlordBookings, cleanerBookings] = await Promise.all([workflow.listParticipantBookings(landlord), workflow.listParticipantBookings(cleaner, { limit: "25" })]);
assert(landlordBookings[0].pricePence === quote.customerPricePence && landlordBookings[0].pricePerspective === "customer-total" && landlordBookings[0].paymentStepAvailable === true, "The Landlord booking list lost the customer total or payment action.");
assert(cleanerBookings[0].pricePence === quote.cleanerPayPence && cleanerBookings[0].pricePerspective === "cleaner-pay" && !Object.hasOwn(cleanerBookings[0], "paymentStepAvailable") && !Object.hasOwn(cleanerBookings[0], "paymentAuthorizationReady") && !Object.hasOwn(cleanerBookings[0], "paymentStepOpensAt") && JSON.stringify(cleanerBookings).includes(String(quote.customerPricePence)) === false, "The Cleaner booking list exposed the customer total, Landlord payment state or lost the offered pay.");
const paymentOpensAt = "2026-07-25T09:00:00.000Z";
const earlyPaymentWorkflow = createBookingWorkflowService({ ...fakeRepository, async listParticipantBookings() { return [{ ...landlordBookings[0], paymentStepAvailable: false, paymentAuthorizationReady: false, paymentStepOpensAt: paymentOpensAt }]; } }, { pricingPolicy: policy });
const [earlyPaymentBooking] = await earlyPaymentWorkflow.listParticipantBookings(landlord);
assert(earlyPaymentBooking.paymentStepAvailable === false && earlyPaymentBooking.paymentAuthorizationReady === false && earlyPaymentBooking.paymentStepOpensAt === paymentOpensAt, "The participant projection lost the server-owned payment opening time.");
const inconsistentPaymentWorkflow = createBookingWorkflowService({ ...fakeRepository, async listParticipantBookings() { return [{ ...landlordBookings[0], paymentAuthorizationReady: true, paymentStepAvailable: true }]; } }, { pricingPolicy: policy });
assert(await rejects(() => inconsistentPaymentWorkflow.listParticipantBookings(landlord), "timing is inconsistent"), "Contradictory payment readiness escaped into the dashboard.");
const invitation = await workflow.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId, customerPricePence: 1, cleanerPayPence: 1 });
assert(calls.find((call) => call.kind === "invite").invitation.customerPricePence === quote.customerPricePence && calls.find((call) => call.kind === "invite").invitation.cleanerPayPence === quote.cleanerPayPence && invitation.status === "pending-cleaner-acceptance" && !Object.hasOwn(invitation, "cleanerPayPence"), "Browser economics reached the booking or private Cleaner pay leaked to a Landlord.");
const accepted = await workflow.respondToInvitation(cleaner, bookingId, { decision: "accept", cleanerPayPence: 1 });
assert(accepted.status === "confirmed" && accepted.cleanerPayPence === quote.cleanerPayPence && !Object.hasOwn(accepted, "customerPricePence") && calls.at(-1).response.decision === "accept" && !Object.hasOwn(calls.at(-1).response, "cleanerPayPence"), "Cleaner response trusted submitted terms, lost the frozen offer or exposed Homle's customer total.");
const expiredWorkflow = createBookingWorkflowService({ ...fakeRepository, async respondToInvitation() { return { id: bookingId, cleaning_request_id: requestId, status: "cancelled", scheduled_start_at: candidate.requested_start_at, scheduled_end_at: candidate.requested_end_at, cleaner_response_deadline: quote.responseDeadline, customer_price_pence: quote.customerPricePence, cleaner_pay_pence: quote.cleanerPayPence, scope_fingerprint: "a".repeat(64), terms_fingerprint: "b".repeat(64), scope_snapshot: { tasks: [] }, responded_at: null, confirmed_at: null, expired_at: now.toISOString() }; } }, { pricingPolicy: policy, clock: () => new Date(now) });
const expired = await expiredWorkflow.respondToInvitation(cleaner, bookingId, { decision: "accept" });
assert(expired.status === "cancelled" && expired.expiredAt === now.toISOString() && expired.respondedAt === null, "An expired invitation did not return its terminal timestamp without fabricating a Cleaner response.");
assert(await rejects(() => workflow.inviteCleaner(cleaner, { cleaningRequestId: requestId, cleanerId: cleaner.userId }), "Landlord"), "A Cleaner could create an invitation.");
assert(await rejects(() => workflow.respondToInvitation(landlord, bookingId, { decision: "accept" }), "Cleaner"), "A Landlord could answer a Cleaner invitation.");
const disabled = createBookingWorkflowService(fakeRepository);
assert(await rejects(() => disabled.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId }), "pricing policy"), "Invitations did not fail closed without private pricing configuration.");

const sqlCalls = [];
let failure = null;
const database = { async withUserTransaction(actor, operation) { return operation({ async query(text, values) { sqlCalls.push({ actor, text, values }); if (failure) throw failure; if (text.includes("getInvitationCandidate")) return { rows: [] }; return { rows: [{ id: bookingId }] }; } }); } };
const repository = createBookingRepository(database);
await repository.listParticipantBookings(cleaner, 50);
await repository.inviteCleaner(landlord, { bookingId, requestId, cleanerId: cleaner.userId, responseDeadline: quote.responseDeadline, customerPricePence: quote.customerPricePence, cleanerPayPence: quote.cleanerPayPence, labourOnCostPence: quote.labourOnCostPence, paymentFeePence: quote.paymentFeePence, travelCostPence: quote.travelCostPence, suppliesCostPence: quote.suppliesCostPence, otherCostPence: quote.otherCostPence, targetMarginBasisPoints: quote.targetMarginBasisPoints });
await repository.respondToInvitation(cleaner, bookingId, { decision: "accept", reason: null });
assert(sqlCalls[0].text.includes("list_my_booking_summaries") && sqlCalls[0].values[0] === 50 && sqlCalls[1].text.includes("tideway_private.invite_cleaner") && sqlCalls[1].values.length === 12 && sqlCalls[2].text.includes("respond_to_cleaner_invitation") && sqlCalls[2].actor.userId === cleaner.userId, "Booking repository bypassed participant-safe summaries, actor-bound audited transitions or parameterized terms.");
failure = Object.assign(new Error("duplicate overlap"), { code: "23P01" });
assert(await rejects(() => repository.respondToInvitation(cleaner, bookingId, { decision: "accept", reason: null }), "overlaps"), "Concurrent exclusion violations were not mapped to a safe schedule conflict.");
for (const [databaseMessage, publicMessage] of [
  ["cleaner-account-inactive", "not currently eligible"],
  ["cleaner-property-mismatch", "property type"],
  ["cleaner-outside-service-area", "outside the cleaner's declared service area"],
  ["cleaner-price-changed", "price changed"],
  ["cleaner-has-overlapping-invitation", "overlapping invitation"]
]) {
  failure = new Error(databaseMessage);
  assert(await rejects(() => repository.inviteCleaner(landlord, { bookingId, requestId, cleanerId: cleaner.userId }), publicMessage), `Invitation hardening error ${databaseMessage} was not mapped safely.`);
}
failure = null;

const migration = await readFile(new URL("../db/migrations/009_booking_invitation_and_acceptance.sql", import.meta.url), "utf8");
const summaryMigration = await readFile(new URL("../db/migrations/026_participant_booking_summaries.sql", import.meta.url), "utf8");
const paymentWindowMigration = await readFile(new URL("../db/migrations/042_booking_payment_window_summary.sql", import.meta.url), "utf8");
const expiryMigration = await readFile(new URL("../db/migrations/011_invitation_expiry_and_requeue.sql", import.meta.url), "utf8");
const hardeningMigration = await readFile(new URL("../db/migrations/028_invitation_eligibility_hardening.sql", import.meta.url), "utf8");
const serviceAreaRepairMigration = await readFile(new URL("../db/migrations/031_fix_invitation_service_area_lookup.sql", import.meta.url), "utf8");
const grants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const workerGrants = await readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8");
for (const required of ["bookings_one_live_attempt_per_request_idx", "planned_contribution_pence", "bookings_target_margin_check", "cleaner_response_deadline", "scope_snapshot", "cleaner-services-mismatch", "cleaner-unavailable", "exclusion_violation", "booking_status_history", "cleaning_request_status_history", "ON CONFLICT (booking_id) DO NOTHING", "idempotency_key"]) assert(migration.includes(required), `Booking migration omitted ${required}.`);
assert(grants.includes("respond_to_cleaner_invitation") && grants.includes("REVOKE INSERT, UPDATE, DELETE ON bookings"), "Runtime role can bypass audited booking transitions.");
for (const required of ["list_my_booking_summaries", "booking.landlord_user_id = actor_id OR booking.cleaner_user_id = actor_id", "pricePerspective", "cleaner-pay", "customer-total", "substring", "propertyArea", "canRespond", "activeJobAvailable", "LIMIT maximum_results", "REVOKE ALL"]) assert(summaryMigration.includes(required), `Participant booking summaries omitted ${required}.`);
assert(grants.includes("list_my_booking_summaries(integer)"), "The runtime cannot execute the participant-safe booking summary function.");
for (const required of ["paymentAuthorizationReady", "paymentStepAvailable", "paymentStepOpensAt", "booking.scheduled_start_at <= now()+interval '5 days'", "payment.authorized_at BETWEEN booking.scheduled_start_at-interval '5 days'"]) assert(paymentWindowMigration.includes(required), `Payment-aware participant summary omitted ${required}.`);
for (const required of ["expired_at", "change_source", "booking_history_actor_source_check", "request_history_actor_source_check", "expire_cleaner_invitation", "expire_due_cleaner_invitations", "FOR UPDATE SKIP LOCKED", "matching reopened", "cleaner-invitation-expired", "respond_to_cleaner_invitation_core", "booking.cleaner_user_id = actor_id"]) assert(expiryMigration.includes(required), `Invitation expiry migration omitted ${required}.`);
assert(!grants.includes("expire_due_cleaner_invitations") && workerGrants.includes("tideway_worker") && workerGrants.includes("expire_due_cleaner_invitations(integer)") && workerGrants.includes("rolbypassrls"), "Invitation expiry is callable by the web role or lacks a restricted non-bypass worker boundary.");
for (const required of ["pg_advisory_xact_lock", "account.account_status='active'", "cleaner-property-mismatch", "cleaner-outside-service-area", "cleaner-price-changed", "cleaner-has-overlapping-invitation", "service.pricing_model IN ('hourly','fixed')", "expected_cleaner_pay<>proposed_cleaner_pay_pence", "cleaner_availability", "tstzrange", "invite_cleaner_before_eligibility_hardening", "respond_to_cleaner_invitation_before_eligibility_hardening", "REVOKE ALL"]) assert(hardeningMigration.includes(required), `Invitation eligibility hardening omitted ${required}.`);
assert(hardeningMigration.indexOf("pg_advisory_xact_lock") < hardeningMigration.indexOf("cleaner-has-overlapping-invitation") && !grants.includes("invite_cleaner_before_eligibility_hardening") && !grants.includes("respond_to_cleaner_invitation_before_eligibility_hardening"), "Invitation schedule serialization happens too late or a superseded function is executable by the runtime role.");
assert(serviceAreaRepairMigration.includes("request_outward_postcode") && serviceAreaRepairMigration.includes("area.outward_postcode=request_outward_postcode") && !serviceAreaRepairMigration.includes("area.outward_postcode=outward_postcode"), "The deployed invitation function retains an ambiguous postcode lookup.");

console.log("Booking workflow tests passed: server-owned profitable terms, frozen scope, authoritative property/coverage/pay/availability eligibility, decline/retry history, idempotent responses and concurrent overlap protection.");
