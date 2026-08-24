import { randomUUID } from "node:crypto";
import { uuid, uuidPattern } from "./validation.mjs";
import { bookingStatuses as canonicalBookingStatuses } from "./domain.mjs";
import { normalizedPricingEconomics, quoteEconomics } from "./pricing-economics.mjs";

function boundedText(value, maximum, label) {
  const normalized = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
  if (normalized.length > maximum) throw new TypeError(`${label} is too long.`);
  return normalized;
}

function integer(value, minimum, maximum, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return normalized;
}

// Postgres hands jsonb back as an array; a driver configured differently hands
// back a string. Both are the same rows.
function taskRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function bookingProjection(record, actor) {
  const base = {
    bookingId: record.id,
    cleaningRequestId: record.cleaning_request_id,
    status: record.status,
    scheduledStartAt: new Date(record.scheduled_start_at).toISOString(),
    scheduledEndAt: new Date(record.scheduled_end_at).toISOString(),
    responseDeadline: new Date(record.cleaner_response_deadline).toISOString(),
    scopeFingerprint: record.scope_fingerprint,
    termsFingerprint: record.terms_fingerprint,
    scope: typeof record.scope_snapshot === "string" ? JSON.parse(record.scope_snapshot) : record.scope_snapshot,
    respondedAt: record.responded_at ? new Date(record.responded_at).toISOString() : null,
    confirmedAt: record.confirmed_at ? new Date(record.confirmed_at).toISOString() : null,
    expiredAt: record.expired_at ? new Date(record.expired_at).toISOString() : null
  };
  const exactLandlord = record.landlord_user_id ? record.landlord_user_id === actor?.userId : actor?.roles?.includes("landlord") && !actor?.roles?.includes("cleaner");
  const exactCleaner = record.cleaner_user_id ? record.cleaner_user_id === actor?.userId : actor?.roles?.includes("cleaner") && !actor?.roles?.includes("landlord");
  if (exactLandlord || actor?.roles?.includes("administrator")) base.customerPricePence = Number(record.customer_price_pence);
  if (exactCleaner || actor?.roles?.includes("administrator")) base.cleanerPayPence = Number(record.cleaner_pay_pence);
  return base;
}

// Built from the canonical list rather than restated. The same twelve values are the
// PostgreSQL `booking_status` enum, and a private copy here would keep rejecting a new
// status after the enum and the domain had both been updated.
const bookingStatuses = new Set(canonicalBookingStatuses);

