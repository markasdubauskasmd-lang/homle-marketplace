import { readFile } from "node:fs/promises";
import { createBookingRepository } from "../src/marketplace/booking-repository.mjs";
import { createBookingWorkflowService } from "../src/marketplace/booking-workflow.mjs";
import { defaultPricingEconomics, quoteEconomics } from "../src/marketplace/pricing-economics.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }
async function rejectsCode(operation, code) { try { await operation(); } catch (error) { return error?.code === code; } return false; }

const now = new Date("2026-07-15T10:00:00.000Z");
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const requestId = "66666666-6666-4666-8666-666666666666";
const bookingId = "55555555-5555-4555-8555-555555555555";
const propertyId = "33333333-3333-4333-8333-333333333333";
const candidate = {
  id: requestId,
  requested_start_at: "2026-07-20T09:00:00.000Z",
  requested_end_at: "2026-07-20T12:00:00.000Z",
  required_services: ["regular-domestic"],
  budget_pence: 20000,
  distance_km: "12.40",
  services: [{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 2500 }]
};
/* ── The price belongs to the job, not to the cleaner ─────────────────────
   Everything that used to be here exercised createBookingPricingPolicy: a
   cost-up quote built from the invited cleaner's own rate card, plus travel,
   supplies, a risk contingency and a binary search for a margin. It is gone.
   Two cleaners quoting two prices for identical work is what platform pricing
   exists to end, and a customer shown one number by the engine must never be
   booked at another.

   A booking is made at the total already frozen onto the request, split by the
   same function that splits every other booking. */

const platformEconomics = {
  cleanerShareBasisPoints: 7000,
  paymentFeeBasisPoints: 150,
  paymentFeeFixedPence: 20,
  targetGrossMarginBasisPoints: 2000,
  minimumContributionPence: 600,
  cleanerHourlyFloorPence: 1500,
  cancellationCleanerShareBasisPoints: 7000
};
const frozenTotalPence = 9000;
const frozenMinutes = 180;
const settled = quoteEconomics(frozenTotalPence, frozenMinutes, platformEconomics);
assert(settled.cleanerPayoutPence + settled.platformRevenuePence === frozenTotalPence,
  "The split does not account for the whole frozen total.");
assert(settled.healthy, `A frozen total the engine produced was refused at booking time: ${settled.reason}`);

