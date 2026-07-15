import { errorResponse, maximumBodyBytes, methodNotAllowed, readJsonObject, sendJson } from "./http-support.mjs";

const uuidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const bookingPropertyPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/property$`);
const bookingResponsePath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/response$`);
const requestInvitationPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/invitations$`);
const requestMatchesPath = new RegExp(`^/api/marketplace/cleaning-requests/(${uuidPattern})/matches$`);
const bookingTrackingPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/tracking$`);
const journeyStartPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/journey/start$`);
const journeyLocationPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/journey/location$`);
const journeyArrivalPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/journey/arrive$`);
const propertyPath = new RegExp(`^/api/marketplace/properties/(${uuidPattern})$`);
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
  if (!security || typeof security.protect !== "function") throw new TypeError("Marketplace HTTP routes require account security.");
  if (!properties || typeof properties.saveLandlordProfile !== "function" || typeof properties.createProperty !== "function" || typeof properties.updateOwnProperty !== "function" || typeof properties.listOwnProperties !== "function" || typeof properties.getBookingProperty !== "function") throw new TypeError("Marketplace HTTP routes require the property service.");
  if (!cleaners || typeof cleaners.saveOwnProfile !== "function" || typeof cleaners.searchPublicProfiles !== "function") throw new TypeError("Marketplace HTTP routes require the cleaner profile service.");
  if (!cleaningRequests || typeof cleaningRequests.createOwnRequest !== "function" || typeof cleaningRequests.listOwnRequests !== "function") throw new TypeError("Marketplace HTTP routes require the cleaning-request service.");
  if (!bookings || typeof bookings.inviteCleaner !== "function" || typeof bookings.respondToInvitation !== "function") throw new TypeError("Marketplace HTTP routes require the booking workflow service.");
  if (!matching || typeof matching.recommendForRequest !== "function") throw new TypeError("Marketplace HTTP routes require the request matching service.");
  if (!journeys || !["startJourney", "updateLocation", "markArrived", "getTracking"].every((method) => typeof journeys[method] === "function")) throw new TypeError("Marketplace HTTP routes require the booking journey service.");
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};

  return {
    async handle(request, response, suppliedUrl) {
      const url = suppliedUrl instanceof URL ? suppliedUrl : new URL(request.url || "/", "http://localhost");
      const pathname = url.pathname;
      if (!pathname.startsWith(apiPrefix)) return false;
      try {
        if (pathname === "/api/marketplace/cleaners") {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const results = await cleaners.searchPublicProfiles(queryFilters(url));
          sendJson(response, 200, { ok: true, cleaners: results });
          return true;
        }
        if (pathname === "/api/marketplace/cleaner/profile") {
          if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["cleaner"] });
          const profile = await cleaners.saveOwnProfile(context.actor, await readJsonObject(request));
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
        sendJson(response, mapped.statusCode, { ok: false, code: mapped.code, error: mapped.message });
        return true;
      }
    }
  };
}

export { maximumBodyBytes };
