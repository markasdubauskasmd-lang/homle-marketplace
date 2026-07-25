import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { arrivalWindows, bookableDays, canLeaveStep, durationChoices } from "../public/landlord-journey-model.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The day the Landlord taps must be the day that gets booked.
//
// `iso` used to come from `toISOString()` (UTC) while the label beside it came from
// `getDate()`/`toLocaleDateString()` (local). For any local time before UTC midnight the
// two disagreed: at 00:30 in London the button read "Thu 2" and submitted the 1st. The
// journey only checks `Boolean(draft.date)`, so nothing downstream caught it — the
// cleaner would simply have been booked for the wrong day.
//
// Timezone is a process-wide setting, so each zone is checked in its own child process.
const zones = ["Europe/London", "Europe/Paris", "America/New_York", "Pacific/Auckland", "Asia/Kolkata", "UTC"];

const probe = `
import { bookableDays } from ${JSON.stringify(new URL("../public/landlord-journey-model.js", import.meta.url).href)};
// 00:30 local: before UTC midnight for every zone ahead of UTC, after it for those behind.
const at = new Date(process.env.PROBE_AT);
const days = bookableDays(at, 14);
const problems = [];
let previous = null;
for (const day of days) {
  // Midday avoids any DST edge when re-reading the date back.
  const parsed = new Date(day.iso + "T12:00:00");
  if (String(parsed.getDate()) !== day.dayOfMonth) problems.push("label " + day.weekday + " " + day.dayOfMonth + " submits " + day.iso);
  else if (parsed.toLocaleDateString("en-GB", { weekday: "short" }) !== day.weekday) problems.push("label " + day.weekday + " " + day.dayOfMonth + " submits " + day.iso);
  // Consecutiveness must be judged inside the probe's own timezone: adding fixed
  // 24-hour durations skips a day at spring-forward and repeats one at autumn-back,
  // and only a run in that zone can see it.
  //
  // Compared as calendar dates, not elapsed time. Local noon to local noon is 23 or 25
  // hours across a daylight-saving change, so a millisecond difference would call a
  // perfectly consecutive pair a gap — which it did, for America/New_York on 1 November.
  if (previous) {
    const expected = new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() + 1, 12);
    const expectedIso = expected.getFullYear() + "-" + String(expected.getMonth() + 1).padStart(2, "0") + "-" + String(expected.getDate()).padStart(2, "0");
    if (day.iso !== expectedIso) problems.push("expected " + expectedIso + " but got " + day.iso);
  }
  previous = parsed;
}
if (new Set(days.map((day) => day.iso)).size !== days.length) problems.push("duplicate day in " + days.map((day) => day.iso).join(" "));
// The first day offered must be tomorrow, in local calendar terms. This is what catches
// the daylight-saving defect: adding a fixed 24 hours to a late-evening start the night
// before a spring-forward lands on the day *after* tomorrow, so the whole run is shifted
// by one and the sequence still looks perfectly consecutive.
const tomorrow = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1, 12);
const tomorrowIso = tomorrow.getFullYear() + "-" + String(tomorrow.getMonth() + 1).padStart(2, "0") + "-" + String(tomorrow.getDate()).padStart(2, "0");
if (days.length && days[0].iso !== tomorrowIso) problems.push("first day should be " + tomorrowIso + " but is " + days[0].iso);
process.stdout.write(JSON.stringify(problems));
`;

for (const zone of zones) {
  for (const at of [
    "2026-07-01T00:30:00Z", "2026-07-01T23:30:00Z", "2026-01-15T00:05:00Z",
    // Either side of the European spring-forward (29 March 2026) and autumn-back (25 October).
    "2026-03-28T23:30:00Z", "2026-03-29T00:30:00Z", "2026-03-29T23:30:00Z",
    "2026-10-24T00:30:00Z", "2026-10-25T00:30:00Z", "2026-10-25T23:30:00Z",
    // And the US transitions, which fall on different dates.
    "2026-03-07T23:30:00Z", "2026-11-01T00:30:00Z"
  ]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TZ: zone, PROBE_AT: at }
    });
    assert.equal(result.status, 0, `The probe failed in ${zone}: ${result.stderr}`);
    const problems = JSON.parse(result.stdout || "[]");
    assert.deepEqual(problems, [], `In ${zone} starting ${at} the offered days are wrong:\n  ${problems.join("\n  ")}`);
  }
}

/* ── The shape of what it returns ── */

const days = bookableDays(new Date("2026-07-01T12:00:00Z"), 14);
assert.equal(days.length, 14, "The wrong number of bookable days was offered.");
assert.ok(Object.isFrozen(days) && days.every(Object.isFrozen), "Bookable days are mutable.");
// Never today, and never a day already gone.
const today = new Date("2026-07-01T12:00:00Z");
assert.ok(days.every((day) => new Date(`${day.iso}T12:00:00Z`) > today), "A day that has already passed was offered as bookable.");
// Strictly consecutive, so no day is skipped or repeated.
for (let index = 1; index < days.length; index += 1) {
  // Parsed as UTC noon deliberately: this comparison is about the calendar sequence the
  // strings describe, independent of any local daylight-saving change.
  const previous = new Date(`${days[index - 1].iso}T12:00:00Z`);
  const current = new Date(`${days[index].iso}T12:00:00Z`);
  assert.equal(current - previous, 86_400_000, `Bookable days are not consecutive around ${days[index].iso}.`);
}
// Every date must be one a date input will accept.
assert.ok(days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.iso)), "A bookable day is not a valid ISO calendar date.");

/* ── Defensive input ── */

assert.equal(bookableDays(new Date("not a date"), 3).length, 3, "An invalid start date was not replaced with now.");
assert.equal(bookableDays("2026-07-01", 3).length, 3, "A non-Date start was not replaced with now.");
assert.equal(bookableDays(undefined, 0).length, 0, "A zero count still offered days.");

/* ── The step gate accepts a generated day, and still requires the rest ── */

// The "when" step needs a date, an arrival window, a frequency and a duration. What
// matters here is that a day this module generates is accepted as the date part — a
// malformed `iso` would fail the gate and strand the Landlord on the step.
const when = { date: days[0].iso, time: arrivalWindows[0], frequency: "one-time", durationMinutes: durationChoices[0] };
assert.equal(canLeaveStep("when", when), true, `A day this module generated was rejected by the when step: ${JSON.stringify(when)}`);
assert.equal(canLeaveStep("when", { ...when, date: "" }), false, "The when step passed with no chosen day.");

console.log(`Landlord journey date tests passed: across ${zones.length} timezones and eleven instants including both daylight-saving transitions, every offered day submits the date its own label shows; days are consecutive, never in the past, frozen and ISO-shaped.`);
