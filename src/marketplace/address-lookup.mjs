const defaultEndpoint = "https://places.googleapis.com/v1";
const maximumResponseBytes = 512 * 1024;
const maximumSuggestions = 10;
const sessionTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const placeIdPattern = /^[A-Za-z0-9_-]{8,256}$/;

function serviceError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function boundedText(value, maximum = 300) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim().replace(/\s+/g, " ") : "";
  return text && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text) ? text : "";
}

function searchQuery(value) {
  const query = boundedText(value, 200);
  if (query.length < 3) throw serviceError("Enter at least three characters of the address or postcode.", 422, "invalid-address-query");
  return query;
}

function sessionToken(value) {
  const token = boundedText(value, 40);
  if (!sessionTokenPattern.test(token)) throw serviceError("Start a fresh address search and try again.", 422, "invalid-address-session");
  return token;
}

function placeId(value) {
  const id = boundedText(value, 256);
  if (!placeIdPattern.test(id)) throw serviceError("Select an address from the latest search results.", 422, "invalid-address-selection");
  return id;
}

function lookupFailure(status) {
  if (status === 404) return serviceError("That address is no longer available. Search again or enter it manually.", 404, "address-not-found");
  if (status === 429) return serviceError("Address search is busy. Wait a moment and try again.", 429, "address-lookup-rate-limited");
  return serviceError("Address search is temporarily unavailable. You can still enter the address manually.", 503, "address-lookup-unavailable");
}

function componentsByType(addressComponents) {
  const result = new Map();
  for (const component of Array.isArray(addressComponents) ? addressComponents : []) {
    const value = boundedText(component?.longText, 160);
    if (!value) continue;
    for (const type of Array.isArray(component?.types) ? component.types : []) {
      if (typeof type === "string" && !result.has(type)) result.set(type, value);
    }
  }
  return result;
}

function resolvedAddress(record) {
  if (!record || typeof record !== "object") throw lookupFailure(502);
  const components = componentsByType(record.addressComponents);
  const postcode = boundedText(components.get("postal_code"), 10).toUpperCase();
  const street = boundedText(components.get("route"), 120);
  const houseNumber = [components.get("subpremise"), components.get("premise"), components.get("street_number")]
    .map((part) => boundedText(part, 80)).filter(Boolean).join(", ");
  const town = boundedText(components.get("postal_town") || components.get("locality"), 100);
  const county = boundedText(components.get("administrative_area_level_2") || components.get("administrative_area_level_1"), 100);
  if (!postcode || !street || !houseNumber || !town) throw serviceError("Google Maps could not separate that address into Homle's required fields. Enter it manually instead.", 422, "address-components-incomplete");
  return Object.freeze({ postcode, houseNumber, street, town, county, country: "United Kingdom" });
}

export function createGooglePlacesAddressLookup(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("Address search requires a fetch implementation.");
  const apiKey = boundedText(options.apiKey, 512);
  if (!apiKey) throw new TypeError("Address search requires a Google Maps server API key.");
  const endpoint = String(options.endpoint || defaultEndpoint).replace(/\/+$/, "");
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= 30_000 ? options.timeoutMs : 7000;

  async function request(path, { method = "GET", body, fieldMask } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${endpoint}${path}`, {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fieldMask
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: controller.signal
      });
      if (!response || response.status !== 200) throw lookupFailure(response?.status);
      const text = await response.text();
      if (typeof text !== "string" || text.length > maximumResponseBytes) throw lookupFailure(502);
      try { return JSON.parse(text); }
      catch { throw lookupFailure(502); }
    } catch (error) {
      if (error?.statusCode) throw error;
      throw lookupFailure(503);
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    async searchAddresses(input, suppliedSessionToken) {
      const query = searchQuery(input);
      const token = sessionToken(suppliedSessionToken);
      const result = await request("/places:autocomplete", {
        method: "POST",
        fieldMask: "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
        body: { input: query, sessionToken: token, includedRegionCodes: ["gb"], regionCode: "uk", languageCode: "en-GB" }
      });
      const suggestions = (Array.isArray(result?.suggestions) ? result.suggestions : []).slice(0, maximumSuggestions).map((suggestion) => ({
        id: boundedText(suggestion?.placePrediction?.placeId, 256),
        address: boundedText(suggestion?.placePrediction?.text?.text, 300)
      })).filter((suggestion) => placeIdPattern.test(suggestion.id) && suggestion.address);
      if (!suggestions.length) throw serviceError("No matching UK addresses were found. Add a house number or enter the address manually.", 404, "address-not-found");
      return Object.freeze({ suggestions });
    },
    async resolveAddress(id, suppliedSessionToken) {
      const selected = placeId(id);
      const token = sessionToken(suppliedSessionToken);
      const query = new URLSearchParams({ sessionToken: token, languageCode: "en-GB", regionCode: "uk" });
      const result = await request(`/places/${encodeURIComponent(selected)}?${query}`, {
        fieldMask: "id,formattedAddress,addressComponents,location"
      });
      return resolvedAddress(result);
    }
  });
}

export function addressLookupFromEnvironment(env = process.env, options = {}) {
  const provider = String(env.ADDRESS_LOOKUP_PROVIDER || "").trim().toLowerCase();
  if (!provider || provider === "none") return null;
  if (provider !== "google-maps") throw new TypeError("ADDRESS_LOOKUP_PROVIDER must be blank, none or google-maps.");
  return createGooglePlacesAddressLookup({ apiKey: env.GOOGLE_MAPS_SERVER_API_KEY, fetch: options.fetch });
}
