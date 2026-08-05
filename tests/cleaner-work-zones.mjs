import assert from "node:assert/strict";
import { normalizedWorkZones, toggledWorkZones, ukWorkZones, workZoneName } from "../public/cleaner-work-zones.js";

assert.equal(ukWorkZones.length, 12, "The clickable map must cover the twelve approved UK work zones.");
assert.equal(new Set(ukWorkZones.map((zone) => zone.code)).size, ukWorkZones.length, "Every UK work zone needs a unique stable code.");
assert(ukWorkZones.every((zone) => zone.name && zone.shortLabel && zone.path.startsWith("M") && Number.isFinite(zone.labelX) && Number.isFinite(zone.labelY)), "Every UK work zone needs a visible shape and label.");
assert.deepEqual(normalizedWorkZones(["scotland", "SCOTLAND", "not-a-zone", "wales"]), ["scotland", "wales"]);
assert.deepEqual(toggledWorkZones(["scotland"], "wales"), ["scotland", "wales"]);
assert.deepEqual(toggledWorkZones(["scotland", "wales"], "scotland"), ["wales"]);
assert.deepEqual(toggledWorkZones(["wales"], "not-a-zone"), ["wales"]);
assert.equal(workZoneName("london"), "London");

console.log("Cleaner UK work-zone tests passed: complete zone set, stable shapes, normalization, selection and removal.");
