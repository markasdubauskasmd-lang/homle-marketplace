import assert from "node:assert/strict";

await import(`../public/scope-time-breakdown.js?test=${Date.now()}`);
const worksheet = globalThis.TidewayScopeTimeBreakdown;
const brief = {
  photos: [{ area: "Kitchen" }, { area: "Kitchen" }, { area: "Bathroom 1" }],
  checklist: ["Kitchen: Wipe worktops", "Kitchen: Do not clean inside the oven", "Bathroom 1: Remove limescale"]
};

assert.deepEqual(worksheet.scopeTimeAreas(brief), [
  { area: "Kitchen", visualCount: 2, taskCount: 1 },
  { area: "Bathroom 1", visualCount: 1, taskCount: 1 }
]);

const built = worksheet.buildScopeTimeBreakdown({
  expectedAreas: worksheet.scopeTimeAreas(brief),
  areaMinutes: [{ area: "Kitchen", minutes: 55 }, { area: "Bathroom 1", minutes: 35 }],
  overheadMinutes: 10
});
assert.equal(built.valid, true);
assert.equal(built.breakdown.totalMinutes, 100);
assert.equal(built.breakdown.roundedHours, 1.75, "Reviewed hours must round up to a quarter-hour without understating work.");
assert.equal(worksheet.validateScopeTimeBreakdown({ brief, breakdown: built.breakdown, expectedHours: 1.75 }).valid, true);

assert.equal(worksheet.buildScopeTimeBreakdown({ expectedAreas: [{ area: "Kitchen" }], areaMinutes: [{ area: "Kitchen", minutes: "" }], overheadMinutes: 0 }).valid, false);
assert.equal(worksheet.buildScopeTimeBreakdown({ expectedAreas: [{ area: "Kitchen" }], areaMinutes: [{ area: "Kitchen", minutes: 17 }], overheadMinutes: 0 }).valid, false, "Room time must use auditable five-minute increments.");
assert.equal(worksheet.buildScopeTimeBreakdown({ expectedAreas: [{ area: "Kitchen" }, { area: "Bathroom" }], areaMinutes: [{ area: "Kitchen", minutes: 480 }, { area: "Bathroom", minutes: 480 }], overheadMinutes: 5 }).valid, false, "A scope larger than one supported visit must not become an unusable quote.");
assert.equal(worksheet.validateScopeTimeBreakdown({ brief, breakdown: { ...built.breakdown, totalMinutes: 95 }, expectedHours: 1.75 }).valid, false, "A forged total must fail.");
assert.equal(worksheet.validateScopeTimeBreakdown({ brief, breakdown: { ...built.breakdown, areas: [{ area: "Kitchen", minutes: 90 }] }, expectedHours: 1.75 }).valid, false, "A missing room must fail.");
assert.equal(worksheet.validateScopeTimeBreakdown({ brief, breakdown: built.breakdown, expectedHours: 1.5 }).valid, false, "Hours cannot be lower than the worksheet result.");

console.log("scope time breakdown tests passed");
