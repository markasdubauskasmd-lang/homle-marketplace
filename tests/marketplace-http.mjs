import { AccountHttpError, createAccountSecurity } from "../src/marketplace/account-security.mjs";
import { administratorMatchingReadiness, createMarketplaceHttpRouter, maximumBodyBytes } from "../src/marketplace/marketplace-http.mjs";
import { createMarketplaceRuntime } from "../src/marketplace/runtime.mjs";
import { createSessionMaterial, developmentSessionCookieName } from "../src/marketplace/session.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(method, url, { body, headers = {} } = {}) {
  const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
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
const cleanerMaterial = createSessionMaterial(sessionSecret, new Date("2026-07-15T15:00:00.000Z"), 3600);
const administratorMaterial = createSessionMaterial(sessionSecret, new Date("2026-07-15T15:00:00.000Z"), 3600);
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
  },
  cleaner: {
    session_id: "88888888-8888-4888-8888-888888888888",
    user_id: "22222222-2222-4222-8222-222222222222",
    email: "cleaner@example.com",
    email_verified_at: "2026-07-15T14:00:00.000Z",
    display_name: "Cleaner Example",
    selected_role: "cleaner",
    roles: ["cleaner"],
    csrf_secret_hash: cleanerMaterial.csrfHash,
    expires_at: cleanerMaterial.expiresAt
  },
  administrator: {
    session_id: "99999999-9999-4999-8999-999999999999",
    user_id: "33333333-3333-4333-8333-333333333333",
    email: "administrator@example.com",
    email_verified_at: "2026-07-15T14:00:00.000Z",
    display_name: "Administrator Example",
    selected_role: "administrator",
    roles: ["administrator"],
    csrf_secret_hash: administratorMaterial.csrfHash,
    expires_at: administratorMaterial.expiresAt
  }
};
const security = createAccountSecurity({ async findSession(hash) { return hash.equals(material.tokenHash) ? sessions.landlord : hash.equals(cleanerMaterial.tokenHash) ? sessions.cleaner : hash.equals(administratorMaterial.tokenHash) ? sessions.administrator : null; } }, { sessionSecret, appOrigin: "http://127.0.0.1:4173", production: false });
const calls = [];
const cleanerProfileService = {
  async searchPublicProfiles(filters) { calls.push({ kind: "search", filters }); return [{ cleanerId: "public-cleaner", displayName: "Public Cleaner" }]; },
  async getPublicProfile(cleanerId) { calls.push({ kind: "cleaner-public", cleanerId }); return { cleanerId, displayName: "Public Cleaner", profilePhotoUrl: null, services: [] }; },
  async getOwnProfile(actor) { calls.push({ kind: "cleaner-get", actor }); return { cleanerId: actor.userId, biography: "Careful cleaner", profileCompletionPercent: 60, isPublic: false, services: [], serviceAreas: [] }; },
  async saveOwnProfile(actor, input) { calls.push({ kind: "cleaner-save", actor, input }); return { profileCompletionPercent: 100 }; },
  async listOwnAvailability(actor) { calls.push({ kind: "availability-list", actor }); return [{ availabilityId: "33333333-3333-4333-8333-333333333333", startAt: "2026-07-20T09:00:00.000Z", endAt: "2026-07-20T17:00:00.000Z", status: "available" }]; },
  async createOwnAvailability(actor, input) { calls.push({ kind: "availability-create", actor, input }); return { availabilityId: "44444444-4444-4444-8444-444444444444", ...input, status: "available" }; },
  async withdrawOwnAvailability(actor, availabilityId) { calls.push({ kind: "availability-withdraw", actor, availabilityId }); return { availabilityId, startAt: "2026-07-20T09:00:00.000Z", endAt: "2026-07-20T17:00:00.000Z", status: "withdrawn" }; }
};
const favouriteCleanerService = {
  async listOwn(actor) {
    calls.push({ kind: "favourite-cleaner-list", actor });
    return [{ cleanerId: "22222222-2222-4222-8222-222222222222", displayName: "Cleaner Example", profilePhotoUrl: null, currentAvailabilityStatus: "available", averageRating: 4.8, reviewCount: 12, completedJobCount: 20, services: [], savedAt: "2026-07-16T12:00:00.000Z" }];
  },
  async setOwn(actor, cleanerId, input) {
    calls.push({ kind: "favourite-cleaner-set", actor, cleanerId, input });
    return { cleanerId, favourite: input.favourite === true };
  }
};
const propertyService = {
  async getLandlordProfile(actor) { calls.push({ kind: "landlord-get", actor }); return { organisationName: "Example PM", biography: "Local portfolio" }; },
  async saveLandlordProfile(actor, input) { calls.push({ kind: "landlord-save", actor, input }); return { organisationName: input.organisationName || null, biography: input.biography || "" }; },
  async createProperty(actor, input) { calls.push({ kind: "property-create", actor, input }); return { propertyId: "44444444-4444-4444-8444-444444444444", name: input.name }; },
  async updateOwnProperty(actor, input) { calls.push({ kind: "property-update", actor, input }); return { propertyId: input.id, name: input.name }; },
  async listOwnProperties(actor) { calls.push({ kind: "property-list", actor }); return []; },
  async getBookingProperty(actor, bookingId) { calls.push({ kind: "booking-property", actor, bookingId }); if (actor.userId === "33333333-3333-4333-8333-333333333333") throw new AccountHttpError(403, "forbidden", "Booking property access is forbidden."); return { propertyId: "44444444-4444-4444-8444-444444444444", accessInstructions: "Protected" }; }
};
const cleaningRequestService = {
  async createOwnRequest(actor, input) { calls.push({ kind: "request-create", actor, input }); return { requestId: "66666666-6666-4666-8666-666666666666", propertyId: input.propertyId, status: "draft" }; },
  async listOwnRequests(actor) { calls.push({ kind: "request-list", actor }); return []; },
  async submitOwnRequest(actor, cleaningRequestId, input) { calls.push({ kind: "request-submit", actor, cleaningRequestId, input }); return { cleaningRequestId, status: "searching-for-cleaner", submittedAt: "2026-07-15T15:00:00.000Z", scopeConfirmedAt: "2026-07-15T15:00:00.000Z", cleanerPreviewAuthorized: input.cleanerPreviewAuthorized, photoCount: 1, taskCount: 2 }; },
  async configureAutomaticDispatch(actor, cleaningRequestId, input) { calls.push({ kind: "request-dispatch", actor, cleaningRequestId, input }); return { cleaningRequestId, enabled: input.enabled, attemptLimit: input.attemptLimit, attemptCount: 0, maximumCustomerPricePence: input.approvedMaximumPricePence }; },
  async withdrawOwnRequest(actor, cleaningRequestId, input) { calls.push({ kind: "request-withdraw", actor, cleaningRequestId, input }); return { cleaningRequestId, status: "cancelled", previousStatus: "searching-for-cleaner", reasonCode: input.reasonCode, withdrawnAt: "2026-07-15T15:00:00.000Z" }; }
};
const bookingWorkflowService = {
  async listParticipantBookings(actor, input) { calls.push({ kind: "booking-list", actor, input }); return [{ bookingId: "55555555-5555-4555-8555-555555555555", participantRole: "landlord", pricePence: 12000, pricePerspective: "customer-total" }]; },
  async previewInvitation(actor, input) { calls.push({ kind: "booking-invitation-preview", actor, input }); return { cleaningRequestId: input.cleaningRequestId, cleanerId: input.cleanerId, customerPricePence: 12000, responseDeadline: "2026-07-15T18:00:00.000Z" }; },
  async inviteCleaner(actor, input) { calls.push({ kind: "booking-invite", actor, input }); return { bookingId: "55555555-5555-4555-8555-555555555555", status: "pending-cleaner-acceptance", customerPricePence: input.approvedCustomerPricePence }; },
  async respondToInvitation(actor, bookingId, input) { calls.push({ kind: "booking-response", actor, bookingId, input }); return { bookingId, status: input.decision === "accept" ? "confirmed" : "cancelled" }; }
};
const matchingService = {
  async recommendForRequest(actor, cleaningRequestId) { calls.push({ kind: "request-matches", actor, cleaningRequestId }); return { cleaningRequestId, generatedAt: "2026-07-15T15:00:00.000Z", candidates: [{ cleanerId: "22222222-2222-4222-8222-222222222222", displayName: "Private Cleaner", rank: 1, estimatedCustomerPricePence: 12000 }] }; }
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
  async confirmUnexpectedTaskTerms(actor, bookingId, taskId) { calls.push({ kind: "progress-confirm-terms", actor, bookingId, taskId }); return { bookingId, status: "cleaning-in-progress" }; },
  async decideUnexpectedTask(actor, bookingId, taskId, input) { calls.push({ kind: "progress-decision", actor, bookingId, taskId, input }); return { bookingId, status: "cleaning-in-progress" }; },
  async finishCleaning(actor, bookingId) { calls.push({ kind: "progress-finish", actor, bookingId }); return { bookingId, status: "awaiting-review", overallPercentage: 100 }; }
};
const mediaService = {
  async createUploadIntent(actor, bookingId, input) { calls.push({ kind: "media-intent", actor, bookingId, input }); return { uploadId: "88888888-8888-4888-8888-888888888888", uploadUrl: "https://storage.example/write", method: "PUT" }; },
  async completeUpload(actor, bookingId, uploadId) { calls.push({ kind: "media-complete", actor, bookingId, uploadId }); return { bookingId, status: "cleaning-in-progress", eventVersion: 8 }; },
  async getPhotoAccess(actor, bookingId, photoId) { calls.push({ kind: "media-access", actor, bookingId, photoId }); return { photoId, url: "https://storage.example/read" }; }
};
const requestMediaService = {
  async createUploadIntent(actor, cleaningRequestId, input) { calls.push({ kind: "request-media-intent", actor, cleaningRequestId, input }); return { uploadId: "88888888-8888-4888-8888-888888888888", uploadUrl: "https://storage.example/request-write", method: "PUT", requiredHeaders: {} }; },
  async completeUpload(actor, cleaningRequestId, uploadId) { calls.push({ kind: "request-media-complete", actor, cleaningRequestId, uploadId }); return { cleaningRequestId, status: "draft", photos: [{ photoId: uploadId }] }; },
  async getScan(actor, cleaningRequestId) { calls.push({ kind: "request-media-scan", actor, cleaningRequestId }); return { cleaningRequestId, status: "draft", photos: [] }; },
  async getPhotoAccess(actor, cleaningRequestId, photoId) { calls.push({ kind: "request-media-access", actor, cleaningRequestId, photoId }); return { photoId, url: "https://storage.example/request-read" }; }
};
const messageService = {
  async sendMessage(actor, bookingId, input) { calls.push({ kind: "message-send", actor, bookingId, input }); return { messageId: "88888888-8888-4888-8888-888888888888", clientMessageId: input.clientMessageId, bookingId, senderUserId: actor.userId, senderRole: actor.roles[0], body: input.body, createdAt: "2026-07-15T16:00:00.000Z" }; },
  async listMessages(actor, bookingId, input) { calls.push({ kind: "message-list", actor, bookingId, input }); return { bookingId, messages: [], hasMore: false, nextCursor: null }; }
};
const realtimeService = {
  async openStream(actor, bookingId, request, response, lastEventId) { calls.push({ kind: "realtime-open", actor, bookingId, lastEventId }); response.writeHead(200, { "Content-Type": "text/event-stream" }); response.end(JSON.stringify({ ok: true })); },
  async openRequestStream(actor, requestId, request, response, lastEventId) { calls.push({ kind: "request-realtime-open", actor, requestId, lastEventId }); response.writeHead(200, { "Content-Type": "text/event-stream" }); response.end(JSON.stringify({ ok: true })); }
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
const disputeService = {
  async open(actor, bookingId, input) { calls.push({ kind: "dispute-open", actor, bookingId, input }); return { disputeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", bookingId, category: input.category, description: input.description, status: "open", resolutionNote: null, resolutionOutcome: null, createdAt: "2026-07-15T19:05:00.000Z", resolvedAt: null }; },
  async getForBooking(actor, bookingId) { calls.push({ kind: "dispute-get", actor, bookingId }); return null; },
  async listForAdministrator(actor, input) { calls.push({ kind: "dispute-list", actor, input }); return { disputes: [], limit: Number(input.limit) || 50, offset: Number(input.offset) || 0 }; },
  async review(actor, disputeId, input) { calls.push({ kind: "dispute-review", actor, disputeId, input }); return { disputeId, bookingId: "55555555-5555-4555-8555-555555555555", category: "quality", description: "The agreed cleaning scope was not completed.", status: input.status, resolutionNote: input.resolutionNote || null, resolutionOutcome: input.resolutionOutcome || null, createdAt: "2026-07-15T19:05:00.000Z", resolvedAt: input.status === "resolved" ? "2026-07-15T20:00:00.000Z" : null }; }
};
const privacyRequestService = {
  async list(actor) { calls.push({ kind: "privacy-list", actor }); return [{ requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestType: "export", status: "requested", createdAt: "2026-07-16T14:30:00.000Z", verifiedAt: null, completedAt: null }]; },
  async request(actor, input) { calls.push({ kind: "privacy-request", actor, input }); return { requestId: input.requestId, requestType: input.requestType, status: "requested", createdAt: "2026-07-16T14:30:00.000Z", verifiedAt: null, completedAt: null, created: true }; }
};
let paymentStarted = false;
const paymentService = {
  getClientConfiguration(actor) { calls.push({ kind: "payment-config", actor }); return { publishableKey: `pk_test_${"p".repeat(32)}`, testMode: true }; },
  async getForBooking(actor, bookingId) {
    calls.push({ kind: "payment-get", actor, bookingId });
    return { paymentId: paymentStarted ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : null, bookingId, status: paymentStarted ? "authorized" : "not-started", amountPence: 12_000, currency: "gbp", amountCapturedPence: 0, amountRefundedPence: 0, requiresCustomerAction: false, clientSecret: null };
  },
  async beginAuthorization(actor, input) {
    calls.push({ kind: "payment-authorize", actor, input });
    paymentStarted = true;
    return { paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bookingId: input.bookingId, status: "requires-customer-action", amountPence: 12_000, currency: "gbp", amountCapturedPence: 0, amountRefundedPence: 0, requiresCustomerAction: true, clientSecret: "pi_test_client_secret" };
  },
  async listForAdministrator(actor, input) {
    calls.push({ kind: "payment-admin-list", actor, input });
    return { payments: [], limit: Number(input.limit) || 50, offset: Number(input.offset) || 0, testMode: true };
  },
  async capture(actor, input) { calls.push({ kind: "payment-admin-capture", actor, input }); return { commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", paymentId: input.paymentId, kind: "capture", status: "provider-pending" }; },
  async cancel(actor, input) { calls.push({ kind: "payment-admin-cancel", actor, input }); return { commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", paymentId: input.paymentId, kind: "cancel", status: "provider-pending" }; },
  async refund(actor, input) { calls.push({ kind: "payment-admin-refund", actor, input }); return { commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", paymentId: input.paymentId, kind: "refund", status: "provider-pending" }; },
  async transfer(actor, input) { calls.push({ kind: "payment-admin-transfer", actor, input }); return { commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", paymentId: input.paymentId, kind: "transfer", status: "provider-pending" }; },
  async handleWebhook(body, signature) {
    calls.push({ kind: "payment-webhook", body, signature });
    if (signature === "bad") throw Object.assign(new Error("The payment webhook could not be verified."), { statusCode: 400, code: "invalid-payment-webhook" });
    return { accepted: true, duplicate: false, ignored: false };
  }
};
const cleanerPayoutService = {
  async getStatus(actor) { calls.push({ kind: "payout-get", actor }); return { status: "not-started", ready: false, detailsSubmitted: false, payoutsEnabled: false, remainingRequirements: null, updatedAt: null }; },
  async refreshStatus(actor) { calls.push({ kind: "payout-refresh", actor }); return { status: "action-required", ready: false, detailsSubmitted: true, payoutsEnabled: false, remainingRequirements: 1, updatedAt: "2026-07-16T17:00:00.000Z" }; },
  async beginOnboarding(actor) { calls.push({ kind: "payout-onboarding", actor }); return { status: "action-required", ready: false, detailsSubmitted: false, payoutsEnabled: false, remainingRequirements: 3, updatedAt: null, onboardingUrl: "https://connect.stripe.com/setup/c/test", expiresAt: "2026-07-16T17:05:00.000Z" }; }
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
const administratorBookingService = {
  async list(actor, input) { calls.push({ kind: "administrator-booking-list", actor, input }); return { operations: [], limit: Number(input.limit) || 50, offset: Number(input.offset) || 0 }; }
};
const dependencies = { security, cleanerProfileService, favouriteCleanerService, propertyService, cleaningRequestService, bookingWorkflowService, matchingService, journeyService, progressService, mediaService, requestMediaService, messageService, realtimeService, notificationService, reviewService, disputeService, administratorBookingService, privacyRequestService, paymentService, cleanerPayoutService, rateLimiter };
const router = createMarketplaceHttpRouter(dependencies, { clientKey: () => trustedClientKey, onUnexpectedError(error) { unexpectedError = error; } });
const authHeaders = {
  cookie: `${developmentSessionCookieName}=${material.token}`,
  origin: "http://127.0.0.1:4173",
  "x-csrf-token": material.csrfToken,
  "content-type": "application/json; charset=utf-8"
};
const cleanerAuthHeaders = {
  cookie: `${developmentSessionCookieName}=${cleanerMaterial.token}`,
  origin: "http://127.0.0.1:4173",
  "x-csrf-token": cleanerMaterial.csrfToken,
  "content-type": "application/json; charset=utf-8"
};
const administratorAuthHeaders = {
  cookie: `${developmentSessionCookieName}=${administratorMaterial.token}`,
  origin: "http://127.0.0.1:4173",
  "x-csrf-token": administratorMaterial.csrfToken,
  "content-type": "application/json; charset=utf-8"
};

const unrelated = response();
assert(await router.handle(request("GET", "/api/health"), unrelated, new URL("http://127.0.0.1:4173/api/health")) === false && unrelated.statusCode === null, "Marketplace router intercepted an existing pilot API route.");

const exactWebhookBody = Buffer.from('{"amount":12000, "preserve":"spacing"}');
const signedWebhook = await dispatch(router, "POST", "/api/marketplace/payments/webhook", { body: exactWebhookBody, headers: { "stripe-signature": "t=1,v1=signed" } });
const paymentWebhookCall = calls.find((call) => call.kind === "payment-webhook");
assert(signedWebhook.response.statusCode === 200 && signedWebhook.body.accepted === true && Buffer.compare(paymentWebhookCall.body, exactWebhookBody) === 0 && paymentWebhookCall.signature === "t=1,v1=signed", "Payment webhook routing changed the signed raw bytes or required an account session.");
const rejectedWebhook = await dispatch(router, "POST", "/api/marketplace/payments/webhook", { body: Buffer.from("{}"), headers: { "stripe-signature": "bad" } });
assert(rejectedWebhook.response.statusCode === 400 && rejectedWebhook.body.code === "invalid-payment-webhook" && !rejectedWebhook.response.body.includes("secret"), "Invalid Stripe signatures did not fail closed with a bounded response.");
const wrongWebhookMethod = await dispatch(router, "GET", "/api/marketplace/payments/webhook");
assert(wrongWebhookMethod.response.statusCode === 405 && wrongWebhookMethod.response.headers.Allow === "POST", "Payment webhook accepted a non-POST method.");
const noPaymentRouter = createMarketplaceHttpRouter({ ...dependencies, paymentService: null, cleanerPayoutService: null }, { clientKey: () => trustedClientKey });
const absentWebhookResponse = response();
assert(await noPaymentRouter.handle(request("POST", "/api/marketplace/payments/webhook", { body: Buffer.from("{}") }), absentWebhookResponse, new URL("http://127.0.0.1:4173/api/marketplace/payments/webhook")) === false && absentWebhookResponse.statusCode === null, "Disabled payments exposed a webhook route.");

const paymentBookingId = "55555555-5555-4555-8555-555555555555";
const bookingPaymentUrl = `/api/marketplace/bookings/${paymentBookingId}/payment`;
const paymentConfiguration = await dispatch(router, "GET", "/api/marketplace/payments/config", { headers: { cookie: authHeaders.cookie } });
assert(paymentConfiguration.response.statusCode === 200 && paymentConfiguration.body.payment.publishableKey.startsWith("pk_test_") && paymentConfiguration.body.payment.testMode === true && calls.at(-1).kind === "payment-config", "Authenticated test checkout could not obtain its bounded publishable configuration.");
const unauthenticatedPaymentConfiguration = await dispatch(router, "GET", "/api/marketplace/payments/config");
assert(unauthenticatedPaymentConfiguration.response.statusCode === 401, "Payment client configuration was exposed without an authenticated Landlord session.");
const unauthenticatedPayment = await dispatch(router, "GET", bookingPaymentUrl);
assert(unauthenticatedPayment.response.statusCode === 401, "Payment status was visible without an authenticated account.");
const unstartedPayment = await dispatch(router, "GET", bookingPaymentUrl, { headers: { cookie: authHeaders.cookie } });
assert(unstartedPayment.response.statusCode === 200 && unstartedPayment.body.payment.paymentId === null && unstartedPayment.body.payment.status === "not-started" && unstartedPayment.body.payment.amountPence === 12_000 && calls.at(-1).kind === "payment-get", "The authenticated booking owner could not see the exact frozen total before payment creation.");
const missingPaymentCsrf = await dispatch(router, "POST", bookingPaymentUrl, { headers: { cookie: authHeaders.cookie, origin: authHeaders.origin, "content-type": authHeaders["content-type"] }, body: { idempotencyKey: "authorize_booking_payment_123456789012" } });
assert(missingPaymentCsrf.response.statusCode === 403 && !calls.some((call) => call.kind === "payment-authorize"), "Payment authorization accepted a missing CSRF token or reached the provider boundary.");
const authorizedPayment = await dispatch(router, "POST", bookingPaymentUrl, { headers: authHeaders, body: { idempotencyKey: "authorize_booking_payment_123456789012" } });
const authorizationCall = calls.find((call) => call.kind === "payment-authorize");
assert(authorizedPayment.response.statusCode === 201 && authorizedPayment.body.payment.requiresCustomerAction === true && authorizedPayment.body.payment.clientSecret === "pi_test_client_secret" && authorizationCall.actor.userId === sessions.landlord.user_id && authorizationCall.input.bookingId === "55555555-5555-4555-8555-555555555555" && authorizationCall.input.idempotencyKey === "authorize_booking_payment_123456789012", "Authenticated Landlord payment authorization lost its booking, retry key or customer-action secret.");
const paymentStatus = await dispatch(router, "GET", bookingPaymentUrl, { headers: { cookie: authHeaders.cookie } });
assert(paymentStatus.response.statusCode === 200 && paymentStatus.body.payment.status === "authorized" && !JSON.stringify(paymentStatus.body).includes("pi_test_client_secret") && calls.at(-1).kind === "payment-get", "Landlord payment status exposed customer-action material or missed its owner-bound service.");
const absentBookingPaymentResponse = response();
assert(await noPaymentRouter.handle(request("GET", bookingPaymentUrl), absentBookingPaymentResponse, new URL(`http://127.0.0.1:4173${bookingPaymentUrl}`)) === false && absentBookingPaymentResponse.statusCode === null, "Disabled payments exposed a participant payment route.");

const adminPaymentQueue = await dispatch(router, "GET", "/api/marketplace/admin/payments?status=actionable&limit=25&offset=0", { headers: { cookie: administratorAuthHeaders.cookie } });
const adminBookingQueue = await dispatch(router, "GET", "/api/marketplace/admin/bookings?view=attention&limit=25&offset=0", { headers: { cookie: administratorAuthHeaders.cookie } });
const landlordAdminBookingQueue = await dispatch(router, "GET", "/api/marketplace/admin/bookings", { headers: { cookie: authHeaders.cookie } });
const adminMatchingReadiness = await dispatch(router, "GET", "/api/marketplace/admin/cleaning-requests/66666666-6666-4666-8666-666666666666/matching-readiness", { headers: { cookie: administratorAuthHeaders.cookie } });
const landlordAdminMatchingReadiness = await dispatch(router, "GET", "/api/marketplace/admin/cleaning-requests/66666666-6666-4666-8666-666666666666/matching-readiness", { headers: { cookie: authHeaders.cookie } });
const relatedPaymentQueue = await dispatch(router, "GET", `/api/marketplace/admin/payments?bookingId=${paymentBookingId}`, { headers: { cookie: administratorAuthHeaders.cookie } });
const relatedPaymentCall = calls.findLast((call) => call.kind === "payment-admin-list");
const landlordPaymentQueue = await dispatch(router, "GET", "/api/marketplace/admin/payments", { headers: { cookie: authHeaders.cookie } });
const missingAdminPaymentCsrf = await dispatch(router, "POST", "/api/marketplace/admin/payments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/capture", { headers: { cookie: administratorAuthHeaders.cookie, origin: administratorAuthHeaders.origin, "content-type": administratorAuthHeaders["content-type"] }, body: { idempotencyKey: "admin_capture_retry_key_123456789012" } });
const capturedPayment = await dispatch(router, "POST", "/api/marketplace/admin/payments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/capture", { headers: administratorAuthHeaders, body: { idempotencyKey: "admin_capture_retry_key_123456789012" } });
const refundedPayment = await dispatch(router, "POST", "/api/marketplace/admin/payments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/refund", { headers: administratorAuthHeaders, body: { idempotencyKey: "admin_refund_retry_key_1234567890123", amountPence: 1500, destinationAccountId: "acct_browser_attack" } });
assert(adminPaymentQueue.response.statusCode === 200 && adminPaymentQueue.body.testMode === true && calls.find((call) => call.kind === "payment-admin-list")?.input.status === "actionable" && landlordPaymentQueue.response.statusCode === 403 && missingAdminPaymentCsrf.response.statusCode === 403, "Administrator payment queue lost role isolation, exact filters, test-mode proof or CSRF protection.");
assert(adminBookingQueue.response.statusCode === 200 && landlordAdminBookingQueue.response.statusCode === 403 && calls.find((call) => call.kind === "administrator-booking-list")?.input.view === "attention", "Administrator booking operations lost role isolation or its exact view filter.");
assert(adminMatchingReadiness.response.statusCode === 200 && landlordAdminMatchingReadiness.response.statusCode === 403 && adminMatchingReadiness.body.matchingReadiness.candidateCount === 1 && adminMatchingReadiness.body.matchingReadiness.lowestCustomerPricePence === 12000 && !adminMatchingReadiness.response.body.includes("Private Cleaner") && !adminMatchingReadiness.response.body.includes("22222222-2222"), "Administrator matching readiness lost role isolation, exact pricing or identity redaction.");
const emptyMatchingReadiness = administratorMatchingReadiness({ generatedAt: "2026-07-15T15:00:00.000Z", candidates: [] });
assert(emptyMatchingReadiness.candidateCount === 0 && emptyMatchingReadiness.candidateLimit === 25 && emptyMatchingReadiness.lowestCustomerPricePence === null && emptyMatchingReadiness.highestCustomerPricePence === null, "Empty matching readiness invented Cleaner supply or prices.");
assert(relatedPaymentQueue.response.statusCode === 200 && relatedPaymentCall.input.bookingId === paymentBookingId && relatedPaymentCall.input.status === null, "The case-payment route lost its exact booking filter or introduced a payment mutation.");
assert(capturedPayment.response.statusCode === 202 && refundedPayment.response.statusCode === 202 && calls.find((call) => call.kind === "payment-admin-capture")?.input.idempotencyKey === "admin_capture_retry_key_123456789012" && calls.find((call) => call.kind === "payment-admin-refund")?.input.amountPence === 1500 && !Object.hasOwn(calls.find((call) => call.kind === "payment-admin-refund").input, "destinationAccountId"), "Administrator capture/refund routes lost exact payment, retry, amount or server-owned destination boundaries.");
const absentAdminPaymentResponse = response();
assert(await noPaymentRouter.handle(request("GET", "/api/marketplace/admin/payments"), absentAdminPaymentResponse, new URL("http://127.0.0.1:4173/api/marketplace/admin/payments")) === false && absentAdminPaymentResponse.statusCode === null, "Disabled payments exposed Administrator settlement operations.");

const payoutUrl = "/api/marketplace/cleaner/payout-account";
const landlordPayout = await dispatch(router, "GET", payoutUrl, { headers: { cookie: authHeaders.cookie } });
const cleanerPayout = await dispatch(router, "GET", payoutUrl, { headers: { cookie: cleanerAuthHeaders.cookie } });
const missingPayoutCsrf = await dispatch(router, "POST", `${payoutUrl}/onboarding`, { headers: { cookie: cleanerAuthHeaders.cookie, origin: cleanerAuthHeaders.origin, "content-type": cleanerAuthHeaders["content-type"] }, body: {} });
const payoutOnboarding = await dispatch(router, "POST", `${payoutUrl}/onboarding`, { headers: cleanerAuthHeaders, body: {} });
const payoutRefresh = await dispatch(router, "POST", `${payoutUrl}/refresh`, { headers: cleanerAuthHeaders, body: {} });
assert(landlordPayout.response.statusCode === 403 && cleanerPayout.response.statusCode === 200 && cleanerPayout.body.payout.status === "not-started" && missingPayoutCsrf.response.statusCode === 403 && payoutOnboarding.response.statusCode === 201 && payoutOnboarding.body.payout.onboardingUrl.startsWith("https://connect.stripe.com/") && payoutRefresh.response.statusCode === 200 && calls.slice(-3).map((call) => call.kind).join(",") === "payout-get,payout-onboarding,payout-refresh", "Cleaner payout routes lost role isolation, CSRF protection, exact onboarding handoff or status refresh.");
const absentPayoutResponse = response();
assert(await noPaymentRouter.handle(request("GET", payoutUrl), absentPayoutResponse, new URL(`http://127.0.0.1:4173${payoutUrl}`)) === false && absentPayoutResponse.statusCode === null, "Disabled payments exposed a Cleaner payout route.");

const directory = await dispatch(router, "GET", "/api/marketplace/cleaners?outwardPostcode=SW1A&verifiedOnly=true&limit=10");
assert(directory.handled && directory.response.statusCode === 200 && directory.body.cleaners.length === 1 && calls.at(-1).filters.outwardPostcode === "SW1A" && calls.at(-1).filters.verifiedOnly === true && calls.at(-1).filters.limit === "10", "Public cleaner discovery did not parse its bounded service filters.");
const badBoolean = await dispatch(router, "GET", "/api/marketplace/cleaners?verifiedOnly=yes");
assert(badBoolean.response.statusCode === 422 && badBoolean.body.code === "validation-failed", "Cleaner discovery accepted an ambiguous boolean filter.");
const publicCleanerProfile = await dispatch(router, "GET", "/api/marketplace/cleaners/22222222-2222-4222-8222-222222222222");
assert(publicCleanerProfile.response.statusCode === 200 && publicCleanerProfile.body.cleaner.cleanerId === "22222222-2222-4222-8222-222222222222" && publicCleanerProfile.body.cleaner.displayName === "Public Cleaner" && calls.at(-1).kind === "cleaner-public", "Direct public Cleaner profile routing lost the exact safe Cleaner identifier or public projection.");
const publicReviews = await dispatch(router, "GET", "/api/marketplace/cleaners/22222222-2222-4222-8222-222222222222/reviews?limit=10");
assert(publicReviews.response.statusCode === 200 && publicReviews.body.reviews.length === 0 && calls.at(-1).kind === "review-public" && calls.at(-1).input.limit === "10", "Public approved-review routing lost its safe Cleaner ID or cursor.");
assert(calls.some((call) => call.kind === "rate-limit" && call.input.scope === "marketplace-public:cleaner-directory" && call.input.key === trustedClientKey) && calls.some((call) => call.kind === "rate-limit" && call.input.scope === "marketplace-public:cleaner-profile" && call.input.key === trustedClientKey) && calls.some((call) => call.kind === "rate-limit" && call.input.scope === "marketplace-public:cleaner-reviews" && call.input.key === trustedClientKey), "Public marketplace reads did not use separate trusted shared-limiter scopes.");

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
const privateAccount = await dispatch(router, "GET", "/api/marketplace/account", { headers: { cookie: authHeaders.cookie } });
assert(privateAccount.response.statusCode === 200 && privateAccount.body.account.displayName === "Landlord Example" && privateAccount.body.account.email === "landlord@example.com" && privateAccount.body.account.selectedRole === "landlord" && privateAccount.body.account.roles.join(",") === "landlord" && !JSON.stringify(privateAccount.body).includes(sessions.landlord.session_id) && !JSON.stringify(privateAccount.body).includes("csrf"), "The private self-account route omitted role context or exposed session material.");
const favouriteCleanerId = "22222222-2222-4222-8222-222222222222";
const favouriteCleanerList = await dispatch(router, "GET", "/api/marketplace/landlord/favourite-cleaners", { headers: { cookie: authHeaders.cookie } });
const cleanerFavouriteList = await dispatch(router, "GET", "/api/marketplace/landlord/favourite-cleaners", { headers: { cookie: cleanerAuthHeaders.cookie } });
const missingFavouriteCsrf = await dispatch(router, "POST", `/api/marketplace/landlord/favourite-cleaners/${favouriteCleanerId}`, { headers: { cookie: authHeaders.cookie, origin: authHeaders.origin, "content-type": authHeaders["content-type"] }, body: { favourite: true } });
const savedFavourite = await dispatch(router, "POST", `/api/marketplace/landlord/favourite-cleaners/${favouriteCleanerId}`, { headers: authHeaders, body: { favourite: true } });
const removedFavourite = await dispatch(router, "POST", `/api/marketplace/landlord/favourite-cleaners/${favouriteCleanerId}`, { headers: authHeaders, body: { favourite: false } });
assert(favouriteCleanerList.response.statusCode === 200 && favouriteCleanerList.body.cleaners[0].displayName === "Cleaner Example" && cleanerFavouriteList.response.statusCode === 403 && missingFavouriteCsrf.response.statusCode === 403 && savedFavourite.body.favourite.favourite === true && removedFavourite.body.favourite.favourite === false && calls.slice(-3).map((call) => call.kind).join(",") === "favourite-cleaner-list,favourite-cleaner-set,favourite-cleaner-set" && calls.at(-1).actor.userId === sessions.landlord.user_id, "Favourite Cleaner routes lost Landlord ownership, role isolation, CSRF protection or exact saved state.");
const privacyList = await dispatch(router, "GET", "/api/marketplace/privacy-requests", { headers: { cookie: authHeaders.cookie } });
const missingPrivacyCsrf = await dispatch(router, "POST", "/api/marketplace/privacy-requests", { headers: { cookie: authHeaders.cookie, origin: authHeaders.origin, "content-type": authHeaders["content-type"] }, body: { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", requestType: "deletion" } });
const privacyRequest = await dispatch(router, "POST", "/api/marketplace/privacy-requests", { headers: authHeaders, body: { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", requestType: "deletion" } });
assert(privacyList.response.statusCode === 200 && privacyList.body.privacyRequests[0].requestType === "export" && missingPrivacyCsrf.response.statusCode === 403 && privacyRequest.response.statusCode === 201 && privacyRequest.body.privacyRequest.requestType === "deletion" && calls.slice(-2).map((call) => call.kind).join(",") === "privacy-list,privacy-request" && calls.at(-1).actor.userId === sessions.landlord.user_id, "Privacy request routes lost account ownership, CSRF protection or safe request projection.");
const bookingList = await dispatch(router, "GET", "/api/marketplace/bookings?limit=25", { headers: { cookie: authHeaders.cookie } });
assert(bookingList.response.statusCode === 200 && bookingList.body.bookings[0].pricePerspective === "customer-total" && calls.at(-1).kind === "booking-list" && calls.at(-1).input.limit === "25" && calls.at(-1).actor.userId === sessions.landlord.user_id, "Participant booking summaries lost account authorization, bounded pagination or role-specific price projection.");
const unauthenticatedBookingList = await dispatch(router, "GET", "/api/marketplace/bookings");
assert(unauthenticatedBookingList.response.statusCode === 401 && unauthenticatedBookingList.body.code === "authentication-required", "Booking summaries were exposed without an authenticated participant.");
const landlordCleanerEdit = await dispatch(router, "PUT", "/api/marketplace/cleaner/profile", { headers: authHeaders, body: { biography: "Attempt" } });
assert(landlordCleanerEdit.response.statusCode === 403 && landlordCleanerEdit.body.code === "role-rejected", "A landlord entered the Cleaner-only profile route.");
const availabilityList = await dispatch(router, "GET", "/api/marketplace/cleaner/availability", { headers: { cookie: cleanerAuthHeaders.cookie } });
const missingAvailabilityCsrf = await dispatch(router, "POST", "/api/marketplace/cleaner/availability", { headers: { cookie: cleanerAuthHeaders.cookie, origin: cleanerAuthHeaders.origin, "content-type": cleanerAuthHeaders["content-type"] }, body: { startAt: "2026-07-20T09:00:00.000Z", endAt: "2026-07-20T17:00:00.000Z" } });
const availabilityCreated = await dispatch(router, "POST", "/api/marketplace/cleaner/availability", { headers: cleanerAuthHeaders, body: { startAt: "2026-07-20T09:00:00.000Z", endAt: "2026-07-20T17:00:00.000Z" } });
const availabilityWithdrawn = await dispatch(router, "DELETE", "/api/marketplace/cleaner/availability/44444444-4444-4444-8444-444444444444", { headers: cleanerAuthHeaders });
const landlordAvailability = await dispatch(router, "GET", "/api/marketplace/cleaner/availability", { headers: { cookie: authHeaders.cookie } });
assert(availabilityList.response.statusCode === 200 && availabilityList.body.availability.length === 1 && missingAvailabilityCsrf.response.statusCode === 403 && availabilityCreated.response.statusCode === 201 && availabilityWithdrawn.response.statusCode === 200 && availabilityWithdrawn.body.availability.status === "withdrawn" && landlordAvailability.response.statusCode === 403 && calls.slice(-3).map((call) => call.kind).join(",") === "availability-list,availability-create,availability-withdraw", "Cleaner availability routes lost account ownership, role isolation, CSRF protection or exact-window lifecycle.");
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
const profileRead = await dispatch(router, "GET", "/api/marketplace/landlord/profile", { headers: { cookie: authHeaders.cookie } });
assert(profileRead.response.statusCode === 200 && profileRead.body.profile.organisationName === "Example PM" && calls.at(-1).kind === "landlord-get" && calls.at(-1).actor.userId === sessions.landlord.user_id, "Landlord profile read was not bound to the authenticated Landlord.");
const cleanerProfileRead = await dispatch(router, "GET", "/api/marketplace/landlord/profile", { headers: { cookie: cleanerAuthHeaders.cookie } });
assert(cleanerProfileRead.response.statusCode === 403 && calls.at(-1).kind === "landlord-get", "A Cleaner account could read the separate private Landlord profile.");
const profile = await dispatch(router, "PUT", "/api/marketplace/landlord/profile", { headers: authHeaders, body: { organisationName: "Example PM", biography: "Local portfolio", userId: "33333333-3333-4333-8333-333333333333" } });
assert(profile.response.statusCode === 200 && calls.at(-1).actor.userId === sessions.landlord.user_id && calls.at(-1).input.userId !== calls.at(-1).actor.userId, "Landlord profile routing trusted a submitted owner identifier.");
const created = await dispatch(router, "POST", "/api/marketplace/properties", { headers: authHeaders, body: { name: "Canal View", landlordUserId: "33333333-3333-4333-8333-333333333333" } });
assert(created.response.statusCode === 201 && calls.at(-1).actor.userId === sessions.landlord.user_id && created.body.property.name === "Canal View", "Property creation did not bind the authenticated actor or return a created response.");
const propertyId = "44444444-4444-4444-8444-444444444444";
const updated = await dispatch(router, "PUT", `/api/marketplace/properties/${propertyId}`, { headers: authHeaders, body: { id: "99999999-9999-4999-8999-999999999999", name: "Updated" } });
assert(updated.response.statusCode === 200 && calls.at(-1).input.id === propertyId, "Property update trusted a body property ID instead of the protected route resource.");
const requestCreated = await dispatch(router, "POST", "/api/marketplace/cleaning-requests", { headers: authHeaders, body: { propertyId, landlordUserId: "33333333-3333-4333-8333-333333333333" } });
const requestList = await dispatch(router, "GET", "/api/marketplace/cleaning-requests", { headers: { cookie: authHeaders.cookie } });
assert(requestCreated.response.statusCode === 201 && requestCreated.body.cleaningRequest.status === "draft" && calls.at(-2).kind === "request-create" && calls.at(-2).actor.userId === sessions.landlord.user_id && requestList.response.statusCode === 200 && calls.at(-1).kind === "request-list", "Account cleaning-request routes did not bind private-draft creation/listing to the authenticated Landlord.");
const requestScanUrl = "/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/scan";
const requestIntentUrl = "/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/photos/intents";
const requestPhotoId = "88888888-8888-4888-8888-888888888888";
const requestScan = await dispatch(router, "GET", requestScanUrl, { headers: { cookie: authHeaders.cookie } });
const missingRequestMediaCsrf = await dispatch(router, "POST", requestIntentUrl, { headers: { cookie: authHeaders.cookie, origin: authHeaders.origin, "content-type": authHeaders["content-type"] }, body: { roomName: "Kitchen" } });
const requestIntent = await dispatch(router, "POST", requestIntentUrl, { headers: authHeaders, body: { roomName: "Kitchen", note: "Hob", mimeType: "image/jpeg", byteSize: 10, checksumSha256: "a".repeat(64) } });
const requestCompletion = await dispatch(router, "POST", `/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/photos/${requestPhotoId}/complete`, { headers: authHeaders, body: {} });
const requestPhotoAccess = await dispatch(router, "GET", `/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/photos/${requestPhotoId}/access`, { headers: { cookie: authHeaders.cookie } });
const requestSubmission = await dispatch(router, "POST", "/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/submit", { headers: authHeaders, body: { scopeReviewed: true, cleanerPreviewAuthorized: true } });
assert(requestScan.response.statusCode === 200 && missingRequestMediaCsrf.response.statusCode === 403 && requestIntent.response.statusCode === 201 && requestCompletion.response.statusCode === 200 && requestPhotoAccess.response.statusCode === 200 && requestSubmission.response.statusCode === 200 && requestSubmission.body.submission.status === "searching-for-cleaner", "Private request scan routes lost authentication, CSRF, completion, signed read or reviewed submission.");
assert(calls.slice(-5).map((call) => call.kind).join(",") === "request-media-scan,request-media-intent,request-media-complete,request-media-access,request-submit" && calls.at(-1).input.cleanerPreviewAuthorized === true, "Room-scan routing lost the owner resource, explicit preview choice or service order.");
const dispatchAuthorized = await dispatch(router, "POST", "/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/automatic-dispatch", { headers: authHeaders, body: { enabled: true, attemptLimit: 3, approvedMaximumPricePence: 15000 } });
assert(dispatchAuthorized.response.statusCode === 200 && dispatchAuthorized.body.automaticDispatch.enabled === true && dispatchAuthorized.body.automaticDispatch.maximumCustomerPricePence === 15000 && calls.at(-1).kind === "request-dispatch" && calls.at(-1).actor.userId === sessions.landlord.user_id && calls.at(-1).input.approvedMaximumPricePence === 15000, "Automatic matching was not protected by Landlord role, CSRF and explicit request-level maximum-price consent.");
const missingWithdrawalCsrf = await dispatch(router, "POST", "/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/withdraw", { headers: { cookie: authHeaders.cookie, origin: authHeaders.origin, "content-type": authHeaders["content-type"] }, body: { reasonCode: "other" } });
const requestWithdrawn = await dispatch(router, "POST", "/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/withdraw", { headers: authHeaders, body: { reasonCode: "no-longer-needed" } });
assert(missingWithdrawalCsrf.response.statusCode === 403 && requestWithdrawn.response.statusCode === 200 && requestWithdrawn.body.withdrawal.status === "cancelled" && calls.at(-1).kind === "request-withdraw" && calls.at(-1).actor.userId === sessions.landlord.user_id && calls.at(-1).input.reasonCode === "no-longer-needed", "Pre-booking withdrawal lost Landlord role, CSRF, route identity or explicit reason binding.");
const cleanerId = "22222222-2222-4222-8222-222222222222";
const matches = await dispatch(router, "GET", "/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/matches", { headers: { cookie: authHeaders.cookie } });
assert(matches.response.statusCode === 200 && matches.body.candidates[0].cleanerId === cleanerId && calls.at(-1).kind === "request-matches" && calls.at(-1).actor.userId === sessions.landlord.user_id, "Request-specific matching did not bind the authenticated Landlord or return the safe recommendation projection.");
const missingInvitationQuoteCsrf = await dispatch(router, "POST", `/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/invitation-quote`, { headers: { cookie: authHeaders.cookie, origin: authHeaders.origin, "content-type": authHeaders["content-type"] }, body: { cleanerId } });
const invitationQuote = await dispatch(router, "POST", `/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/invitation-quote`, { headers: authHeaders, body: { cleanerId, customerPricePence: 1 } });
assert(missingInvitationQuoteCsrf.response.statusCode === 403 && invitationQuote.response.statusCode === 200 && invitationQuote.body.quote.customerPricePence === 12000 && !Object.hasOwn(invitationQuote.body.quote, "cleanerPayPence") && calls.at(-1).kind === "booking-invitation-preview" && calls.at(-1).input.cleanerId === cleanerId && !Object.hasOwn(calls.at(-1).input, "customerPricePence"), "Invitation price preview lost Landlord/CSRF protection, trusted browser economics or exposed Cleaner pay.");
const invitation = await dispatch(router, "POST", `/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/invitations`, { headers: authHeaders, body: { cleanerId, approvedCustomerPricePence: 12000, customerPricePence: 1 } });
assert(invitation.response.statusCode === 201 && invitation.body.booking.customerPricePence === 12000 && calls.at(-1).kind === "booking-invite" && calls.at(-1).input.cleanerId === cleanerId && calls.at(-1).input.approvedCustomerPricePence === 12000 && !Object.hasOwn(calls.at(-1).input, "customerPricePence"), "Invitation routing lost the exact approved total, trusted browser-supplied economics or lost the selected Cleaner.");
const bookingId = "55555555-5555-4555-8555-555555555555";
const bookingCompletion = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/completion`, { headers: authHeaders, body: {} });
const submittedReview = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/reviews`, { headers: authHeaders, body: { rating: 5, writtenReview: "Clear and professional." } });
const bookingReview = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/reviews`, { headers: { cookie: authHeaders.cookie } });
assert(bookingCompletion.response.statusCode === 200 && submittedReview.response.statusCode === 201 && bookingReview.response.statusCode === 200 && calls.slice(-3).map((call) => call.kind).join(",") === "review-complete-booking,review-submit,review-get" && calls.at(-2).actor.userId === sessions.landlord.user_id, "Landlord completion/review routes lost role, CSRF or participant binding.");
const openedDispute = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/dispute`, { headers: authHeaders, body: { requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", category: "quality", description: "The agreed cleaning scope was not completed." } });
const bookingDispute = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/dispute`, { headers: { cookie: authHeaders.cookie } });
assert(openedDispute.response.statusCode === 201 && openedDispute.body.dispute.status === "open" && bookingDispute.response.statusCode === 200 && bookingDispute.body.dispute === null && calls.slice(-2).map((call) => call.kind).join(",") === "dispute-open,dispute-get", "Participant booking-case routes lost CSRF, authentication or booking binding.");
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
const requestRealtimeStream = await dispatch(router, "GET", "/api/marketplace/cleaning-requests/66666666-6666-4666-8666-666666666666/events?afterEventId=11", { headers: { cookie: authHeaders.cookie, origin: authHeaders.origin } });
assert(requestRealtimeStream.response.statusCode === 200 && calls.at(-1).kind === "request-realtime-open" && calls.at(-1).requestId === "66666666-6666-4666-8666-666666666666" && calls.at(-1).lastEventId === "11", "The private Landlord request stream lost role, exact-origin, resource or durable cursor binding.");
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
const unexpectedTask = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks`, { headers: authHeaders, body: { roomName: "Hall", description: "Clear packaging", estimatedAdditionalMinutes: 15, withinBookedTermsConfirmed: true } });
const taskTermsConfirmation = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks/${progressTaskId}/terms-confirmation`, { headers: authHeaders, body: {} });
const cleaningFinished = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/finish`, { headers: authHeaders, body: {} });
assert([cleaningStarted, cleaningPaused, cleaningTask, unexpectedTask, taskTermsConfirmation, cleaningFinished].every((result) => result.response.statusCode < 300) && cleaningFinished.body.progress.status === "awaiting-review" && calls.slice(-6).map((call) => call.kind).join(",") === "progress-start,progress-pause,progress-task,progress-add,progress-confirm-terms,progress-finish", "Cleaner progress routes lost start/pause/task/unexpected/frozen-terms/finish actions or role binding.");
const photoUploadId = "88888888-8888-4888-8888-888888888888";
const photoIntent = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/photos/intents`, { headers: authHeaders, body: { photoType: "before", mimeType: "image/jpeg", byteSize: 1234, checksumSha256: "a".repeat(64) } });
const photoCompletion = await dispatch(router, "POST", `/api/marketplace/bookings/${bookingId}/cleaning-progress/photos/${photoUploadId}/complete`, { headers: authHeaders, body: {} });
const photoAccess = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/cleaning-progress/photos/${photoUploadId}/access`, { headers: { cookie: authHeaders.cookie } });
assert(photoIntent.response.statusCode === 201 && photoCompletion.response.statusCode === 200 && photoAccess.response.statusCode === 200 && calls.slice(-3).map((call) => call.kind).join(",") === "media-intent,media-complete,media-access", "Private media routes did not bind Cleaner uploads and participant reads to the booking actor.");
const cleanerPropertyWrite = await dispatch(router, "POST", "/api/marketplace/properties", { headers: authHeaders, body: { name: "Attempt" } });
assert(cleanerPropertyWrite.response.statusCode === 403 && cleanerPropertyWrite.body.code === "role-rejected", "A Cleaner entered the Landlord-only property route.");
const participantDisputeQueue = await dispatch(router, "GET", "/api/marketplace/admin/disputes", { headers: { cookie: authHeaders.cookie } });
assert(participantDisputeQueue.response.statusCode === 403 && participantDisputeQueue.body.code === "role-rejected", "A booking participant entered the Administrator case queue.");
sessions.landlord = { ...sessions.landlord, user_id: "33333333-3333-4333-8333-333333333333", selected_role: "administrator", roles: ["administrator"] };
const moderatedReview = await dispatch(router, "POST", "/api/marketplace/admin/reviews/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/moderation", { headers: authHeaders, body: { decision: "approved" } });
assert(moderatedReview.response.statusCode === 200 && calls.at(-1).kind === "review-moderate" && calls.at(-1).actor.roles.includes("administrator"), "Administrator review moderation route lost role or CSRF binding.");
const disputeQueue = await dispatch(router, "GET", "/api/marketplace/admin/disputes?status=open&limit=25", { headers: { cookie: authHeaders.cookie } });
const missingDisputeCsrf = await dispatch(router, "PATCH", "/api/marketplace/admin/disputes/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { headers: { cookie: authHeaders.cookie, origin: authHeaders.origin, "content-type": "application/json; charset=utf-8" }, body: { status: "reviewing" } });
const reviewedDispute = await dispatch(router, "PATCH", "/api/marketplace/admin/disputes/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { headers: authHeaders, body: { status: "resolved", resolutionNote: "The evidence was reviewed and the booking has been cancelled.", resolutionOutcome: "cancelled", policyVersion: "tideway-case-response-v1", evidenceReviewed: true, sensitiveDataMinimised: true, noExternalActionConfirmed: true } });
assert(missingDisputeCsrf.response.statusCode === 403 && missingDisputeCsrf.body.code === "csrf-rejected", "Administrator case mutation accepted a missing CSRF token.");
assert(disputeQueue.response.statusCode === 200 && calls.at(-2).kind === "dispute-list" && calls.at(-2).input.status === "open" && reviewedDispute.response.statusCode === 200 && reviewedDispute.body.dispute.resolutionOutcome === "cancelled" && calls.at(-1).kind === "dispute-review" && calls.at(-1).actor.roles.includes("administrator"), "Administrator booking-case queue or audited resolution route lost its role, query or CSRF boundary.");
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

const originalCreateProperty = propertyService.createProperty;
propertyService.createProperty = async () => { throw Object.assign(new Error("The supplied property details are invalid."), { statusCode: 422, code: "invalid-property" }); };
const repositoryValidation = await dispatch(router, "POST", "/api/marketplace/properties", { headers: authHeaders, body: { name: "Invalid" } });
assert(repositoryValidation.response.statusCode === 422 && repositoryValidation.body.code === "invalid-property", "A safe repository validation error was converted into an internal failure.");
propertyService.createProperty = originalCreateProperty;

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
assert(runtime.router && runtime.security && runtime.propertyService && runtime.cleanerProfileService && runtime.cleaningRequestService && runtime.bookingWorkflowService && runtime.bookingRepository && runtime.matchingService && runtime.matchingRepository && runtime.matchingReady === false && runtime.journeyService && runtime.journeyRepository && runtime.progressService && runtime.progressRepository && runtime.mediaService && runtime.mediaRepository && runtime.messageService && runtime.messageRepository && runtime.realtimeService && runtime.realtimeRepository && runtime.realtimeSignalSource && runtime.notificationService && runtime.notificationRepository && runtime.reviewService && runtime.reviewRepository && runtime.disputeService && runtime.disputeRepository && runtime.privacyRequestService && runtime.privacyRequestRepository && runtime.cleanerPayoutRepository && runtime.cleanerPayoutService === null && runtime.identityService && runtime.credentialService && runtime.accountSessionService && runtime.authenticationRouter === null && runtime.authenticationHttpReady === false && Object.isFrozen(runtime), "Marketplace runtime did not compose the existing database, security, account, profile, property, request, matching, booking, journey, progress, media, messaging, realtime, notifications, reviews, disputes, privacy requests, payout repository and HTTP layers or safely keep incomplete provider delivery detached.");
let unconfiguredEmailRejected = false;
assert(runtime.requestMediaService && runtime.requestMediaRepository, "Marketplace runtime did not compose private cleaning-request room media.");
try { createMarketplaceRuntime(pool, { env: baseEnvironment, ...runtimeAbuseControl, emailDelivery: { send() {} } }); } catch (error) { unconfiguredEmailRejected = error.message.includes("requires one configured HTTPS or SMTP email provider and EMAIL_FROM"); }
assert(unconfiguredEmailRejected, "An email authentication boundary was enabled without trusted delivery configuration.");
let missingAbuseControl = false;
try { createMarketplaceRuntime(pool, { env: baseEnvironment }); } catch (error) { missingAbuseControl = error.message.includes("shared rate limiter and trusted client-key resolver"); }
assert(missingAbuseControl, "Marketplace runtime composed public reads without shared abuse control.");
const enabledEnvironment = { ...baseEnvironment, SMTP_URL: "smtps://mail.example.com", EMAIL_FROM: "Homle <hello@example.com>" };
const enabledRuntime = createMarketplaceRuntime(pool, {
  env: enabledEnvironment,
  emailDelivery: { async send() {} },
  ...runtimeAbuseControl
});
assert(enabledRuntime.authenticationHttpReady && enabledRuntime.authenticationRouter && enabledRuntime.router !== enabledRuntime.marketplaceRouter, "A complete trusted email/rate/client boundary did not compose the isolated authentication controller into the runtime chain.");
const pricedRuntime = createMarketplaceRuntime(pool, {
  env: {
    ...enabledEnvironment,
    BOOKING_TARGET_MARGIN_BPS: "2000",
    BOOKING_MINIMUM_CONTRIBUTION_PENCE: "1000",
    BOOKING_LABOUR_ON_COST_BPS: "1500",
    BOOKING_PAYMENT_FEE_BPS: "200",
    BOOKING_PAYMENT_FEE_FIXED_PENCE: "20",
    BOOKING_RISK_CONTINGENCY_BPS: "500",
    BOOKING_TRAVEL_COST_PENCE: "500",
    BOOKING_TRAVEL_COST_PER_KM_PENCE: "50",
    BOOKING_TRAVEL_DISTANCE_MULTIPLIER_BPS: "10000",
    BOOKING_SUPPLIES_COST_PENCE: "300",
    BOOKING_OTHER_COST_PENCE: "0",
    BOOKING_INVITATION_TTL_MINUTES: "60"
  },
  emailDelivery: { async send() {} },
  ...runtimeAbuseControl
});
assert(pricedRuntime.matchingReady === true, "A complete private booking-pricing policy was not exposed as matching-ready.");
const googleRuntime = createMarketplaceRuntime(pool, {
  env: { ...enabledEnvironment, GOOGLE_CLIENT_ID: "google-client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "google-client-secret" },
  emailDelivery: { async send() {} },
  ...runtimeAbuseControl
});
assert(googleRuntime.googleOidcReady === true && googleRuntime.googleOidcProvider?.callbackUrl === `${baseEnvironment.APP_ORIGIN}/api/marketplace/auth/google/callback`, "Complete Google configuration did not compose the exact callback verifier into the authentication runtime.");
const facebookRuntime = createMarketplaceRuntime(pool, {
  env: { ...enabledEnvironment, FACEBOOK_APP_ID: "123456789012345", FACEBOOK_APP_SECRET: "abcdef0123456789abcdef0123456789", FACEBOOK_GRAPH_API_VERSION: "v99.0" },
  emailDelivery: { async send() {} },
  ...runtimeAbuseControl
});
assert(facebookRuntime.facebookLoginReady === true && facebookRuntime.facebookLoginProvider && facebookRuntime.facebookDataDeletionRepository && facebookRuntime.facebookDataDeletionService, "Complete Facebook configuration did not compose sign-in together with Meta's signed data-deletion boundary.");
let missingRuntime = false;
try { createMarketplaceRuntime(pool, { env: {} }); } catch (error) { missingRuntime = error.message.includes("DATABASE_URL") && error.message.includes("SESSION_SECRET") && error.message.includes("DATA_ENCRYPTION_KEY"); }
assert(missingRuntime, "Marketplace runtime did not fail closed without its database/session/encryption configuration.");

console.log("Marketplace HTTP tests passed: isolated routing, public search, session/role/origin/CSRF protection, owner-bound property mutations, bounded JSON, safe errors and fail-closed runtime composition.");
