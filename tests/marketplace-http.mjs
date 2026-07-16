import { AccountHttpError, createAccountSecurity } from "../src/marketplace/account-security.mjs";
import { createMarketplaceHttpRouter, maximumBodyBytes } from "../src/marketplace/marketplace-http.mjs";
import { createMarketplaceRuntime } from "../src/marketplace/runtime.mjs";
import { createSessionMaterial, developmentSessionCookieName } from "../src/marketplace/session.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(method, url, { body, headers = {} } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; }
  };
}

function response() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(body = "") { this.body = String(body); },
    parsed() { return JSON.parse(this.body); }
  };
}

async function dispatch(router, method, url, options) {
  const selectedRequest = request(method, url, options);
  const selectedResponse = response();
  const handled = await router.handle(selectedRequest, selectedResponse, new URL(url, "http://127.0.0.1:4173"));
  return { handled, request: selectedRequest, response: selectedResponse, body: selectedResponse.parsed() };
}

const sessionSecret = "marketplace-http-session-secret-over-thirty-two-characters";
const material = createSessionMaterial(sessionSecret, new Date("2026-07-15T15:00:00.000Z"), 3600);
const sessions = {
  landlord: {
    session_id: "77777777-7777-4777-8777-777777777777",
    user_id: "11111111-1111-4111-8111-111111111111",
    email: "landlord@example.com",
    email_verified_at: "2026-07-15T14:00:00.000Z",
    display_name: "Landlord Example",
    selected_role: "landlord",
    roles: ["landlord"],
    csrf_secret_hash: material.csrfHash,
    expires_at: material.expiresAt
  }
};
const security = createAccountSecurity({ async findSession(hash) { return hash.equals(material.tokenHash) ? sessions.landlord : null; } }, { sessionSecret, appOrigin: "http://127.0.0.1:4173", production: false });
const calls = [];
const cleanerProfileService = {
  async searchPublicProfiles(filters) { calls.push({ kind: "search", filters }); return [{ cleanerId: "public-cleaner", displayName: "Public Cleaner" }]; },
  async getOwnProfile(actor) { calls.push({ kind: "cleaner-get", actor }); return { cleanerId: actor.userId, biography: "Careful cleaner", profileCompletionPercent: 60, isPublic: false, services: [], serviceAreas: [] }; },
  async saveOwnProfile(actor, input) { calls.push({ kind: "cleaner-save", actor, input }); return { profileCompletionPercent: 100 }; }
};
const propertyService = {
  async saveLandlordProfile(actor, input) { calls.push({ kind: "landlord-save", actor, input }); return { organisationName: input.organisationName || null, biography: input.biography || "" }; },
  async createProperty(actor, input) { calls.push({ kind: "property-create", actor, input }); return { propertyId: "44444444-4444-4444-8444-444444444444", name: input.name }; },
  async updateOwnProperty(actor, input) { calls.push({ kind: "property-update", actor, input }); return { propertyId: input.id, name: input.name }; },
  async listOwnProperties(actor) { calls.push({ kind: "property-list", actor }); return []; },
  async getBookingProperty(actor, bookingId) { calls.push({ kind: "booking-property", actor, bookingId }); if (actor.userId === "33333333-3333-4333-8333-333333333333") throw new AccountHttpError(403, "forbidden", "Booking property access is forbidden."); return { propertyId: "44444444-4444-4444-8444-444444444444", accessInstructions: "Protected" }; }
};
const cleaningRequestService = {
  async createOwnRequest(actor, input) { calls.push({ kind: "request-create", actor, input }); return { requestId: "66666666-6666-4666-8666-666666666666", propertyId: input.propertyId, status: "searching-for-cleaner" }; },
  async listOwnRequests(actor) { calls.push({ kind: "request-list", actor }); return []; }
};
const bookingWorkflowService = {
  async inviteCleaner(actor, input) { calls.push({ kind: "booking-invite", actor, input }); return { bookingId: "55555555-5555-4555-8555-555555555555", status: "pending-cleaner-acceptance" }; },
  async respondToInvitation(actor, bookingId, input) { calls.push({ kind: "booking-response", actor, bookingId, input }); return { bookingId, status: input.decision === "accept" ? "confirmed" : "cancelled" }; }
};
const matchingService = {
  async recommendForRequest(actor, cleaningRequestId) { calls.push({ kind: "request-matches", actor, cleaningRequestId }); return { cleaningRequestId, generatedAt: "2026-07-15T15:00:00.000Z", candidates: [{ cleanerId: "22222222-2222-4222-8222-222222222222", rank: 1 }] }; }
};
const journeyService = {
  async startJourney(actor, bookingId, input) { calls.push({ kind: "journey-start", actor, bookingId, input }); return { bookingId, status: "cleaner-en-route", sharingState: "live" }; },
  async updateLocation(actor, bookingId, input) { calls.push({ kind: "journey-location", actor, bookingId, input }); return { bookingId, status: "cleaner-en-route", sharingState: "live", location: input }; },
  async markArrived(actor, bookingId) { calls.push({ kind: "journey-arrive", actor, bookingId }); return { bookingId, status: "cleaner-arrived", sharingState: "arrived", location: null }; },
  async getTracking(actor, bookingId) { calls.push({ kind: "journey-read", actor, bookingId }); return { bookingId, status: "cleaner-en-route", sharingState: "live" }; }
};
const progressService = {
  async getProgress(actor, bookingId) { calls.push({ kind: "progress-read", actor, bookingId }); return { bookingId, status: "cleaning-in-progress", overallPercentage: 50 }; },
  async startCleaning(actor, bookingId) { calls.push({ kind: "progress-start", actor, bookingId }); return { bookingId, status: "cleaning-in-progress" }; },
  async setPause(actor, bookingId, input) { calls.push({ kind: "progress-pause", actor, bookingId, input }); return { bookingId, status: "cleaning-in-progress", isPaused: input.paused }; },
  async updateTask(actor, bookingId, taskId, input) { calls.push({ kind: "progress-task", actor, bookingId, taskId, input }); return { bookingId, status: "cleaning-in-progress" }; },
  async addUnexpectedTask(actor, bookingId, input) { calls.push({ kind: "progress-add", actor, bookingId, input }); return { bookingId, status: "cleaning-in-progress" }; },
  async decideUnexpectedTask(actor, bookingId, taskId, input) { calls.push({ kind: "progress-decision", actor, bookingId, taskId, input }); return { bookingId, status: "cleaning-in-progress" }; },
  async finishCleaning(actor, bookingId) { calls.push({ kind: "progress-finish", actor, bookingId }); return { bookingId, status: "awaiting-review", overallPercentage: 100 }; }
};
const mediaService = {
  async createUploadIntent(actor, bookingId, input) { calls.push({ kind: "media-intent", actor, bookingId, input }); return { uploadId: "88888888-8888-4888-8888-888888888888", uploadUrl: "https://storage.example/write", method: "PUT" }; },
  async completeUpload(actor, bookingId, uploadId) { calls.push({ kind: "media-complete", actor, bookingId, uploadId }); return { bookingId, status: "cleaning-in-progress", eventVersion: 8 }; },
  async getPhotoAccess(actor, bookingId, photoId) { calls.push({ kind: "media-access", actor, bookingId, photoId }); return { photoId, url: "https://storage.example/read" }; }
};
const messageService = {
  async sendMessage(actor, bookingId, input) { calls.push({ kind: "message-send", actor, bookingId, input }); return { messageId: "88888888-8888-4888-8888-888888888888", clientMessageId: input.clientMessageId, bookingId, senderUserId: actor.userId, senderRole: actor.roles[0], body: input.body, createdAt: "2026-07-15T16:00:00.000Z" }; },
  async listMessages(actor, bookingId, input) { calls.push({ kind: "message-list", actor, bookingId, input }); return { bookingId, messages: [], hasMore: false, nextCursor: null }; }
};
const realtimeService = {
  async openStream(actor, bookingId, request, response, lastEventId) { calls.push({ kind: "realtime-open", actor, bookingId, lastEventId }); response.writeHead(200, { "Content-Type": "text/event-stream" }); response.end(JSON.stringify({ ok: true })); }
};
const notificationService = {
  async listNotifications(actor, input) { calls.push({ kind: "notification-list", actor, input }); return { notifications: [], unreadCount: 2, hasMore: false, nextCursor: null }; },
  async markNotificationRead(actor, notificationId) { calls.push({ kind: "notification-read", actor, notificationId }); return { notificationId, readAt: "2026-07-15T18:05:00.000Z" }; },
  async markAllNotificationsRead(actor, input) { calls.push({ kind: "notification-read-all", actor, input }); return { markedRead: 2, cutoffCreatedAt: input.cutoffCreatedAt }; }
};
const reviewService = {
  async confirmCompletion(actor, bookingId) { calls.push({ kind: "review-complete-booking", actor, bookingId }); return { bookingId, status: "completed", completedAt: "2026-07-15T18:55:00.000Z" }; },
  async submitReview(actor, bookingId, input) { calls.push({ kind: "review-submit", actor, bookingId, input }); return { reviewId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bookingId, cleanerId: "22222222-2222-4222-8222-222222222222", rating: input.rating, moderationStatus: "pending", createdAt: "2026-07-15T19:00:00.000Z" }; },
  async getBookingReview(actor, bookingId) { calls.push({ kind: "review-get", actor, bookingId }); return null; },
  async getPublicReviews(cleanerId, input) { calls.push({ kind: "review-public", cleanerId, input }); return { cleanerId, reviews: [], hasMore: false, nextCursor: null }; },
  async respondToReview(actor, bookingId, input) { calls.push({ kind: "review-respond", actor, bookingId, input }); return { reviewId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bookingId, cleanerId: actor.userId, rating: 5, moderationStatus: "approved", cleanerResponse: input.response, createdAt: "2026-07-15T19:00:00.000Z" }; },
  async moderateReview(actor, reviewId, input) { calls.push({ kind: "review-moderate", actor, reviewId, input }); return { reviewId, bookingId: "55555555-5555-4555-8555-555555555555", cleanerId: "22222222-2222-4222-8222-222222222222", rating: 5, moderationStatus: input.decision, createdAt: "2026-07-15T19:00:00.000Z" }; }
};
let unexpectedError;
let rateLimitedScope = "";
let limiterFailure = null;
let trustedClientKey = "198.51.100.20";
const rateLimiter = {
  async consume(input) {
    calls.push({ kind: "rate-limit", input });
    if (limiterFailure) throw limiterFailure;
    return input.scope === rateLimitedScope ? { allowed: false, retryAfterSeconds: 99999 } : { allowed: true };
  }
};
const router = createMarketplaceHttpRouter({ security, cleanerProfileService, propertyService, cleaningRequestService, bookingWorkflowService, matchingService, journeyService, progressService, mediaService, messageService, realtimeService, notificationService, reviewService, rateLimiter }, { clientKey: () => trustedClientKey, onUnexpectedError(error) { unexpectedError = error; } });
const authHeaders = {
  cookie: `${developmentSessionCookieName}=${material.token}`,
  origin: "http://127.0.0.1:4173",
  "x-csrf-token": material.csrfToken,
  "content-type": "application/json; charset=utf-8"
};

