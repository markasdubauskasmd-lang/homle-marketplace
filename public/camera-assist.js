// The decisions behind the automatic capture assists: torch and zoom.
//
// The two physical causes of bad condition grades are "too dark" and "too far",
// and until now the scanner could only nag about them. Where the camera lets a
// web page fix them — Android Chrome exposes torch and zoom through track
// constraints; iPhone Safari exposes neither — the fix now happens by itself,
// with a visible control to undo it.
//
// Pure decision logic, kept out of the overlay so the rules that stop it
// misbehaving are directly testable:
//
//   * Nothing engages on a single bad sample. A shadow crossing the lens must
//     not fire the torch; both assists wait for the same condition on
//     consecutive quality samples (~a second apart).
//   * The torch is never turned OFF automatically. Torch on → frame brightens →
//     "too dark" clears → an auto-off would darken the frame and re-trigger the
//     auto-on, strobing the room. Off is the customer's tap, or the camera
//     closing.
//   * A customer's "no" is final for the room. Turning the torch off or
//     resetting the zoom sets a declined flag, and the assist stays quiet until
//     they enter another room.

// Capability readers, defensive because `getCapabilities` is optional and its
// shape is whatever the browser felt like reporting.
export function torchSupported(capabilities) {
  return capabilities?.torch === true;
}

export function zoomRange(capabilities) {
  const supplied = capabilities?.zoom;
  const min = Number(supplied?.min);
  const max = Number(supplied?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || min <= 0) return null;
  const step = Number(supplied?.step);
  return Object.freeze({ min, max, step: Number.isFinite(step) && step > 0 ? step : 0.1 });
}

// Both assists demand the same persistence before acting.
export const assistMinimumStreak = 2;

// Automatic zoom is a nudge, not a hunt: one modest step each time the
// "move closer" advice has persisted, never past 3× however far the hardware
// goes — heavy digital zoom manufactures pixels rather than revealing them.
export const zoomStepFactor = 1.5;
export const zoomCeiling = 3;

export function shouldEnableTorch({ supported = false, torchOn = false, declined = false, darkStreak = 0 } = {}) {
  if (!supported || torchOn || declined) return false;
  return darkStreak >= assistMinimumStreak;
}

/**
 * The next zoom to apply, or null for "leave it alone".
 *
 * Null on: no zoom support, insufficient streak, customer declined, or already
 * at the allowed ceiling. The result is clamped and quantised to the camera's
 * own step so `applyConstraints` is never asked for a value the hardware
 * rejects outright.
 */
export function nextAutoZoom({ range = null, zoom = 0, declined = false, distanceStreak = 0 } = {}) {
  if (!range || declined || distanceStreak < assistMinimumStreak) return null;
  const current = Number.isFinite(zoom) && zoom >= range.min ? zoom : range.min;
  const limit = Math.min(range.max, range.min * zoomCeiling);
  if (current >= limit - range.step / 2) return null;
  const target = Math.min(limit, current * zoomStepFactor);
  // Quantised to the hardware's step, measured from its own minimum.
  const quantised = range.min + Math.round((target - range.min) / range.step) * range.step;
  const bounded = Math.max(range.min, Math.min(limit, quantised));
  // A step too small to matter is not worth a constraint change.
  if (bounded - current < range.step / 2) return null;
  return Math.round(bounded * 100) / 100;
}

// What the reset chip shows. One decimal is plenty; "2.25×" reads as noise.
export function zoomLabel(zoom) {
  const value = Number(zoom);
  if (!Number.isFinite(value) || value <= 1) return "";
  return `${(Math.round(value * 10) / 10).toString()}× — tap to reset`;
}
