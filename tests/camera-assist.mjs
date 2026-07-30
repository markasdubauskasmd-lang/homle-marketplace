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

// The second trigger — the fourth field report: a ready detector persistently
// finding NOTHING in a good frame is the other face of "too far", and must
// drive the same bounded nudge. Weaker evidence than a found-but-small object
// (an empty wall up close is also empty), so it must persist longer.
assert.ok(emptyViewMinimumStreak > assistMinimumStreak, "Empty-view evidence is weaker than a found-but-small object and must persist longer before zooming.");
assert.equal(nextAutoZoom({ range, zoom: 1, emptyStreak: emptyViewMinimumStreak - 1 }), null, "A briefly empty view zoomed the camera — panning across a doorway would trigger it.");
assert.equal(nextAutoZoom({ range, zoom: 1, emptyStreak: emptyViewMinimumStreak }), 1.5, "A detector that persistently finds nothing did not get the zoom nudge — the fourth field report exactly.");
assert.equal(nextAutoZoom({ range, zoom: 1, emptyStreak: 99, declined: true }), null, "A declined zoom re-engaged from the empty-view trigger.");
assert.equal(nextAutoZoom({ range, zoom: 3, emptyStreak: 99 }), null, "The empty-view trigger zoomed past the ceiling.");
// Values are quantised to the hardware's own step.
{
  const coarse = nextAutoZoom({ range: { min: 1, max: 8, step: 0.5 }, zoom: 1, distanceStreak: 2 });
  assert.equal((coarse - 1) % 0.5, 0, `The zoom target ignored the hardware step: ${coarse}`);
}

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
