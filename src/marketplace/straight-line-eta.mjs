// Provider-free arrival estimation for the live journey view. Computes the
// great-circle distance from the Cleaner's latest consented location to the
// booked property and divides by a conservative urban travel speed, plus a
// small parking/arrival buffer. Runs entirely on this server: no external
// routing API, so no live location ever leaves the platform. A road-routing
// provider can replace this later through the same estimateArrival contract.

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

export function etaProviderFromEnvironment(env = process.env) {
  const selected = String(env.ETA_PROVIDER || "straight-line").trim().toLowerCase();
  if (selected === "none") return null;
  if (selected !== "straight-line") throw new TypeError("ETA_PROVIDER must be blank, none or straight-line.");
  return createStraightLineEtaProvider();
}
