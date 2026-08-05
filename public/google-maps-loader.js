let mapsPromise;

function publicMapsConfig(value) {
  if (!value || value.provider !== "google-maps" || typeof value.apiKey !== "string" || value.apiKey.length < 20) {
    throw new Error("Google Maps has not been configured for this Homle deployment.");
  }
  return {
    apiKey: value.apiKey,
    language: value.language || "en-GB",
    region: value.region || "GB",
    mapId: value.mapId || ""
  };
}

export function loadGoogleMaps(value) {
  if (globalThis.google?.maps?.importLibrary) return Promise.resolve(globalThis.google.maps);
  if (mapsPromise) return mapsPromise;
  const config = publicMapsConfig(value);
  mapsPromise = new Promise((resolve, reject) => {
    const callbackName = `__homleGoogleMapsReady_${crypto.randomUUID().replaceAll("-", "")}`;
    const script = document.createElement("script");
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.searchParams.set("key", config.apiKey);
    url.searchParams.set("loading", "async");
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("v", "quarterly");
    url.searchParams.set("language", config.language);
    url.searchParams.set("region", config.region);
    script.src = url.href;
    script.async = true;
    const pageScript = document.querySelector('script[src^="/cleaner-jobs-map.js"]');
    if (pageScript?.nonce) script.nonce = pageScript.nonce;
    script.onerror = () => {
      delete globalThis[callbackName];
      mapsPromise = undefined;
      reject(new Error("Google Maps could not be loaded."));
    };
    globalThis[callbackName] = () => {
      delete globalThis[callbackName];
      resolve(globalThis.google.maps);
    };
    document.head.append(script);
  });
  return mapsPromise;
}
