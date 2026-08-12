// The Landlord care record: validation and the earned-freeze streak rules.
//
// The reviewed retention concept sets the product logic this file guards:
// a turnaround "hit" is a booking locked in inside 24 hours, one freeze is
// earned per three completed cleans and bridges exactly one gap, the streak is
// the run of hits with frozen gaps bridged, and figures without enough history
// come through as null rather than being invented.
import { readFile } from "node:fs/promises";
import { createLandlordCareService } from "../src/marketplace/landlord-care-service.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const actor = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };

function serviceReturning(value) {
  return createLandlordCareService({ async get() { return value; } });
}

function baseSummary(overrides = {}) {
  return {
    generatedAt: "2026-08-12T12:00:00.000Z",
    privacyScope: "Own records plus anonymised cohort standing only.",
    totals: { completedCleanCount: 3, bookedValuePence: 19_800, roomsScannedCount: 41, propertyCount: 2, bookingCount: 4 },
    medianLagHours: 6,
    streakEvents: [false, true, false, true, true],
    benchmark: null,
    lastScan: null,
    ...overrides
  };
}

// Role isolation: the service refuses anyone who is not a landlord.
await serviceReturning(baseSummary()).get(actor);
let refused = null;
try { await serviceReturning(baseSummary()).get({ userId: actor.userId, roles: ["cleaner"] }); } catch (error) { refused = error; }
assert(refused?.statusCode === 403 && refused?.code === "landlord-required", "A non-Landlord actor was served a care record.");

// The design's own worked example: five events [miss, hit, miss, hit, hit]
// with one earned freeze (three completed cleans). The newest run is
// hit-hit-frozen-hit — a three-turnaround streak — and the oldest miss stays a
// plain miss because the only freeze is already holding the newer gap.
const example = await serviceReturning(baseSummary()).get(actor);
assert(example.streak.turnaroundCount === 3, `The worked streak example counts ${example.streak.turnaroundCount} turnarounds, not 3.`);
assert(example.streak.cells.join(",") === "miss,hit,frozen,hit,hit,empty,empty,empty", `The streak cells are wrong: ${example.streak.cells.join(",")}.`);
assert(example.streak.freezesEarned === 1 && example.streak.freezesUsed === 1 && example.streak.freezesAvailable === 0, "Freeze accounting is wrong for the worked example.");

// No history: every cell is an empty slot, the streak is zero, and the median
// lag stays null instead of being invented.
const empty = await serviceReturning(baseSummary({ totals: { completedCleanCount: 0, bookedValuePence: 0, roomsScannedCount: 0, propertyCount: 0, bookingCount: 0 }, medianLagHours: null, streakEvents: [] })).get(actor);
assert(empty.streak.turnaroundCount === 0 && empty.streak.cells.every((cell) => cell === "empty") && empty.streak.cells.length === 8, "An empty record does not render eight empty slots.");
assert(empty.medianLagHours === null && empty.benchmark === null && empty.lastScan === null, "An empty record invented a figure.");

// Freezes are earned one per three completed cleans and each bridges ONE gap:
// with two freezes, two separate gaps inside the run stay bridged.
const doubleFreeze = await serviceReturning(baseSummary({ totals: { completedCleanCount: 6, bookedValuePence: 40_000, roomsScannedCount: 10, propertyCount: 1, bookingCount: 8 }, streakEvents: [true, false, true, false, true, true] })).get(actor);
assert(doubleFreeze.streak.cells.join(",") === "hit,frozen,hit,frozen,hit,hit,empty,empty" && doubleFreeze.streak.turnaroundCount === 4 && doubleFreeze.streak.freezesUsed === 2, `Two earned freezes did not bridge two gaps: ${doubleFreeze.streak.cells.join(",")}.`);

// A gap with no freeze left breaks the streak; hits before the break are
// still drawn as hits but no longer counted.
const broken = await serviceReturning(baseSummary({ totals: { completedCleanCount: 2, bookedValuePence: 10_000, roomsScannedCount: 5, propertyCount: 1, bookingCount: 4 }, streakEvents: [true, true, false, true] })).get(actor);
assert(broken.streak.turnaroundCount === 1 && broken.streak.cells.join(",") === "hit,hit,miss,hit,empty,empty,empty,empty" && broken.streak.freezesEarned === 0, `An unbridged gap did not break the streak: ${broken.streak.cells.join(",")}.`);

// The benchmark only exists as an anonymised cohort of at least three
// portfolios; a smaller cohort is dropped rather than presented as a ranking.
const thinCohort = await serviceReturning(baseSummary({ benchmark: { cohortSize: 2, lagTopPercent: 50 } })).get(actor);
assert(thinCohort.benchmark === null, "A two-portfolio cohort was presented as an anonymised benchmark.");
const cohort = await serviceReturning(baseSummary({ benchmark: { cohortSize: 214, lagTopPercent: 18, coverageCohortSize: 214, coverageTopPercent: 52, coverageShare: 83, latestScannedRooms: 10, latestPlannedRooms: 12, closingGapReachesTopQuarter: true } })).get(actor);
assert(cohort.benchmark.lagTopPercent === 18 && cohort.benchmark.coverageTopPercent === 52 && cohort.benchmark.closingGapReachesTopQuarter === true, "A healthy cohort's standings were not projected.");

// Corrupt repository payloads are refused, never partially rendered.
let corrupt = null;
try { await serviceReturning(baseSummary({ totals: { completedCleanCount: -1, bookedValuePence: 0, roomsScannedCount: 0, propertyCount: 0, bookingCount: 0 } })).get(actor); } catch (error) { corrupt = error; }
assert(corrupt instanceof Error, "A negative completed-clean count was accepted.");
let corruptEvents = null;
try { await serviceReturning(baseSummary({ streakEvents: ["yes"] })).get(actor); } catch (error) { corruptEvents = error; }
assert(corruptEvents instanceof Error, "Non-boolean streak events were accepted.");

// The last scan is projected with bounded text and its honest diff fields.
const scanned = await serviceReturning(baseSummary({ lastScan: { propertyName: "House in London", capturedAt: "2026-08-12T11:56:00.000Z", roomCount: 12, taskCount: 2, taskRoomNames: ["Kitchen", "Hallway", "Extra"], unchangedRoomCount: 10, newObjects: [{ label: "Shower screen", roomName: "Ensuite", evidence: "white deposits around the base" }], previousCapturedAt: "2026-03-02T10:00:00.000Z" } })).get(actor);
assert(scanned.lastScan.taskRoomNames.length === 2 && scanned.lastScan.newObjects[0].label === "Shower screen" && scanned.lastScan.previousCapturedAt === "2026-03-02T10:00:00.000Z", "The last-scan projection lost its bounded fields.");

// The SQL function, its grant and the migration lock ship together.
const migration = await readFile(new URL("../db/migrations/098_landlord_care_summary.sql", import.meta.url), "utf8");
const grants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const lock = JSON.parse(await readFile(new URL("../db/migration-lock.json", import.meta.url), "utf8"));
assert(migration.includes("SECURITY DEFINER") && migration.includes("has_role('landlord')") && migration.includes("get_landlord_care_summary"), "The care-summary SQL function is missing its landlord guard.");
assert(grants.includes("tideway_private.get_landlord_care_summary() TO tideway_app"), "The care-summary function is not granted to the runtime role.");
assert(lock.migrations.some((entry) => entry.file === "098_landlord_care_summary.sql"), "Migration 098 is not in the migration lock.");

console.log("Landlord care-summary tests passed: role isolation, earned-freeze streak rules, honest empty states, anonymised-benchmark boundary and shipped database assets.");
