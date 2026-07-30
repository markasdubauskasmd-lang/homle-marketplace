import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assistMinimumStreak, nextAutoZoom, shouldEnableTorch, torchSupported, zoomCeiling, zoomLabel, zoomRange
} from "../public/camera-assist.js";

// The automatic capture assists. What is pinned here is the set of rules that
// stop "helpful" turning into "possessed": nothing fires on one bad sample, the
// torch never strobes, a decline is final, and the zoom nudges instead of
// hunting.

/* ── Capability reading is defensive ───────────────────────────────────── */

assert.equal(torchSupported({ torch: true }), true);
assert.equal(torchSupported({ torch: "true" }), false, "A non-boolean capability was trusted.");
assert.equal(torchSupported(undefined), false, "A missing getCapabilities did not read as unsupported.");
assert.equal(zoomRange({ zoom: { min: 1, max: 8, step: 0.1 } })?.max, 8);
assert.equal(zoomRange({ zoom: { min: 1, max: 1 } }), null, "A zero-width zoom range was not rejected.");
assert.equal(zoomRange({ zoom: { min: 0, max: 4 } }), null, "A nonsensical zero minimum was accepted.");
assert.equal(zoomRange({}), null);
// A camera that reports no step still gets a usable one.
assert.equal(zoomRange({ zoom: { min: 1, max: 4 } })?.step, 0.1, "A missing step did not default.");

/* ── The torch: on after persistence, off never (automatically) ────────── */

const torchBase = { supported: true, torchOn: false, declined: false };
assert.equal(shouldEnableTorch({ ...torchBase, darkStreak: 1 }), false, "A single dark sample fired the torch — a shadow crossing the lens would light the room.");
assert.equal(shouldEnableTorch({ ...torchBase, darkStreak: assistMinimumStreak }), true, "A persistently dark room did not get the torch.");
assert.equal(shouldEnableTorch({ ...torchBase, darkStreak: 5, supported: false }), false, "An unsupported camera was asked for a torch.");
assert.equal(shouldEnableTorch({ ...torchBase, darkStreak: 5, torchOn: true }), false, "An already-lit torch was re-lit.");
// The customer's off is final: however dark it stays, no automatic re-light.
assert.equal(shouldEnableTorch({ ...torchBase, darkStreak: 99, declined: true }), false, "A declined torch was re-lit automatically.");
// And there is deliberately no automatic OFF decision at all: torch on brightens
// the frame, which clears the advice, and an auto-off would strobe the room.
const assistSource = readFileSync(new URL("../public/camera-assist.js", import.meta.url), "utf8");
assert.ok(!/torch:\s*false/.test(assistSource), "The decision module can decide to turn the torch off, which is the strobe loop the design forbids.");

/* ── The zoom: a bounded nudge, never a hunt ───────────────────────────── */

const range = Object.freeze({ min: 1, max: 8, step: 0.1 });
assert.equal(nextAutoZoom({ range, zoom: 1, distanceStreak: 1 }), null, "A single far sample zoomed the camera.");
assert.equal(nextAutoZoom({ range, zoom: 1, distanceStreak: assistMinimumStreak }), 1.5, "A persistent far view did not get the first nudge.");
assert.equal(nextAutoZoom({ range, zoom: 1.5, distanceStreak: 2 }), 2.3, "The second nudge did not step from the current zoom.");
// The ceiling holds even when the hardware goes far beyond it: heavy digital
// zoom manufactures pixels rather than revealing them.
assert.equal(nextAutoZoom({ range, zoom: 2.9, distanceStreak: 2 }), 3, "The nudge did not clamp to the ceiling.");
assert.equal(nextAutoZoom({ range, zoom: 3, distanceStreak: 9 }), null, "The assist zoomed past its ceiling.");
assert.ok(zoomCeiling <= 3, "The zoom ceiling was raised — past 3× digital zoom degrades the evidence it exists to improve.");
// A camera whose maximum is below the ceiling is respected.
assert.equal(nextAutoZoom({ range: { min: 1, max: 2, step: 0.1 }, zoom: 1.5, distanceStreak: 2 }), 2, "The hardware maximum was exceeded.");
assert.equal(nextAutoZoom({ range: { min: 1, max: 2, step: 0.1 }, zoom: 2, distanceStreak: 2 }), null, "A camera at its maximum was asked for more.");
// Declining is final for the room, and no range means no decision.
assert.equal(nextAutoZoom({ range, zoom: 1, distanceStreak: 9, declined: true }), null, "A declined zoom re-engaged automatically.");
assert.equal(nextAutoZoom({ range: null, zoom: 1, distanceStreak: 9 }), null, "A camera without zoom was asked to zoom.");
// Values are quantised to the hardware's own step.
{
  const coarse = nextAutoZoom({ range: { min: 1, max: 8, step: 0.5 }, zoom: 1, distanceStreak: 2 });
  assert.equal((coarse - 1) % 0.5, 0, `The zoom target ignored the hardware step: ${coarse}`);
}

/* ── The reset chip's label ────────────────────────────────────────────── */

assert.equal(zoomLabel(2.25), "2.3× — tap to reset");
assert.equal(zoomLabel(1), "", "An unzoomed camera showed a reset chip.");
assert.equal(zoomLabel(undefined), "");

console.log("Camera-assist checks passed: defensive capability reading, torch only after persistent darkness and never automatically off, declines final, zoom nudges quantised and ceilinged, and honest labels.");