// The terms the workflow will produce from that frozen total. Named as the rest
// of this file names them, because they are the same three numbers a booking
// has always carried.
const quote = {
  customerPricePence: frozenTotalPence,
  cleanerPayPence: settled.cleanerPayoutPence,
  // Zero, and each one deliberately so. Platform pricing has no labour on-cost,
  // no travel line and no supplies line: the customer price is the published
  // price of the job, and everything that used to be added on top of a
  // cleaner's rate is already inside it.
  labourOnCostPence: 0,
  paymentFeePence: settled.paymentFeePence,
  travelCostPence: 0,
  suppliesCostPence: 0,
  otherCostPence: 0,
  targetMarginBasisPoints: settled.grossMarginBasisPoints,
  targetContributionPence: settled.grossMarginPence,
  responseDeadline: "2026-07-15T13:00:00.000Z"
};
// The cleaner's own rate card stays on the candidate and must not move the
// price. Every invitation below is priced from quoted_total_pence instead.
candidate.quoted_total_pence = frozenTotalPence;
candidate.quoted_minutes = frozenMinutes;
candidate.pricing_config_version = 1;

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
  async getInvitationCandidate(actor, suppliedRequestId, cleanerId, requirePayoutReady = false) {
    calls.push({ kind: "candidate", actor, suppliedRequestId, cleanerId, requirePayoutReady });
    return candidate;
  },
  async inviteCleaner(actor, invitation) {
    calls.push({ kind: "invite", actor, invitation });
    return { id: bookingId, cleaning_request_id: requestId, landlord_user_id: landlord.userId, cleaner_user_id: cleaner.userId, status: "pending-cleaner-acceptance", scheduled_start_at: candidate.requested_start_at, scheduled_end_at: candidate.requested_end_at, cleaner_response_deadline: invitation.responseDeadline, customer_price_pence: invitation.customerPricePence, cleaner_pay_pence: invitation.cleanerPayPence, scope_fingerprint: "a".repeat(64), terms_fingerprint: "b".repeat(64), scope_snapshot: { tasks: [] }, responded_at: null, confirmed_at: null };
  },
  async respondToInvitation(actor, suppliedBookingId, response) {
    calls.push({ kind: "respond", actor, suppliedBookingId, response });
    return { id: bookingId, cleaning_request_id: requestId, landlord_user_id: landlord.userId, cleaner_user_id: cleaner.userId, status: response.decision === "accept" ? "confirmed" : "cancelled", scheduled_start_at: candidate.requested_start_at, scheduled_end_at: candidate.requested_end_at, cleaner_response_deadline: quote.responseDeadline, customer_price_pence: quote.customerPricePence, cleaner_pay_pence: quote.cleanerPayPence, scope_fingerprint: "a".repeat(64), terms_fingerprint: "b".repeat(64), scope_snapshot: { tasks: [] }, responded_at: now.toISOString(), confirmed_at: response.decision === "accept" ? now.toISOString() : null, expired_at: null };
  }
};
const workflow = createBookingWorkflowService(fakeRepository, { platformEconomics, clock: () => new Date(now) });
const [landlordBookings, cleanerBookings] = await Promise.all([workflow.listParticipantBookings(landlord), workflow.listParticipantBookings(cleaner, { limit: "25" })]);
assert(landlordBookings[0].pricePence === quote.customerPricePence && landlordBookings[0].pricePerspective === "customer-total" && landlordBookings[0].paymentStepAvailable === true, "The Landlord booking list lost the customer total or payment action.");
assert(cleanerBookings[0].pricePence === quote.cleanerPayPence && cleanerBookings[0].pricePerspective === "cleaner-pay" && !Object.hasOwn(cleanerBookings[0], "paymentStepAvailable") && !Object.hasOwn(cleanerBookings[0], "paymentAuthorizationReady") && !Object.hasOwn(cleanerBookings[0], "paymentStepOpensAt") && JSON.stringify(cleanerBookings).includes(String(quote.customerPricePence)) === false, "The Cleaner booking list exposed the customer total, Landlord payment state or lost the offered pay.");
const repeatWorkflow = createBookingWorkflowService({ ...fakeRepository, async listParticipantBookings() { return [{ ...landlordBookings[0], status: "completed", propertyId, cleanerId: cleaner.userId, paymentStepAvailable: false }]; } }, { platformEconomics });
const [repeatBooking] = await repeatWorkflow.listParticipantBookings(landlord);
assert(repeatBooking.propertyId === propertyId && repeatBooking.cleanerId === cleaner.userId, "A completed Landlord booking lost its owner-authorized repeat-booking identifiers.");
const cleanerPrivacyWorkflow = createBookingWorkflowService({ ...fakeRepository, async listParticipantBookings() { return [{ ...cleanerBookings[0], status: "completed", propertyId, cleanerId: cleaner.userId }]; } }, { platformEconomics });
const [cleanerPrivacyBooking] = await cleanerPrivacyWorkflow.listParticipantBookings(cleaner);
assert(!Object.hasOwn(cleanerPrivacyBooking, "propertyId") && !Object.hasOwn(cleanerPrivacyBooking, "cleanerId"), "The Cleaner summary received Landlord-only repeat-booking identifiers.");
const paymentOpensAt = "2026-07-25T09:00:00.000Z";
const earlyPaymentWorkflow = createBookingWorkflowService({ ...fakeRepository, async listParticipantBookings() { return [{ ...landlordBookings[0], paymentStepAvailable: false, paymentAuthorizationReady: false, paymentStepOpensAt: paymentOpensAt }]; } }, { platformEconomics });
const [earlyPaymentBooking] = await earlyPaymentWorkflow.listParticipantBookings(landlord);
assert(earlyPaymentBooking.paymentStepAvailable === false && earlyPaymentBooking.paymentAuthorizationReady === false && earlyPaymentBooking.paymentStepOpensAt === paymentOpensAt, "The participant projection lost the server-owned payment opening time.");
const inconsistentPaymentWorkflow = createBookingWorkflowService({ ...fakeRepository, async listParticipantBookings() { return [{ ...landlordBookings[0], paymentAuthorizationReady: true, paymentStepAvailable: true }]; } }, { platformEconomics });
assert(await rejects(() => inconsistentPaymentWorkflow.listParticipantBookings(landlord), "timing is inconsistent"), "Contradictory payment readiness escaped into the dashboard.");
const invitationPreview = await workflow.previewInvitation(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId, customerPricePence: 1, cleanerPayPence: 1 });
assert(invitationPreview.customerPricePence === quote.customerPricePence && invitationPreview.cleaningRequestId === requestId && invitationPreview.cleanerId === cleaner.userId && !Object.hasOwn(invitationPreview, "cleanerPayPence") && !Object.hasOwn(invitationPreview, "payoutReady") && calls.find((call) => call.kind === "candidate")?.requirePayoutReady === false && calls.filter((call) => call.kind === "invite").length === 0, "The read-only Landlord preview changed booking state, trusted browser economics, requested a payout gate in no-payment mode or exposed private Cleaner payout data.");
assert(await rejectsCode(() => workflow.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId, approvedCustomerPricePence: quote.customerPricePence - 1 }), "invitation-price-changed"), "A Landlord could invite a Cleaner after approving a different customer total.");
assert(await rejects(() => workflow.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId }), "Approved customer total"), "A direct Cleaner invitation did not require an explicit Landlord price approval.");
const invitation = await workflow.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId, approvedCustomerPricePence: quote.customerPricePence, customerPricePence: 1, cleanerPayPence: 1 });
assert(calls.find((call) => call.kind === "invite").invitation.customerPricePence === quote.customerPricePence && calls.find((call) => call.kind === "invite").invitation.cleanerPayPence === quote.cleanerPayPence && invitation.status === "pending-cleaner-acceptance" && invitation.customerPricePence === quote.customerPricePence && !Object.hasOwn(invitation, "cleanerPayPence"), "Approved server economics did not reach the booking or private Cleaner pay leaked to a Landlord.");
const accepted = await workflow.respondToInvitation(cleaner, bookingId, { decision: "accept", cleanerPayPence: 1 });
assert(accepted.status === "confirmed" && accepted.cleanerPayPence === quote.cleanerPayPence && !Object.hasOwn(accepted, "customerPricePence") && calls.at(-1).response.decision === "accept" && !Object.hasOwn(calls.at(-1).response, "cleanerPayPence"), "Cleaner response trusted submitted terms, lost the frozen offer or exposed Homle's customer total.");
let paidInvitationWrites = 0;
const payoutUnreadyInvitationRepository = {
  ...fakeRepository,
  async getInvitationCandidate(...arguments_) {
    const selected = await fakeRepository.getInvitationCandidate(...arguments_);
    return { ...selected, payout_ready: false };
  },
  async inviteCleaner(...arguments_) {
    paidInvitationWrites += 1;
    return fakeRepository.inviteCleaner(...arguments_);
  }
};
const payoutUnreadyInvitationWorkflow = createBookingWorkflowService(payoutUnreadyInvitationRepository, { platformEconomics, clock: () => new Date(now), requirePayoutReady: true, getPayoutReadiness: async () => ({ ready: false }) });
assert(await rejectsCode(() => payoutUnreadyInvitationWorkflow.previewInvitation(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId }), "cleaner-payout-not-ready"), "A Landlord received a paid quote for a Cleaner without a verified payout destination.");
assert(await rejectsCode(() => payoutUnreadyInvitationWorkflow.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId, approvedCustomerPricePence: quote.customerPricePence }), "cleaner-payout-not-ready") && paidInvitationWrites === 0, "A paid direct invitation was written before the selected Cleaner had a verified payout destination.");
const payoutReadyInvitationRepository = {
  ...payoutUnreadyInvitationRepository,
  async getInvitationCandidate(...arguments_) {
    const selected = await fakeRepository.getInvitationCandidate(...arguments_);
    return { ...selected, payout_ready: true };
  }
};
const payoutReadyInvitationWorkflow = createBookingWorkflowService(payoutReadyInvitationRepository, { platformEconomics, clock: () => new Date(now), requirePayoutReady: true, getPayoutReadiness: async () => ({ ready: true }) });
const paidInvitationPreview = await payoutReadyInvitationWorkflow.previewInvitation(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId });
assert(paidInvitationPreview.customerPricePence === quote.customerPricePence && !Object.hasOwn(paidInvitationPreview, "payout_ready") && !Object.hasOwn(paidInvitationPreview, "payoutReady") && calls.filter((call) => call.kind === "candidate").at(-1).requirePayoutReady === true, "A payout-ready direct Cleaner could not be quoted safely or private payout readiness leaked to the Landlord.");
const paidInvitation = await payoutReadyInvitationWorkflow.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId, approvedCustomerPricePence: quote.customerPricePence });
assert(paidInvitation.status === "pending-cleaner-acceptance" && paidInvitationWrites === 1 && !Object.hasOwn(paidInvitation, "payout_ready") && !Object.hasOwn(paidInvitation, "payoutReady"), "A payout-ready direct Cleaner could not be invited or private payout readiness leaked into the booking.");
let paidResponseWrites = 0;
const paidRepository = { ...fakeRepository, async respondToInvitation(...arguments_) { paidResponseWrites += 1; return fakeRepository.respondToInvitation(...arguments_); } };
const payoutRequiredWorkflow = createBookingWorkflowService(paidRepository, { platformEconomics, requirePayoutReady: true, getPayoutReadiness: async () => ({ ready: false }) });
assert(await rejectsCode(() => payoutRequiredWorkflow.respondToInvitation(cleaner, bookingId, { decision: "accept" }), "payout-setup-required") && paidResponseWrites === 0, "A paid booking was confirmed before the Cleaner had a verified payout destination.");
const declinedWithoutPayout = await payoutRequiredWorkflow.respondToInvitation(cleaner, bookingId, { decision: "decline" });
assert(declinedWithoutPayout.status === "cancelled" && paidResponseWrites === 1, "The paid-booking payout gate incorrectly blocked a Cleaner from declining.");
const payoutReadyWorkflow = createBookingWorkflowService(paidRepository, { platformEconomics, requirePayoutReady: true, getPayoutReadiness: async () => ({ ready: true }) });
const paidAccepted = await payoutReadyWorkflow.respondToInvitation(cleaner, bookingId, { decision: "accept" });
assert(paidAccepted.status === "confirmed" && paidResponseWrites === 2, "A Cleaner with a verified payout destination could not accept a paid booking.");
const payoutUnavailableWorkflow = createBookingWorkflowService(paidRepository, { platformEconomics, requirePayoutReady: true, getPayoutReadiness: async () => { throw new Error("database unavailable"); } });
assert(await rejectsCode(() => payoutUnavailableWorkflow.respondToInvitation(cleaner, bookingId, { decision: "accept" }), "payout-readiness-unavailable") && paidResponseWrites === 2, "A payout-readiness outage did not fail closed before paid booking confirmation.");
let missingPayoutBoundaryRejected = false;
try { createBookingWorkflowService(fakeRepository, { platformEconomics, requirePayoutReady: true }); } catch (error) { missingPayoutBoundaryRejected = String(error.message).includes("payout-readiness boundary"); }
assert(missingPayoutBoundaryRejected, "Paid booking acceptance composed without a payout-readiness boundary.");
const expiredWorkflow = createBookingWorkflowService({ ...fakeRepository, async respondToInvitation() { return { id: bookingId, cleaning_request_id: requestId, status: "cancelled", scheduled_start_at: candidate.requested_start_at, scheduled_end_at: candidate.requested_end_at, cleaner_response_deadline: quote.responseDeadline, customer_price_pence: quote.customerPricePence, cleaner_pay_pence: quote.cleanerPayPence, scope_fingerprint: "a".repeat(64), terms_fingerprint: "b".repeat(64), scope_snapshot: { tasks: [] }, responded_at: null, confirmed_at: null, expired_at: now.toISOString() }; } }, { platformEconomics, clock: () => new Date(now) });
const expired = await expiredWorkflow.respondToInvitation(cleaner, bookingId, { decision: "accept" });
assert(expired.status === "cancelled" && expired.expiredAt === now.toISOString() && expired.respondedAt === null, "An expired invitation did not return its terminal timestamp without fabricating a Cleaner response.");
assert(await rejects(() => workflow.inviteCleaner(cleaner, { cleaningRequestId: requestId, cleanerId: cleaner.userId }), "Landlord"), "A Cleaner could create an invitation.");
const dualRoleActor = { userId: landlord.userId, roles: ["cleaner", "landlord"] };
assert(await rejects(() => workflow.previewInvitation(dualRoleActor, { cleaningRequestId: requestId, cleanerId: landlord.userId }), "cannot be invited to your own"), "A dual-workspace account could preview an invitation to its own Cleaner profile.");
assert(await rejects(() => workflow.respondToInvitation(landlord, bookingId, { decision: "accept" }), "Cleaner"), "A Landlord could answer a Cleaner invitation.");
// An unpriced request fails closed and says what is actually wrong. There is
// no other pricing path left to fall through to, which is the point.
const unpricedRepository = {
  ...fakeRepository,
  async getInvitationCandidate() {
    const { quoted_total_pence, quoted_minutes, pricing_config_version, ...withoutQuote } = candidate;
    return withoutQuote;
  }
};
const unpriced = createBookingWorkflowService(unpricedRepository, { platformEconomics, clock: () => new Date(now) });
assert(await rejects(() => unpriced.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId, approvedCustomerPricePence: 1 }), "cannot be booked until it is re-quoted"),
  "An unpriced request did not fail closed once the cost-up path was removed.");

