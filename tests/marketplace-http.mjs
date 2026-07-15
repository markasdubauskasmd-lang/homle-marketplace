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
  async saveOwnProfile(actor, input) { calls.push({ kind: "cleaner-save", actor, input }); return { profileCompletionPercent: 100 }; }
};
const propertyService = {
  async saveLandlordProfile(actor, input) { calls.push({ kind: "landlord-save", actor, input }); return { organisationName: input.organisationName || null, biography: input.biography || "" }; },
  async createProperty(actor, input) { calls.push({ kind: "property-create", actor, input }); return { propertyId: "44444444-4444-4444-8444-444444444444", name: input.name }; },
  async updateOwnProperty(actor, input) { calls.push({ kind: "property-update", actor, input }); return { propertyId: input.id, name: input.name }; },
  async listOwnProperties(actor) { calls.push({ kind: "property-list", actor }); return []; },
  async getBookingProperty(actor, bookingId) { calls.push({ kind: "booking-property", actor, bookingId }); if (actor.userId === "33333333-3333-4333-8333-333333333333") throw new AccountHttpError(403, "forbidden", "Booking property access is forbidden."); return { propertyId: "44444444-4444-4444-8444-444444444444", accessInstructions: "Protected" }; }
};
let unexpectedError;
const router = createMarketplaceHttpRouter({ security, cleanerProfileService, propertyService }, { onUnexpectedError(error) { unexpectedError = error; } });
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
const profile = await dispatch(router, "PUT", "/api/marketplace/landlord/profile", { headers: authHeaders, body: { organisationName: "Example PM", biography: "Local portfolio", userId: "33333333-3333-4333-8333-333333333333" } });
assert(profile.response.statusCode === 200 && calls.at(-1).actor.userId === sessions.landlord.user_id && calls.at(-1).input.userId !== calls.at(-1).actor.userId, "Landlord profile routing trusted a submitted owner identifier.");
const created = await dispatch(router, "POST", "/api/marketplace/properties", { headers: authHeaders, body: { name: "Canal View", landlordUserId: "33333333-3333-4333-8333-333333333333" } });
assert(created.response.statusCode === 201 && calls.at(-1).actor.userId === sessions.landlord.user_id && created.body.property.name === "Canal View", "Property creation did not bind the authenticated actor or return a created response.");
const propertyId = "44444444-4444-4444-8444-444444444444";
const updated = await dispatch(router, "PUT", `/api/marketplace/properties/${propertyId}`, { headers: authHeaders, body: { id: "99999999-9999-4999-8999-999999999999", name: "Updated" } });
assert(updated.response.statusCode === 200 && calls.at(-1).input.id === propertyId, "Property update trusted a body property ID instead of the protected route resource.");
const bookingId = "55555555-5555-4555-8555-555555555555";
const bookingProperty = await dispatch(router, "GET", `/api/marketplace/bookings/${bookingId}/property`, { headers: { cookie: authHeaders.cookie } });
assert(bookingProperty.response.statusCode === 200 && calls.at(-1).bookingId === bookingId && bookingProperty.body.property.accessInstructions === "Protected", "Booking-scoped property route lost the authenticated participant projection.");
sessions.landlord = { ...sessions.landlord, user_id: "22222222-2222-4222-8222-222222222222", selected_role: "cleaner", roles: ["cleaner"] };
const cleanerProfile = await dispatch(router, "PUT", "/api/marketplace/cleaner/profile", { headers: authHeaders, body: { biography: "Careful cleaner" } });
assert(cleanerProfile.response.statusCode === 200 && calls.at(-1).kind === "cleaner-save" && calls.at(-1).actor.roles.includes("cleaner"), "The authenticated Cleaner could not update their own profile through the role-protected route.");
const cleanerPropertyWrite = await dispatch(router, "POST", "/api/marketplace/properties", { headers: authHeaders, body: { name: "Attempt" } });
assert(cleanerPropertyWrite.response.statusCode === 403 && cleanerPropertyWrite.body.code === "role-rejected", "A Cleaner entered the Landlord-only property route.");
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
const runtime = createMarketplaceRuntime(pool, { env: baseEnvironment });
assert(runtime.router && runtime.security && runtime.propertyService && runtime.cleanerProfileService && runtime.identityService && runtime.credentialService && runtime.accountSessionService && runtime.authenticationRouter === null && runtime.authenticationHttpReady === false && Object.isFrozen(runtime), "Marketplace runtime did not compose the existing database, security, account, profile, property and HTTP layers or safely kept incomplete authentication delivery detached.");
let partialAuthenticationRejected = false;
try { createMarketplaceRuntime(pool, { env: baseEnvironment, emailDelivery: { send() {} } }); } catch (error) { partialAuthenticationRejected = error.message.includes("requires email delivery, shared rate limiting"); }
assert(partialAuthenticationRejected, "A partially supplied authentication HTTP boundary was silently enabled.");
const enabledEnvironment = { ...baseEnvironment, SMTP_URL: "smtps://mail.example.com", EMAIL_FROM: "Tideway <hello@example.com>" };
const enabledRuntime = createMarketplaceRuntime(pool, {
  env: enabledEnvironment,
  emailDelivery: { async send() {} },
  rateLimiter: { async consume() { return { allowed: true }; } },
  clientKey: () => "test-client"
});
assert(enabledRuntime.authenticationHttpReady && enabledRuntime.authenticationRouter && enabledRuntime.router !== enabledRuntime.marketplaceRouter, "A complete trusted email/rate/client boundary did not compose the isolated authentication controller into the runtime chain.");
let missingRuntime = false;
try { createMarketplaceRuntime(pool, { env: {} }); } catch (error) { missingRuntime = error.message.includes("DATABASE_URL") && error.message.includes("SESSION_SECRET") && error.message.includes("DATA_ENCRYPTION_KEY"); }
assert(missingRuntime, "Marketplace runtime did not fail closed without its database/session/encryption configuration.");

console.log("Marketplace HTTP tests passed: isolated routing, public search, session/role/origin/CSRF protection, owner-bound property mutations, bounded JSON, safe errors and fail-closed runtime composition.");