const unrelated = response();
assert(await router.handle(request("GET", "/api/health"), unrelated, new URL("http://127.0.0.1:4173/api/health")) === false && unrelated.statusCode === null, "Marketplace router intercepted an existing pilot API route.");

const directory = await dispatch(router, "GET", "/api/marketplace/cleaners?outwardPostcode=SW1A&verifiedOnly=true&limit=10");
assert(directory.handled && directory.response.statusCode === 200 && directory.body.cleaners.length === 1 && calls.at(-1).filters.outwardPostcode === "SW1A" && calls.at(-1).filters.verifiedOnly === true && calls.at(-1).filters.limit === "10", "Public cleaner discovery did not parse its bounded service filters.");
const badBoolean = await dispatch(router, "GET", "/api/marketplace/cleaners?verifiedOnly=yes");
assert(badBoolean.response.statusCode === 422 && badBoolean.body.code === "validation-failed", "Cleaner discovery accepted an ambiguous boolean filter.");
const publicReviews = await dispatch(router, "GET", "/api/marketplace/cleaners/22222222-2222-4222-8222-222222222222/reviews?limit=10");
assert(publicReviews.response.statusCode === 200 && publicReviews.body.reviews.length === 0 && calls.at(-1).kind === "review-public" && calls.at(-1).input.limit === "10", "Public approved-review routing lost its safe Cleaner ID or cursor.");
assert(calls.some((call) => call.kind === "rate-limit" && call.input.scope === "marketplace-public:cleaner-directory" && call.input.key === trustedClientKey) && calls.some((call) => call.kind === "rate-limit" && call.input.scope === "marketplace-public:cleaner-reviews" && call.input.key === trustedClientKey), "Public marketplace reads did not use separate trusted shared-limiter scopes.");

