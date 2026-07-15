import { randomUUID } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function bookingProjection(record, actor) {
  const base = {
    bookingId: record.id,
    cleaningRequestId: record.cleaning_request_id,
    status: record.status,
    scheduledStartAt: new Date(record.scheduled_start_at).toISOString(),
    scheduledEndAt: new Date(record.scheduled_end_at).toISOString(),
    responseDeadline: new Date(record.cleaner_response_deadline).toISOString(),
    customerPricePence: Number(record.customer_price_pence),
    scopeFingerprint: record.scope_fingerprint,
    termsFingerprint: record.terms_fingerprint,
    scope: typeof record.scope_snapshot === "string" ? JSON.parse(record.scope_snapshot) : record.scope_snapshot,
    respondedAt: record.responded_at ? new Date(record.responded_at).toISOString() : null,
    confirmedAt: record.confirmed_at ? new Date(record.confirmed_at).toISOString() : null
  };
  if (actor?.roles?.includes("cleaner")) base.cleanerPayPence = Number(record.cleaner_pay_pence);
  return base;
}

export function createBookingPricingPolicy(configuration = {}) {
  const config = {
    targetMarginBasisPoints: integer(configuration.targetMarginBasisPoints, 1, 9000, "Target margin"),
    labourOnCostBasisPoints: integer(configuration.labourOnCostBasisPoints ?? 0, 0, 5000, "Labour on-cost"),
    paymentFeeBasisPoints: integer(configuration.paymentFeeBasisPoints ?? 0, 0, 2000, "Payment fee"),
    paymentFeeFixedPence: integer(configuration.paymentFeeFixedPence ?? 0, 0, 10000, "Fixed payment fee"),
    travelCostPence: integer(configuration.travelCostPence ?? 0, 0, 1000000, "Travel cost"),
    suppliesCostPence: integer(configuration.suppliesCostPence ?? 0, 0, 1000000, "Supplies cost"),
    otherCostPence: integer(configuration.otherCostPence ?? 0, 0, 1000000, "Other cost"),
    invitationTtlMinutes: integer(configuration.invitationTtlMinutes ?? 180, 15, 1440, "Invitation lifetime")
  };
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
      const fixedCosts = cleanerPayPence + labourOnCostPence + config.travelCostPence + config.suppliesCostPence + config.otherCostPence + config.paymentFeeFixedPence;
      let low = fixedCosts + 1;
      let high = 10_000_000;
      while (low < high) {
        const proposed = Math.floor((low + high) / 2);
        const fee = config.paymentFeeFixedPence + Math.ceil(proposed * config.paymentFeeBasisPoints / 10000);
        const contribution = proposed - cleanerPayPence - labourOnCostPence - fee - config.travelCostPence - config.suppliesCostPence - config.otherCostPence;
        if (contribution * 10000 >= proposed * config.targetMarginBasisPoints) high = proposed;
        else low = proposed + 1;
      }
      const paymentFeePence = config.paymentFeeFixedPence + Math.ceil(low * config.paymentFeeBasisPoints / 10000);
      const finalContribution = low - cleanerPayPence - labourOnCostPence - paymentFeePence - config.travelCostPence - config.suppliesCostPence - config.otherCostPence;
      if (low > 10_000_000 || cleanerPayPence > 10_000_000 || finalContribution <= 0 || finalContribution * 10000 < low * config.targetMarginBasisPoints) throw Object.assign(new Error("The selected scope cannot be priced inside the supported safe range."), { statusCode: 409, code: "request-not-priceable" });
      const responseDeadline = new Date(Math.min(start.getTime(), now.getTime() + config.invitationTtlMinutes * 60000));
      if (responseDeadline.getTime() <= now.getTime()) throw Object.assign(new Error("The requested start time is too close to invite a cleaner."), { statusCode: 409, code: "request-too-soon" });
      return {
        customerPricePence: low,
        cleanerPayPence,
        labourOnCostPence,
        paymentFeePence,
        travelCostPence: config.travelCostPence,
        suppliesCostPence: config.suppliesCostPence,
        otherCostPence: config.otherCostPence,
        targetMarginBasisPoints: config.targetMarginBasisPoints,
        responseDeadline: responseDeadline.toISOString()
      };
    }
  });
}

export function bookingPricingPolicyFromEnvironment(env = process.env) {
  const mapping = {
    targetMarginBasisPoints: "BOOKING_TARGET_MARGIN_BPS",
    labourOnCostBasisPoints: "BOOKING_LABOUR_ON_COST_BPS",
    paymentFeeBasisPoints: "BOOKING_PAYMENT_FEE_BPS",
    paymentFeeFixedPence: "BOOKING_PAYMENT_FEE_FIXED_PENCE",
    travelCostPence: "BOOKING_TRAVEL_COST_PENCE",
    suppliesCostPence: "BOOKING_SUPPLIES_COST_PENCE",
    otherCostPence: "BOOKING_OTHER_COST_PENCE",
    invitationTtlMinutes: "BOOKING_INVITATION_TTL_MINUTES"
  };
  const present = Object.values(mapping).filter((name) => String(env[name] ?? "").trim() !== "");
  if (!present.length) return null;
  if (present.length !== Object.keys(mapping).length) throw new TypeError("Booking pricing configuration must provide the complete private BOOKING_* variable set.");
  return createBookingPricingPolicy(Object.fromEntries(Object.entries(mapping).map(([key, name]) => [key, Number(env[name])])));
}

export function createBookingWorkflowService(repository, options = {}) {
  if (!repository || typeof repository.getInvitationCandidate !== "function" || typeof repository.inviteCleaner !== "function" || typeof repository.respondToInvitation !== "function") throw new TypeError("A complete booking workflow repository is required.");
  const pricingPolicy = options.pricingPolicy || null;
  const clock = options.clock || (() => new Date());
  return Object.freeze({
    async inviteCleaner(actor, input = {}) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.some((role) => role === "landlord" || role === "administrator")) throw new TypeError("A Landlord account is required to invite a cleaner.");
      if (!pricingPolicy || typeof pricingPolicy.quote !== "function") throw Object.assign(new Error("Booking invitations are unavailable until the private pricing policy is configured."), { statusCode: 503, code: "pricing-not-configured" });
      const requestId = uuid(input.cleaningRequestId, "cleaning request id");
      const cleanerId = uuid(input.cleanerId, "cleaner id");
      const candidate = await repository.getInvitationCandidate(actor, requestId, cleanerId);
      if (!candidate) throw Object.assign(new Error("The cleaning request or cleaner was not found."), { statusCode: 404, code: "candidate-not-found" });
      const terms = pricingPolicy.quote(candidate, clock());
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
