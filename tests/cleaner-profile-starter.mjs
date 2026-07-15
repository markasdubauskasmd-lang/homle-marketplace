import assert from "node:assert/strict";
import {
  cleanerEquipmentPlanLabel,
  cleanerProfileStarterCaptured,
  normalizeCleanerProfileStarter,
  normalizeOptionalCleanerProfileStarter
} from "../cleaner-profile-starter.mjs";

const valid = normalizeCleanerProfileStarter({
  professionalBio: "I clean rental homes carefully and work through an agreed room checklist.",
  languages: "English, Polish, english",
  equipmentPlan: "confirm-per-opportunity"
});
assert.equal(valid.professionalBio.startsWith("I clean"), true);
assert.deepEqual(valid.languages, ["English", "Polish"]);
assert.equal(valid.equipmentPlan, "confirm-per-opportunity");
assert.equal(cleanerProfileStarterCaptured(valid), true);
assert.equal(cleanerEquipmentPlanLabel(valid.equipmentPlan), "Equipment and products must be agreed for each opportunity");

assert.throws(() => normalizeCleanerProfileStarter({ ...valid, professionalBio: "Too short" }), /40 to 600/);
assert.throws(() => normalizeCleanerProfileStarter({ ...valid, languages: "" }), /at least one language/);
assert.throws(() => normalizeCleanerProfileStarter({ ...valid, languages: Array.from({ length: 11 }, (_, index) => `Language ${index}`) }), /no more than 10/);
assert.throws(() => normalizeCleanerProfileStarter({ ...valid, languages: ["x".repeat(41)] }), /1 to 40/);
assert.throws(() => normalizeCleanerProfileStarter({ ...valid, equipmentPlan: "I own everything" }), /supported equipment/);
assert.equal(cleanerProfileStarterCaptured({}), false);
assert.deepEqual(normalizeOptionalCleanerProfileStarter({}), { professionalBio: "", languages: [], equipmentPlan: "" });
assert.deepEqual(normalizeOptionalCleanerProfileStarter(valid), valid);
assert.throws(() => normalizeOptionalCleanerProfileStarter({ professionalBio: valid.professionalBio }), /at least one language/);

console.log("cleaner profile starter tests passed");
