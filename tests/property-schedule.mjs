import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { propertyDateTime, propertyStartAt } from "../public/property-schedule.js";
import { requestedWindow } from "../public/landlord-dashboard-model.js";
import { supportRequestPayload } from "../public/landlord-help-model.js";

const now = new Date("2026-01-01T00:00:00Z");
assert.equal(propertyStartAt("2026-09-20", "10:00"), "2026-09-20T09:00:00.000Z");
assert.equal(propertyStartAt("2026-12-20", "10:00"), "2026-12-20T10:00:00.000Z");
for (const [date, time] of [["2026-02-30", "10:00"], ["2026-02-29", "10:00"], ["2026-09-20", "24:00"], ["2026-09-20", "10:60"]]) {
  assert.throws(() => propertyStartAt(date, time), /valid cleaning date/);
}
assert.equal(propertyStartAt("2028-02-29", "10:00"), "2028-02-29T10:00:00.000Z");
assert.throws(() => propertyStartAt("2026-03-29", "01:30"), /does not exist/);
assert.throws(() => propertyStartAt("2026-10-25", "01:30"), /occurs twice/);
assert.equal(propertyStartAt("2026-03-29", "02:00"), "2026-03-29T01:00:00.000Z");
assert.equal(propertyStartAt("2026-10-25", "02:00"), "2026-10-25T02:00:00.000Z");
// Durations remain elapsed work time across clock changes, without changing prices.
for (const [date, expectedEnd] of [["2026-03-29", "2026-03-29T02:30:00.000Z"], ["2026-10-25", "2026-10-25T01:30:00.000Z"]]) {
  assert.equal(requestedWindow(date, "00:30", 120, now).requestedEndAt, expectedEnd);
}
assert.throws(() => requestedWindow("2026-09-20", "10:00", 120, new Date("2026-09-20T09:00:00Z")), /future/);
assert.throws(() => requestedWindow("2028-09-20", "10:00", 120, now), /within the next year/);
assert.throws(() => requestedWindow("2026-09-20", "10:00", 29, now), /duration/);

const source = await readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");
const prepare = source.slice(source.indexOf("function prepareAnotherTime("), source.indexOf("async function continueAnotherTime("));
const requests = [{ requestId: "request", requestedStartAt: "2026-09-20T09:00:00Z", requestedEndAt: "2026-09-20T11:00:00Z" }];
const context = { requests, propertyDateTime, Date, matchOutcomeDate: { focus() {} }, matchOutcomeStart: {}, matchOutcomeDuration: { options: [{ value: "120" }] }, showMatchOutcomeStep() {} };
vm.runInNewContext(`${prepare}\nprepareAnotherTime("request");`, context);
assert.equal(context.matchOutcomeDate.value, "2026-09-20");
assert.equal(context.matchOutcomeStart.value, "10:00");
assert.equal(context.matchOutcomeDuration.value, "120");
assert.equal(context.matchOutcomeDate.min, propertyDateTime().date);

const support = { category: "booking-change", bookingId: "bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc", bookingChangeKind: "reschedule", proposedStartAt: "2026-09-20T10:00", description: "Please move the booking to this proposed property time.", confirmNoSensitiveData: true };
const id = "acacacac-acac-4cac-8cac-acacacacacac";
assert.equal(supportRequestPayload(support, id, now.getTime()).proposedStartAt, "2026-09-20T09:00:00.000Z");
assert.equal(supportRequestPayload({ ...support, proposedStartAt: "2026-09-20T09:00:00Z" }, id, now.getTime()).proposedStartAt, "2026-09-20T09:00:00.000Z");
assert.throws(() => supportRequestPayload({ ...support, proposedStartAt: "2026-10-25T01:30" }, id, now.getTime()), /occurs twice/);
assert.throws(() => supportRequestPayload({ ...support, proposedStartAt: "2026-09-20T10:00:00" }, id, now.getTime()), /new start time/);

// A separate process per zone proves host-local parsing cannot change the request.
const probe = `
import { requestedWindow } from ${JSON.stringify(new URL("../public/landlord-dashboard-model.js", import.meta.url).href)};
import { propertyDateTime } from ${JSON.stringify(new URL("../public/property-schedule.js", import.meta.url).href)};
import { bookableDays } from ${JSON.stringify(new URL("../public/landlord-journey-model.js", import.meta.url).href)};
console.log(JSON.stringify({ window: requestedWindow("2026-09-20", "10:00", 180, new Date("2026-09-16T00:00Z")), local: propertyDateTime("2026-07-01T23:30:00Z"), days: bookableDays(new Date("2026-07-01T23:30:00Z"), 2) }));`;
let baseline;
for (const zone of ["Europe/London", "America/New_York", "Asia/Tokyo", "Pacific/Auckland", "Pacific/Honolulu", "UTC"]) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", env: { ...process.env, TZ: zone } });
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  baseline ||= actual;
  assert.deepEqual(actual, baseline, `Customer schedule changed in ${zone}`);
  assert.equal(actual.window.requestedStartAt, "2026-09-20T09:00:00.000Z");
  assert.equal(actual.local.date, "2026-07-02");
  assert.equal(actual.days[0].iso, "2026-07-03");
}
console.log("Property schedule checks passed: six overseas zones, UK calendar, DST gap/fold, duration, reschedule prefill and support payload.");
