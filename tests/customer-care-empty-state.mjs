import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const script = await readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(script.slice(script.indexOf("function careRecordView("), script.indexOf("const careWholePounds")), context);
const empty = { totals: { bookingCount: 0, completedCleanCount: 0, roomsScannedCount: 0, bookedValuePence: 0 }, lastScan: null };
assert.equal(context.careRecordView(empty, "loading").history, false);
assert.match(context.careRecordView(empty, "loading").lead, /Loading/);
assert.match(context.careRecordView(null, "error").title, /unavailable/);
assert.equal(context.careRecordView(null, "error").history, false);
assert.match(context.careRecordView(empty, "ready").title, /first clean/);
assert.equal(context.careRecordView(empty, "ready").history, false);
for (const key of ["bookingCount", "completedCleanCount", "roomsScannedCount"]) {
  assert.equal(context.careRecordView({ ...empty, totals: { ...empty.totals, [key]: 1 } }, "ready").history, true);
}
assert.equal(context.careRecordView({ ...empty, lastScan: { roomCount: 1 } }, "ready").history, true);
console.log("Customer history presentation: loading, failed, empty and real-history states passed.");