const searchesBeforeThrottle = calls.filter((call) => call.kind === "search").length;
rateLimitedScope = "marketplace-public:cleaner-directory";
const throttledDirectory = await dispatch(router, "GET", "/api/marketplace/cleaners?limit=10");
assert(throttledDirectory.response.statusCode === 429 && throttledDirectory.body.code === "rate-limited" && throttledDirectory.response.headers["Retry-After"] === "3600" && calls.filter((call) => call.kind === "search").length === searchesBeforeThrottle, "Throttled Cleaner discovery reached the service or lost its bounded Retry-After response.");
rateLimitedScope = "";

limiterFailure = new Error("private shared-limiter outage");
unexpectedError = null;
const unavailableReviews = await dispatch(router, "GET", "/api/marketplace/cleaners/22222222-2222-4222-8222-222222222222/reviews");
assert(unavailableReviews.response.statusCode === 503 && unavailableReviews.body.code === "abuse-control-unavailable" && !unavailableReviews.response.body.includes("private shared-limiter outage") && unexpectedError === limiterFailure, "A shared-limiter outage did not fail closed or leaked private failure detail.");
limiterFailure = null;

trustedClientKey = "";
unexpectedError = null;
const missingClientKey = await dispatch(router, "GET", "/api/marketplace/cleaners");
assert(missingClientKey.response.statusCode === 503 && missingClientKey.body.code === "abuse-control-unavailable" && unexpectedError instanceof TypeError, "A missing trusted client key did not stop public discovery safely.");
trustedClientKey = "198.51.100.20";

