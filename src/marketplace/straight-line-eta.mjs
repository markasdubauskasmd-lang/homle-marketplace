// Arrival estimation providers for the live journey view. The provider-free
// fallback runs entirely on this server. Google Routes is optional and sends
// only the current and destination points for a road ETA after the Cleaner's
// existing journey-location consent boundary has been crossed.

const earthRadiusKm = 6371;

function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

function greatCircleKm(origin, destination) {
  const dLat = radians(destination.latitude - origin.latitude);
  const dLon = radians(destination.longitude - origin.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(origin.latitude)) * Math.cos(radians(destination.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}

function finiteCoordinate(value, limit) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

function validPoint(point) {
  return point && typeof point === "object" && finiteCoordinate(point.latitude, 90) && finiteCoordinate(point.longitude, 180);
}

export function createStraightLineEtaProvider(options = {}) {
  const speedKmh = Number.isFinite(options.speedKmh) && options.speedKmh >= 5 && options.speedKmh <= 120 ? options.speedKmh : 22;
  const bufferMinutes = Number.isFinite(options.bufferMinutes) && options.bufferMinutes >= 0 && options.bufferMinutes <= 30 ? options.bufferMinutes : 3;
  const minimumMinutes = Number.isFinite(options.minimumMinutes) && options.minimumMinutes >= 1 && options.minimumMinutes <= 30 ? options.minimumMinutes : 4;
  // Straight-line distance understates road distance; scale it up before
  // dividing by the assumed speed. 1.35 is a common urban detour ratio.
  const routeFactor = Number.isFinite(options.routeFactor) && options.routeFactor >= 1 && options.routeFactor <= 2 ? options.routeFactor : 1.35;
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();

  return Object.freeze({
    async estimateArrival(input) {
      if (!validPoint(input?.origin) || !validPoint(input?.destination)) return null;
      const distanceKm = greatCircleKm(input.origin, input.destination) * routeFactor;
      const travelMinutes = Math.max(minimumMinutes, (distanceKm / speedKmh) * 60 + bufferMinutes);
      // The journey service independently rejects estimates in the past or more
      // than 24 hours out; cap here as well so the contract is self-contained.
      const boundedMinutes = Math.min(travelMinutes, 24 * 60 - 1);
      return new Date(clock().getTime() + Math.round(boundedMinutes * 60_000));
    }
  });
}

export function createGoogleRoutesEtaProvider(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("Google Routes requires a fetch implementation.");
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (!apiKey) throw new TypeError("Google Routes requires a server API key.");
  const endpoint = String(options.endpoint || "https://routes.googleapis.com/directions/v2:computeRoutes");
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= 30_000 ? options.timeoutMs : 7000;
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();
  const fallback = options.fallback || createStraightLineEtaProvider({ clock });

  async function fallbackEstimate(input) {
    return fallback && typeof fallback.estimateArrival === "function" ? fallback.estimateArrival(input) : null;
  }

  return Object.freeze({
    async estimateArrival(input) {
      if (!validPoint(input?.origin) || !validPoint(input?.destination)) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"
          },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: input.origin.latitude, longitude: input.origin.longitude } } },
            destination: { location: { latLng: { latitude: input.destination.latitude, longitude: input.destination.longitude } } },
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_AWARE",
            computeAlternativeRoutes: false,
            languageCode: "en-GB",
            units: "METRIC"
          }),
          redirect: "error",
          signal: controller.signal
        });
        if (!response || response.status !== 200) return fallbackEstimate(input);
        const body = await response.text();
        if (typeof body !== "string" || body.length > 128 * 1024) return fallbackEstimate(input);
        const parsed = JSON.parse(body);
        const duration = typeof parsed?.routes?.[0]?.duration === "string" ? Number(parsed.routes[0].duration.replace(/s$/, "")) : NaN;
        if (!Number.isFinite(duration) || duration < 0 || duration > 24 * 60 * 60) return fallbackEstimate(input);
        return new Date(clock().getTime() + Math.max(60, Math.round(duration)) * 1000);
      } catch {
        return fallbackEstimate(input);
      } finally {
        clearTimeout(timer);
      }
    }
  });
}

export function etaProviderFromEnvironment(env = process.env, options = {}) {
  const selected = String(env.ETA_PROVIDER || "straight-line").trim().toLowerCase();
  if (selected === "none") return null;
  if (selected === "straight-line") return createStraightLineEtaProvider(options);
  if (selected === "google-maps") return createGoogleRoutesEtaProvider({ apiKey: env.GOOGLE_MAPS_SERVER_API_KEY, fetch: options.fetch, clock: options.clock });
  throw new TypeError("ETA_PROVIDER must be blank, none, straight-line or google-maps.");
}
