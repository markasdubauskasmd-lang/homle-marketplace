import { readFile } from "node:fs/promises";
import { createBookingRepository } from "../src/marketplace/booking-repository.mjs";
import { bookingPricingPolicyFromEnvironment, createBookingPricingPolicy, createBookingWorkflowService } from "../src/marketplace/booking-workflow.mjs";

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
const policy = createBookingPricingPolicy({
  targetMarginBasisPoints: 2000,
  minimumContributionPence: 1800,
  labourOnCostBasisPoints: 1000,
  paymentFeeBasisPoints: 300,
  paymentFeeFixedPence: 20,
  riskContingencyBasisPoints: 500,
  travelCostPence: 500,
  suppliesCostPence: 250,
  invitationTtlMinutes: 180
});
const quote = policy.quote(candidate, now);
const costs = quote.cleanerPayPence + quote.labourOnCostPence + quote.paymentFeePence + quote.travelCostPence + quote.suppliesCostPence + quote.otherCostPence;
assert(quote.cleanerPayPence === 7500 && quote.riskContingencyPence > 0 && quote.otherCostPence === quote.riskContingencyPence && quote.customerPricePence > costs && quote.customerPricePence - costs >= 1800 && (quote.customerPricePence - costs) * 10000 >= quote.customerPricePence * 2000 && quote.targetContributionPence === 1800 && quote.responseDeadline === "2026-07-15T13:00:00.000Z", "Private pricing did not cover cleaner pay, the frozen risk allowance, costs, both profit floors and a bounded response window.");
assert(await rejects(() => Promise.resolve(createBookingPricingPolicy({ targetMarginBasisPoints: 0 })), "Target margin"), "A zero-margin policy was accepted.");
assert(await rejects(() => Promise.resolve(createBookingPricingPolicy({ targetMarginBasisPoints: 2000 })), "Minimum booking contribution"), "A missing pounds-per-booking floor was accepted.");
assert(await rejects(() => Promise.resolve(createBookingPricingPolicy({ targetMarginBasisPoints: 7000, minimumContributionPence: 1, paymentFeeBasisPoints: 1000, riskContingencyBasisPoints: 2000 })), "must leave room"), "An impossible combined margin, fee and contingency policy was accepted.");
assert(await rejects(() => Promise.resolve(policy.quote({ ...candidate, services: [{ serviceCode: "regular-domestic", pricingModel: "quote", pricePence: null }] }, now)), "manual quote"), "A manual-quote service was silently priced.");
const distancePolicy = createBookingPricingPolicy({
  targetMarginBasisPoints: 2000,
  minimumContributionPence: 1800,
  labourOnCostBasisPoints: 1000,
  paymentFeeBasisPoints: 300,
  paymentFeeFixedPence: 20,
  riskContingencyBasisPoints: 500,
  travelCostPence: 500,
  travelCostPerKmPence: 35,
  travelDistanceMultiplierBasisPoints: 20000,
  suppliesCostPence: 250,
  invitationTtlMinutes: 180
});
const distanceQuote = distancePolicy.quote(candidate, now);
const nearbyQuote = distancePolicy.quote({ ...candidate, distance_km: "1.00" }, now);
assert(distanceQuote.travelCostPence === 1368 && nearbyQuote.travelCostPence === 570 && distanceQuote.customerPricePence > nearbyQuote.customerPricePence, "Distance-aware pricing did not freeze the approved base plus multiplied per-kilometre travel cost into the customer total.");
for (const suppliedDistance of [null, "", "not-a-distance", "-1", "500.01"]) {
  assert(await rejectsCode(() => Promise.resolve(distancePolicy.quote({ ...candidate, distance_km: suppliedDistance }, now)), "travel-distance-unavailable"), `Unsafe travel distance ${String(suppliedDistance)} was priced instead of failing closed.`);
}
const excessiveTravelPolicy = createBookingPricingPolicy({ targetMarginBasisPoints: 2000, minimumContributionPence: 1, travelCostPence: 999999, travelCostPerKmPence: 100000, travelDistanceMultiplierBasisPoints: 50000 });
assert(await rejectsCode(() => Promise.resolve(excessiveTravelPolicy.quote({ ...candidate, distance_km: "500" }, now)), "request-not-priceable"), "An excessive distance cost escaped the supported frozen travel-cost ceiling.");
assert(bookingPricingPolicyFromEnvironment({}) === null && await rejects(() => Promise.resolve(bookingPricingPolicyFromEnvironment({ BOOKING_TARGET_MARGIN_BPS: "2000" })), "complete private"), "Missing or partial booking economics did not fail closed.");
const previousEnvironmentPolicy = { BOOKING_TARGET_MARGIN_BPS: "2000", BOOKING_MINIMUM_CONTRIBUTION_PENCE: "1800", BOOKING_LABOUR_ON_COST_BPS: "1000", BOOKING_PAYMENT_FEE_BPS: "300", BOOKING_PAYMENT_FEE_FIXED_PENCE: "20", BOOKING_RISK_CONTINGENCY_BPS: "500", BOOKING_TRAVEL_COST_PENCE: "500", BOOKING_SUPPLIES_COST_PENCE: "250", BOOKING_OTHER_COST_PENCE: "0", BOOKING_INVITATION_TTL_MINUTES: "180" };
assert(await rejects(() => Promise.resolve(bookingPricingPolicyFromEnvironment(previousEnvironmentPolicy)), "complete private"), "The previous fixed-only environment silently activated without an explicit distance rate and distance multiplier.");
const configuredPolicy = bookingPricingPolicyFromEnvironment({ ...previousEnvironmentPolicy, BOOKING_TRAVEL_COST_PER_KM_PENCE: "35", BOOKING_TRAVEL_DISTANCE_MULTIPLIER_BPS: "20000" });
assert(configuredPolicy.quote(candidate, now).customerPricePence === distanceQuote.customerPricePence, "Complete private distance-aware environment pricing did not compose deterministically.");

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
const workflow = createBookingWorkflowService(fakeRepository, { pricingPolicy: policy, clock: () => new Date(now) });
const [landlordBookings, cleanerBookings] = await Promise.all([workflow.listParticipantBookings(landlord), workflow.listParticipantBookings(cleaner, { limit: "25" })]);
assert(landlordBookings[0].pricePence === quote.customerPricePence && landlordBookings[0].pricePerspective === "customer-total" && landlordBookings[0].paymentStepAvailable === true, "The Landlord booking list lost the customer total or payment action.");
assert(cleanerBookings[0].pricePence === quote.cleanerPayPence && cleanerBookings[0].pricePerspective === "cleaner-pay" && !Object.hasOwn(cleanerBookings[0], "paymentStepAvailable") && !Object.hasOwn(cleanerBookings[0], "paymentAuthorizationReady") && !Object.hasOwn(cleanerBookings[0], "paymentStepOpensAt") && JSON.stringify(cleanerBookings).includes(String(quote.customerPricePence)) === false, "The Cleaner booking list exposed the customer total, Landlord payment state or lost the offered pay.");
const repeatWorkflow = createBookingWorkflowService({ ...fakeRepository, async listParticipantBookings() { return [{ ...landlordBookings[0], status: "completed", propertyId, cleanerId: cleaner.userId, paymentStepAvailable: false }]; } }, { pricingPolicy: policy });
const [repeatBooking] = await repeatWorkflow.listParticipantBookings(landlord);
assert(repeatBooking.propertyId === propertyId && repeatBooking.cleanerId === cleaner.userId, "A completed Landlord booking lost its owner-authorized repeat-booking identifiers.");
const cleanerPrivacyWorkflow = createBookingWorkflowService({ ...fakeRepository, async listParticipantBookings() { return [{ ...cleanerBookings[0], status: "completed", propertyId, cleanerId: cleaner.userId }]; } }, { pricingPolicy: policy });
const [cleanerPrivacyBooking] = await cleanerPrivacyWorkflow.listParticipantBookings(cleaner);
assert(!Object.hasOwn(cleanerPrivacyBooking, "propertyId") && !Object.hasOwn(cleanerPrivacyBooking, "cleanerId"), "The Cleaner summary received Landlord-only repeat-booking identifiers.");
const paymentOpensAt = "2026-07-25T09:00:00.000Z";
const earlyPaymentWorkflow = createBookingWorkflowService({ ...fakeRepository, async listParticipantBookings() { return [{ ...landlordBookings[0], paymentStepAvailable: false, paymentAuthorizationReady: false, paymentStepOpensAt: paymentOpensAt }]; } }, { pricingPolicy: policy });
const [earlyPaymentBooking] = await earlyPaymentWorkflow.listParticipantBookings(landlord);
assert(earlyPaymentBooking.paymentStepAvailable === false && earlyPaymentBooking.paymentAuthorizationReady === false && earlyPaymentBooking.paymentStepOpensAt === paymentOpensAt, "The participant projection lost the server-owned payment opening time.");
const inconsistentPaymentWorkflow = createBookingWorkflowService({ ...fakeRepository, async listParticipantBookings() { return [{ ...landlordBookings[0], paymentAuthorizationReady: true, paymentStepAvailable: true }]; } }, { pricingPolicy: policy });
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
const payoutUnreadyInvitationWorkflow = createBookingWorkflowService(payoutUnreadyInvitationRepository, { pricingPolicy: policy, clock: () => new Date(now), requirePayoutReady: true, getPayoutReadiness: async () => ({ ready: false }) });
assert(await rejectsCode(() => payoutUnreadyInvitationWorkflow.previewInvitation(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId }), "cleaner-payout-not-ready"), "A Landlord received a paid quote for a Cleaner without a verified payout destination.");
assert(await rejectsCode(() => payoutUnreadyInvitationWorkflow.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId, approvedCustomerPricePence: quote.customerPricePence }), "cleaner-payout-not-ready") && paidInvitationWrites === 0, "A paid direct invitation was written before the selected Cleaner had a verified payout destination.");
const payoutReadyInvitationRepository = {
  ...payoutUnreadyInvitationRepository,
  async getInvitationCandidate(...arguments_) {
    const selected = await fakeRepository.getInvitationCandidate(...arguments_);
    return { ...selected, payout_ready: true };
  }
};
const payoutReadyInvitationWorkflow = createBookingWorkflowService(payoutReadyInvitationRepository, { pricingPolicy: policy, clock: () => new Date(now), requirePayoutReady: true, getPayoutReadiness: async () => ({ ready: true }) });
const paidInvitationPreview = await payoutReadyInvitationWorkflow.previewInvitation(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId });
assert(paidInvitationPreview.customerPricePence === quote.customerPricePence && !Object.hasOwn(paidInvitationPreview, "payout_ready") && !Object.hasOwn(paidInvitationPreview, "payoutReady") && calls.filter((call) => call.kind === "candidate").at(-1).requirePayoutReady === true, "A payout-ready direct Cleaner could not be quoted safely or private payout readiness leaked to the Landlord.");
const paidInvitation = await payoutReadyInvitationWorkflow.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId, approvedCustomerPricePence: quote.customerPricePence });
assert(paidInvitation.status === "pending-cleaner-acceptance" && paidInvitationWrites === 1 && !Object.hasOwn(paidInvitation, "payout_ready") && !Object.hasOwn(paidInvitation, "payoutReady"), "A payout-ready direct Cleaner could not be invited or private payout readiness leaked into the booking.");
let paidResponseWrites = 0;
const paidRepository = { ...fakeRepository, async respondToInvitation(...arguments_) { paidResponseWrites += 1; return fakeRepository.respondToInvitation(...arguments_); } };
const payoutRequiredWorkflow = createBookingWorkflowService(paidRepository, { pricingPolicy: policy, requirePayoutReady: true, getPayoutReadiness: async () => ({ ready: false }) });
assert(await rejectsCode(() => payoutRequiredWorkflow.respondToInvitation(cleaner, bookingId, { decision: "accept" }), "payout-setup-required") && paidResponseWrites === 0, "A paid booking was confirmed before the Cleaner had a verified payout destination.");
const declinedWithoutPayout = await payoutRequiredWorkflow.respondToInvitation(cleaner, bookingId, { decision: "decline" });
assert(declinedWithoutPayout.status === "cancelled" && paidResponseWrites === 1, "The paid-booking payout gate incorrectly blocked a Cleaner from declining.");
const payoutReadyWorkflow = createBookingWorkflowService(paidRepository, { pricingPolicy: policy, requirePayoutReady: true, getPayoutReadiness: async () => ({ ready: true }) });
const paidAccepted = await payoutReadyWorkflow.respondToInvitation(cleaner, bookingId, { decision: "accept" });
assert(paidAccepted.status === "confirmed" && paidResponseWrites === 2, "A Cleaner with a verified payout destination could not accept a paid booking.");
const payoutUnavailableWorkflow = createBookingWorkflowService(paidRepository, { pricingPolicy: policy, requirePayoutReady: true, getPayoutReadiness: async () => { throw new Error("database unavailable"); } });
assert(await rejectsCode(() => payoutUnavailableWorkflow.respondToInvitation(cleaner, bookingId, { decision: "accept" }), "payout-readiness-unavailable") && paidResponseWrites === 2, "A payout-readiness outage did not fail closed before paid booking confirmation.");
let missingPayoutBoundaryRejected = false;
try { createBookingWorkflowService(fakeRepository, { pricingPolicy: policy, requirePayoutReady: true }); } catch (error) { missingPayoutBoundaryRejected = String(error.message).includes("payout-readiness boundary"); }
assert(missingPayoutBoundaryRejected, "Paid booking acceptance composed without a payout-readiness boundary.");
const expiredWorkflow = createBookingWorkflowService({ ...fakeRepository, async respondToInvitation() { return { id: bookingId, cleaning_request_id: requestId, status: "cancelled", scheduled_start_at: candidate.requested_start_at, scheduled_end_at: candidate.requested_end_at, cleaner_response_deadline: quote.responseDeadline, customer_price_pence: quote.customerPricePence, cleaner_pay_pence: quote.cleanerPayPence, scope_fingerprint: "a".repeat(64), terms_fingerprint: "b".repeat(64), scope_snapshot: { tasks: [] }, responded_at: null, confirmed_at: null, expired_at: now.toISOString() }; } }, { pricingPolicy: policy, clock: () => new Date(now) });
const expired = await expiredWorkflow.respondToInvitation(cleaner, bookingId, { decision: "accept" });
assert(expired.status === "cancelled" && expired.expiredAt === now.toISOString() && expired.respondedAt === null, "An expired invitation did not return its terminal timestamp without fabricating a Cleaner response.");
assert(await rejects(() => workflow.inviteCleaner(cleaner, { cleaningRequestId: requestId, cleanerId: cleaner.userId }), "Landlord"), "A Cleaner could create an invitation.");
const dualRoleActor = { userId: landlord.userId, roles: ["cleaner", "landlord"] };
assert(await rejects(() => workflow.previewInvitation(dualRoleActor, { cleaningRequestId: requestId, cleanerId: landlord.userId }), "cannot be invited to your own"), "A dual-workspace account could preview an invitation to its own Cleaner profile.");
assert(await rejects(() => workflow.respondToInvitation(landlord, bookingId, { decision: "accept" }), "Cleaner"), "A Landlord could answer a Cleaner invitation.");
const disabled = createBookingWorkflowService(fakeRepository);
assert(await rejects(() => disabled.inviteCleaner(landlord, { cleaningRequestId: requestId, cleanerId: cleaner.userId }), "pricing policy"), "Invitations did not fail closed without private pricing configuration.");

