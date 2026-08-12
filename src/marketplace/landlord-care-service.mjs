/**
 * The Landlord care record behind the Home view's "Your care record" section.
 *
 * The repository returns raw facts from the landlord's own bookings, scans and
 * booking timestamps. This service validates every field and derives the one
 * piece of product logic the reviewed retention concept defines:
 *
 * - A "turnaround" is a booking whose start was locked in within 24 hours of
 *   the booking being created (a hit).
 * - A streak freeze is EARNED, never sold: one per three completed cleans. A
 *   freeze bridges a single gap so one slow booking does not erase the record.
 * - The streak is the run of hits, newest backwards, with frozen gaps bridged.
 *
 * Figures with too little history come through as null and the page says so —
 * nothing is estimated, seeded or reset on a schedule.
 */

function integer(value, label, { maximum = 10_000_000 } = {}) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${label} is unavailable.`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

function optionalTimestamp(value, label) {
  return value == null ? null : timestamp(value, label);
}

function boundedText(value, maximum) {
  return String(value ?? "").slice(0, maximum);
}

/** Streak cells, oldest first, padded with "empty" to eight slots. */
function deriveStreak(events, freezesEarned) {
  const cells = [];
  let streak = 0;
  let freezesUsed = 0;
  let alive = true;
  // Walk newest -> oldest so freezes protect the current run, then restore
  // display order. Older misses beyond the broken run stay plain misses.
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index] === true) {
      cells.unshift("hit");
      if (alive) streak += 1;
    } else if (alive && freezesUsed < freezesEarned) {
      freezesUsed += 1;
      cells.unshift("frozen");
    } else {
      alive = false;
      cells.unshift("miss");
    }
  }
  while (cells.length < 8) cells.push("empty");
  return Object.freeze({
    turnaroundCount: streak,
    cells: Object.freeze(cells),
    freezesEarned,
    freezesUsed,
    freezesAvailable: Math.max(0, freezesEarned - freezesUsed)
  });
}

export function createLandlordCareService(repository) {
  if (!repository || typeof repository.get !== "function") throw new TypeError("A complete Landlord care repository is required.");
  return Object.freeze({
    async get(actor) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("landlord")) throw Object.assign(new Error("A Homle Landlord account is required."), { statusCode: 403, code: "landlord-required" });
      const value = await repository.get(actor);
      if (!value || typeof value !== "object") throw new Error("The care record is unavailable.");

      const rawTotals = value.totals;
      if (!rawTotals || typeof rawTotals !== "object") throw new Error("Care totals are unavailable.");
      const totals = Object.freeze({
        completedCleanCount: integer(rawTotals.completedCleanCount, "Completed clean count"),
        bookedValuePence: integer(rawTotals.bookedValuePence, "Booked value", { maximum: 1_000_000_000_000 }),
        roomsScannedCount: integer(rawTotals.roomsScannedCount, "Rooms scanned count"),
        propertyCount: integer(rawTotals.propertyCount, "Property count"),
        bookingCount: integer(rawTotals.bookingCount, "Booking count")
      });

      const medianLagHours = value.medianLagHours == null ? null : Number(value.medianLagHours);
      if (medianLagHours != null && (!Number.isFinite(medianLagHours) || medianLagHours < 0)) throw new Error("The booking-lag median is unavailable.");

      const rawEvents = Array.isArray(value.streakEvents) ? value.streakEvents : [];
      if (rawEvents.length > 8 || rawEvents.some((event) => typeof event !== "boolean")) throw new Error("The turnaround record is unavailable.");
      const streak = deriveStreak(rawEvents, Math.floor(totals.completedCleanCount / 3));

      let benchmark = null;
      if (value.benchmark != null) {
        if (typeof value.benchmark !== "object") throw new Error("The care benchmark is unavailable.");
        const cohortSize = integer(value.benchmark.cohortSize, "Benchmark cohort size");
        if (cohortSize >= 3) {
          benchmark = Object.freeze({
            cohortSize,
            lagTopPercent: value.benchmark.lagTopPercent == null ? null : Math.min(100, Math.max(1, integer(value.benchmark.lagTopPercent, "Booking-lag standing", { maximum: 100 }))),
            coverageCohortSize: value.benchmark.coverageCohortSize == null ? null : integer(value.benchmark.coverageCohortSize, "Coverage cohort size"),
            coverageTopPercent: value.benchmark.coverageTopPercent == null ? null : Math.min(100, Math.max(1, integer(value.benchmark.coverageTopPercent, "Scan-coverage standing", { maximum: 100 }))),
            coverageShare: value.benchmark.coverageShare == null ? null : integer(value.benchmark.coverageShare, "Scan-coverage share", { maximum: 100 }),
            latestScannedRooms: value.benchmark.latestScannedRooms == null ? null : integer(value.benchmark.latestScannedRooms, "Latest scanned rooms"),
            latestPlannedRooms: value.benchmark.latestPlannedRooms == null ? null : integer(value.benchmark.latestPlannedRooms, "Latest planned rooms"),
            closingGapReachesTopQuarter: value.benchmark.closingGapReachesTopQuarter === true
          });
        }
      }

      let lastScan = null;
      if (value.lastScan != null) {
        if (typeof value.lastScan !== "object") throw new Error("The last scan record is unavailable.");
        const taskRoomNames = Array.isArray(value.lastScan.taskRoomNames) ? value.lastScan.taskRoomNames : [];
        const newObjects = Array.isArray(value.lastScan.newObjects) ? value.lastScan.newObjects : [];
        lastScan = Object.freeze({
          propertyName: boundedText(value.lastScan.propertyName, 160),
          capturedAt: timestamp(value.lastScan.capturedAt, "Scan capture time"),
          roomCount: integer(value.lastScan.roomCount, "Scanned room count"),
          taskCount: integer(value.lastScan.taskCount, "Scan task count"),
          taskRoomNames: Object.freeze(taskRoomNames.slice(0, 2).map((name) => boundedText(name, 120))),
          unchangedRoomCount: integer(value.lastScan.unchangedRoomCount, "Unchanged room count"),
          newObjects: Object.freeze(newObjects.slice(0, 2).map((object) => Object.freeze({
            label: boundedText(object?.label, 40),
            roomName: boundedText(object?.roomName, 120),
            evidence: boundedText(object?.evidence, 200)
          }))),
          previousCapturedAt: optionalTimestamp(value.lastScan.previousCapturedAt, "Previous scan capture time")
        });
      }

      return Object.freeze({
        generatedAt: timestamp(value.generatedAt, "Care record generation time"),
        privacyScope: boundedText(value.privacyScope, 300),
        totals,
        medianLagHours,
        streak,
        benchmark,
        lastScan
      });
    }
  });
}
