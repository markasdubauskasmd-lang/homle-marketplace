import { isUkPostcode } from "../../public/contact-validation.js";

// Best-effort UK postcode -> coordinate resolution via postcodes.io, a free,
// no-account, open-data service. Geocoding only enriches matching: a failure
// must never block a property or service-area save, so every path fails safe
// by returning null and letting the existing outward-postcode fallback stand.

const defaultEndpoint = "https://api.postcodes.io";
const maximumResponseBytes = 64 * 1024;
const outwardPostcodePattern = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

function normalizedFullPostcode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized.length < 5 || normalized.length > 8 || !isUkPostcode(normalized)) return null;
  return normalized;
}

function normalizedOutcode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  return outwardPostcodePattern.test(normalized) ? normalized : null;
}

function finiteCoordinate(value, limit) {
  return typeof value === "number" && Number.isFinite(value) && value >= -limit && value <= limit ? value : null;
}

function coordinatesFrom(record) {
  if (!record || typeof record !== "object") return null;
  const latitude = finiteCoordinate(record.latitude, 90);
  const longitude = finiteCoordinate(record.longitude, 180);
  // postcodes.io returns null coordinates for a small number of valid
  // postcodes (e.g. Crown dependencies); treat those as unresolved.
  return latitude == null || longitude == null ? null : { latitude, longitude };
}

export function createPostcodesIoGeocoder(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("A geocoder requires a fetch implementation.");
  const endpoint = String(options.endpoint || defaultEndpoint).replace(/\/+$/, "");
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= 30_000 ? options.timeoutMs : 5000;

  async function lookup(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${endpoint}${path}`, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: controller.signal
      });
      if (!response || response.status !== 200) return null;
      const body = await response.text();
      if (typeof body !== "string" || body.length > maximumResponseBytes) return null;
      const parsed = JSON.parse(body);
      if (!parsed || parsed.status !== 200) return null;
      return coordinatesFrom(parsed.result);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    async geocodePostcode(postcode) {
      const normalized = normalizedFullPostcode(postcode);
      if (!normalized) return null;
      return lookup(`/postcodes/${encodeURIComponent(normalized)}`);
    },
    async geocodeOutcode(outcode) {
      const normalized = normalizedOutcode(outcode);
      if (!normalized) return null;
      return lookup(`/outcodes/${encodeURIComponent(normalized)}`);
    }
  });
}

export function geocoderFromEnvironment(env = process.env, options = {}) {
  const provider = String(env.GEOCODING_PROVIDER || "").trim().toLowerCase();
  if (!provider || provider === "none") return null;
  if (provider !== "postcodes-io") throw new TypeError("GEOCODING_PROVIDER must be blank, none or postcodes-io.");
  return createPostcodesIoGeocoder({ fetch: options.fetch });
}
