import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assistMinimumStreak, emptyViewMinimumStreak, nextAutoZoom, nextManualZoom, shouldEnableTorch, torchLumaThreshold, torchSupported, zoomCeiling, zoomLabel, zoomRange
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

// Detector failures and distant objects must never move the camera.
const range = { min: 1, max: 8, step: .1 };
for (const distanceStreak of [0, 1, 2, 99]) for (const emptyStreak of [0, 3, 99]) {
  assert.equal(nextAutoZoom({ range, zoom: 1, distanceStreak, emptyStreak }), null);
}
assert.ok(zoomCeiling <= 3);
/* ── The zoom chip: a label and a manual control ───────────────────────── */

assert.equal(zoomLabel(2.25), "2.3×");
assert.equal(zoomLabel(1), "1×", "The chip hides at 1×, but it is now a manual control and must always name its state.");
assert.equal(zoomLabel(undefined), "");

// Manual stepping exists because the automatic trigger needs the detector to
// have found something small, and a far dim wall gives it nothing — while the
// customer can see perfectly well that everything is too far away.
{
  const range = { min: 1, max: 8, step: 0.1 };
  assert.equal(nextManualZoom(range, 1), 1.5, "The first manual step is wrong.");
  assert.equal(nextManualZoom(range, 1.5), 2, "The second manual step is wrong.");
  assert.equal(nextManualZoom(range, 2), 3, "The third manual step is wrong.");
  assert.equal(nextManualZoom(range, 3), 1, "The cycle does not wrap back to wide.");
  // A camera whose maximum is inside the cycle still wraps cleanly.
  const short = { min: 1, max: 1.8, step: 0.1 };
  assert.equal(nextManualZoom(short, 1), 1.5, "A short-range camera lost its usable step.");
  assert.equal(nextManualZoom(short, 1.5), 1.8, "A short-range camera did not step to its own maximum.");
  assert.equal(nextManualZoom(short, 1.8), 1, "A short-range camera does not wrap back to wide.");
  assert.equal(nextManualZoom(null, 1), null, "A camera without zoom was offered the manual cycle.");
}

// The torch threshold sits above the nag threshold on purpose: auto-exposure
// brightens a dark bedroom into the 50–90 range, so a threshold tuned for raw
// darkness never fires on a live camera — the first field trial's exact report.
assert.ok(torchLumaThreshold > 42 && torchLumaThreshold <= 90,
  `The torch threshold (${torchLumaThreshold}) drifted out of the post-auto-exposure band that field evidence put it in.`);

console.log("Camera-assist checks passed: defensive capability reading, torch only after persistent darkness and never automatically off, declines final, zoom nudges quantised and ceilinged, and honest labels.");

import "./manual-camera-zoom.mjs";