const noSession = await dispatch(router, "GET", "/api/marketplace/properties");
assert(noSession.response.statusCode === 401 && noSession.body.code === "authentication-required" && noSession.response.headers["Cache-Control"] === "no-store", "Private property listing accepted a missing session or allowed caching.");
const landlordCleanerEdit = await dispatch(router, "PUT", "/api/marketplace/cleaner/profile", { headers: authHeaders, body: { biography: "Attempt" } });
assert(landlordCleanerEdit.response.statusCode === 403 && landlordCleanerEdit.body.code === "role-rejected", "A landlord entered the Cleaner-only profile route.");
const wrongOrigin = await dispatch(router, "POST", "/api/marketplace/properties", { headers: { ...authHeaders, origin: "https://attacker.example" }, body: { name: "Attempt" } });
assert(wrongOrigin.response.statusCode === 403 && wrongOrigin.body.code === "origin-rejected", "Property mutation accepted a cross-origin request.");
const missingCsrf = await dispatch(router, "POST", "/api/marketplace/properties", { headers: { ...authHeaders, "x-csrf-token": "" }, body: { name: "Attempt" } });
assert(missingCsrf.response.statusCode === 403 && missingCsrf.body.code === "csrf-rejected", "Property mutation accepted a missing CSRF token.");

