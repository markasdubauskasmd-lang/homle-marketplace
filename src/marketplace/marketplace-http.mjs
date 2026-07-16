import { errorResponse, maximumBodyBytes, methodNotAllowed, readJsonObject, readRawBody, sendJson } from "./http-support.mjs";
import { createRateLimitBoundary } from "./rate-limit-boundary.mjs";

const uuidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const bookingPropertyPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/property$`);
const bookingResponsePath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/response$`);
const requestInvitationPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/invitations$`);
const requestMatchesPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/matches$`);
const bookingTrackingPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/tracking$`);
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
const jobPhotoIntentPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/photos/intents$`);
const jobPhotoCompletionPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/photos/(${uuidPattern})/complete$`);
const jobPhotoAccessPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/cleaning-progress/photos/(${uuidPattern})/access$`);
const bookingMessagesPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/messages$`);
const bookingEventsPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/events$`);
const notificationReadPath = new RegExp(`^/api/marketplace/notifications/(${uuidPattern})/read$`);
const propertyPath = new RegExp(`^/api/marketplace/properties/(${uuidPattern})$`);
const cleanerReviewsPath = new RegExp(`^/api/marketplace/cleaners/(${uuidPattern})/reviews$`);
const bookingCompletionPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/completion$`);
const bookingReviewsPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/reviews$`);
const bookingReviewResponsePath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/reviews/response$`);
const bookingPaymentPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/payment$`);
const adminReviewModerationPath = new RegExp(`^/api/marketplace/admin/reviews/(${uuidPattern})/moderation$`);
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

export function createMarketplaceHttpRouter(dependencies, options = {}) {
  const security = dependencies?.security;
  const properties = dependencies?.propertyService;
  const cleaners = dependencies?.cleanerProfileService;
  const cleaningRequests = dependencies?.cleaningRequestService;
  const bookings = dependencies?.bookingWorkflowService;
  const matching = dependencies?.matchingService;
  const journeys = dependencies?.journeyService;
  const progress = dependencies?.progressService;
  const media = dependencies?.mediaService;
  const messages = dependencies?.messageService;
  const realtime = dependencies?.realtimeService;
  const notifications = dependencies?.notificationService;
  const reviews = dependencies?.reviewService;
  const payments = dependencies?.paymentService || null;
  const rateLimiter = dependencies?.rateLimiter;
  if (!security || typeof security.protect !== "function") throw new TypeError("Marketplace HTTP routes require account security.");
  if (!properties || typeof properties.saveLandlordProfile !== "function" || typeof properties.createProperty !== "function" || typeof properties.updateOwnProperty !== "function" || typeof properties.listOwnProperties !== "function" || typeof properties.getBookingProperty !== "function") throw new TypeError("Marketplace HTTP routes require the property service.");
  if (!cleaners || typeof cleaners.getOwnProfile !== "function" || typeof cleaners.saveOwnProfile !== "function" || typeof cleaners.searchPublicProfiles !== "function") throw new TypeError("Marketplace HTTP routes require the cleaner profile service.");
  if (!cleaningRequests || typeof cleaningRequests.createOwnRequest !== "function" || typeof cleaningRequests.listOwnRequests !== "function") throw new TypeError("Marketplace HTTP routes require the cleaning-request service.");
  if (!bookings || typeof bookings.inviteCleaner !== "function" || typeof bookings.respondToInvitation !== "function") throw new TypeError("Marketplace HTTP routes require the booking workflow service.");
  if (!matching || typeof matching.recommendForRequest !== "function") throw new TypeError("Marketplace HTTP routes require the request matching service.");
  if (!journeys || !["startJourney", "updateLocation", "markArrived", "getTracking"].every((method) => typeof journeys[method] === "function")) throw new TypeError("Marketplace HTTP routes require the booking journey service.");
  if (!progress || !["getProgress", "startCleaning", "setPause", "updateTask", "addUnexpectedTask", "decideUnexpectedTask", "finishCleaning"].every((method) => typeof progress[method] === "function")) throw new TypeError("Marketplace HTTP routes require the cleaning-progress service.");
  if (!media || !["createUploadIntent", "completeUpload", "getPhotoAccess"].every((method) => typeof media[method] === "function")) throw new TypeError("Marketplace HTTP routes require the private job-media service.");
  if (!messages || !["sendMessage", "listMessages"].every((method) => typeof messages[method] === "function")) throw new TypeError("Marketplace HTTP routes require the booking-message service.");
  if (!realtime || typeof realtime.openStream !== "function") throw new TypeError("Marketplace HTTP routes require the booking real-time service.");
  if (!notifications || !["listNotifications", "markNotificationRead", "markAllNotificationsRead"].every((method) => typeof notifications[method] === "function")) throw new TypeError("Marketplace HTTP routes require the account notification service.");
  if (!reviews || !["confirmCompletion", "submitReview", "getBookingReview", "getPublicReviews", "respondToReview", "moderateReview"].every((method) => typeof reviews[method] === "function")) throw new TypeError("Marketplace HTTP routes require the verified booking-review service.");
  if (payments && !["handleWebhook", "beginAuthorization", "getForBooking", "getClientConfiguration"].every((method) => typeof payments[method] === "function")) throw new TypeError("Marketplace payment routes require the complete payment service.");
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};
  const limitPublicRead = createRateLimitBoundary(rateLimiter, options.clientKey, { onUnexpectedError });

  return {
    async handle(request, response, suppliedUrl) {
      const url = suppliedUrl instanceof URL ? suppliedUrl : new URL(request.url || "/", "http://localhost");
      const pathname = url.pathname;
      if (!pathname.startsWith(apiPrefix)) return false;
      try {
        if (pathname === "/api/marketplace/payments/webhook") {
          if (!payments) return false;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const signatureHeader = request.headers?.["stripe-signature"];
          const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
          const result = await payments.handleWebhook(await readRawBody(request), signature);
          sendJson(response, 200, { ok: true, accepted: result?.accepted === true, duplicate: result?.duplicate === true, ignored: result?.ignored === true });
          return true;
        }
        if (pathname === "/api/marketplace/payments/config") {
          if (!payments) return false;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request, { roles: ["landlord"] });
          sendJson(response, 200, { ok: true, payment: payments.getClientConfiguration(context.actor) });
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
          sendJson(response, 200, { ok: true, account: { displayName: context.account.displayName, email: context.account.email, selectedRole: context.account.selectedRole, roles: context.actor.roles } });
          return true;
        }
        if (pathname === "/api/marketplace/cleaners") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          await limitPublicRead(request, "marketplace-public:cleaner-directory");
          const results = await cleaners.searchPublicProfiles(queryFilters(url));
          sendJson(response, 200, { ok: true, cleaners: results });
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
        if (pathname === "/api/marketplace/landlord/profile") {
          if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const profile = await properties.saveLandlordProfile(context.actor, await readJsonObject(request));
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
        const selectedProperty = pathname.match(propertyPath);
        if (selectedProperty) {
          if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const body = await readJsonObject(request);
          const property = await properties.updateOwnProperty(context.actor, { ...body, id: selectedProperty[1] });
          sendJson(response, 200, { ok: true, property });
          return true;
        }
        const selectedInvitationRequest = pathname.match(requestInvitationPath);
        if (selectedInvitationRequest) {
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const body = await readJsonObject(request);
          const booking = await bookings.inviteCleaner(context.actor, { cleaningRequestId: selectedInvitationRequest[1], cleanerId: body.cleanerId });
          sendJson(response, 201, { ok: true, booking });
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
