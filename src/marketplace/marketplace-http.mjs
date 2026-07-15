import { AccountHttpError } from "./account-security.mjs";

const uuidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const bookingPropertyPath = new RegExp(`^/api/marketplace/bookings/(${uuidPattern})/property$`);
const propertyPath = new RegExp(`^/api/marketplace/properties/(${uuidPattern})$`);
const apiPrefix = "/api/marketplace/";
const maximumBodyBytes = 64 * 1024;

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function contentType(request) {
  const supplied = request?.headers?.["content-type"];
  return Array.isArray(supplied) ? supplied[0] : String(supplied || "");
}

async function readJsonObject(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(contentType(request))) throw Object.assign(new SyntaxError("Send a JSON request body."), { code: "json-content-type-required" });
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.length;
    if (byteLength > maximumBodyBytes) throw Object.assign(new Error("The request body is too large."), { statusCode: 413, code: "request-too-large" });
    chunks.push(buffer);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new SyntaxError("The JSON request body is invalid."), { code: "invalid-json" }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new SyntaxError("The JSON request body must be an object."), { code: "json-object-required" });
  return value;
}

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

function errorResponse(error) {
  if (error instanceof AccountHttpError) return { statusCode: error.statusCode, code: error.code, message: error.message };
  if (error instanceof SyntaxError) return { statusCode: 400, code: error.code || "invalid-request", message: error.message };
  if (error instanceof TypeError) return { statusCode: 422, code: "validation-failed", message: error.message };
  if ([403, 404, 409, 413].includes(error?.statusCode)) return { statusCode: error.statusCode, code: error.code || ({ 403: "forbidden", 404: "not-found", 409: "conflict", 413: "request-too-large" }[error.statusCode]), message: error.message };
  return { statusCode: 500, code: "internal-error", message: "Something went wrong. Please try again." };
}

function methodNotAllowed(response, methods) {
  sendJson(response, 405, { ok: false, code: "method-not-allowed", error: "This method is not allowed." }, { Allow: methods.join(", ") });
}

export function createMarketplaceHttpRouter(dependencies, options = {}) {
  const security = dependencies?.security;
  const properties = dependencies?.propertyService;
  const cleaners = dependencies?.cleanerProfileService;
  if (!security || typeof security.protect !== "function") throw new TypeError("Marketplace HTTP routes require account security.");
  if (!properties || typeof properties.saveLandlordProfile !== "function" || typeof properties.createProperty !== "function" || typeof properties.updateOwnProperty !== "function" || typeof properties.listOwnProperties !== "function" || typeof properties.getBookingProperty !== "function") throw new TypeError("Marketplace HTTP routes require the property service.");
  if (!cleaners || typeof cleaners.saveOwnProfile !== "function" || typeof cleaners.searchPublicProfiles !== "function") throw new TypeError("Marketplace HTTP routes require the cleaner profile service.");
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
        const selectedProperty = pathname.match(propertyPath);
        if (selectedProperty) {
          if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]), true;
          const context = await security.protect(request, { mutation: true, roles: ["landlord"] });
          const body = await readJsonObject(request);
          const property = await properties.updateOwnProperty(context.actor, { ...body, id: selectedProperty[1] });
          sendJson(response, 200, { ok: true, property });
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