const ownerList = await dispatch(router, "GET", "/api/marketplace/properties", { headers: { cookie: authHeaders.cookie } });
assert(ownerList.response.statusCode === 200 && calls.at(-1).kind === "property-list" && calls.at(-1).actor.userId === sessions.landlord.user_id, "Property listing did not use the authenticated landlord identity.");
const notificationList = await dispatch(router, "GET", "/api/marketplace/notifications?limit=15", { headers: { cookie: authHeaders.cookie } });
const notificationId = "77777777-7777-4777-8777-777777777777";
const notificationRead = await dispatch(router, "POST", `/api/marketplace/notifications/${notificationId}/read`, { headers: authHeaders, body: {} });
const notificationReadAll = await dispatch(router, "POST", "/api/marketplace/notifications/read-all", { headers: authHeaders, body: { cutoffCreatedAt: "2026-07-15T18:10:00.000Z" } });
assert(notificationList.response.statusCode === 200 && notificationList.body.unreadCount === 2 && notificationRead.response.statusCode === 200 && notificationReadAll.response.statusCode === 200 && calls.slice(-3).map((call) => call.kind).join(",") === "notification-list,notification-read,notification-read-all" && calls.at(-3).input.limit === "15" && calls.at(-2).notificationId === notificationId, "Notification inbox routes lost account authorization, pagination or CSRF-protected read actions.");
const profile = await dispatch(router, "PUT", "/api/marketplace/landlord/profile", { headers: authHeaders, body: { organisationName: "Example PM", biography: "Local portfolio", userId: "33333333-3333-4333-8333-333333333333" } });
assert(profile.response.statusCode === 200 && calls.at(-1).actor.userId === sessions.landlord.user_id && calls.at(-1).input.userId !== calls.at(-1).actor.userId, "Landlord profile routing trusted a submitted owner identifier.");
const created = await dispatch(router, "POST", "/api/marketplace/properties", { headers: authHeaders, body: { name: "Canal View", landlordUserId: "33333333-3333-4333-8333-333333333333" } });
assert(created.response.statusCode === 201 && calls.at(-1).actor.userId === sessions.landlord.user_id && created.body.property.name === "Canal View", "Property creation did not bind the authenticated actor or return a created response.");
const propertyId = "44444444-4444-4444-8444-444444444444";
const updated = await dispatch(router, "PUT", `/api/marketplace/properties/${propertyId}`, { headers: authHeaders, body: { id: "99999999-9999-4999-8999-999999999999", name: "Updated" } });
assert(updated.response.statusCode === 200 && calls.at(-1).input.id === propertyId, "Property update trusted a body property ID instead of the protected route resource.");
const requestCreated = await dispatch(router, "POST", "/api/marketplace/cleaning-requests", { headers: authHeaders, body: { propertyId, landlordUserId: "33333333-3333-4333-8333-333333333333" } });
const requestList = await dispatch(router, "GET", "/api/marketplace/cleaning-requests", { headers: { cookie: authHeaders.cookie } });
assert(requestCreated.response.statusCode === 201 && requestCreated.body.cleaningRequest.status === "searching-for-cleaner" && calls.at(-2).kind === "request-create" && calls.at(-2).actor.userId === sessions.landlord.user_id && requestList.response.statusCode === 200 && calls.at(-1).kind === "request-list", "Account cleaning-request routes did not bind Landlord creation/listing to the authenticated actor.");
const cleanerId = "22222222-2222-4222-8222-222222222222";
const matches = await dispatch(router, "GET", "/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/matches", { headers: { cookie: authHeaders.cookie } });
assert(matches.response.statusCode === 200 && matches.body.candidates[0].cleanerId === cleanerId && calls.at(-1).kind === "request-matches" && calls.at(-1).actor.userId === sessions.landlord.user_id, "Request-specific matching did not bind the authenticated Landlord or return the safe recommendation projection.");
const invitation = await dispatch(router, "POST", `/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/invitations`, { headers: authHeaders, body: { cleanerId, customerPricePence: 1 } });
assert(invitation.response.statusCode === 201 && calls.at(-1).kind === "booking-invite" && calls.at(-1).input.cleanerId === cleanerId && !Object.hasOwn(calls.at(-1).input, "customerPricePence"), "Invitation routing trusted browser-supplied economics or lost the selected cleaner.");
const bookingId = "55555555-5555-4555-8555-555555555555";
const bookingCompletion = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/completion`, { headers: authHeaders, body: {} });
const submittedReview = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/reviews`, { headers: authHeaders, body: { rating: 5, writtenReview: "Clear and professional." } });
const bookingReview = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/reviews`, { headers: { cookie: authHeaders.cookie } });
assert(bookingCompletion.response.statusCode === 200 && submittedReview.response.statusCode === 201 && bookingReview.response.statusCode === 200 && calls.slice(-3).map((call) => call.kind).join(",") === "review-complete-booking,review-submit,review-get" && calls.at(-2).actor.userId === sessions.landlord.user_id, "Landlord completion/review routes lost role, CSRF or participant binding.");
const bookingProperty = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/property`, { headers: { cookie: authHeaders.cookie } });
assert(bookingProperty.response.statusCode === 200 && calls.at(-1).bookingId === bookingId && bookingProperty.body.property.accessInstructions === "Protected", "Booking-scoped property route lost the authenticated participant projection.");
const landlordTracking = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/tracking`, { headers: { cookie: authHeaders.cookie } });
assert(landlordTracking.response.statusCode === 200 && landlordTracking.body.tracking.sharingState === "live" && calls.at(-1).kind === "journey-read" && calls.at(-1).actor.userId === sessions.landlord.user_id, "A Landlord participant could not read the safe current booking tracking snapshot.");
const messageList = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/messages?limit=25`, { headers: { cookie: authHeaders.cookie } });
const landlordMessage = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/messages`, { headers: authHeaders, body: { clientMessageId: "99999999-9999-4999-8999-999999999999", body: "Please begin with the kitchen." } });
assert(messageList.response.statusCode === 200 && landlordMessage.response.statusCode === 201 && calls.at(-2).kind === "message-list" && calls.at(-2).input.limit === "25" && calls.at(-1).kind === "message-send" && calls.at(-1).actor.userId === sessions.landlord.user_id, "Booking messages lost authenticated participant reads, Landlord sends or query pagination.");
const missingRealtimeOrigin = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/events`, { headers: { cookie: authHeaders.cookie } });
const realtimeStream = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/events?afterEventId=7`, { headers: { cookie: authHeaders.cookie, origin: authHeaders.origin } });
assert(missingRealtimeOrigin.response.statusCode === 403 && missingRealtimeOrigin.body.code === "origin-rejected" && realtimeStream.response.statusCode === 200 && calls.at(-1).kind === "realtime-open" && calls.at(-1).lastEventId === "7", "Real-time booking stream did not require exact origin or preserve its durable reconnect cursor.");
const landlordJourneyStart = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/journey/start`, { headers: authHeaders, body: { consentGranted: true, latitude: 51.5, longitude: -0.1 } });
assert(landlordJourneyStart.response.statusCode === 403 && landlordJourneyStart.body.code === "role-rejected", "A Landlord could start the Cleaner journey.");
const landlordProgress = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/cleaning-progress`, { headers: { cookie: authHeaders.cookie } });
const progressTaskId = "77777777-7777-4777-8777-777777777777";
const taskDecision = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks/${progressTaskId}/decision`, { headers: authHeaders, body: { decision: "approved", priceUnchangedConfirmed: true } });
assert(landlordProgress.response.statusCode === 200 && landlordProgress.body.progress.overallPercentage === 50 && taskDecision.response.statusCode === 200 && calls.at(-1).kind === "progress-decision" && calls.at(-1).actor.userId === sessions.landlord.user_id, "Landlord progress read or unexpected-task decision lost participant/role authorization.");
sessions.landlord = { ...sessions.landlord, user_id: "22222222-2222-4222-8222-222222222222", selected_role: "cleaner", roles: ["cleaner"] };
const ownCleanerProfile = await dispatch(router, "GET", "/api/marketplace/cleaner/profile", { headers: { cookie: authHeaders.cookie } });
const cleanerProfile = await dispatch(router, "PUT", "/api/marketplace/cleaner/profile", { headers: authHeaders, body: { biography: "Careful cleaner" } });
assert(ownCleanerProfile.response.statusCode === 200 && ownCleanerProfile.body.profile.cleanerId === sessions.landlord.user_id && calls.at(-2).kind === "cleaner-get" && cleanerProfile.response.statusCode === 200 && calls.at(-1).kind === "cleaner-save" && calls.at(-1).actor.roles.includes("cleaner"), "The authenticated Cleaner could not read and update their own profile through the role-protected route.");
const bookingResponse = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/response`, { headers: authHeaders, body: { decision: "accept" } });
assert(bookingResponse.response.statusCode === 200 && bookingResponse.body.booking.status === "confirmed" && calls.at(-1).kind === "booking-response" && calls.at(-1).actor.userId === cleanerId, "Cleaner invitation response was not actor-bound or did not return the confirmed state.");
const cleanerReviewResponse = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/reviews/response`, { headers: authHeaders, body: { response: "Thank you." } });
assert(cleanerReviewResponse.response.statusCode === 200 && calls.at(-1).kind === "review-respond" && calls.at(-1).actor.userId === cleanerId, "Cleaner review response route lost assigned-role binding.");
const journeyStarted = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/journey/start`, { headers: authHeaders, body: { consentGranted: true, latitude: 51.501, longitude: -0.142, estimatedArrivalAt: "2099-01-01T00:00:00.000Z" } });
const journeyUpdated = await dispatch(router, "PUT", `/api/marketplace/bookings/${bookingId}/journey/location`, { headers: authHeaders, body: { latitude: 51.502, longitude: -0.141, accuracyMetres: 12 } });
const journeyArrived = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/journey/arrive`, { headers: authHeaders, body: {} });
assert(journeyStarted.response.statusCode === 200 && journeyUpdated.response.statusCode === 200 && journeyArrived.response.statusCode === 200 && journeyArrived.body.tracking.location === null && calls.at(-3).kind === "journey-start" && calls.at(-3).input.estimatedArrivalAt === "2099-01-01T00:00:00.000Z" && calls.at(-2).kind === "journey-location" && calls.at(-1).kind === "journey-arrive", "Cleaner journey routes lost actor-bound consent/location updates or failed to stop at arrival.");
const cleaningStarted = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/start`, { headers: authHeaders, body: {} });
const cleaningPaused = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/pause`, { headers: authHeaders, body: { paused: true, note: "Short break" } });
const cleaningTask = await dispatch(router, "PUT", `/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks/${progressTaskId}`, { headers: authHeaders, body: { status: "completed" } });
const unexpectedTask = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks`, { headers: authHeaders, body: { roomName: "Hall", description: "Clear packaging", estimatedAdditionalMinutes: 15 } });
const cleaningFinished = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/finish`, { headers: authHeaders, body: {} });
assert([cleaningStarted, cleaningPaused, cleaningTask, unexpectedTask, cleaningFinished].every((result) => result.response.statusCode < 300) && cleaningFinished.body.progress.status === "awaiting-review" && calls.slice(-5).map((call) => call.kind).join(",") === "progress-start,progress-pause,progress-task,progress-add,progress-finish", "Cleaner progress routes lost start/pause/task/unexpected/finish actions or role binding.");
const photoUploadId = "88888888-8888-4888-8888-888888888888";
const photoIntent = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/photos/intents`, { headers: authHeaders, body: { photoType: "before", mimeType: "image/jpeg", byteSize: 1234, checksumSha256: "a".repeat(64) } });
const photoCompletion = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/photos/${photoUploadId}/complete`, { headers: authHeaders, body: {} });
const photoAccess = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/cleaning-progress/photos/${photoUploadId}/access`, { headers: { cookie: authHeaders.cookie } });
assert(photoIntent.response.statusCode === 201 && photoCompletion.response.statusCode === 200 && photoAccess.response.statusCode === 200 && calls.slice(-3).map((call) => call.kind).join(",") === "media-intent,media-complete,media-access", "Private media routes did not bind Cleaner uploads and participant reads to the booking actor.");
const cleanerPropertyWrite = await dispatch(router, "POST", "/api/marketplace/properties", { headers: authHeaders, body: { name: "Attempt" } });
assert(cleanerPropertyWrite.response.statusCode === 403 && cleanerPropertyWrite.body.code === "role-rejected", "A Cleaner entered the Landlord-only property route.");
sessions.landlord = { ...sessions.landlord, user_id: "33333333-3333-4333-8333-333333333333", selected_role: "administrator", roles: ["administrator"] };
const moderatedReview = await dispatch(router, "POST", "/api/marketplace/admin/reviews/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/moderation", { headers: authHeaders, body: { decision: "approved" } });
assert(moderatedReview.response.statusCode === 200 && calls.at(-1).kind === "review-moderate" && calls.at(-1).actor.roles.includes("administrator"), "Administrator review moderation route lost role or CSRF binding.");
sessions.landlord = { ...sessions.landlord, user_id: "11111111-1111-4111-8111-111111111111", selected_role: "landlord", roles: ["landlord"] };

const invalidJson = await dispatch(router, "POST", "/api/marketplace/properties", { headers: authHeaders, body: "{" });
assert(invalidJson.response.statusCode === 400 && invalidJson.body.code === "invalid-json", "Malformed JSON was not rejected safely.");
const wrongContentType = await dispatch(router, "POST", "/api/marketplace/properties", { headers: { ...authHeaders, "content-type": "text/plain" }, body: {} });
assert(wrongContentType.response.statusCode === 400 && wrongContentType.body.code === "json-content-type-required", "A property mutation accepted a non-JSON body.");
const tooLarge = await dispatch(router, "POST", "/api/marketplace/properties", { headers: authHeaders, body: `{"value":"${"x".repeat(maximumBodyBytes)}"}` });
assert(tooLarge.response.statusCode === 413 && tooLarge.body.code === "request-too-large", "Marketplace JSON bodies were not size-bounded.");
const method = await dispatch(router, "DELETE", "/api/marketplace/properties", { headers: authHeaders });
assert(method.response.statusCode === 405 && method.response.headers.Allow === "GET, POST", "A recognized route did not return an explicit method boundary.");
const unknown = await dispatch(router, "GET", "/api/marketplace/private-invention");
assert(unknown.response.statusCode === 404 && unknown.body.code === "not-found", "Unknown marketplace paths escaped their isolated API namespace.");

propertyService.listOwnProperties = async () => { throw new Error("sensitive database detail"); };
const internalFailure = await dispatch(router, "GET", "/api/marketplace/properties", { headers: { cookie: authHeaders.cookie } });
assert(internalFailure.response.statusCode === 500 && internalFailure.body.error === "Something went wrong. Please try again." && !internalFailure.response.body.includes("sensitive database detail") && unexpectedError?.message === "sensitive database detail", "Unexpected errors leaked internals or were not sent to the private error hook.");

const baseEnvironment = {
  DATABASE_URL: "postgresql://tideway_app:test@127.0.0.1:5432/tideway",
  SESSION_SECRET: "runtime-session-secret-over-thirty-two-characters",
  AUTH_TOKEN_SECRET: "runtime-token-secret-over-thirty-two-characters",
  DATA_ENCRYPTION_KEY: "runtime-data-secret-over-thirty-two-characters",
  APP_ORIGIN: "http://127.0.0.1:4173"
};
const pool = { async connect() { throw new Error("Runtime composition must not connect eagerly."); } };
const runtimeAbuseControl = { rateLimiter: { async consume() { return { allowed: true }; } }, clientKey: () => "test-client" };
const runtime = createMarketplaceRuntime(pool, { env: baseEnvironment, ...runtimeAbuseControl });
assert(runtime.router && runtime.security && runtime.propertyService && runtime.cleanerProfileService && runtime.cleaningRequestService && runtime.bookingWorkflowService && runtime.bookingRepository && runtime.matchingService && runtime.matchingRepository && runtime.journeyService && runtime.journeyRepository && runtime.progressService && runtime.progressRepository && runtime.mediaService && runtime.mediaRepository && runtime.messageService && runtime.messageRepository && runtime.realtimeService && runtime.realtimeRepository && runtime.realtimeSignalSource && runtime.notificationService && runtime.notificationRepository && runtime.reviewService && runtime.reviewRepository && runtime.identityService && runtime.credentialService && runtime.accountSessionService && runtime.authenticationRouter === null && runtime.authenticationHttpReady === false && Object.isFrozen(runtime), "Marketplace runtime did not compose the existing database, security, account, profile, property, request, matching, booking, journey, progress, media, messaging, realtime, notifications, reviews and HTTP layers or safely keep incomplete authentication delivery detached.");
let unconfiguredEmailRejected = false;
try { createMarketplaceRuntime(pool, { env: baseEnvironment, ...runtimeAbuseControl, emailDelivery: { send() {} } }); } catch (error) { unconfiguredEmailRejected = error.message.includes("requires SMTP_URL and EMAIL_FROM"); }
assert(unconfiguredEmailRejected, "An email authentication boundary was enabled without trusted delivery configuration.");
let missingAbuseControl = false;
try { createMarketplaceRuntime(pool, { env: baseEnvironment }); } catch (error) { missingAbuseControl = error.message.includes("shared rate limiter and trusted client-key resolver"); }
assert(missingAbuseControl, "Marketplace runtime composed public reads without shared abuse control.");
const enabledEnvironment = { ...baseEnvironment, SMTP_URL: "smtps://mail.example.com", EMAIL_FROM: "Tideway <hello@example.com>" };
const enabledRuntime = createMarketplaceRuntime(pool, {
  env: enabledEnvironment,
  emailDelivery: { async send() {} },
  ...runtimeAbuseControl
});
assert(enabledRuntime.authenticationHttpReady && enabledRuntime.authenticationRouter && enabledRuntime.router !== enabledRuntime.marketplaceRouter, "A complete trusted email/rate/client boundary did not compose the isolated authentication controller into the runtime chain.");
const googleRuntime = createMarketplaceRuntime(pool, {
  env: { ...enabledEnvironment, GOOGLE_CLIENT_ID: "google-client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "google-client-secret" },
  emailDelivery: { async send() {} },
  ...runtimeAbuseControl
});
assert(googleRuntime.googleOidcReady === true && googleRuntime.googleOidcProvider?.callbackUrl === `${baseEnvironment.APP_ORIGIN}/api/marketplace/auth/google/callback`, "Complete Google configuration did not compose the exact callback verifier into the authentication runtime.");
let missingRuntime = false;
try { createMarketplaceRuntime(pool, { env: {} }); } catch (error) { missingRuntime = error.message.includes("DATABASE_URL") && error.message.includes("SESSION_SECRET") && error.message.includes("DATA_ENCRYPTION_KEY"); }
assert(missingRuntime, "Marketplace runtime did not fail closed without its database/session/encryption configuration.");

console.log("Marketplace HTTP tests passed: isolated routing, public search, session/role/origin/CSRF protection, owner-bound property mutations, bounded JSON, safe errors and fail-closed runtime composition.");
