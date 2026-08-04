function clean(value, maximum) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= maximum && !/[\u0000-\u001f\u007f\s]/.test(text) ? text : "";
}

export function mapsClientConfigurationFromEnvironment(env = process.env) {
  const provider = String(env.MAP_PROVIDER || "").trim().toLowerCase();
  if (!provider || provider === "none") return null;
  if (provider !== "google-maps") throw new TypeError("MAP_PROVIDER must be blank, none or google-maps.");
  const browserKey = clean(env.GOOGLE_MAPS_BROWSER_API_KEY, 256);
  if (!browserKey) throw new TypeError("Google Maps display requires a browser API key.");
  const mapId = clean(env.GOOGLE_MAPS_MAP_ID, 64);
  return Object.freeze({ provider: "google-maps", apiKey: browserKey, mapId: mapId || null, region: "GB", language: "en-GB" });
}
