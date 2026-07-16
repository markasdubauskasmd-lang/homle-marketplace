import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, styles, draft] = await Promise.all([
  readFile(path.join(root, "public", "index.html"), "utf8"),
  readFile(path.join(root, "public", "app.js"), "utf8"),
  readFile(path.join(root, "public", "styles.css"), "utf8"),
  readFile(path.join(root, "public", "cleaner-application-draft.js"), "utf8")
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cleanerForm = html.slice(html.indexOf('id="cleaner-application"'), html.indexOf("</article>", html.indexOf('id="cleaner-application"')));
const stages = cleanerForm.match(/data-guided-step=/g) || [];
const requiredNames = [
  "fullName",
  "postcode",
  "email",
  "phone",
  "travelAreas",
  "experience",
  "firstAvailableDate",
  "firstAvailableStartTime",
  "firstAvailableEndTime",
  "rightToWork",
  "consent"
];

assert(stages.length === 3, "The Cleaner application no longer has three short guided stages.");
for (const name of requiredNames) {
  assert(new RegExp(`name="${name}"[^>]*required`).test(cleanerForm), `The minimum ${name} application evidence is no longer required.`);
}
assert(cleanerForm.includes("Cleaning work you want") && cleanerForm.includes("choose at least one") && cleanerForm.includes("data-service-group"), "The minimum service preference is not collected or explained.");
assert(cleanerForm.includes("Your professional profile comes later through your private tracker") && cleanerForm.includes("Your profile comes next") && cleanerForm.includes("Nothing is published automatically"), "The shortened application does not explain the private profile follow-up.");
assert(cleanerForm.includes('class="application-optional-fields"') && cleanerForm.includes("Add usual availability or a note") && cleanerForm.includes('name="availability"') && cleanerForm.includes('name="notes"'), "Nonessential availability detail and notes are not in one optional disclosure.");
assert(cleanerForm.includes("Apply and open my tracker"), "The application does not name its single continuation clearly.");
assert(!/(?:name="(?:professionalBio|languages|equipmentPlan)"|data-cleaner-application-preview|Private application preview|data-cleaner-preview)/.test(cleanerForm), "The initial Cleaner application still asks for or renders professional-profile work.");
assert(!app.includes("cleaner-application-preview") && !app.includes("readCleanerPreviewInput") && !app.includes("enhanceCleanerApplicationPreview"), "The application still downloads and runs the removed profile-preview controller.");
assert(!/(?:professionalBio|languages|equipmentPlan)/.test(draft), "The recovery draft still retains removed profile fields.");
assert(styles.includes(".application-optional-fields") && styles.includes(".application-next-step") && !styles.includes(".cleaner-application-preview") && !styles.includes(".profile-starter-panel"), "The streamlined application styling is missing or dead preview styling remains shipped.");

console.log("Cleaner application journey tests passed: minimum first contact, optional-detail disclosure, private profile follow-up and removed preview overhead.");