const sqlCalls = [];
let failure = null;
const database = { async withUserTransaction(actor, operation) { return operation({ async query(text, values) { sqlCalls.push({ actor, text, values }); if (failure) throw failure; if (text.includes("coverage.distance_km")) return { rows: [{ id: requestId, distance_km: "4.20" }] }; return { rows: [{ id: bookingId }] }; } }); } };
const repository = createBookingRepository(database);
const selectedCandidate = await repository.getInvitationCandidate(landlord, requestId, cleaner.userId);
await repository.listParticipantBookings(cleaner, 50);
await repository.inviteCleaner(landlord, { bookingId, requestId, cleanerId: cleaner.userId, responseDeadline: quote.responseDeadline, customerPricePence: quote.customerPricePence, cleanerPayPence: quote.cleanerPayPence, labourOnCostPence: quote.labourOnCostPence, paymentFeePence: quote.paymentFeePence, travelCostPence: quote.travelCostPence, suppliesCostPence: quote.suppliesCostPence, otherCostPence: quote.otherCostPence, targetMarginBasisPoints: quote.targetMarginBasisPoints, targetContributionPence: quote.targetContributionPence });
await repository.respondToInvitation(cleaner, bookingId, { decision: "accept", reason: null });
assert(selectedCandidate.distance_km === "4.20" && sqlCalls[0].text.includes("JOIN properties property") && sqlCalls[0].text.includes("cleaner_service_areas") && sqlCalls[0].text.includes("coverage.distance_km") && sqlCalls[0].text.includes("profile.user_id<>request.landlord_user_id") && sqlCalls[0].text.includes("cleaner_payout_ready_for_paid_booking") && sqlCalls[0].text.includes("$4::boolean") && sqlCalls[0].values[1] === cleaner.userId && sqlCalls[0].values[3] === false, "Direct Cleaner invitation pricing did not bind the selected Cleaner to property distance evidence, self-exclusion and an explicit paid-mode payout gate.");
assert(sqlCalls[1].text.includes("list_my_booking_summaries") && sqlCalls[1].values[0] === 50 && sqlCalls[2].text.includes("tideway_private.invite_cleaner") && sqlCalls[2].values.length === 13 && sqlCalls[2].values[12] === 1800 && sqlCalls[3].text.includes("respond_to_cleaner_invitation") && sqlCalls[3].actor.userId === cleaner.userId, "Booking repository bypassed participant-safe summaries, actor-bound audited transitions or both parameterized profit targets.");
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