// Given a re-quote boundary, the same request books at today's price for its
// own scope rather than at a price derived from the cleaner being invited.
{
  let sawCleanerRates = false;
  const requoted = createBookingWorkflowService(unpricedRepository, {
    platformEconomics,
    clock: () => new Date(now),
    async requoteRequest(actor, request) {
      // The boundary is handed the request's own scope. A cleaner's rate card
      // is not part of it, and must not become part of it.
      sawCleanerRates = Object.hasOwn(request, "services");
      return { priceable: true, totalPence: 7000, estimatedMinutes: 150, configVersion: 2, payoutBasisPence: 7000 };
    }
  });
  const preview = await requoted.previewInvitation(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId });
  assert(preview.customerPricePence === 7000, `A re-quoted request did not book at the re-quoted price: ${preview.customerPricePence}`);
  assert(!sawCleanerRates, "The re-quote boundary was handed the invited cleaner's rate card.");
}

const sqlCalls = [];
let failure = null;
const database = { async withUserTransaction(actor, operation) { return operation({ async query(text, values) { sqlCalls.push({ actor, text, values }); if (failure) throw failure; if (text.includes("coverage.distance_km")) return { rows: [{ id: requestId, distance_km: "4.20" }] }; return { rows: [{ id: bookingId }] }; } }); } };
const repository = createBookingRepository(database);
const selectedCandidate = await repository.getInvitationCandidate(landlord, requestId, cleaner.userId);
await repository.listParticipantBookings(cleaner, 50);
await repository.inviteCleaner(landlord, { bookingId, requestId, cleanerId: cleaner.userId, responseDeadline: quote.responseDeadline, customerPricePence: quote.customerPricePence, cleanerPayPence: quote.cleanerPayPence, labourOnCostPence: quote.labourOnCostPence, paymentFeePence: quote.paymentFeePence, travelCostPence: quote.travelCostPence, suppliesCostPence: quote.suppliesCostPence, otherCostPence: quote.otherCostPence, targetMarginBasisPoints: quote.targetMarginBasisPoints, targetContributionPence: quote.targetContributionPence });
await repository.respondToInvitation(cleaner, bookingId, { decision: "accept", reason: null });
assert(selectedCandidate.distance_km === "4.20" && sqlCalls[0].text.includes("JOIN properties property") && sqlCalls[0].text.includes("cleaner_service_areas") && sqlCalls[0].text.includes("coverage.distance_km") && sqlCalls[0].text.includes("profile.user_id<>request.landlord_user_id") && sqlCalls[0].text.includes("cleaner_payout_ready_for_paid_booking") && sqlCalls[0].text.includes("$4::boolean") && sqlCalls[0].values[1] === cleaner.userId && sqlCalls[0].values[3] === false, "Direct Cleaner invitation pricing did not bind the selected Cleaner to property distance evidence, self-exclusion and an explicit paid-mode payout gate.");
assert(sqlCalls[1].text.includes("list_my_booking_summaries") && sqlCalls[1].values[0] === 50 && sqlCalls[2].text.includes("tideway_private.invite_cleaner") && sqlCalls[2].values.length === 13 && sqlCalls[2].values[12] === settled.grossMarginPence && sqlCalls[3].text.includes("respond_to_cleaner_invitation") && sqlCalls[3].actor.userId === cleaner.userId, "Booking repository bypassed participant-safe summaries, actor-bound audited transitions or both parameterized profit targets.");
const repeatSqlCalls = [];
const repeatRepository = createBookingRepository({
  async withUserTransaction(actor, operation) {
    return operation({ async query(text, values) {
      repeatSqlCalls.push({ actor, text, values });
      if (text.includes("list_my_booking_summaries")) return { rows: [{ bookings: [{ bookingId, participantRole: "landlord", status: "completed" }] }] };
      return { rows: [{ id: bookingId, property_id: propertyId, cleaner_user_id: cleaner.userId }] };
    } });
  }
});
const [repeatRepositoryBooking] = await repeatRepository.listParticipantBookings(landlord, 50);
assert(repeatRepositoryBooking.propertyId === propertyId && repeatRepositoryBooking.cleanerId === cleaner.userId && repeatSqlCalls[1].text.includes("landlord_user_id=$1::uuid") && repeatSqlCalls[1].text.includes("status='completed'") && repeatSqlCalls[1].values[0] === landlord.userId, "Repeat-booking identifiers were not loaded through a completed, owner-bound Landlord query.");
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
const contributionFloorMigration = await readFile(new URL("../db/migrations/056_booking_minimum_contribution.sql", import.meta.url), "utf8");
const runtimeSource = await readFile(new URL("../src/marketplace/runtime.mjs", import.meta.url), "utf8");
const grants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const workerGrants = await readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8");
for (const required of ["bookings_one_live_attempt_per_request_idx", "planned_contribution_pence", "bookings_target_margin_check", "cleaner_response_deadline", "scope_snapshot", "cleaner-services-mismatch", "cleaner-unavailable", "exclusion_violation", "booking_status_history", "cleaning_request_status_history", "ON CONFLICT (booking_id) DO NOTHING", "idempotency_key"]) assert(migration.includes(required), `Booking migration omitted ${required}.`);
assert(grants.includes("respond_to_cleaner_invitation") && grants.includes("REVOKE INSERT, UPDATE, DELETE ON bookings"), "Runtime role can bypass audited booking transitions.");
assert(runtimeSource.includes("requirePayoutReady: paymentService !== null") && runtimeSource.includes("cleanerPayoutService.getStatus(actor)"), "The runtime does not activate the Cleaner payout gate exactly when paid bookings are attached.");
for (const required of ["list_my_booking_summaries", "booking.landlord_user_id = actor_id OR booking.cleaner_user_id = actor_id", "pricePerspective", "cleaner-pay", "customer-total", "substring", "propertyArea", "canRespond", "activeJobAvailable", "LIMIT maximum_results", "REVOKE ALL"]) assert(summaryMigration.includes(required), `Participant booking summaries omitted ${required}.`);
assert(grants.includes("list_my_booking_summaries(integer)"), "The runtime cannot execute the participant-safe booking summary function.");
for (const required of ["paymentAuthorizationReady", "paymentStepAvailable", "paymentStepOpensAt", "booking.scheduled_start_at <= now()+interval '5 days'", "payment.authorized_at BETWEEN booking.scheduled_start_at-interval '5 days'"]) assert(paymentWindowMigration.includes(required), `Payment-aware participant summary omitted ${required}.`);
for (const required of ["expired_at", "change_source", "booking_history_actor_source_check", "request_history_actor_source_check", "expire_cleaner_invitation", "expire_due_cleaner_invitations", "FOR UPDATE SKIP LOCKED", "matching reopened", "cleaner-invitation-expired", "respond_to_cleaner_invitation_core", "booking.cleaner_user_id = actor_id"]) assert(expiryMigration.includes(required), `Invitation expiry migration omitted ${required}.`);
assert(!grants.includes("expire_due_cleaner_invitations") && workerGrants.includes("tideway_worker") && workerGrants.includes("expire_due_cleaner_invitations(integer)") && workerGrants.includes("rolbypassrls"), "Invitation expiry is callable by the web role or lacks a restricted non-bypass worker boundary.");
for (const required of ["pg_advisory_xact_lock", "account.account_status='active'", "cleaner-property-mismatch", "cleaner-outside-service-area", "cleaner-price-changed", "cleaner-has-overlapping-invitation", "service.pricing_model IN ('hourly','fixed')", "expected_cleaner_pay<>proposed_cleaner_pay_pence", "cleaner_availability", "tstzrange", "invite_cleaner_before_eligibility_hardening", "respond_to_cleaner_invitation_before_eligibility_hardening", "REVOKE ALL"]) assert(hardeningMigration.includes(required), `Invitation eligibility hardening omitted ${required}.`);
assert(hardeningMigration.indexOf("pg_advisory_xact_lock") < hardeningMigration.indexOf("cleaner-has-overlapping-invitation") && !grants.includes("invite_cleaner_before_eligibility_hardening") && !grants.includes("respond_to_cleaner_invitation_before_eligibility_hardening"), "Invitation schedule serialization happens too late or a superseded function is executable by the runtime role.");
assert(serviceAreaRepairMigration.includes("request_outward_postcode") && serviceAreaRepairMigration.includes("area.outward_postcode=request_outward_postcode") && !serviceAreaRepairMigration.includes("area.outward_postcode=outward_postcode"), "The deployed invitation function retains an ambiguous postcode lookup.");
for (const required of ["target_contribution_pence", "bookings_target_contribution_check", "proposed_target_contribution_pence", "planned_contribution<proposed_target_contribution_pence", "termsFingerprint", "REVOKE ALL ON FUNCTION tideway_private.invite_cleaner"]) assert(contributionFloorMigration.includes(required), `The booking minimum-contribution migration omitted ${required}.`);
assert(grants.includes("invite_cleaner(uuid, uuid, uuid, timestamptz, integer, integer, integer, integer, integer, integer, integer, integer, integer)") && !grants.includes("GRANT EXECUTE ON FUNCTION tideway_private.invite_cleaner(uuid, uuid, uuid, timestamptz, integer, integer, integer, integer, integer, integer, integer, integer) TO tideway_app"), "The runtime role did not move exclusively to the two-floor invitation function.");

console.log("Booking workflow tests passed: server-owned two-floor profitable terms, frozen scope, authoritative property/coverage/pay/availability eligibility, decline/retry history, idempotent responses and concurrent overlap protection.");
