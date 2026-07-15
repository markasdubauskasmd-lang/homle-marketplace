import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanerApplicationPreview, equipmentLabels, serviceLabels } from "../public/cleaner-application-preview.js";
import { equipmentPlans } from "../cleaner-profile-starter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, styles] = await Promise.all([
  readFile(path.join(root, "public", "index.html"), "utf8"),
  readFile(path.join(root, "public", "app.js"), "utf8"),
  readFile(path.join(root, "public", "styles.css"), "utf8")
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const blank = cleanerApplicationPreview({
  email: "must-not-appear@example.com",
  phone: "07123456789",
  postcode: "SW1A 1AA",
  rating: 5,
  verified: true,
  price: 10
});
assert(blank.name === "Your name" && blank.initials === "YOU" && blank.completion.completed === 0 && blank.completion.total === 8, "A blank application preview did not remain truthful and incomplete.");
assert(!["email", "phone", "postcode", "rating", "verified", "price"].some((key) => Object.hasOwn(blank, key)), "The preview projection leaked private contact/location data or invented marketplace claims.");
assert(!JSON.stringify(blank).includes("must-not-appear@example.com") && !JSON.stringify(blank).includes("07123456789") && !JSON.stringify(blank).includes("SW1A 1AA"), "Injected private application data reached the presentation model.");

const complete = cleanerApplicationPreview({
  fullName: "  Alex   Morgan  ",
  travelAreas: "SW1A, SW4",
  experience: "3–5 years",
  professionalBio: "I prepare rental homes carefully and confirm every agreed task before I begin.",
  languages: "English, Polish, english",
  equipmentPlan: "confirm-per-opportunity",
  firstAvailableDate: "2099-07-20",
  firstAvailableStartTime: "08:00",
  firstAvailableEndTime: "15:00",
  serviceTurnovers: true,
  serviceDeepCleans: true
});
assert(complete.name === "Alex   Morgan" && complete.initials === "AM", "Name normalization or initials are not stable.");
assert(JSON.stringify(complete.services) === JSON.stringify(["Rental turnovers", "Deep cleans"]), "Selected services were not projected in a stable allowlisted order.");
assert(JSON.stringify(complete.languages) === JSON.stringify(["English", "Polish"]), "Languages were not trimmed and deduplicated safely.");
assert(complete.equipment === equipmentPlans["confirm-per-opportunity"] && complete.firstAvailability.includes("applicant supplied, unconfirmed"), "Equipment or first-availability copy implied unsupported confirmation.");
assert(complete.completion.completed === 8 && complete.completion.percent === 100 && complete.completion.missing.length === 0, "A complete presentation did not reach application-preview readiness.");

const incomplete = cleanerApplicationPreview({ ...complete, equipmentPlan: "verified-and-supplied", travelAreas: "London" });
assert(incomplete.equipment === "Not added yet" && incomplete.completion.missing.includes("equipment plan") && incomplete.completion.missing.includes("matchable work areas"), "Unsupported equipment or vague travel coverage was presented as ready.");

assert(JSON.stringify(equipmentLabels) === JSON.stringify(equipmentPlans), "The browser preview equipment labels drifted from server normalization.");
for (const [name, label] of Object.entries(serviceLabels)) {
  assert(html.includes(`name="${name}"`) && html.includes(label), `The ${name} preview mapping drifted from the Cleaner form.`);
}
assert(html.includes("Private application preview") && html.includes("Unverified · not published") && html.includes("This is not a public profile, approval, verification, job offer or availability confirmation."), "The application preview is missing its truthful private-state boundary.");
assert(!/<(?:input|select|textarea)[^>]*data-cleaner-preview/i.test(html), "The presentation preview added a form control that could alter the submission contract.");
assert(app.includes("readCleanerPreviewInput") && app.includes("cleanerApplicationPreview(readCleanerPreviewInput(form))") && app.includes("serviceList.replaceChildren") && app.includes("chip.textContent = label") && !app.includes("preview.innerHTML"), "The live preview is not rendered through the privacy-safe text-only projection.");
assert(!/value\("(?:email|phone|postcode)"\)/.test(app.slice(app.indexOf("function readCleanerPreviewInput"), app.indexOf("function enhanceCleanerApplicationPreview"))), "The live preview reader includes private contact or home-postcode fields.");
assert(styles.includes(".cleaner-application-preview") && styles.includes(".cleaner-application-preview-details") && styles.includes(".cleaner-application-preview-readiness") && styles.includes("grid-template-columns: 1fr;"), "The application preview is missing responsive mobile treatment.");

console.log("Cleaner application preview tests passed: truthful applicant projection, private-field isolation, allowlisted claims, live text-only rendering and mobile layout.");