function optionalIso(value, label) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Booking ${label} is unavailable.`);
  return date.toISOString();
}

function summaryText(value, maximum, fallback = "") {
  const normalized = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
  return normalized && normalized.length <= maximum ? normalized : fallback;
}

function participantBookingProjection(record, actor) {
  if (!record || typeof record !== "object") throw new Error("A booking summary is unavailable.");
  const bookingId = uuid(record.bookingId ?? record.booking_id, "booking id");
  const participantRole = record.participantRole ?? record.participant_role;
  if (participantRole !== "cleaner" && participantRole !== "landlord") throw new Error("Booking participant role is unavailable.");
  if (!actor?.roles?.includes(participantRole)) throw new Error("Booking participant role did not match the authenticated account.");
  const status = String(record.status || "");
  if (!bookingStatuses.has(status)) throw new Error("Booking status is unavailable.");
  const pricePence = Number(record.pricePence ?? record.price_pence);
  const pricePerspective = record.pricePerspective ?? record.price_perspective;
  const expectedPerspective = participantRole === "cleaner" ? "cleaner-pay" : "customer-total";
  if (!Number.isInteger(pricePence) || pricePence < 1 || pricePence > 10_000_000 || pricePerspective !== expectedPerspective) throw new Error("Participant booking price is unavailable.");
  const taskCount = Number(record.taskCount ?? record.task_count);
  if (!Number.isInteger(taskCount) || taskCount < 0 || taskCount > 10_000) throw new Error("Booking task count is unavailable.");
  const scheduledStartAt = optionalIso(record.scheduledStartAt ?? record.scheduled_start_at, "start time");
  const scheduledEndAt = optionalIso(record.scheduledEndAt ?? record.scheduled_end_at, "end time");
  if (!scheduledStartAt || !scheduledEndAt || Date.parse(scheduledEndAt) <= Date.parse(scheduledStartAt)) throw new Error("Booking schedule is unavailable.");
  const propertyArea = summaryText(record.propertyArea ?? record.property_area, 4);
  if (propertyArea && !/^[A-Z]{1,2}[0-9][A-Z0-9]?$/.test(propertyArea)) throw new Error("Booking area is unavailable.");
  const paymentAuthorizationReady = participantRole === "landlord" && status === "confirmed" && (record.paymentAuthorizationReady === true || record.payment_authorization_ready === true);
  const paymentStepAvailable = participantRole === "landlord" && status === "confirmed" && (record.paymentStepAvailable === true || record.payment_step_available === true);
  const paymentStepOpensAt = participantRole === "landlord" && status === "confirmed" ? optionalIso(record.paymentStepOpensAt ?? record.payment_step_opens_at, "payment opening time") : null;
  const repeatBookingIdentifiers = participantRole === "landlord" && status === "completed" && (record.propertyId ?? record.property_id) && (record.cleanerId ?? record.cleaner_id)
    ? { propertyId: uuid(record.propertyId ?? record.property_id, "repeat-booking property id"), cleanerId: uuid(record.cleanerId ?? record.cleaner_id, "repeat-booking Cleaner id") }
    : {};
  if ((paymentAuthorizationReady && paymentStepAvailable) || (paymentStepOpensAt && (paymentAuthorizationReady || paymentStepAvailable))) throw new Error("Booking payment timing is inconsistent.");
  return Object.freeze({
    bookingId,
    participantRole,
    status,
    scheduledStartAt,
    scheduledEndAt,
    responseDeadline: optionalIso(record.responseDeadline ?? record.response_deadline, "response deadline"),
    pricePence,
    pricePerspective,
    propertyName: summaryText(record.propertyName ?? record.property_name, 160, "Cleaning property"),
    propertyArea,
    cleaningType: summaryText(record.cleaningType ?? record.cleaning_type, 100, "Cleaning"),
    taskCount,
    counterpartyName: summaryText(record.counterpartyName ?? record.counterparty_name, 160, participantRole === "cleaner" ? "Landlord" : "Assigned Cleaner"),
    canRespond: participantRole === "cleaner" && status === "pending-cleaner-acceptance" && (record.canRespond === true || record.can_respond === true),
    activeJobAvailable: ["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "disputed"].includes(status) && (record.activeJobAvailable === true || record.active_job_available === true),
    ...repeatBookingIdentifiers,
    ...(participantRole === "landlord" ? { paymentAuthorizationReady, paymentStepAvailable, paymentStepOpensAt } : {}),
    respondedAt: optionalIso(record.respondedAt ?? record.responded_at, "response time"),
    confirmedAt: optionalIso(record.confirmedAt ?? record.confirmed_at, "confirmation time")
  });
}

export function createBookingWorkflowService(repository, options = {}) {
  if (!repository || typeof repository.listParticipantBookings !== "function" || typeof repository.getInvitationCandidate !== "function" || typeof repository.inviteCleaner !== "function" || typeof repository.respondToInvitation !== "function") throw new TypeError("A complete booking workflow repository is required.");
  // Prices a request that carries no frozen quote, from its own stored rooms
  // and tasks, through the same engine every other quote uses. Configured means
  // the cost-up path below is never reached at this seam.
  const requote = typeof options.requoteRequest === "function" ? options.requoteRequest : null;
  // The share and floors a platform-priced booking settles against. Absent
  // means the cost-up path is the only one available, which is the behaviour
  // every existing deployment already has.
  const platformEconomics = options.platformEconomics ? normalizedPricingEconomics(options.platformEconomics) : null;
  const getPlatformEconomics = typeof options.getPlatformEconomics === "function" ? options.getPlatformEconomics : null;
  // The cost-up policy owns this for its own path; the platform-priced path
  // needs the same window and cannot reach into the policy's closure for it.
  const platformInvitationTtlMinutes = integer(options.invitationTtlMinutes ?? 180, 15, 1440, "Invitation lifetime");
  const clock = options.clock || (() => new Date());
  const requirePayoutReady = options.requirePayoutReady === true;
  const getPayoutReadiness = options.getPayoutReadiness;
  if (requirePayoutReady && typeof getPayoutReadiness !== "function") throw new TypeError("Paid booking acceptance requires a Cleaner payout-readiness boundary.");
  /**
   * Terms for a request that already carries the price the customer saw.
   *
   * The customer figure is NOT recomputed here. It is the number on their
   * screen, frozen onto the request when they were shown it, and the whole
   * point is that it survives to the card unchanged — including across a
   * pricing change an operator publishes in between.
   *
   * Returns null when the request has no platform quote, so the caller falls
   * back to the cost-up path.
   */
  function platformPricedTerms(candidate, now, economics) {
    const customerPricePence = Number(candidate?.quoted_total_pence ?? candidate?.quotedTotalPence);
    const quotedMinutes = Number(candidate?.quoted_minutes ?? candidate?.quotedMinutes);
    if (!Number.isInteger(customerPricePence) || customerPricePence < 1) return null;
    if (!economics) throw Object.assign(new Error("Platform pricing is temporarily unavailable."), { statusCode: 503, code: "pricing-not-configured" });

    const settled = quoteEconomics(customerPricePence, quotedMinutes, economics);
    // Re-run every commercial floor at invitation time. The stored total is
    // immutable, but operator economics can change between scan and booking;
    // silently accepting a now-unhealthy quote would make the audit boundary
    // cosmetic rather than protective.
    if (!settled.healthy) {
      throw Object.assign(new Error("This request cannot be booked at the price it was quoted."), { statusCode: 409, code: "request-not-priceable" });
    }

    const start = new Date(candidate.requested_start_at);
    const responseDeadline = new Date(Math.min(start.getTime(), now.getTime() + platformInvitationTtlMinutes * 60000));
    if (responseDeadline.getTime() <= now.getTime()) throw Object.assign(new Error("The requested start time is too close to invite a cleaner."), { statusCode: 409, code: "request-too-soon" });

    return {
      customerPricePence,
      cleanerPayPence: settled.cleanerPayoutPence,
      labourOnCostPence: 0,
      paymentFeePence: settled.paymentFeePence,
      riskContingencyPence: 0,
      travelCostPence: 0,
      suppliesCostPence: 0,
      otherCostPence: 0,
      quotedMinutes: Number.isInteger(quotedMinutes) ? quotedMinutes : null,
      pricingConfigVersion: Number(candidate?.pricing_config_version ?? candidate?.pricingConfigVersion) || null,
      // Reported, not targeted. Under platform pricing the margin is whatever
      // the published price list produces; it is not searched for.
      targetMarginBasisPoints: settled.grossMarginBasisPoints,
      targetContributionPence: settled.grossMarginPence,
      responseDeadline: responseDeadline.toISOString()
    };
  }

  /**
   * Terms for a request saved before Homle priced up front.
   *
   * Prices the rooms and tasks the request actually carries, at today's
   * published rates, through the same engine every other quote uses.
   *
   * This is what the cost-up path used to do, and it is strictly better at this
   * seam: cost-up derived the customer price from whichever cleaner was being
   * invited, so two cleaners produced two prices for identical work. Here the
   * price belongs to the job. The caller still approves the figure before
   * anything is written, because the customer has not seen this one yet.
   */
  async function reQuotedTerms(actor, candidate, now, economics) {
    if (!economics) throw Object.assign(new Error("Platform pricing is temporarily unavailable."), { statusCode: 503, code: "pricing-not-configured" });

    const quote = await requote(actor, {
      tasks: taskRows(candidate.tasks),
      cleaningType: candidate.cleaning_type ?? candidate.cleaningType ?? "",
      postcode: candidate.property_postcode ?? candidate.propertyPostcode ?? "",
      startAt: candidate.requested_start_at,
      recurrenceRule: candidate.recurrence_rule ?? candidate.recurrenceRule ?? null
    });
    if (!quote?.priceable) {
      throw Object.assign(new Error(quote?.reason || "This request cannot be priced automatically."), { statusCode: 409, code: quote?.code || "request-not-priceable" });
    }

    const settled = quoteEconomics(quote.totalPence, quote.estimatedMinutes, economics, { payoutBasisPence: quote.payoutBasisPence });
    if (!settled.healthy) {
      throw Object.assign(new Error("This request cannot be booked at the price it works out to."), { statusCode: 409, code: "request-not-priceable" });
    }

    const start = new Date(candidate.requested_start_at);
    const responseDeadline = new Date(Math.min(start.getTime(), now.getTime() + platformInvitationTtlMinutes * 60000));
    if (responseDeadline.getTime() <= now.getTime()) throw Object.assign(new Error("The requested start time is too close to invite a cleaner."), { statusCode: 409, code: "request-too-soon" });

    return {
      customerPricePence: quote.totalPence,
      cleanerPayPence: settled.cleanerPayoutPence,
      labourOnCostPence: 0,
      paymentFeePence: settled.paymentFeePence,
      riskContingencyPence: 0,
      travelCostPence: 0,
      suppliesCostPence: 0,
      otherCostPence: 0,
      quotedMinutes: quote.estimatedMinutes,
      pricingConfigVersion: quote.configVersion ?? null,
      targetMarginBasisPoints: settled.grossMarginBasisPoints,
      targetContributionPence: settled.grossMarginPence,
      responseDeadline: responseDeadline.toISOString()
    };
  }

  async function invitationQuote(actor, input = {}) {
    if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.some((role) => role === "landlord" || role === "administrator")) throw new TypeError("A Landlord account is required to price a Cleaner invitation.");
    // NOT a guard on the whole function any more.
    //
    // It used to be, which made the legacy cost-up policy — and the twelve
    // BOOKING_* variables behind it — a hard requirement for inviting a cleaner
    // to a booking that never touches it. A deployment carrying only the
    // platform price list could not book at all. The requirement is now checked
    // where it is actually needed: below, on the cost-up branch.
    const requestId = uuid(input.cleaningRequestId, "cleaning request id");
    const cleanerId = uuid(input.cleanerId, "cleaner id");
    if (cleanerId === actor.userId.toLowerCase()) throw Object.assign(new Error("Your Cleaner workspace cannot be invited to your own cleaning request."), { statusCode: 409, code: "self-booking-not-allowed" });
    const candidate = await repository.getInvitationCandidate(actor, requestId, cleanerId, requirePayoutReady);
    if (!candidate) throw Object.assign(new Error("The cleaning request or cleaner was not found."), { statusCode: 404, code: "candidate-not-found" });
    if (requirePayoutReady && candidate.payout_ready !== true) {
      throw Object.assign(new Error("This Cleaner is not ready to receive a test payout yet. Choose another available Cleaner; no invitation or payment was created."), { statusCode: 409, code: "cleaner-payout-not-ready" });
    }
    // A request that carries the price the customer was shown is priced FROM
    // that price: the customer figure is already decided, and the cleaner is
    // paid a share of it.
    //
    const resolvedPlatformEconomics = getPlatformEconomics
      ? normalizedPricingEconomics(await getPlatformEconomics(actor))
      : platformEconomics;
    const terms = platformPricedTerms(candidate, clock(), resolvedPlatformEconomics)
      ?? (requote ? await reQuotedTerms(actor, candidate, clock(), resolvedPlatformEconomics) : null);
    if (!terms) {
      throw Object.assign(new Error("This request was saved before Homle priced requests up front, and cannot be booked until it is re-quoted."), { statusCode: 409, code: "request-not-priced" });
    }
    return Object.freeze({ requestId, cleanerId, terms });
  }
  return Object.freeze({
    async listParticipantBookings(actor, input = {}) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.some((role) => role === "cleaner" || role === "landlord")) throw new TypeError("A Cleaner or Landlord account is required to view bookings.");
      const maximumResults = input.limit == null || input.limit === "" ? 50 : integer(input.limit, 1, 100, "Booking result limit");
      const value = await repository.listParticipantBookings(actor, maximumResults);
      const records = Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value) : null;
      if (!Array.isArray(records) || records.length > maximumResults) throw new Error("Booking summaries are unavailable.");
      return records.map((record) => participantBookingProjection(record, actor));
    },
    async previewInvitation(actor, input = {}) {
      const { requestId, cleanerId, terms } = await invitationQuote(actor, input);
      return Object.freeze({ cleaningRequestId: requestId, cleanerId, customerPricePence: terms.customerPricePence, responseDeadline: terms.responseDeadline });
    },
    async inviteCleaner(actor, input = {}) {
      const { requestId, cleanerId, terms } = await invitationQuote(actor, input);
      const approvedCustomerPricePence = integer(input.approvedCustomerPricePence, 1, 10_000_000, "Approved customer total");
      if (approvedCustomerPricePence !== terms.customerPricePence) throw Object.assign(new Error("The quoted total changed. Review the current price before inviting the Cleaner."), { statusCode: 409, code: "invitation-price-changed" });
      const record = await repository.inviteCleaner(actor, { bookingId: randomUUID(), requestId, cleanerId, ...terms });
      return bookingProjection(record, actor);
    },
    async respondToInvitation(actor, bookingId, input = {}) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("cleaner")) throw new TypeError("A Cleaner account is required to answer an invitation.");
      const selectedBookingId = uuid(bookingId, "booking id");
      const decision = boundedText(input.decision, 20, "Invitation decision").toLowerCase();
      if (decision !== "accept" && decision !== "decline") throw new TypeError("Choose accept or decline.");
      const reason = boundedText(input.reason, 1000, "Decline reason") || null;
      if (decision === "accept" && requirePayoutReady) {
        let payout;
        try { payout = await getPayoutReadiness(actor); }
        catch (error) {
          throw Object.assign(new Error("Homle could not verify your payout setup, so this paid request was not accepted. Try again when the payout service is available."), { statusCode: 503, code: "payout-readiness-unavailable", cause: error });
        }
        if (payout?.ready !== true) throw Object.assign(new Error("Finish secure payout setup before accepting a paid cleaning request. No booking was confirmed."), { statusCode: 409, code: "payout-setup-required" });
      }
      const record = await repository.respondToInvitation(actor, selectedBookingId, { decision, reason });
      return bookingProjection(record, actor);
    }
  });
}
