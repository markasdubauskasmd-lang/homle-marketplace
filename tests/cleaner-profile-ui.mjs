import { readFile } from "node:fs/promises";
import { commaList, fixedPriceOptionsFromText, fixedPriceOptionsToText, moneyToPence, outwardPostcodes, penceToMoney, preservedServiceAreas, profileCompletion } from "../public/cleaner-profile-model.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function throws(operation, expected) {
  try { operation(); } catch (error) { return String(error.message).includes(expected); }
  return false;
}

assert(moneyToPence("24.50", "Rate", true) === 2450 && penceToMoney(2450) === "24.50" && moneyToPence("", "Rate") === null, "Pound/pence profile conversion is not exact.");
assert(throws(() => moneyToPence("24.999", "Rate", true), "two decimal") && throws(() => moneyToPence("0", "Rate", true), "between"), "Invalid or zero profile pricing was accepted.");
const options = fixedPriceOptionsFromText("Studio turnover: 65.00\nTwo-bedroom turnover: 95");
assert(options[0].pricePence === 6500 && options[1].label === "Two-bedroom turnover" && fixedPriceOptionsToText(options).includes("95.00") && throws(() => fixedPriceOptionsFromText("Missing price"), "must use"), "Fixed-price profile parsing or lossless display failed.");
assert(commaList("English, Spanish, English", 20, 60, "Language").join(",") === "English,Spanish" && outwardPostcodes("sw2, EC1A").join(",") === "SW2,EC1A" && throws(() => outwardPostcodes("London"), "outward postcodes"), "Profile list deduplication or UK service-area validation failed.");

const preserved = preservedServiceAreas(["SW2", "EC1A"], [{ outwardPostcode: "SW2", latitude: "51.44", longitude: "-0.12" }, { outwardPostcode: "N1", latitude: 51.5, longitude: -0.08 }]);
assert(preserved[0].latitude === 51.44 && preserved[0].longitude === -0.12 && preserved[1].latitude === null && preserved[1].longitude === null && preserved.every((area) => area.outwardPostcode !== "N1"), "Editing outward codes lost matched private coordinates or retained a removed area.");

const complete = {
  profilePhotoUrl: "https://images.example/cleaner.jpg",
  biography: "A careful Cleaner who communicates clearly and follows the agreed checklist.",
  services: [{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 2400 }],
  hourlyRatePence: 2400,
  fixedPriceOptions: [],
  travelRadiusKm: 12,
  serviceAreas: [{ outwardPostcode: "SW2", latitude: null, longitude: null }],
  yearsExperience: 0,
  languages: ["English"],
  equipmentSupplied: ["Vacuum cleaner"],
  productsSupplied: [],
  residentialPreference: true,
  commercialPreference: false
};
assert(profileCompletion(complete) === 100 && profileCompletion({ ...complete, profilePhotoUrl: "http://unsafe.example/photo.jpg" }) === 90, "Client completion does not mirror the ten server profile requirements or accepted an insecure photo URL.");

const [page, script, styles, server] = await Promise.all([
  readFile(new URL("../public/cleaner-profile.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-profile.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);

assert(server.includes('"/cleaner/profile": "cleaner-profile.html"') && page.includes('data-cleaner-profile-form hidden') && page.includes('data-profile-controls disabled') && page.includes('name="isPublic" type="checkbox" disabled'), "The Cleaner profile editor route or fail-closed initial controls are missing.");
assert(script.includes('fetch("/api/marketplace/cleaner/profile"') && script.includes('method: "PUT"') && script.includes('credentials: "same-origin"') && script.includes('"X-CSRF-Token": csrf') && script.includes('sessionStorage.getItem("tideway_csrf")'), "The editor is not bound to authenticated GET and CSRF-protected PUT profile routes.");
assert(script.includes('response.status === 401') && script.includes('response.status === 403') && script.includes('response.status === 404 || response.status === 503') && script.includes('beforeunload') && !script.includes('innerHTML'), "The editor lacks honest account/runtime states, unsaved-change protection or safe rendering.");
assert((page.match(/data-service-code=/g) || []).length === 6 && page.includes('name="profilePhotoUrl"') && page.includes('name="biography"') && page.includes('name="serviceAreas"') && page.includes('name="equipmentSupplied"') && page.includes('name="productsSupplied"'), "The editor omits a supported service or required complete-profile field.");
assert(script.includes('preservedServiceAreas') && script.includes('if (publicControl.checked) publicControl.checked = false') && script.includes('Complete every required section before publishing'), "Profile editing can erase retained area coordinates or publish an incomplete profile.");
assert(styles.includes('.cleaner-editor-page') && styles.includes('.cleaner-editor-save') && page.includes('aria-live="polite"') && page.includes('Skip to profile editor'), "The profile editor lacks responsive one-handed saving or accessible feedback.");

console.log("Cleaner profile UI tests passed: exact money/list models, coordinate preservation, complete-field editing, fail-closed auth, CSRF saving, publish gating and mobile accessibility.");