// Booking cancellation. `confirmed:cancelled` was a permitted Landlord
// transition with no database function and no route behind it, so a customer
// could not cancel and could not get their card hold released — which also
// stranded refunds, because a refund requires a cancelled, completed or
// disputed booking.
const cancelledRecord = { id: bookingId, cleaning_request_id: requestId, landlord_user_id: landlord.userId, cleaner_user_id: cleaner.userId, status: "cancelled", scheduled_start_at: candidate.requested_start_at, scheduled_end_at: candidate.requested_end_at, cleaner_response_deadline: quote.responseDeadline, customer_price_pence: quote.customerPricePence, cleaner_pay_pence: quote.cleanerPayPence, scope_fingerprint: "a".repeat(64), terms_fingerprint: "b".repeat(64), scope_snapshot: { tasks: [] }, responded_at: now.toISOString(), confirmed_at: null, expired_at: null };
const cancelCalls = [];
const cancelRepository = { ...fakeRepository, async cancelBooking(actor, suppliedBookingId, reason) { cancelCalls.push({ actor, suppliedBookingId, reason }); return cancelledRecord; } };

const releasingWorkflow = createBookingWorkflowService(cancelRepository, {
  pricingPolicy: policy,
  releaseAuthorization: async () => ({ released: true, message: "Your card hold has been released. You have not been charged.", code: "released" })
});
const cancellation = await releasingWorkflow.cancelBooking(landlord, bookingId, { reason: "Plans changed" });
assert(cancellation.booking.status === "cancelled" && cancellation.holdRelease.released === true, "Cancelling a booking did not cancel it or did not release the card hold.");
assert(cancelCalls.length === 1 && cancelCalls[0].reason === "Plans changed" && cancelCalls[0].suppliedBookingId === bookingId, "The cancellation reason or booking identity did not reach the repository.");

