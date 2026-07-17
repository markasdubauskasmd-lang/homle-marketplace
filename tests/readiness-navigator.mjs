import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await import(`${pathToFileURL(path.join(root, "public", "readiness-navigator.js")).href}?test=${Date.now()}`);
const navigator = globalThis.TidewayReadinessNavigator;

const readiness = {
  checks: { identity: false, contact: false, pilotArea: true, economics: false, insurance: false, payments: false, operatingRules: false },
  missing: {
    identity: ["legal owner name", "business structure"],
    contact: ["valid support email", "valid public HTTPS website origin"],
    pilotArea: [],
    economics: ["positive customer hourly rate", "founder contribution-margin floor", "founder minimum contribution per booking", "conservative travel distance for distance-based pricing"],
    insurance: ["insurance marked active and verified"],
    payments: ["payment provider marked live and verified"],
    operatingRules: ["decided cleaner engagement model"]
  },
  next: { key: "identity", label: "Legal identity", missing: ["legal owner name", "business structure"] }
};
const unchanged = JSON.stringify(readiness);
const model = navigator.navigationModel(readiness);
assert.equal(model.areas.length, 7);
assert.deepEqual(model.nextTarget, { label: "legal owner name", fieldName: "legalOwnerName" });
assert.deepEqual(model.areas.find((area) => area.key === "economics")?.target, { label: "positive customer hourly rate", fieldName: "customerHourlyRate" });
assert.equal(model.areas.find((area) => area.key === "pilotArea")?.target, null);
assert.equal(model.areas.find((area) => area.key === "pilotArea")?.complete, true);
assert.equal(JSON.stringify(readiness), unchanged, "Navigation must not change founder readiness evidence.");
assert.equal(navigator.firstMappedRequirement(["unknown requirement", "valid support phone"])?.fieldName, "supportPhone");
assert.equal(navigator.firstMappedRequirement(["unknown requirement"]), null);

const [adminHtml, adminJs] = await Promise.all([
  readFile(path.join(root, "public", "admin.html"), "utf8"),
  readFile(path.join(root, "public", "admin.js"), "utf8")
]);
const formNames = new Set([...adminHtml.matchAll(/\bname="([A-Za-z0-9]+)"/g)].map((match) => match[1]));
for (const fieldName of new Set(Object.values(navigator.requirementFields))) assert(formNames.has(fieldName), `Mapped readiness field is missing from the setup form: ${fieldName}`);
assert.equal((adminHtml.match(/data-readiness-action/g) || []).length, 7);
assert.equal((adminHtml.match(/data-readiness-action type="button"/g) || []).length, 7);
assert(adminJs.includes("focusReadinessRequirement") && adminJs.includes("areaButton.onclick"));
assert(!adminJs.includes("form.requestSubmit") && !adminJs.includes("form.submit()"), "Readiness navigation must never submit founder decisions automatically.");

console.log("readiness navigator tests passed");
