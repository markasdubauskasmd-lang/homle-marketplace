import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await import(`${pathToFileURL(path.join(root, "public", "dispatch-order.js")).href}?test=${Date.now()}`);
const dispatchOrder = globalThis.TidewayDispatchOrder;

const entry = (severity, code, dueDate = "", createdAt = "2026-07-15T10:00:00.000Z") => ({ action: { severity, code, dueDate }, record: { createdAt } });
const queue = [
  entry("high", "newer-undated", "", "2026-07-15T12:00:00.000Z"),
  entry("high", "later-date", "2026-07-22"),
  entry("monitor", "monitor-date", "2026-07-15"),
  entry("urgent", "safety"),
  entry("high", "earlier-date", "2026-07-18"),
  entry("high", "invalid-date", "2026-02-30", "2026-07-15T11:00:00.000Z")
];
const unchanged = JSON.stringify(queue);
const orderedCodes = [...queue].sort(dispatchOrder.compareDispatchEntries).map((item) => item.action.code);
assert.deepEqual(orderedCodes, ["safety", "earlier-date", "later-date", "newer-undated", "invalid-date", "monitor-date"]);
assert.equal(JSON.stringify(queue), unchanged, "Queue ordering must not mutate founder actions or lead records.");
assert.equal(dispatchOrder.validCalendarDate("2026-07-21"), "2026-07-21");
assert.equal(dispatchOrder.validCalendarDate("2026-02-30"), "");
assert.equal(dispatchOrder.validCalendarDate("not-a-date"), "");

const [adminHtml, adminJs] = await Promise.all([
  readFile(path.join(root, "public", "admin.html"), "utf8"),
  readFile(path.join(root, "public", "admin.js"), "utf8")
]);
assert(adminHtml.indexOf("/dispatch-order.js") < adminHtml.indexOf("/admin.js"), "Dispatch ordering must load before the control desk.");
assert(adminJs.includes("sort(dispatchOrder.compareDispatchEntries)") && adminJs.includes("Requested ${formatCalendarDate(action.dueDate)}"));

console.log("Dispatch ordering tests passed: urgent safety remains first, then exact approaching dates, then undated work without mutating records.");