// Only the customer cancels this way. A Cleaner who wants out declines the
// invitation or raises a dispute; letting them cancel would let them drop
// confirmed work without either record being made.
assert(await rejects(() => releasingWorkflow.cancelBooking(cleaner, bookingId, {}), "Landlord account is required"), "A Cleaner was allowed to cancel a Landlord's booking.");
assert(await rejects(() => releasingWorkflow.cancelBooking(landlord, "not-a-uuid", {}), "booking id"), "A malformed booking id was accepted for cancellation.");

// A booking cancelled before the payment window ever opened has no hold to
// release. That is ordinary, not a failure.
const unpaidWorkflow = createBookingWorkflowService(cancelRepository, {
  pricingPolicy: policy,
  releaseAuthorization: async () => ({ released: false, message: "No payment had been taken, so there is nothing to release.", code: "no-payment" })
});
const unpaidCancellation = await unpaidWorkflow.cancelBooking(landlord, bookingId, {});
assert(unpaidCancellation.booking.status === "cancelled" && unpaidCancellation.holdRelease.code === "no-payment", "Cancelling a booking with no payment did not succeed cleanly.");

// The booking is genuinely cancelled even when the provider call fails. Telling
// the customer their cancellation did not work, when it did, would send them
// back to cancel a booking that no longer exists.
const failingWorkflow = createBookingWorkflowService(cancelRepository, {
  pricingPolicy: policy,
  releaseAuthorization: async () => { throw Object.assign(new Error("provider unavailable"), { code: "provider-unavailable" }); }
});
const failedRelease = await failingWorkflow.cancelBooking(landlord, bookingId, {});
assert(failedRelease.booking.status === "cancelled" && failedRelease.holdRelease.released === false && failedRelease.holdRelease.code === "provider-unavailable", "A failed hold release either un-cancelled the booking or hid the failure.");
assert(!failedRelease.holdRelease.message.toLowerCase().includes("charged you") && failedRelease.holdRelease.message.includes("not a charge"), "The failed-release message does not tell the customer a hold is not a charge.");

