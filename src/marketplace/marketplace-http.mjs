import { scanRates, scanReleaseRates } from "./scan-telemetry.mjs";
import { measureFromReference, measurementLabel, referenceScale } from "./room-measurement.mjs";
import { errorResponse, maximumBodyBytes, methodNotAllowed, readJsonObject, readRawBody, sendJson, maximumRoomPhotoBodyBytes, maximumRoomScanBodyBytes } from "./http-support.mjs";
import { createRateLimitBoundary } from "./rate-limit-boundary.mjs";
import { cleanerProfilePhotoMimeTypes, maximumCleanerProfilePhotoBytes } from "./cleaner-profile-photo.mjs";
import { cleanerOnboardingDocumentMimeTypes, maximumCleanerOnboardingDocumentBytes } from "./cleaner-onboarding-document.mjs";
// The customer price comes from the same module the browser runs, so the
// scanner's number and the authorised number cannot drift. The economics that
// decide whether Homle will sell at that number stay server-side.
import { defaultPricingConfig, normalizedPricingConfig } from "../../public/pricing-config.js";
import { quoteRooms } from "../../public/pricing-engine.js";
import { defaultPricingEconomics, normalizedPricingEconomics, reviewedQuote } from "./pricing-economics.mjs";

const uuidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const bookingPropertyPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/property$`);
const bookingResponsePath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/response$`);
const requestInvitationPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/invitations$`);
const requestInvitationQuotePath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/invitation-quote$`);
const requestMatchesPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/matches$`);
const requestAutomaticDispatchPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/automatic-dispatch$`);
const requestSubmissionPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/submit$`);
const requestWithdrawalPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/withdraw$`);
const requestReschedulePath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/reschedule$`);
const requestScanPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/scan$`);
// The structured scan lives beside the photo metadata rather than replacing
// it: `/scan` reports which private images exist, `/room-scan` reports what
// was actually seen in them.
const requestRoomScanPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/room-scan$`);
const requestRoomScanObjectPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/room-scan/objects/(${uuidPattern})$`);
const requestRoomScanMeasurementPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/room-scan/rooms/(${uuidPattern})/measurements$`);
const scanGroundTruthObjectPath = new RegExp(`^/api/marketplace/admin/scan-ground-truth/objects/(${uuidPattern})$`);
const requestVoiceInstructionPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/voice-instructions$`);
const requestPhotoIntentPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/photos/intents$`);
const requestPhotoCompletionPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/photos/(${uuidPattern})/complete$`);
const requestPhotoAccessPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/photos/(${uuidPattern})/access$`);
const bookingTrackingPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/tracking$`);
const journeyReadinessPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/journey/readiness$`);
const journeyStartPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/journey/start$`);
const journeyLocationPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/journey/location$`);
const journeyArrivalPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/journey/arrive$`);
const cleaningProgressPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress$`);
const cleaningStartPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/start$`);
const cleaningPausePath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/pause$`);
const cleaningFinishPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/finish$`);
const cleaningTasksPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/tasks$`);
const cleaningTaskPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/tasks/(${uuidPattern})$`);
const cleaningTaskDecisionPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/tasks/(${uuidPattern})/decision$`);
const cleaningTaskTermsConfirmationPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/tasks/(${uuidPattern})/terms-confirmation$`);
const jobPhotoIntentPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/photos/intents$`);
const jobPhotoCompletionPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/photos/(${uuidPattern})/complete$`);
const jobPhotoAccessPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/photos/(${uuidPattern})/access$`);
const bookingMessagesPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/messages$`);
const bookingEventsPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/events$`);
const requestEventsPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/events$`);
const notificationReadPath = new RegExp(`^/api/marketplace/notifications/(${uuidPattern})/read$`);
const propertyPath = new RegExp(`^/api/marketplace/properties/(${uuidPattern})$`);
const propertyArchivePath = new RegExp(`^/api/marketplace/properties/(${uuidPattern})/archive$`);
const propertyRestorePath = new RegExp(`^/api/marketplace/properties/(${uuidPattern})/restore$`);
const cleanerProfilePath = new RegExp(`^/api/marketplace/cleaners/(${uuidPattern})$`);
const cleanerReviewsPath = new RegExp(`^/api/marketplace/cleaners/(${uuidPattern})/reviews$`);
const cleanerAvailabilityPath = new RegExp(`^/api/marketplace/cleaner/availability/(${uuidPattern})$`);
const cleanerOnboardingSectionPath = /^\/api\/marketplace\/cleaner\/onboarding\/([a-z-]+)$/;
const cleanerOnboardingDocumentsPath = "/api/marketplace/cleaner/onboarding/documents";
const cleanerOnboardingSubmissionPath = "/api/marketplace/cleaner/onboarding/submission";
const cleanerOnboardingDocumentPath = /^\/api\/marketplace\/cleaner\/onboarding\/documents\/([a-z-]+)\/([A-Za-z][A-Za-z0-9]{0,79})$/;
const cleanerProfilePhotoPath = "/api/marketplace/cleaner/profile-photo";
const cleanerAddressResolvePath = "/api/marketplace/cleaner/address-lookup/resolve";
const favouriteCleanerPath = new RegExp(`^/api/marketplace/landlord/favourite-cleaners/(${uuidPattern})$`);
const bookingCompletionPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/completion$`);
const bookingReviewsPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/reviews$`);
const bookingReviewResponsePath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/reviews/response$`);
const bookingPaymentPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/payment$`);
const adminPaymentCommandPath = new RegExp(`^/api/marketplace/admin/payments/(${uuidPattern})/(capture|cancel|refund|transfer)$`);
const adminRequestMatchingReadinessPath = new RegExp(`^/api/marketplace/admin/cleaning-requests/(${uuidPattern})/matching-readiness$`);
const adminCleanerVerificationPath = new RegExp(`^/api/marketplace/admin/cleaner-verifications/(${uuidPattern})$`);
const adminReviewModerationPath = new RegExp(`^/api/marketplace/admin/reviews/(${uuidPattern})/moderation$`);
const bookingDisputePath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/dispute$`);
const adminDisputePath = new RegExp(`^/api/marketplace/admin/disputes/(${uuidPattern})$`);
const adminSupportRequestPath = new RegExp(`^/api/marketplace/admin/support-requests/(${uuidPattern})$`);
const apiPrefix = "/api/marketplace/";

function queryFilters(url) {
  const result = {};
  for (const name of ["outwardPostcode", "serviceCode", "startAt", "endAt", "minimumRating", "maximumPricePence", "latitude", "longitude", "maximumDistanceKm", "limit", "offset"]) {
    if (url.searchParams.has(name)) result[name] = url.searchParams.get(name);
  }
  if (url.searchParams.has("verifiedOnly")) {
    const supplied = url.searchParams.get("verifiedOnly");
    if (supplied !== "true" && supplied !== "false") throw new TypeError("Verified status must be true or false.");
    result.verifiedOnly = supplied === "true";
  }
  return result;
}

export function administratorMatchingReadiness(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.candidates) || typeof result.generatedAt !== "string" || !Number.isFinite(Date.parse(result.generatedAt))) throw new Error("Matching readiness is unavailable.");
  const prices = result.candidates.map((candidate) => Number(candidate?.estimatedCustomerPricePence)).filter((price) => Number.isInteger(price) && price > 0 && price <= 10_000_000);
  if (prices.length !== result.candidates.length) throw new Error("Matching readiness pricing is unavailable.");
  return Object.freeze({
    generatedAt: new Date(result.generatedAt).toISOString(),
    candidateCount: result.candidates.length,
    candidateLimit: 25,
    moreMayExist: result.candidates.length === 25,
    lowestCustomerPricePence: prices.length ? Math.min(...prices) : null,
    highestCustomerPricePence: prices.length ? Math.max(...prices) : null
  });
}

export function createMarketplaceHttpRouter(dependencies, options = {}) {
  const security = dependencies?.security;
  const properties = dependencies?.propertyService;
  const cleaners = dependencies?.cleanerProfileService;
  const cleanerOnboarding = dependencies?.cleanerOnboardingService;
  const cleanerOnboardingDocuments = dependencies?.cleanerOnboardingDocumentService;
  const cleanerProfilePhotos = dependencies?.cleanerProfilePhotoService;
  const addressLookup = dependencies?.addressLookup || null;
  const mapsClientConfig = dependencies?.mapsClientConfig || null;
  const favouriteCleaners = dependencies?.favouriteCleanerService;
  const cleaningRequests = dependencies?.cleaningRequestService;
  const scans = dependencies?.scanService;
  const scanPricing = dependencies?.scanPricingService;
  const scanGroundTruth = dependencies?.scanGroundTruthService || null;
  const scanTelemetry = dependencies?.scanTelemetry || null;
  // Guarded at every call site. Telemetry observes the scanner; it is never a
  // reason a request fails.
  // Returns whether the event was actually counted, so the ingest route below can
  // tell a client that a name it sent was rejected rather than letting it believe
  // it is being measured.
  const observeScan = (metric, extra) => {
    try { return scanTelemetry?.record(metric, extra) === true; }
    catch { return false; }
  };
  const bookings = dependencies?.bookingWorkflowService;
  const matching = dependencies?.matchingService;
  const journeys = dependencies?.journeyService;
  const progress = dependencies?.progressService;
  const media = dependencies?.mediaService;
  const requestMedia = dependencies?.requestMediaService;
  const messages = dependencies?.messageService;
  // Optional by design — absent means the on-device parser stays the only path.
  const speechSummary = dependencies?.speechSummary || null;
  const roomVision = dependencies?.roomVision || null;
  const realtime = dependencies?.realtimeService;
  const notifications = dependencies?.notificationService;
  const emailSuppressions = dependencies?.emailSuppressionService || null;
  const reviews = dependencies?.reviewService;
  const disputes = dependencies?.disputeService;
  const supportRequests = dependencies?.supportRequestService;
  const administratorBookings = dependencies?.administratorBookingService;
  const administratorVerification = dependencies?.administratorVerificationService;
  const administratorCoverage = dependencies?.administratorCoverageService;
  const administratorFunnel = dependencies?.administratorFunnelService;
  const landlordCare = dependencies?.landlordCareService;
  const privacyRequests = dependencies?.privacyRequestService;
  const payments = dependencies?.paymentService || null;
  const cleanerPayouts = dependencies?.cleanerPayoutService || null;
  const rateLimiter = dependencies?.rateLimiter;
  if (!security || typeof security.protect !== "function") throw new TypeError("Marketplace HTTP routes require account security.");
  if (!properties || typeof properties.getLandlordProfile !== "function" || typeof properties.saveLandlordProfile !== "function" || typeof properties.createProperty !== "function" || typeof properties.updateOwnProperty !== "function" || typeof properties.listOwnProperties !== "function" || typeof properties.listArchivedOwnProperties !== "function" || typeof properties.archiveOwnProperty !== "function" || typeof properties.restoreOwnProperty !== "function" || typeof properties.getBookingProperty !== "function") throw new TypeError("Marketplace HTTP routes require the property service.");
  if (!cleaners || !["getOwnProfile", "saveOwnProfile", "searchPublicProfiles", "getPublicProfile", "listOwnAvailability", "createOwnAvailability", "withdrawOwnAvailability"].every((method) => typeof cleaners[method] === "function")) throw new TypeError("Marketplace HTTP routes require the complete cleaner profile service.");
  if (!cleanerOnboarding || !["listOwnSections", "getOwnSection", "saveOwnSection", "getSubmissionReadiness", "submitOwnApplication"].every((method) => typeof cleanerOnboarding[method] === "function")) throw new TypeError("Marketplace HTTP routes require the complete Cleaner onboarding service.");
  if (!cleanerOnboardingDocuments || !["listOwnDocuments", "saveOwnDocument", "getOwnDocument", "deleteOwnDocument"].every((method) => typeof cleanerOnboardingDocuments[method] === "function")) throw new TypeError("Marketplace HTTP routes require the complete Cleaner onboarding document service.");
  if (!cleanerProfilePhotos || !["getOwnPhoto", "saveOwnPhoto"].every((method) => typeof cleanerProfilePhotos[method] === "function")) throw new TypeError("Marketplace HTTP routes require the complete Cleaner profile photo service.");
  if (!favouriteCleaners || !["listOwn", "setOwn"].every((method) => typeof favouriteCleaners[method] === "function")) throw new TypeError("Marketplace HTTP routes require the favourite-Cleaner service.");
  if (!cleaningRequests || !["createOwnRequest", "listOwnRequests", "submitOwnRequest", "withdrawOwnRequest", "rescheduleOwnRequest", "configureAutomaticDispatch"].every((method) => typeof cleaningRequests[method] === "function")) throw new TypeError("Marketplace HTTP routes require the complete cleaning-request service.");
  if (!bookings || typeof bookings.listParticipantBookings !== "function" || typeof bookings.previewInvitation !== "function" || typeof bookings.inviteCleaner !== "function" || typeof bookings.respondToInvitation !== "function") throw new TypeError("Marketplace HTTP routes require the booking workflow service.");
  if (!matching || typeof matching.recommendForRequest !== "function") throw new TypeError("Marketplace HTTP routes require the request matching service.");
  if (!journeys || !["getJourneyReadiness", "startJourney", "updateLocation", "markArrived", "getTracking"].every((method) => typeof journeys[method] === "function")) throw new TypeError("Marketplace HTTP routes require the booking journey service.");
  if (!progress || !["getProgress", "startCleaning", "setPause", "updateTask", "addUnexpectedTask", "confirmUnexpectedTaskTerms", "decideUnexpectedTask", "finishCleaning"].every((method) => typeof progress[method] === "function")) throw new TypeError("Marketplace HTTP routes require the cleaning-progress service.");
  if (!media || !["createUploadIntent", "completeUpload", "getPhotoAccess"].every((method) => typeof media[method] === "function")) throw new TypeError("Marketplace HTTP routes require the private job-media service.");
  if (!requestMedia || !["createUploadIntent", "completeUpload", "getScan", "getPhotoAccess"].every((method) => typeof requestMedia[method] === "function")) throw new TypeError("Marketplace HTTP routes require the private request-media service.");
  if (!messages || !["sendMessage", "listMessages"].every((method) => typeof messages[method] === "function")) throw new TypeError("Marketplace HTTP routes require the booking-message service.");
  if (!realtime || typeof realtime.openStream !== "function" || typeof realtime.openRequestStream !== "function" || typeof realtime.openNotificationStream !== "function") throw new TypeError("Marketplace HTTP routes require the real-time marketplace service.");
  if (!notifications || !["listNotifications", "markNotificationRead", "markAllNotificationsRead"].every((method) => typeof notifications[method] === "function")) throw new TypeError("Marketplace HTTP routes require the account notification service.");
  if (emailSuppressions && typeof emailSuppressions.handle !== "function") throw new TypeError("Resend webhook routes require the complete email-suppression service.");
  if (!reviews || !["confirmCompletion", "submitReview", "getBookingReview", "getPublicReviews", "respondToReview", "moderateReview"].every((method) => typeof reviews[method] === "function")) throw new TypeError("Marketplace HTTP routes require the verified booking-review service.");
  if (!disputes || !["open", "getForBooking", "listForAdministrator", "review"].every((method) => typeof disputes[method] === "function")) throw new TypeError("Marketplace HTTP routes require the booking-case service.");
  if (!supportRequests || !["create", "listOwn", "listForAdministrator", "review"].every((method) => typeof supportRequests[method] === "function")) throw new TypeError("Marketplace HTTP routes require the Landlord support-request service.");
  if (!administratorBookings || typeof administratorBookings.list !== "function") throw new TypeError("Marketplace HTTP routes require the Administrator booking operations service.");
  if (!administratorCoverage || typeof administratorCoverage.get !== "function") throw new TypeError("Marketplace HTTP routes require the Administrator coverage-report service.");
  if (!administratorFunnel || typeof administratorFunnel.get !== "function") throw new TypeError("Marketplace HTTP routes require the Administrator funnel-report service.");
  if (!landlordCare || typeof landlordCare.get !== "function") throw new TypeError("Marketplace HTTP routes require the Landlord care-record service.");
  if (!privacyRequests || !["list", "request"].every((method) => typeof privacyRequests[method] === "function")) throw new TypeError("Marketplace HTTP routes require the account privacy-request service.");
  if (payments && !["handleWebhook", "beginAuthorization", "getForBooking", "getClientConfiguration", "listForAdministrator", "capture", "cancel", "refund", "transfer"].every((method) => typeof payments[method] === "function")) throw new TypeError("Marketplace payment routes require the complete payment service.");
  if (cleanerPayouts && !["getStatus", "refreshStatus", "beginOnboarding"].every((method) => typeof cleanerPayouts[method] === "function")) throw new TypeError("Marketplace Cleaner payout routes require the complete payout service.");
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};
  const limitPublicRead = createRateLimitBoundary(rateLimiter, options.clientKey, { onUnexpectedError });

  // Pricing is injected rather than imported at the point of use, so an
  // administrator's stored values can replace the shipped defaults without a
  // deployment.
  //
  // Nothing stored resolves to the shipped defaults, which are a complete
  // working price list rather than placeholders — a deployment that has never
  // opened the pricing page quotes the same numbers as one that has. A read
  // that FAILS also falls back, because refusing to price a clean because a
  // configuration lookup timed out is worse than pricing it at the defaults the
  // whole test suite is calibrated against.
  const pricingAdministration = options.pricingAdministration || null;
  async function pricingConfiguration(actor) {
    if (typeof options.pricingConfiguration !== "function") return defaultPricingConfig;
    try {
      return (await options.pricingConfiguration(actor)) || defaultPricingConfig;
    } catch { return defaultPricingConfig; }
  }
  async function pricingEconomicsConfiguration(actor) {
    if (typeof options.pricingEconomicsConfiguration !== "function") return defaultPricingEconomics;
    try {
      return (await options.pricingEconomicsConfiguration(actor)) || defaultPricingEconomics;
    } catch { return defaultPricingEconomics; }
  }

  return {
    async handle(request, response, suppliedUrl) {
      const url = suppliedUrl instanceof URL ? suppliedUrl : new URL(request.url || "/", "http://localhost");
      const pathname = url.pathname;
      if (!pathname.startsWith(apiPrefix)) return false;
      try {
        if (pathname === "/api/marketplace/email/resend/webhook") {
          if (!emailSuppressions) return false;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const result = await emailSuppressions.handle(await readRawBody(request), {
            "svix-id": request.headers?.["svix-id"],
            "svix-timestamp": request.headers?.["svix-timestamp"],
            "svix-signature": request.headers?.["svix-signature"]
          });
          sendJson(response, 200, {
            ok: true,
            accepted: result?.accepted === true,
            duplicate: result?.duplicate === true,
            ignored: result?.ignored === true
          });
          return true;
        }
        if (pathname === "/api/marketplace/payments/webhook") {
          if (!payments) return false;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const signatureHeader = request.headers?.["stripe-signature"];
          const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
          const result = await payments.handleWebhook(await readRawBody(request), signature);
          // A signed, non-duplicate event that did not reconcile is a payment,
          // command or state mismatch. Stripe must not retry a recorded event, so
          // answer 200, but raise a privacy-safe operational signal so the money
          // anomaly is not silently swallowed.
          if (result?.accepted !== true && result?.duplicate !== true) {
            onUnexpectedError(Object.assign(new Error("A signed payment webhook did not reconcile."), { code: "payment-webhook-unreconciled" }));
          }
          sendJson(response, 200, { ok: true, accepted: result?.accepted === true, duplicate: result?.duplicate === true, ignored: result?.ignored === true });
          return true;
        }
        if (pathname === "/api/marketplace/payments/config") {
          if (!payments) return false;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          sendJson(response, 200, { ok: true, payment: payments.getClientConfiguration(context.actor) });
          return true;
        }
        if (pathname === "/api/marketplace/payments/sandbox-checkout") {
          if (!payments) return false;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const payment = await payments.beginSandboxCheckout(context.actor, await readJsonObject(request));
          sendJson(response, 201, { ok: true, payment });
          return true;
        }
        if (pathname === "/api/marketplace/admin/payments") {
          if (!payments) return false;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          const page = await payments.listForAdministrator(context.actor, { bookingId: url.searchParams.get("bookingId"), status: url.searchParams.get("status"), limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") });
          sendJson(response, 200, { ok: true, ...page });
          return true;
        }
        if (pathname === "/api/marketplace/admin/bookings") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          const page = await administratorBookings.list(context.actor, { view: url.searchParams.get("view"), limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") });
          sendJson(response, 200, { ok: true, ...page });
          return true;
        }
        if (pathname === "/api/marketplace/admin/coverage") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          const report = await administratorCoverage.get(context.actor, { windowDays: url.searchParams.get("windowDays") });
          sendJson(response, 200, { ok: true, ...report });
          return true;
        }
        if (pathname === "/api/marketplace/admin/funnel") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          const report = await administratorFunnel.get(context.actor, { windowDays: url.searchParams.get("windowDays") });
          sendJson(response, 200, { ok: true, ...report });
          return true;
        }
        if (pathname === "/api/marketplace/admin/cleaner-verifications") {
          if (!administratorVerification) return false;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          const page = await administratorVerification.list(context.actor, { view: url.searchParams.get("view"), limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") });
          sendJson(response, 200, { ok: true, ...page });
          return true;
        }
        const selectedAdminVerification = pathname.match(adminCleanerVerificationPath);
        if (selectedAdminVerification) {
          if (!administratorVerification) return false;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["administrator"] });
          const input = await readJsonObject(request);
          const result = await administratorVerification.set(context.actor, selectedAdminVerification[1], input);
          sendJson(response, 200, { ok: true, verification: result });
          return true;
        }
        const selectedAdminMatchingReadiness = pathname.match(adminRequestMatchingReadinessPath);
        if (selectedAdminMatchingReadiness) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          const readiness = administratorMatchingReadiness(await matching.recommendForRequest(context.actor, selectedAdminMatchingReadiness[1]));
          sendJson(response, 200, { ok: true, matchingReadiness: readiness });
          return true;
        }
        const selectedAdminPaymentCommand = pathname.match(adminPaymentCommandPath);
        if (selectedAdminPaymentCommand) {
          if (!payments) return false;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["administrator"] });
          const input = await readJsonObject(request);
          const kind = selectedAdminPaymentCommand[2];
          const command = await payments[kind](context.actor, { paymentId: selectedAdminPaymentCommand[1], idempotencyKey: input.idempotencyKey, ...(kind === "refund" ? { amountPence: input.amountPence } : {}) });
          sendJson(response, 202, { ok: true, command });
          return true;
        }
        if (pathname === "/api/marketplace/cleaner/payout-account") {
          if (!cleanerPayouts) return false;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["cleaner"] });
          sendJson(response, 200, { ok: true, payout: await cleanerPayouts.getStatus(context.actor) });
          return true;
        }
        if (pathname === "/api/marketplace/cleaner/payout-account/refresh") {
          if (!cleanerPayouts) return false;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          sendJson(response, 200, { ok: true, payout: await cleanerPayouts.refreshStatus(context.actor) });
          return true;
        }
        if (pathname === "/api/marketplace/cleaner/payout-account/onboarding") {
          if (!cleanerPayouts) return false;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          sendJson(response, 201, { ok: true, payout: await cleanerPayouts.beginOnboarding(context.actor) });
          return true;
        }
        const selectedBookingPayment = pathname.match(bookingPaymentPath);
        if (selectedBookingPayment) {
          if (!payments) return false;
          if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed(response, ["GET", "POST"]), true;
          const mutation = request.method === "POST";
          const context = await security.protect(request, { mutation, roles: mutation ? ["landlord"] : ["landlord", "administrator"] });
          const payment = mutation
            ? await payments.beginAuthorization(context.actor, { bookingId: selectedBookingPayment[1], idempotencyKey: (await readJsonObject(request)).idempotencyKey })
            : await payments.getForBooking(context.actor, selectedBookingPayment[1]);
          sendJson(response, mutation ? 201 : 200, { ok: true, payment });
          return true;
        }
        if (pathname === "/api/marketplace/account") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          sendJson(response, 200, { ok: true, account: { displayName: context.account.displayName, email: context.account.email, avatarUrl: context.account.avatarUrl, selectedRole: context.account.selectedRole, roles: context.actor.roles } });
          return true;
        }
        if (pathname === "/api/marketplace/landlord/bootstrap") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          // Authenticate and authorize once before starting any owner-bound read.
          // The dashboard previously opened seven private routes in parallel,
          // which turned one expired mobile session into seven avoidable 401s.
          const context = await security.protect(request, { roles: ["landlord"] });
          const reads = await Promise.allSettled([
            properties.getLandlordProfile(context.actor),
            properties.listOwnProperties(context.actor),
            properties.listArchivedOwnProperties(context.actor),
            cleaningRequests.listOwnRequests(context.actor),
            bookings.listParticipantBookings(context.actor, { limit: "50" }),
            supportRequests.listOwn(context.actor, { limit: "25", offset: "0" })
          ]);
          const names = ["profile", "properties", "archivedProperties", "cleaningRequests", "bookings", "supportRequests"];
          const unavailable = names.filter((_, index) => reads[index].status === "rejected");
          const value = (index, fallback) => reads[index].status === "fulfilled" ? reads[index].value : fallback;
          const supportPage = value(5, { supportRequests: [] });
          sendJson(response, 200, {
            ok: true,
            account: { displayName: context.account.displayName, email: context.account.email, avatarUrl: context.account.avatarUrl, selectedRole: context.account.selectedRole, roles: context.actor.roles },
            profile: value(0, { organisationName: null, biography: "" }),
            properties: value(1, []),
            archivedProperties: value(2, []),
            cleaningRequests: value(3, []),
            bookings: value(4, []),
            supportRequests: Array.isArray(supportPage?.supportRequests) ? supportPage.supportRequests : [],
            unavailable
          });
          return true;
        }
        if (pathname === "/api/marketplace/privacy-requests") {
          if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed(response, ["GET", "POST"]), true;
          const mutation = request.method === "POST";
          const context = await security.protect(request, { mutation });
          const result = mutation
            ? await privacyRequests.request(context.actor, await readJsonObject(request))
            : await privacyRequests.list(context.actor);
          sendJson(response, mutation && result.created === true ? 201 : 200, { ok: true, ...(mutation ? { privacyRequest: result } : { privacyRequests: result }) });
          return true;
        }
        if (pathname === "/api/marketplace/landlord/care-summary") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["landlord"] });
          sendJson(response, 200, { ok: true, careSummary: await landlordCare.get(context.actor) });
          return true;
        }
        if (pathname === "/api/marketplace/landlord/support-requests") {
          if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed(response, ["GET", "POST"]), true;
          const mutation = request.method === "POST";
          const context = await security.protect(request, { mutation, roles: ["landlord"] });
          const result = mutation
            ? await supportRequests.create(context.actor, await readJsonObject(request))
            : await supportRequests.listOwn(context.actor, { limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") });
          sendJson(response, mutation ? 201 : 200, { ok: true, ...(mutation ? { supportRequest: result } : result) });
          return true;
        }
        if (pathname === "/api/marketplace/admin/support-requests") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          const result = await supportRequests.listForAdministrator(context.actor, {
            status: url.searchParams.get("status"),
            category: url.searchParams.get("category"),
            limit: url.searchParams.get("limit"),
            offset: url.searchParams.get("offset")
          });
          sendJson(response, 200, { ok: true, ...result });
          return true;
        }
        const selectedAdminSupportRequest = pathname.match(adminSupportRequestPath);
        if (selectedAdminSupportRequest) {
          if (request.method !== "PATCH") return methodNotAllowed(response, ["PATCH"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["administrator"] });
          const supportRequest = await supportRequests.review(context.actor, selectedAdminSupportRequest[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, supportRequest });
          return true;
        }
        if (pathname === "/api/marketplace/bookings") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["cleaner", "landlord"] });
          const records = await bookings.listParticipantBookings(context.actor, { limit: url.searchParams.get("limit") });
          sendJson(response, 200, { ok: true, bookings: records });
          return true;
        }
        if (pathname === "/api/marketplace/cleaners") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          await limitPublicRead(request, "marketplace-public:cleaner-directory");
          const results = await cleaners.searchPublicProfiles(queryFilters(url));
          sendJson(response, 200, { ok: true, cleaners: results });
          return true;
        }
        const selectedCleanerProfile = pathname.match(cleanerProfilePath);
        if (selectedCleanerProfile) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          await limitPublicRead(request, "marketplace-public:cleaner-profile");
          sendJson(response, 200, { ok: true, cleaner: await cleaners.getPublicProfile(selectedCleanerProfile[1]) });
          return true;
        }
        const selectedCleanerReviews = pathname.match(cleanerReviewsPath);
        if (selectedCleanerReviews) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          await limitPublicRead(request, "marketplace-public:cleaner-reviews");
          const page = await reviews.getPublicReviews(selectedCleanerReviews[1], {
            beforeCreatedAt: url.searchParams.get("beforeCreatedAt"),
            beforeReviewId: url.searchParams.get("beforeReviewId"),
            limit: url.searchParams.get("limit")
          });
          sendJson(response, 200, { ok: true, ...page });
          return true;
        }
        if (pathname === "/api/marketplace/cleaner/profile") {
          if (request.method !== "GET" && request.method !== "PUT") return methodNotAllowed(response, ["GET", "PUT"]), true;
          const mutation = request.method === "PUT";
          const context = await security.protect(request, { mutation, roles: ["cleaner"] });
          const profile = mutation ? await cleaners.saveOwnProfile(context.actor, await readJsonObject(request)) : await cleaners.getOwnProfile(context.actor);
          sendJson(response, 200, { ok: true, profile });
          return true;
        }
        if (pathname === cleanerProfilePhotoPath) {
          if (request.method !== "GET" && request.method !== "PUT") return methodNotAllowed(response, ["GET", "PUT"]), true;
          const mutation = request.method === "PUT";
          const context = await security.protect(request, { mutation, roles: ["cleaner"] });
          if (mutation) {
            const supplied = request.headers?.["content-type"];
            const mimeType = String(Array.isArray(supplied) ? supplied[0] : supplied || "").split(";", 1)[0].trim().toLowerCase();
            if (!cleanerProfilePhotoMimeTypes.includes(mimeType)) throw new TypeError("Choose a JPG, PNG or WebP photo.");
            const photo = await cleanerProfilePhotos.saveOwnPhoto(context.actor, { mimeType, bytes: await readRawBody(request, maximumCleanerProfilePhotoBytes) });
            sendJson(response, 200, { ok: true, photo });
          } else {
            const photo = await cleanerProfilePhotos.getOwnPhoto(context.actor);
            if (!photo) throw Object.assign(new Error("No profile photo has been uploaded."), { statusCode: 404, code: "profile-photo-not-found" });
            response.writeHead(200, {
              "Content-Type": photo.mimeType,
              "Content-Length": String(photo.bytes.length),
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff"
            });
            response.end(photo.bytes);
          }
          return true;
        }
        if (pathname === "/api/marketplace/maps/config") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          await security.protect(request, { roles: ["cleaner"] });
          if (!mapsClientConfig) throw Object.assign(new Error("Google Maps has not been configured yet."), { statusCode: 503, code: "maps-not-configured" });
          sendJson(response, 200, { ok: true, maps: mapsClientConfig });
          return true;
        }
        if (pathname === "/api/marketplace/cleaner/address-lookup" || pathname === cleanerAddressResolvePath) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          await security.protect(request, { mutation: true, roles: ["cleaner"] });
          await limitPublicRead(request, "marketplace-cleaner:address-lookup");
          if (!addressLookup) throw Object.assign(new Error("Address lookup has not been configured yet. Enter the address manually for now."), { statusCode: 503, code: "address-lookup-not-configured" });
          const input = await readJsonObject(request);
          if (pathname === cleanerAddressResolvePath) {
            const address = await addressLookup.resolveAddress(input.id, input.sessionToken);
            sendJson(response, 200, { ok: true, address });
          } else {
            const result = await addressLookup.searchAddresses(input.query, input.sessionToken);
            sendJson(response, 200, { ok: true, suggestions: result.suggestions });
          }
          return true;
        }
        if (pathname === "/api/marketplace/cleaner/onboarding") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["cleaner"] });
          sendJson(response, 200, { ok: true, sections: await cleanerOnboarding.listOwnSections(context.actor) });
          return true;
        }
        if (pathname === cleanerOnboardingSubmissionPath) {
          if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed(response, ["GET", "POST"]), true;
          const mutation = request.method === "POST";
          const context = await security.protect(request, { mutation, roles: ["cleaner"] });
          if (mutation) {
            const submission = await cleanerOnboarding.submitOwnApplication(context.actor, await readJsonObject(request));
            sendJson(response, submission.replayed ? 200 : 201, { ok: true, submission });
          } else {
            sendJson(response, 200, { ok: true, submission: await cleanerOnboarding.getSubmissionReadiness(context.actor) });
          }
          return true;
        }
        if (pathname === cleanerOnboardingDocumentsPath) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["cleaner"] });
          sendJson(response, 200, { ok: true, documents: await cleanerOnboardingDocuments.listOwnDocuments(context.actor, url.searchParams.get("section")) });
          return true;
        }
        const selectedCleanerOnboardingDocument = pathname.match(cleanerOnboardingDocumentPath);
        if (selectedCleanerOnboardingDocument) {
          if (!["GET", "PUT", "DELETE"].includes(request.method)) return methodNotAllowed(response, ["GET", "PUT", "DELETE"]), true;
          const mutation = request.method !== "GET";
          const context = await security.protect(request, { mutation, roles: ["cleaner"] });
          const section = selectedCleanerOnboardingDocument[1];
          const documentType = selectedCleanerOnboardingDocument[2];
          if (request.method === "PUT") {
            const supplied = request.headers?.["content-type"];
            const mimeType = String(Array.isArray(supplied) ? supplied[0] : supplied || "").split(";", 1)[0].trim().toLowerCase();
            if (!cleanerOnboardingDocumentMimeTypes.includes(mimeType)) throw Object.assign(new Error("Choose a PDF, JPEG or PNG document."), { statusCode: 422, code: "invalid-document-mime-type" });
            const encodedFilename = String(request.headers?.["x-document-filename"] || "");
            let filename;
            try { filename = decodeURIComponent(encodedFilename); } catch { throw Object.assign(new Error("The document filename is invalid."), { statusCode: 422, code: "invalid-document-filename" }); }
            const document = await cleanerOnboardingDocuments.saveOwnDocument(context.actor, section, documentType, {
              filename,
              mimeType,
              bytes: await readRawBody(request, maximumCleanerOnboardingDocumentBytes)
            });
            sendJson(response, 200, { ok: true, document });
          } else if (request.method === "DELETE") {
            sendJson(response, 200, { ok: true, document: await cleanerOnboardingDocuments.deleteOwnDocument(context.actor, section, documentType) });
          } else {
            const document = await cleanerOnboardingDocuments.getOwnDocument(context.actor, section, documentType);
            if (!document) throw Object.assign(new Error("No stored document was found."), { statusCode: 404, code: "onboarding-document-not-found" });
            response.writeHead(200, {
              "Content-Type": document.mimeType,
              "Content-Length": String(document.bytes.length),
              "Content-Disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff"
            });
            response.end(document.bytes);
          }
          return true;
        }
        const selectedCleanerOnboardingSection = pathname.match(cleanerOnboardingSectionPath);
        if (selectedCleanerOnboardingSection) {
          if (request.method !== "GET" && request.method !== "PUT") return methodNotAllowed(response, ["GET", "PUT"]), true;
          const mutation = request.method === "PUT";
          const context = await security.protect(request, { mutation, roles: ["cleaner"] });
          const section = mutation
            ? await cleanerOnboarding.saveOwnSection(context.actor, selectedCleanerOnboardingSection[1], await readJsonObject(request))
            : await cleanerOnboarding.getOwnSection(context.actor, selectedCleanerOnboardingSection[1]);
          sendJson(response, 200, { ok: true, section });
          return true;
        }
        if (pathname === "/api/marketplace/cleaner/availability") {
          if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed(response, ["GET", "POST"]), true;
          const mutation = request.method === "POST";
          const context = await security.protect(request, { mutation, roles: ["cleaner"] });
          const availability = mutation
            ? await cleaners.createOwnAvailability(context.actor, await readJsonObject(request))
            : await cleaners.listOwnAvailability(context.actor);
          sendJson(response, mutation ? 201 : 200, { ok: true, availability });
          return true;
        }
        const selectedCleanerAvailability = pathname.match(cleanerAvailabilityPath);
        if (selectedCleanerAvailability) {
          if (request.method !== "DELETE") return methodNotAllowed(response, ["DELETE"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          const availability = await cleaners.withdrawOwnAvailability(context.actor, selectedCleanerAvailability[1]);
          sendJson(response, 200, { ok: true, availability });
          return true;
        }
        if (pathname === "/api/marketplace/landlord/profile") {
          if (request.method !== "GET" && request.method !== "PUT") return methodNotAllowed(response, ["GET", "PUT"]), true;
          const mutation = request.method === "PUT";
          const context = await security.protect(request, { mutation, roles: ["landlord"] });
          const profile = mutation
            ? await properties.saveLandlordProfile(context.actor, await readJsonObject(request))
            : await properties.getLandlordProfile(context.actor);
          sendJson(response, 200, { ok: true, profile });
          return true;
        }
        if (pathname === "/api/marketplace/properties") {
          if (request.method === "GET") {
            const context = await security.protect(request, { roles: ["landlord"] });
            const records = await properties.listOwnProperties(context.actor);
            sendJson(response, 200, { ok: true, properties: records });
            return true;
          }
          if (request.method === "POST") {
            const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
            const property = await properties.createProperty(context.actor, await readJsonObject(request));
            sendJson(response, 201, { ok: true, property });
            return true;
          }
          return methodNotAllowed(response, ["GET", "POST"]), true;
        }
        if (pathname === "/api/marketplace/properties/archived") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["landlord"] });
          const records = await properties.listArchivedOwnProperties(context.actor);
          sendJson(response, 200, { ok: true, properties: records });
          return true;
        }
        if (pathname === "/api/marketplace/cleaning-requests") {
          if (request.method === "GET") {
            const context = await security.protect(request, { roles: ["landlord"] });
            const records = await cleaningRequests.listOwnRequests(context.actor);
            sendJson(response, 200, { ok: true, cleaningRequests: records });
            return true;
          }
          if (request.method === "POST") {
            const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
            const cleaningRequest = await cleaningRequests.createOwnRequest(context.actor, await readJsonObject(request));
            sendJson(response, 201, { ok: true, cleaningRequest });
            return true;
          }
          return methodNotAllowed(response, ["GET", "POST"]), true;
        }
        const selectedRequestSubmission = pathname.match(requestSubmissionPath);
        if (selectedRequestSubmission) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const submission = await cleaningRequests.submitOwnRequest(context.actor, selectedRequestSubmission[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, submission });
          return true;
        }
        const selectedRequestWithdrawal = pathname.match(requestWithdrawalPath);
        if (selectedRequestWithdrawal) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const withdrawal = await cleaningRequests.withdrawOwnRequest(context.actor, selectedRequestWithdrawal[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, withdrawal });
          return true;
        }
        const selectedRequestReschedule = pathname.match(requestReschedulePath);
        if (selectedRequestReschedule) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const reschedule = await cleaningRequests.rescheduleOwnRequest(context.actor, selectedRequestReschedule[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, reschedule });
          return true;
        }
        const selectedVoiceInstructions = pathname.match(requestVoiceInstructionPath);
        if (selectedVoiceInstructions) {
          if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const stored = await scans.recordOwnVoiceInstructions(context.actor, selectedVoiceInstructions[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, ...stored });
          return true;
        }
        const selectedRoomScanMeasurement = pathname.match(requestRoomScanMeasurementPath);
        if (selectedRoomScanMeasurement) {
          if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const stored = await scans.recordOwnMeasurements(context.actor, selectedRoomScanMeasurement[2], await readJsonObject(request));
          sendJson(response, 200, { ok: true, ...stored });
          return true;
        }
        const selectedRoomScanObject = pathname.match(requestRoomScanObjectPath);
        if (selectedRoomScanObject) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const correction = await scans.correctOwnObject(context.actor, selectedRoomScanObject[2], await readJsonObject(request));
          sendJson(response, 200, { ok: true, correction });
          return true;
        }
        const selectedRoomScan = pathname.match(requestRoomScanPath);
        if (selectedRoomScan) {
          if (request.method === "GET") {
            // Structured scan observations and pricing are a Landlord/Admin
            // review surface. Cleaner scope continues through the existing,
            // separately reviewed request-media/checklist projection.
            const context = await security.protect(request, { roles: ["landlord", "administrator"] });
            sendJson(response, 200, { ok: true, scan: await scans.getScan(context.actor, selectedRoomScan[1]) });
            return true;
          }
          if (request.method === "PUT") {
            const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
            const body = await readJsonObject(request, maximumRoomScanBodyBytes);
            const scan = await scans.recordOwnScan(context.actor, { ...body, cleaningRequestId: selectedRoomScan[1] });
            sendJson(response, 200, { ok: true, scan });
            return true;
          }
          if (request.method === "DELETE") {
            const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
            sendJson(response, 200, { ok: true, ...await scans.deleteOwnScan(context.actor, selectedRoomScan[1]) });
            return true;
          }
          return methodNotAllowed(response, ["GET", "PUT", "DELETE"]), true;
        }
        const selectedRequestScan = pathname.match(requestScanPath);
        if (selectedRequestScan) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["landlord"] });
          sendJson(response, 200, { ok: true, scan: await requestMedia.getScan(context.actor, selectedRequestScan[1]) });
          return true;
        }
        const selectedRequestPhotoIntent = pathname.match(requestPhotoIntentPath);
        if (selectedRequestPhotoIntent) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          sendJson(response, 201, { ok: true, upload: await requestMedia.createUploadIntent(context.actor, selectedRequestPhotoIntent[1], await readJsonObject(request)) });
          return true;
        }
        const selectedRequestPhotoCompletion = pathname.match(requestPhotoCompletionPath);
        if (selectedRequestPhotoCompletion) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          sendJson(response, 200, { ok: true, scan: await requestMedia.completeUpload(context.actor, selectedRequestPhotoCompletion[1], selectedRequestPhotoCompletion[2]) });
          return true;
        }
        const selectedRequestPhotoAccess = pathname.match(requestPhotoAccessPath);
        if (selectedRequestPhotoAccess) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          sendJson(response, 200, { ok: true, photo: await requestMedia.getPhotoAccess(context.actor, selectedRequestPhotoAccess[1], selectedRequestPhotoAccess[2]) });
          return true;
        }
        if (pathname === "/api/marketplace/notifications/events") {
          if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]), true;
          // Native EventSource remains available to the frozen Cleaner client.
          // The Landlord client uses a streamed POST because it can carry CSRF
          // proof even when Chrome omits Origin from a same-origin EventSource
          // GET. This branch is additive and role-isolated from Cleaner traffic.
          const context = request.method === "POST"
            ? await security.protect(request, { mutation: true, roles: ["landlord"] })
            : await security.protect(request);
          if (request.method === "GET") security.requireOrigin(request);
          await realtime.openNotificationStream(context.actor, request, response, context.expiresAt);
          return true;
        }
        if (pathname === "/api/marketplace/notifications") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          const page = await notifications.listNotifications(context.actor, {
            beforeCreatedAt: url.searchParams.get("beforeCreatedAt"),
            beforeNotificationId: url.searchParams.get("beforeNotificationId"),
            limit: url.searchParams.get("limit")
          });
          sendJson(response, 200, { ok: true, ...page });
          return true;
        }
        if (pathname === "/api/marketplace/notifications/read-all") {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true });
          const result = await notifications.markAllNotificationsRead(context.actor, await readJsonObject(request));
          sendJson(response, 200, { ok: true, result });
          return true;
        }
        const selectedNotificationRead = pathname.match(notificationReadPath);
        if (selectedNotificationRead) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true });
          const notification = await notifications.markNotificationRead(context.actor, selectedNotificationRead[1]);
          sendJson(response, 200, { ok: true, notification });
          return true;
        }
        const selectedPropertyArchive = pathname.match(propertyArchivePath);
        if (selectedPropertyArchive) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const archivedProperty = await properties.archiveOwnProperty(context.actor, selectedPropertyArchive[1]);
          sendJson(response, 200, { ok: true, archivedProperty });
          return true;
        }
        const selectedPropertyRestore = pathname.match(propertyRestorePath);
        if (selectedPropertyRestore) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const restoredProperty = await properties.restoreOwnProperty(context.actor, selectedPropertyRestore[1]);
          sendJson(response, 200, { ok: true, restoredProperty });
          return true;
        }
        const selectedProperty = pathname.match(propertyPath);
        if (selectedProperty) {
          if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const body = await readJsonObject(request);
          const property = await properties.updateOwnProperty(context.actor, { ...body, id: selectedProperty[1] });
          sendJson(response, 200, { ok: true, property });
          return true;
        }
        const selectedInvitationQuoteRequest = pathname.match(requestInvitationQuotePath);
        if (selectedInvitationQuoteRequest) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const body = await readJsonObject(request);
          const quote = await bookings.previewInvitation(context.actor, { cleaningRequestId: selectedInvitationQuoteRequest[1], cleanerId: body.cleanerId });
          sendJson(response, 200, { ok: true, quote });
          return true;
        }
        const selectedInvitationRequest = pathname.match(requestInvitationPath);
        if (selectedInvitationRequest) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const body = await readJsonObject(request);
          const booking = await bookings.inviteCleaner(context.actor, { cleaningRequestId: selectedInvitationRequest[1], cleanerId: body.cleanerId, approvedCustomerPricePence: body.approvedCustomerPricePence });
          sendJson(response, 201, { ok: true, booking });
          return true;
        }
        const selectedAutomaticDispatchRequest = pathname.match(requestAutomaticDispatchPath);
        if (selectedAutomaticDispatchRequest) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const automaticDispatch = await cleaningRequests.configureAutomaticDispatch(context.actor, selectedAutomaticDispatchRequest[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, automaticDispatch });
          return true;
        }
        const selectedMatchRequest = pathname.match(requestMatchesPath);
        if (selectedMatchRequest) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["landlord"] });
          const matches = await matching.recommendForRequest(context.actor, selectedMatchRequest[1]);
          sendJson(response, 200, { ok: true, ...matches });
          return true;
        }
        const selectedBookingResponse = pathname.match(bookingResponsePath);
        if (selectedBookingResponse) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          const booking = await bookings.respondToInvitation(context.actor, selectedBookingResponse[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, booking });
          return true;
        }
        const selectedCompletion = pathname.match(bookingCompletionPath);
        if (selectedCompletion) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const booking = await reviews.confirmCompletion(context.actor, selectedCompletion[1]);
          sendJson(response, 200, { ok: true, booking });
          return true;
        }
        const selectedReviewResponse = pathname.match(bookingReviewResponsePath);
        if (selectedReviewResponse) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          const review = await reviews.respondToReview(context.actor, selectedReviewResponse[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, review });
          return true;
        }
        const selectedBookingReviews = pathname.match(bookingReviewsPath);
        if (selectedBookingReviews) {
          if (request.method === "GET") {
            const context = await security.protect(request);
            const review = await reviews.getBookingReview(context.actor, selectedBookingReviews[1]);
            sendJson(response, 200, { ok: true, review });
            return true;
          }
          if (request.method === "POST") {
            const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
            const review = await reviews.submitReview(context.actor, selectedBookingReviews[1], await readJsonObject(request));
            sendJson(response, 201, { ok: true, review });
            return true;
          }
          return methodNotAllowed(response, ["GET", "POST"]), true;
        }
        const selectedAdminReview = pathname.match(adminReviewModerationPath);
        if (selectedAdminReview) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["administrator"] });
          const review = await reviews.moderateReview(context.actor, selectedAdminReview[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, review });
          return true;
        }
        const selectedBookingDispute = pathname.match(bookingDisputePath);
        if (selectedBookingDispute) {
          if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]), true;
          const mutation = request.method === "POST";
          const context = await security.protect(request, { mutation, roles: ["landlord", "cleaner"] });
          const dispute = mutation ? await disputes.open(context.actor, selectedBookingDispute[1], await readJsonObject(request)) : await disputes.getForBooking(context.actor, selectedBookingDispute[1]);
          sendJson(response, mutation ? 201 : 200, { ok: true, dispute });
          return true;
        }
        if (pathname === "/api/marketplace/admin/disputes") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          const queue = await disputes.listForAdministrator(context.actor, { status: url.searchParams.get("status"), limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") });
          sendJson(response, 200, { ok: true, ...queue });
          return true;
        }
        const selectedAdminDispute = pathname.match(adminDisputePath);
        if (selectedAdminDispute) {
          if (request.method !== "PATCH") return methodNotAllowed(response, ["PATCH"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["administrator"] });
          const dispute = await disputes.review(context.actor, selectedAdminDispute[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, dispute });
          return true;
        }
        const selectedMessages = pathname.match(bookingMessagesPath);
        if (selectedMessages) {
          if (request.method === "GET") {
            const context = await security.protect(request);
            const page = await messages.listMessages(context.actor, selectedMessages[1], {
              beforeCreatedAt: url.searchParams.get("beforeCreatedAt"),
              beforeMessageId: url.searchParams.get("beforeMessageId"),
              limit: url.searchParams.get("limit")
            });
            sendJson(response, 200, { ok: true, ...page });
            return true;
          }
          if (request.method === "POST") {
            const context = await security.protect(request, { mutation: true, roles: ["cleaner", "landlord"] });
            const message = await messages.sendMessage(context.actor, selectedMessages[1], await readJsonObject(request));
            sendJson(response, 201, { ok: true, message });
            return true;
          }
          return methodNotAllowed(response, ["GET", "POST"]), true;
        }
        const selectedEvents = pathname.match(bookingEventsPath);
        if (selectedEvents) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          security.requireOrigin(request);
          await realtime.openStream(context.actor, selectedEvents[1], request, response, request.headers?.["last-event-id"] || url.searchParams.get("afterEventId") || 0, context.expiresAt);
          return true;
        }
        // Understanding a dictated walkthrough happens server-side so the
        // provider credential never reaches the browser. It is optional: with
        // no provider configured the Landlord keeps the on-device parser, which
        // is also what the browser falls back to if this call fails.
        if (pathname === "/api/marketplace/landlord/scan-summary") {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          // This call spends money with a metered provider, so an authenticated
          // Landlord replaying their own valid session must not be able to
          // drive unbounded provider cost.
          await limitPublicRead(request, "marketplace-landlord:scan-summary");
          if (!speechSummary) {
            sendJson(response, 503, { ok: false, error: "Assisted walkthrough summaries are not configured." });
            return true;
          }
          const body = await readJsonObject(request);
          try {
            // One provider call, two views of the same reading. `tasks` is
            // exactly what this route has always returned, so nothing that
            // consumes it changes. `instructions` classifies each entry, so a
            // restriction like "do not move the paperwork" can be shown as a
            // restriction rather than as another line on a to-do list.
            const detailed = typeof speechSummary.summariseDetailed === "function"
              ? await speechSummary.summariseDetailed(body?.transcript)
              : { tasks: await speechSummary.summarise(body?.transcript), instructions: [] };
            sendJson(response, 200, { ok: true, tasks: detailed.tasks, instructions: detailed.instructions });
          } catch (error) {
            // The provider being unavailable must never block the walkthrough,
            // and its internal error text is never surfaced to the Landlord.
            sendJson(response, 502, { ok: false, error: "The walkthrough could not be summarised automatically." });
          }
          return true;
        }
        // Reads one captured room photo. The photo is held in memory for the
        // request only — nothing here writes it anywhere.
        if (pathname === "/api/marketplace/landlord/room-reading") {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          await limitPublicRead(request, "marketplace-landlord:room-reading");
          if (!roomVision) {
            observeScan("scan.reading.unavailable");
            sendJson(response, 503, { ok: false, error: "Assisted room reading is not configured." });
            return true;
          }
          const body = await readJsonObject(request, maximumRoomPhotoBodyBytes);
          // Start only after authentication, rate limiting and bounded JSON
          // parsing have succeeded. This measures the provider-facing read the
          // customer is waiting for, not unrelated request setup. The collector
          // immediately converts it to a coarse bucket, so the exact duration
          // never leaves this call.
          const readingStartedAt = Date.now();
          try {
            // Two shapes, one route. When the device has already found and
            // boxed the objects it sends them for naming only. When it has not —
            // the phone-camera fallback has no live viewfinder and so no boxes —
            // the whole frame is read exactly as before.
            const selectedItems = Array.isArray(body?.items) ? body.items : [];
            // Which read this is, and therefore which model tier answers it.
            //
            // Compared against the exact string rather than passed through: this
            // is a client-supplied field that selects a model which can cost five
            // times more, so anything unrecognised — absent, misspelt, or
            // hand-crafted — has to land on the cheaper tier. It can never
            // escalate, only stay cheap.
            const purpose = body?.purpose === "confirmation" ? "confirmation" : "walking";
            const result = selectedItems.length
              ? await roomVision.readSelectedItems({ image: body?.image, items: selectedItems, roomName: body?.roomName, transcript: body?.transcript })
              : await roomVision.readRoom({ image: body?.image, roomName: body?.roomName, transcript: body?.transcript, purpose });
            observeScan("scan.reading.succeeded", { dimensions: { outcome: "ok" } });
            sendJson(response, 200, { ok: true, ...result });
          } catch (error) {
            // Bucketed by cause, so a provider outage and a malformed photograph
            // are distinguishable without recording either.
            observeScan("scan.reading.failed", {
              dimensions: { outcome: error?.name === "AbortError" || error?.status === 408 ? "timeout" : "provider-error" }
            });
            // The scan must never be blocked by the reader being unavailable.
            // Keep photographs and provider messages out of logs, but retain a
            // bounded diagnostic signature so a broken model call is visible.
            console.error("[room-reading] provider request failed", {
              name: String(error?.name || "Error").slice(0, 80),
              status: Number.isInteger(error?.status) ? error.status : null,
              type: String(error?.error?.type || error?.type || "").slice(0, 80)
            });
            sendJson(response, 502, { ok: false, error: "This room could not be read automatically." });
          } finally {
            observeScan("scan.reading.latency_ms", { durationMs: Date.now() - readingStartedAt });
          }
          return true;
        }
        // The rules a customer's estimate was built from. Readable by any
        // authenticated account on purpose: someone quoted a number is entitled
        // to see the rates behind it, and the row holds no personal data.
        if (pathname === "/api/marketplace/pricing/scan-ruleset") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          sendJson(response, 200, { ok: true, ruleset: await scanPricing.getActiveRuleset(context.actor, url.searchParams.get("rulesetId")) });
          return true;
        }
        // Changing these numbers changes what every customer is charged, so it
        // is Administrator-only, append-only and audited at the database.
        // How far the shadow estimate is currently missing. Administrator-only and
        // aggregate-only: an error distribution discloses nothing, a list of
        // requests and agreed prices is a list of what customers paid.
        // The browser reports what only it can see: a denied camera, an
        // unavailable detector, a redaction, an abandoned scan. Every name and
        // every label is checked against the allowlist in scan-telemetry.mjs
        // before it is counted, so this cannot become a channel for arbitrary
        // strings — which is exactly what it would be if it accepted free text.
        if (pathname === "/api/marketplace/landlord/scan-events") {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          await security.protect(request, { mutation: true, roles: ["landlord"] });
          const body = await readJsonObject(request);
          const submitted = Array.isArray(body?.events) ? body.events.slice(0, 40) : [];
          let accepted = 0;
          for (const event of submitted) {
            if (observeScan(String(event?.metric || ""), {
              count: event?.count, durationMs: event?.durationMs, dimensions: event?.dimensions
            })) accepted += 1;
          }
          // The count is returned so a client can tell that an event name it sent
          // was rejected, rather than silently believing it is being measured.
          sendJson(response, 200, { ok: true, accepted });
          return true;
        }
        if (pathname === "/api/marketplace/pricing/scan-addons") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          sendJson(response, 200, { ok: true, addons: await scanPricing.listAddons(context.actor) });
          return true;
        }
        if (pathname === "/api/marketplace/admin/pricing/scan-addons") {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["administrator"] });
          sendJson(response, 200, { ok: true, addons: await scanPricing.upsertAddon(context.actor, await readJsonObject(request)) });
          return true;
        }
        if (pathname === "/api/marketplace/admin/scan-retention") {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["administrator"] });
          sendJson(response, 200, { ok: true, policy: await scanPricing.setRetention(context.actor, await readJsonObject(request)) });
          return true;
        }
        if (pathname === "/api/marketplace/admin/scan-telemetry") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          if (!scanTelemetry) {
            sendJson(response, 503, { ok: false, error: "Scan telemetry is not configured." });
            return true;
          }
          const result = typeof scanTelemetry.durableSnapshot === "function"
            ? await scanTelemetry.durableSnapshot(context.actor, 30)
            : { snapshot: scanTelemetry.snapshot(), durable: false, windowDays: null };
          sendJson(response, 200, {
            ok: true,
            ...result,
            rates: scanRates(result.snapshot),
            releaseRates: scanReleaseRates(result.snapshot)
          });
          return true;
        }
        if (pathname === "/api/marketplace/admin/pricing/scan-shadow-report") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          const report = await scanPricing.shadowReport(context.actor, url.searchParams.get("rulesetId"), url.searchParams.get("modelVersion"));
          sendJson(response, 200, { ok: true, report });
          return true;
        }
        // The scanner's accuracy, measured against reviewed truth. The queue is
        // what an internal reviewer still has to grade; the report is aggregate
        // agreement — counts and kappa, never rows about a particular home.
        if (pathname === "/api/marketplace/admin/scan-ground-truth") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["administrator"] });
          if (!scanGroundTruth) {
            sendJson(response, 503, { ok: false, error: "Scan accuracy review is not configured." });
            return true;
          }
          sendJson(response, 200, {
            ok: true,
            queue: await scanGroundTruth.getQueue(context.actor, url.searchParams.get("limit")),
            report: await scanGroundTruth.getReport(context.actor)
          });
          return true;
        }
        const selectedGroundTruthObject = pathname.match(scanGroundTruthObjectPath);
        if (selectedGroundTruthObject) {
          if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["administrator"] });
          if (!scanGroundTruth) {
            sendJson(response, 503, { ok: false, error: "Scan accuracy review is not configured." });
            return true;
          }
          const truth = await scanGroundTruth.recordVerdict(context.actor, selectedGroundTruthObject[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, truth });
          return true;
        }
        // The whole price list, read and written by an operator.
        //
        // The economics travel on THIS endpoint and no other: it is
        // administrator-only, and the cleaner's share and the margin floors are
        // exactly what an operator has come here to set. They are never
        // attached to a customer-facing quote.
        if (pathname === "/api/marketplace/admin/pricing") {
          const context = await security.protect(request, { mutation: request.method !== "GET", roles: ["administrator"] });
          if (request.method === "GET") {
            sendJson(response, 200, {
              ok: true,
              config: normalizedPricingConfig(await pricingConfiguration(context.actor)),
              economics: normalizedPricingEconomics(await pricingEconomicsConfiguration(context.actor))
            });
            return true;
          }
          if (request.method === "PUT") {
            const body = await readJsonObject(request);
            // Both halves are validated before either is stored, so a rejected
            // economics edit cannot leave a saved price list it no longer suits.
            const config = normalizedPricingConfig(body?.config);
            const economics = normalizedPricingEconomics(body?.economics);
            if (!pricingAdministration) {
              // Better a plain refusal than a form that appears to save. An
              // operator who believes a price change landed will not check it.
              throw Object.assign(new Error("Pricing storage is not connected, so this change was not saved."), { statusCode: 503, code: "pricing-storage-unavailable" });
            }
            await pricingAdministration.publish(context.actor, { config, economics, changeReason: body?.changeReason });
            sendJson(response, 200, { ok: true, config, economics });
            return true;
          }
          return methodNotAllowed(response, ["GET", "PUT"]), true;
        }
        // What a candidate price list would do to a real booking, before it is
        // saved. Compute only — nothing is stored, and the configuration in the
        // body is used instead of the live one precisely so an operator can see
        // the consequence of an edit they have not committed to.
        if (pathname === "/api/marketplace/admin/pricing/preview") {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          await security.protect(request, { mutation: true, roles: ["administrator"] });
          const body = await readJsonObject(request, maximumRoomScanBodyBytes);
          const config = normalizedPricingConfig(body?.config);
          const economics = normalizedPricingEconomics(body?.economics);
          const reviewed = reviewedQuote(quoteRooms(body?.request ?? {}, config), economics);
          sendJson(response, 200, { ok: true, quote: reviewed.quote, economics: reviewed.economics });
          return true;
        }
        if (pathname === "/api/marketplace/admin/pricing/scan-ruleset") {
          const context = await security.protect(request, { mutation: request.method !== "GET", roles: ["administrator"] });
          if (request.method === "GET") {
            sendJson(response, 200, {
              ok: true,
              ruleset: await scanPricing.getActiveRuleset(context.actor, url.searchParams.get("rulesetId")),
              history: await scanPricing.listRulesets(context.actor, url.searchParams.get("rulesetId"), url.searchParams.get("limit")),
              // Returned alongside the rates because both are things an operator
              // adjusts about the same feature, and a second round trip to read
              // two integers is waste.
              retention: await scanPricing.getRetention(context.actor)
            });
            return true;
          }
          if (request.method === "POST") {
            const body = await readJsonObject(request);
            sendJson(response, 200, { ok: true, ruleset: await scanPricing.publishRuleset(context.actor, body?.rulesetId, body) });
            return true;
          }
          return methodNotAllowed(response, ["GET", "POST"]), true;
        }
        // Assesses a scan the customer is still holding. Stores nothing, so it is
        // rate-limited against the read allowance rather than treated as a write:
        // it costs CPU and a rates lookup, and a replayed session should not be
        // able to spend either without bound.
        if (pathname === "/api/marketplace/landlord/scan-preview") {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, allowance: false, roles: ["landlord"] });
          await limitPublicRead(request, "marketplace-landlord:scan-preview");
          const body = await readJsonObject(request, maximumRoomScanBodyBytes);
          sendJson(response, 200, { ok: true, scan: await scans.previewScan(context.actor, body) });
          return true;
        }
        // The price, from the rooms and tasks the customer has confirmed.
        //
        // THIS IS THE AUTHORITY. The browser runs the identical module so the
        // scanner can update instantly without a round trip, but the number
        // that reaches a booking is the one produced here — a client that has
        // been tampered with cannot talk Homle into a price it did not compute.
        //
        // Compute only: nothing is stored, no cleaner is contacted and no
        // booking is created, so it is rate-limited against the read allowance.
        // The response deliberately carries no economics; what the cleaner is
        // paid and what Homle keeps is not the customer's side of the contract.
        if (pathname === "/api/marketplace/pricing/quote") {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const quoteContext = await security.protect(request, { mutation: true, allowance: false, roles: ["landlord"] });
          await limitPublicRead(request, "marketplace-landlord:scan-preview");
          const body = await readJsonObject(request, maximumRoomScanBodyBytes);
          const config = normalizedPricingConfig(await pricingConfiguration(quoteContext.actor));
          const { quote } = reviewedQuote(quoteRooms(body, config), await pricingEconomicsConfiguration(quoteContext.actor));
          sendJson(response, 200, { ok: true, quote });
          return true;
        }
        // The price list the scanner needs to show a running total without a
        // round trip per tap. Public-shaped on purpose: these are the prices a
        // customer is about to be quoted, and there is nothing to hide in them.
        if (pathname === "/api/marketplace/pricing/config") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const configContext = await security.protect(request, { roles: ["landlord"] });
          await limitPublicRead(request, "marketplace-landlord:scan-preview");
          sendJson(response, 200, { ok: true, config: normalizedPricingConfig(await pricingConfiguration(configContext.actor)) });
          return true;
        }
        // Turns two tapped pixel spans into a measurement with its band. Compute
        // only — nothing is stored and no image travels; the photo stays on the
        // phone and only the two line lengths arrive. The maths lives in
        // room-measurement.mjs, whose single ownership is the reason this
        // endpoint exists at all: the client must never re-implement the
        // tolerance arithmetic to show a preview of it.
        //
        // Shares the scan-preview allowance on purpose: same feature family,
        // same cost class (pure arithmetic), and a scan produces a handful of
        // these against preview's generous budget.
        if (pathname === "/api/marketplace/landlord/photo-measurement") {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          await security.protect(request, { mutation: true, allowance: false, roles: ["landlord"] });
          await limitPublicRead(request, "marketplace-landlord:scan-preview");
          const body = await readJsonObject(request);
          try {
            const scale = referenceScale({
              reference: body?.reference,
              referencePixels: Number(body?.referencePixels),
              referenceAxis: body?.referenceAxis === "height" ? "height" : "width"
            });
            const measurement = measureFromReference({
              subject: body?.subject,
              scale,
              spanPixels: Number(body?.spanPixels)
            });
            sendJson(response, 200, { ok: true, measurement: { ...measurement, label: measurementLabel(measurement) } });
          } catch (error) {
            // These messages are already written for the customer ("The bank
            // card is too small in the picture…"), so they are the response.
            sendJson(response, 400, { ok: false, error: String(error?.message || "That could not be measured.") });
          }
          return true;
        }
        if (pathname === "/api/marketplace/landlord/favourite-cleaners") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["landlord"] });
          sendJson(response, 200, { ok: true, cleaners: await favouriteCleaners.listOwn(context.actor) });
          return true;
        }
        const selectedFavouriteCleaner = pathname.match(favouriteCleanerPath);
        if (selectedFavouriteCleaner) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const favourite = await favouriteCleaners.setOwn(context.actor, selectedFavouriteCleaner[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, favourite });
          return true;
        }
        const selectedRequestEvents = pathname.match(requestEventsPath);
        if (selectedRequestEvents) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["landlord"] });
          security.requireOrigin(request);
          await realtime.openRequestStream(context.actor, selectedRequestEvents[1], request, response, request.headers?.["last-event-id"] || url.searchParams.get("afterEventId") || 0, context.expiresAt);
          return true;
        }
        const selectedJourneyReadiness = pathname.match(journeyReadinessPath);
        if (selectedJourneyReadiness) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["cleaner"] });
          const readiness = await journeys.getJourneyReadiness(context.actor, selectedJourneyReadiness[1]);
          sendJson(response, 200, { ok: true, readiness });
          return true;
        }
        const selectedJourneyStart = pathname.match(journeyStartPath);
        if (selectedJourneyStart) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          const tracking = await journeys.startJourney(context.actor, selectedJourneyStart[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, tracking });
          return true;
        }
        const selectedJourneyLocation = pathname.match(journeyLocationPath);
        if (selectedJourneyLocation) {
          if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          const tracking = await journeys.updateLocation(context.actor, selectedJourneyLocation[1], await readJsonObject(request));
          sendJson(response, 200, { ok: true, tracking });
          return true;
        }
        const selectedJourneyArrival = pathname.match(journeyArrivalPath);
        if (selectedJourneyArrival) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          const tracking = await journeys.markArrived(context.actor, selectedJourneyArrival[1]);
          sendJson(response, 200, { ok: true, tracking });
          return true;
        }
        const selectedTracking = pathname.match(bookingTrackingPath);
        if (selectedTracking) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          const tracking = await journeys.getTracking(context.actor, selectedTracking[1]);
          sendJson(response, 200, { ok: true, tracking });
          return true;
        }
        const selectedCleaningStart = pathname.match(cleaningStartPath);
        if (selectedCleaningStart) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          sendJson(response, 200, { ok: true, progress: await progress.startCleaning(context.actor, selectedCleaningStart[1]) });
          return true;
        }
        const selectedPhotoIntent = pathname.match(jobPhotoIntentPath);
        if (selectedPhotoIntent) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          const intent = await media.createUploadIntent(context.actor, selectedPhotoIntent[1], await readJsonObject(request));
          sendJson(response, 201, { ok: true, upload: intent });
          return true;
        }
        const selectedPhotoCompletion = pathname.match(jobPhotoCompletionPath);
        if (selectedPhotoCompletion) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          sendJson(response, 200, { ok: true, progress: await media.completeUpload(context.actor, selectedPhotoCompletion[1], selectedPhotoCompletion[2]) });
          return true;
        }
        const selectedPhotoAccess = pathname.match(jobPhotoAccessPath);
        if (selectedPhotoAccess) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          sendJson(response, 200, { ok: true, photo: await media.getPhotoAccess(context.actor, selectedPhotoAccess[1], selectedPhotoAccess[2]) });
          return true;
        }
        const selectedCleaningPause = pathname.match(cleaningPausePath);
        if (selectedCleaningPause) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          sendJson(response, 200, { ok: true, progress: await progress.setPause(context.actor, selectedCleaningPause[1], await readJsonObject(request)) });
          return true;
        }
        const selectedCleaningFinish = pathname.match(cleaningFinishPath);
        if (selectedCleaningFinish) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          sendJson(response, 200, { ok: true, progress: await progress.finishCleaning(context.actor, selectedCleaningFinish[1]) });
          return true;
        }
        const selectedTaskDecision = pathname.match(cleaningTaskDecisionPath);
        if (selectedTaskDecision) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          sendJson(response, 200, { ok: true, progress: await progress.decideUnexpectedTask(context.actor, selectedTaskDecision[1], selectedTaskDecision[2], await readJsonObject(request)) });
          return true;
        }
        const selectedTaskTermsConfirmation = pathname.match(cleaningTaskTermsConfirmationPath);
        if (selectedTaskTermsConfirmation) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          sendJson(response, 200, { ok: true, progress: await progress.confirmUnexpectedTaskTerms(context.actor, selectedTaskTermsConfirmation[1], selectedTaskTermsConfirmation[2]) });
          return true;
        }
        const selectedCleaningTask = pathname.match(cleaningTaskPath);
        if (selectedCleaningTask) {
          if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          sendJson(response, 200, { ok: true, progress: await progress.updateTask(context.actor, selectedCleaningTask[1], selectedCleaningTask[2], await readJsonObject(request)) });
          return true;
        }
        const selectedCleaningTasks = pathname.match(cleaningTasksPath);
        if (selectedCleaningTasks) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          sendJson(response, 201, { ok: true, progress: await progress.addUnexpectedTask(context.actor, selectedCleaningTasks[1], await readJsonObject(request)) });
          return true;
        }
        const selectedCleaningProgress = pathname.match(cleaningProgressPath);
        if (selectedCleaningProgress) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          sendJson(response, 200, { ok: true, progress: await progress.getProgress(context.actor, selectedCleaningProgress[1]) });
          return true;
        }
        const selectedBooking = pathname.match(bookingPropertyPath);
        if (selectedBooking) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          const property = await properties.getBookingProperty(context.actor, selectedBooking[1]);
          sendJson(response, 200, { ok: true, property });
          return true;
        }
        sendJson(response, 404, { ok: false, code: "not-found", error: "Marketplace route not found." });
        return true;
      } catch (error) {
        const mapped = errorResponse(error);
        if (mapped.statusCode === 500) onUnexpectedError(error);
        const headers = error?.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {};
        sendJson(response, mapped.statusCode, { ok: false, code: mapped.code, error: mapped.message }, headers);
        return true;
      }
    }
  };
}

export { maximumBodyBytes };
