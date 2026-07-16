import { readFile } from "node:fs/promises";
import { commaList, fixedPriceOptionsFromText, fixedPriceOptionsToText, moneyToPence, outwardPostcodes, penceToMoney, preservedServiceAreas, profileCompletion, profileCompletionDetails } from "../public/cleaner-profile-model.js";

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
assert(profileCompletion(complete) === 100 && profileCompletion({ ...complete, profilePhotoUrl: "http://unsafe.example/photo.jpg" }) === 100, "Client completion still depends on a Cleaner-supplied remote photo URL.");
const incompleteDetails = profileCompletionDetails({ ...complete, biography: "", services: [], hourlyRatePence: null });
assert(incompleteDetails.percent === 67 && incompleteDetails.completed === 6 && incompleteDetails.total === 9 && incompleteDetails.sections.find((section) => section.key === "introduction")?.missing.join(",") === "biography" && incompleteDetails.sections.find((section) => section.key === "services")?.missing.join(",") === "service,price" && incompleteDetails.sections.find((section) => section.key === "boundaries")?.complete === true, "Guided profile completion did not identify the exact next section and missing details.");

const [page, script, styles, server] = await Promise.all([
  readFile(new URL("../public/cleaner-profile.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-profile.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);

assert(server.includes('"/cleaner/profile": "cleaner-profile.html"') && page.includes('data-cleaner-profile-form hidden') && page.includes('data-profile-controls disabled') && page.includes('name="isPublic" type="checkbox" disabled'), "The Cleaner profile editor route or fail-closed initial controls are missing.");
assert(script.includes('fetch("/api/marketplace/cleaner/profile"') && script.includes('method: "PUT"') && script.includes('credentials: "same-origin"') && script.includes('"X-CSRF-Token": csrf') && script.includes('sessionStorage.getItem("tideway_csrf")'), "The editor is not bound to authenticated GET and CSRF-protected PUT profile routes.");
assert(script.includes('response.status === 401') && script.includes('response.status === 403') && script.includes('response.status === 404 || response.status === 503') && script.includes('beforeunload') && !script.includes('innerHTML'), "The editor lacks honest account/runtime states, unsaved-change protection or safe rendering.");
assert((page.match(/data-service-code=/g) || []).length === 6 && !page.includes('name="profilePhotoUrl"') && page.includes("public identity is handled automatically") && page.includes('name="biography"') && page.includes('name="serviceAreas"') && page.includes('name="equipmentSupplied"') && page.includes('name="productsSupplied"'), "The editor retained the external-photo friction or omitted a supported service or required profile field.");
assert(script.includes('preservedServiceAreas') && script.includes('if (publicControl.checked) publicControl.checked = false') && script.includes('Complete every required section before publishing'), "Profile editing can erase retained area coordinates or publish an incomplete profile.");
assert((page.match(/data-profile-step-target=/g) || []).length === 4 && (page.match(/data-profile-section=/g) || []).length === 4 && page.includes('data-profile-next-action') && page.includes('data-profile-continue="services"') && page.includes('data-profile-continue="boundaries"') && page.includes('data-profile-continue="review"') && page.includes('Save progress'), "The profile editor does not expose one guided next action, four bounded sections or progress saving.");
assert(page.includes('href="/cleaner/availability"') && page.includes("Set your real working times separately") && !page.includes('name="currentAvailabilityStatus"') && !script.includes("form.elements.currentAvailabilityStatus"), "The profile still asks for a vague duplicate availability decision instead of linking to exact working times.");
assert(script.includes('profileCompletionDetails') && script.includes('function selectProfileSection') && script.includes('profileNextAction.dataset.profileTarget') && script.includes('selectProfileSection(completion.sections.find') && script.includes('aria-current') && !script.includes('form.elements.profilePhotoUrl') && !script.includes('innerHTML'), "The profile editor does not open the first incomplete section, retained a remote-photo field or unsafely updates guided navigation.");
assert(styles.includes('.cleaner-editor-page') && styles.includes('.cleaner-editor-save') && styles.includes('.cleaner-profile-next') && styles.includes('.cleaner-profile-steps') && styles.includes('.cleaner-profile-continue') && styles.includes('grid-template-columns: 1fr 1fr;') && page.includes('aria-live="polite"') && page.includes('Skip to profile editor'), "The profile editor lacks responsive one-handed navigation, saving or accessible feedback.");

console.log("Cleaner profile UI tests passed: guided next action, exact completion sections, safe editing, publishing gate and mobile accessibility.");