// Payments are optional; a deployment without them must still be cancellable.
const noPaymentsWorkflow = createBookingWorkflowService(cancelRepository, { pricingPolicy: policy });
const noPaymentsCancellation = await noPaymentsWorkflow.cancelBooking(landlord, bookingId, {});
assert(noPaymentsCancellation.booking.status === "cancelled" && noPaymentsCancellation.holdRelease === null, "A deployment without payments attached could not cancel a booking.");

const cancellationMigration = await readFile(new URL("../db/migrations/115_landlord_booking_cancellation.sql", import.meta.url), "utf8");
for (const required of ["cancel_booking_as_landlord", "landlord-required", "booking-not-found", "booking-not-cancellable", "previous_status", "booking_status_history", "cleaning_request_status_history", "journey_started_at IS NOT NULL", "ON CONFLICT (idempotency_key) DO NOTHING", "GRANT EXECUTE"]) assert(cancellationMigration.includes(required), `The cancellation migration omitted ${required}.`);
// Ownership is proven by the lookup rather than a separate check that could
// drift from it, and the permitted statuses must match domain.mjs exactly.
assert(cancellationMigration.includes("booking.landlord_user_id = actor_id"), "Cancellation does not bind the booking to the acting Landlord.");
assert(cancellationMigration.includes("IF booking_record.status = 'cancelled' THEN") && cancellationMigration.includes("RETURN booking_record;"), "Cancelling twice is treated as an error rather than the outcome the customer already asked for.");
assert(cancellationMigration.indexOf("previous_status := booking_record.status") < cancellationMigration.indexOf("UPDATE bookings"), "The status history would record 'cancelled' moving to itself.");
const domainSource = await readFile(new URL("../src/marketplace/domain.mjs", import.meta.url), "utf8");
for (const permitted of ["draft", "searching-for-cleaner", "cleaner-invited", "pending-cleaner-acceptance", "confirmed"]) assert(domainSource.includes(`"${permitted}:cancelled"`) && cancellationMigration.includes(`'${permitted}'`), `The cancellable statuses in the migration and domain.mjs disagree about ${permitted}.`);
const httpSource = await readFile(new URL("../src/marketplace/marketplace-http.mjs", import.meta.url), "utf8");
assert(httpSource.includes("bookingCancellationPath") && /bookingCancellationPath[\s\S]{0,400}roles: \["landlord"\]/.test(httpSource), "The cancellation route is missing or is not restricted to the Landlord who owns the booking.");
assert(runtimeSource.includes("releaseAuthorization") && runtimeSource.includes("paymentService.cancel(actor,"), "Cancelling a booking does not release the customer's card hold.");

console.log("Booking workflow tests passed: server-owned two-floor profitable terms, frozen scope, authoritative property/coverage/pay/availability eligibility, decline/retry history, idempotent responses, concurrent overlap protection and customer cancellation that releases the card hold.");
