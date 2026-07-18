import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { roomScanSummary } from "../public/request-status-model.js";

assert.equal(
  roomScanSummary({ status: "landlord-draft", photoCount: 1, taskCount: 5 }),
  "1 room photo/video · 5 cleaner tasks · Waiting for Homle review",
  "The customer tracker still exposes the internal landlord-draft scan status or incorrect singular grammar."
);
assert.equal(roomScanSummary({ status: "needs-revision", photoCount: 2, taskCount: 1 }), "2 room photos/videos · 1 cleaner task · Changes requested", "A requested scan revision is not explained in customer language.");
assert.equal(roomScanSummary({ status: "review-pending", photoCount: 1, taskCount: 1 }), "1 room photo/video · 1 cleaner task · Review checks in progress", "A partially completed review exposes its internal status.");
assert.equal(roomScanSummary({ status: "reviewed", photoCount: 2, taskCount: 4, reviewedHours: 1, confidence: "high" }), "2 room photos/videos · 4 cleaner tasks · 1 reviewed hour · High confidence", "A completed scan does not retain its useful reviewed evidence with correct grammar.");
assert.equal(roomScanSummary({ status: "new-internal-state", photoCount: -1, taskCount: "unknown" }), "0 room photos/videos · 0 cleaner tasks · Review status updating", "An unexpected internal scan state leaks to the customer tracker.");

const script = await readFile(new URL("../public/request-status.js", import.meta.url), "utf8");
assert(script.includes('setText("[data-scan-detail]", roomScanSummary(result.roomScan))'), "The private request tracker does not render the safe room-scan summary model.");
assert(!script.includes("result.roomScan.status}`"), "The private request tracker still renders a raw internal scan status.");

console.log("Request tracker UI tests passed: room media, task counts and every review state use concise customer language without internal status leakage.");
