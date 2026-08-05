const tileSize = 256;
const minimumLatitude = -85.05112878;
const maximumLatitude = 85.05112878;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function clampedMapZoom(value, minimum = 5, maximum = 16) {
  const zoom = Math.round(Number(value));
  return Math.max(minimum, Math.min(maximum, Number.isFinite(zoom) ? zoom : minimum));
}

export function worldPixelFromCoordinate(latitude, longitude, zoom) {
  const level = clampedMapZoom(zoom, 0, 22);
  const size = tileSize * 2 ** level;
  const lat = Math.max(minimumLatitude, Math.min(maximumLatitude, Number(latitude) || 0));
  const lon = Math.max(-180, Math.min(180, Number(longitude) || 0));
  const sine = Math.sin(lat * Math.PI / 180);
  return {
    x: (lon + 180) / 360 * size,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size
  };
}

export function coordinateFromWorldPixel(x, y, zoom) {
  const level = clampedMapZoom(zoom, 0, 22);
  const size = tileSize * 2 ** level;
  const longitude = Number(x) / size * 360 - 180;
  const mercator = Math.PI - 2 * Math.PI * Number(y) / size;
  const latitude = 180 / Math.PI * Math.atan(Math.sinh(mercator));
  return {
    latitude: Math.max(minimumLatitude, Math.min(maximumLatitude, latitude)),
    longitude: ((longitude + 540) % 360) - 180
  };
}

export function openStreetMapTileUrl(zoom, x, y) {
  const level = clampedMapZoom(zoom, 0, 22);
  const count = 2 ** level;
  const wrappedX = ((Math.trunc(Number(x)) % count) + count) % count;
  const tileY = Math.max(0, Math.min(count - 1, Math.trunc(Number(y))));
  return `https://tile.openstreetmap.org/${level}/${wrappedX}/${tileY}.png`;
}

export function outwardPostcode(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^([A-Z]{1,2}[0-9][A-Z0-9]?)(?:[0-9][A-Z]{2})?$/);
  return match?.[1] || "";
}

export function postcodeDetailsFromReverseResponse(payload) {
  const record = Array.isArray(payload?.result) ? payload.result[0] : null;
  const postcode = String(record?.postcode || "").trim().toUpperCase();
  const outcode = outwardPostcode(record?.outcode || postcode);
  const latitude = finiteNumber(record?.latitude);
  const longitude = finiteNumber(record?.longitude);
  if (!postcode || !outcode || latitude == null || longitude == null) return null;
  return Object.freeze({
    postcode,
    outwardPostcode: outcode,
    latitude,
    longitude,
    distanceMetres: Math.max(0, Math.round(finiteNumber(record?.distance) || 0)),
    district: String(record?.admin_district || "").trim(),
    ward: String(record?.admin_ward || "").trim(),
    region: String(record?.region || "").trim(),
    country: String(record?.country || "United Kingdom").trim() || "United Kingdom"
  });
}

export const postcodeMapTileSize = tileSize;
