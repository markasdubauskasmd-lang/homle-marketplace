import { randomUUID } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const bookingPricingEnvironmentRules = Object.freeze([
  Object.freeze({ property: "targetMarginBasisPoints", key: "BOOKING_TARGET_MARGIN_BPS", minimum: 1, maximum: 9000 }),
  Object.freeze({ property: "minimumContributionPence", key: "BOOKING_MINIMUM_CONTRIBUTION_PENCE", minimum: 1, maximum: 10_000_000 }),
  Object.freeze({ property: "labourOnCostBasisPoints", key: "BOOKING_LABOUR_ON_COST_BPS", minimum: 0, maximum: 5000 }),
  Object.freeze({ property: "paymentFeeBasisPoints", key: "BOOKING_PAYMENT_FEE_BPS", minimum: 0, maximum: 2000 }),
  Object.freeze({ property: "paymentFeeFixedPence", key: "BOOKING_PAYMENT_FEE_FIXED_PENCE", minimum: 0, maximum: 10_000 }),
  Object.freeze({ property: "riskContingencyBasisPoints", key: "BOOKING_RISK_CONTINGENCY_BPS", minimum: 0, maximum: 5000 }),
  Object.freeze({ property: "travelCostPence", key: "BOOKING_TRAVEL_COST_PENCE", minimum: 0, maximum: 1_000_000 }),
  Object.freeze({ property: "travelCostPerKmPence", key: "BOOKING_TRAVEL_COST_PER_KM_PENCE", minimum: 0, maximum: 100_000 }),
  Object.freeze({ property: "travelDistanceMultiplierBasisPoints", key: "BOOKING_TRAVEL_DISTANCE_MULTIPLIER_BPS", minimum: 1, maximum: 50_000 }),
  Object.freeze({ property: "suppliesCostPence", key: "BOOKING_SUPPLIES_COST_PENCE", minimum: 0, maximum: 1_000_000 }),
  Object.freeze({ property: "otherCostPence", key: "BOOKING_OTHER_COST_PENCE", minimum: 0, maximum: 1_000_000 }),
  Object.freeze({ property: "invitationTtlMinutes", key: "BOOKING_INVITATION_TTL_MINUTES", minimum: 15, maximum: 1440 })
]);

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

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

function serviceRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function priceableTravelCost(candidate, config) {
  if (config.travelCostPerKmPence === 0) return config.travelCostPence;
  const suppliedDistance = candidate?.distance_km;
  const distanceKm = suppliedDistance == null || suppliedDistance === "" ? Number.NaN : Number(suppliedDistance);
  if (!Number.isFinite(distanceKm) || distanceKm < 0 || distanceKm > 500) {
    throw Object.assign(new Error("The cleaner-to-property travel distance is unavailable, so this request cannot be priced safely."), { statusCode: 409, code: "travel-distance-unavailable" });
  }
  const distanceCostPence = Math.ceil(distanceKm * config.travelCostPerKmPence * config.travelDistanceMultiplierBasisPoints / 10000);
  const totalTravelCostPence = config.travelCostPence + distanceCostPence;
  if (!Number.isSafeInteger(distanceCostPence) || distanceCostPence < 0 || !Number.isSafeInteger(totalTravelCostPence) || totalTravelCostPence > 1_000_000) {
    throw Object.assign(new Error("The selected travel distance cannot be priced inside the supported safe range."), { statusCode: 409, code: "request-not-priceable" });
  }
  return totalTravelCostPence;
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

const bookingStatuses = new Set(["draft", "searching-for-cleaner", "cleaner-invited", "pending-cleaner-acceptance", "confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "cancelled", "disputed"]);

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

export function createBookingPricingPolicy(configuration = {}) {
  const config = {
    targetMarginBasisPoints: integer(configuration.targetMarginBasisPoints, 1, 9000, "Target margin"),
    minimumContributionPence: integer(configuration.minimumContributionPence, 1, 10_000_000, "Minimum booking contribution"),
    labourOnCostBasisPoints: integer(configuration.labourOnCostBasisPoints ?? 0, 0, 5000, "Labour on-cost"),
    paymentFeeBasisPoints: integer(configuration.paymentFeeBasisPoints ?? 0, 0, 2000, "Payment fee"),
    paymentFeeFixedPence: integer(configuration.paymentFeeFixedPence ?? 0, 0, 10000, "Fixed payment fee"),
    riskContingencyBasisPoints: integer(configuration.riskContingencyBasisPoints ?? 0, 0, 5000, "Risk contingency"),
    travelCostPence: integer(configuration.travelCostPence ?? 0, 0, 1000000, "Travel cost"),
    travelCostPerKmPence: integer(configuration.travelCostPerKmPence ?? 0, 0, 100000, "Travel cost per kilometre"),
    travelDistanceMultiplierBasisPoints: integer(configuration.travelDistanceMultiplierBasisPoints ?? 10000, 1, 50000, "Travel distance multiplier"),
    suppliesCostPence: integer(configuration.suppliesCostPence ?? 0, 0, 1000000, "Supplies cost"),
    otherCostPence: integer(configuration.otherCostPence ?? 0, 0, 1000000, "Other cost"),
    invitationTtlMinutes: integer(configuration.invitationTtlMinutes ?? 180, 15, 1440, "Invitation lifetime")
  };
  if (config.targetMarginBasisPoints + config.paymentFeeBasisPoints + config.riskContingencyBasisPoints >= 10000) {
    throw new TypeError("Target margin, payment fee and risk contingency must leave room to cover the cleaning costs.");
  }
  return Object.freeze({
    quote(candidate, now = new Date()) {
      const start = new Date(candidate.requested_start_at);
      const end = new Date(candidate.requested_end_at);
      const durationMinutes = Math.ceil((end.getTime() - start.getTime()) / 60000);
      if (!Number.isInteger(durationMinutes) || durationMinutes < 30) throw new TypeError("The request duration cannot be priced.");
      const prices = new Map(serviceRows(candidate.services).map((service) => [service.serviceCode ?? service.service_code, service]));
      let cleanerPayPence = 0;
      const requiredServices = Array.isArray(candidate.required_services) ? candidate.required_services : [];
      if (!requiredServices.length) throw Object.assign(new Error("The cleaning request has no priceable services."), { statusCode: 409, code: "request-not-priceable" });
      for (const required of requiredServices) {
        const service = prices.get(required);
        const price = Number(service?.pricePence ?? service?.price_pence);
        const model = service?.pricingModel ?? service?.pricing_model;
        if (!Number.isInteger(price) || price < 1 || model === "quote") throw Object.assign(new Error("This cleaner requires a manual quote for the selected scope."), { statusCode: 409, code: "manual-quote-required" });
        cleanerPayPence += model === "hourly" ? Math.ceil(price * durationMinutes / 60) : price;
      }
      const labourOnCostPence = Math.ceil(cleanerPayPence * config.labourOnCostBasisPoints / 10000);
      const travelCostPence = priceableTravelCost(candidate, config);
      const fixedCosts = cleanerPayPence + labourOnCostPence + travelCostPence + config.suppliesCostPence + config.otherCostPence + config.paymentFeeFixedPence;
      let low = fixedCosts + 1;
      let high = 10_000_000;
      while (low < high) {
        const proposed = Math.floor((low + high) / 2);
        const fee = config.paymentFeeFixedPence + Math.ceil(proposed * config.paymentFeeBasisPoints / 10000);
        const riskContingencyPence = Math.ceil(proposed * config.riskContingencyBasisPoints / 10000);
        const contribution = proposed - cleanerPayPence - labourOnCostPence - fee - riskContingencyPence - travelCostPence - config.suppliesCostPence - config.otherCostPence;
        if (contribution >= config.minimumContributionPence && contribution * 10000 >= proposed * config.targetMarginBasisPoints) high = proposed;
        else low = proposed + 1;
      }
      const paymentFeePence = config.paymentFeeFixedPence + Math.ceil(low * config.paymentFeeBasisPoints / 10000);
      const riskContingencyPence = Math.ceil(low * config.riskContingencyBasisPoints / 10000);
      const frozenOtherCostPence = config.otherCostPence + riskContingencyPence;
      const finalContribution = low - cleanerPayPence - labourOnCostPence - paymentFeePence - frozenOtherCostPence - travelCostPence - config.suppliesCostPence;
      if (low > 10_000_000 || cleanerPayPence > 10_000_000 || finalContribution < config.minimumContributionPence || finalContribution * 10000 < low * config.targetMarginBasisPoints) throw Object.assign(new Error("The selected scope cannot be priced inside the supported safe range."), { statusCode: 409, code: "request-not-priceable" });
      const responseDeadline = new Date(Math.min(start.getTime(), now.getTime() + config.invitationTtlMinutes * 60000));
      if (responseDeadline.getTime() <= now.getTime()) throw Object.assign(new Error("The requested start time is too close to invite a cleaner."), { statusCode: 409, code: "request-too-soon" });
      return {
        customerPricePence: low,
        cleanerPayPence,
        labourOnCostPence,
        paymentFeePence,
        riskContingencyPence,
        travelCostPence,
        suppliesCostPence: config.suppliesCostPence,
        otherCostPence: frozenOtherCostPence,
        targetMarginBasisPoints: config.targetMarginBasisPoints,
        targetContributionPence: config.minimumContributionPence,
        responseDeadline: responseDeadline.toISOString()
      };
    }
  });
}

export function bookingPricingPolicyFromEnvironment(env = process.env) {
  const present = bookingPricingEnvironmentRules.filter(({ key }) => String(env[key] ?? "").trim() !== "");
  if (!present.length) return null;
  if (present.length !== bookingPricingEnvironmentRules.length) throw new TypeError("Booking pricing configuration must provide the complete private BOOKING_* variable set.");
  return createBookingPricingPolicy(Object.fromEntries(bookingPricingEnvironmentRules.map(({ property, key }) => [property, Number(env[key])])));
}

export function createBookingWorkflowService(repository, options = {}) {
  if (!repository || typeof repository.listParticipantBookings !== "function" || typeof repository.getInvitationCandidate !== "function" || typeof repository.inviteCleaner !== "function" || typeof repository.respondToInvitation !== "function") throw new TypeError("A complete booking workflow repository is required.");
  const pricingPolicy = options.pricingPolicy || null;
  const clock = options.clock || (() => new Date());
  async function invitationQuote(actor, input = {}) {
    if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.some((role) => role === "landlord" || role === "administrator")) throw new TypeError("A Landlord account is required to price a Cleaner invitation.");
    if (!pricingPolicy || typeof pricingPolicy.quote !== "function") throw Object.assign(new Error("Booking invitations are unavailable until the private pricing policy is configured."), { statusCode: 503, code: "pricing-not-configured" });
    const requestId = uuid(input.cleaningRequestId, "cleaning request id");
    const cleanerId = uuid(input.cleanerId, "cleaner id");
    if (cleanerId === actor.userId.toLowerCase()) throw Object.assign(new Error("Your Cleaner workspace cannot be invited to your own cleaning request."), { statusCode: 409, code: "self-booking-not-allowed" });
    const candidate = await repository.getInvitationCandidate(actor, requestId, cleanerId);
    if (!candidate) throw Object.assign(new Error("The cleaning request or cleaner was not found."), { statusCode: 404, code: "candidate-not-found" });
    return Object.freeze({ requestId, cleanerId, terms: pricingPolicy.quote(candidate, clock()) });
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
      const decision = boundedText(input.decision, 20, "Invitation decision").toLowerCase();
      if (decision !== "accept" && decision !== "decline") throw new TypeError("Choose accept or decline.");
      const reason = boundedText(input.reason, 1000, "Decline reason") || null;
      const record = await repository.respondToInvitation(actor, uuid(bookingId, "booking id"), { decision, reason });
      return bookingProjection(record, actor);
    }
  });
}
