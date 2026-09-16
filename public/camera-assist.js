// Capability readers, defensive because `getCapabilities` is optional and its
// shape is whatever the browser felt like reporting.
export function torchSupported(capabilities) {
  const torch = capabilities?.torch;
  return torch === true || (Array.isArray(torch) && torch.includes(true));
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

// The brightness below which the torch streak counts, measured on the frame the
// phone actually delivers — which is AFTER auto-exposure has done its best. The
// first field trial proved the flaw in reusing the "too dark" advice threshold
// (42): a genuinely dark bedroom auto-brightens to the 50–90 range, so the
// advice threshold nearly never fires post-AE and the torch never came on. 70
// is a first field calibration: low enough that an ordinarily lit evening room
// sits above it, high enough that the AE-brightened murk a dark bedroom
// produces sits below it. Revisit against the scan.assist.torch telemetry once
// real numbers exist.
export const torchLumaThreshold = 70;

// Manual zoom is bounded; no detection result may move the camera.
export const zoomCeiling = 3;
export const zoomStepFactor = 1.5;
export const emptyViewMinimumStreak = 3;

export function shouldEnableTorch({ supported = false, torchOn = false, declined = false, darkStreak = 0 } = {}) {
  if (!supported || torchOn || declined) return false;
  return darkStreak >= assistMinimumStreak;
}

// Compatibility for older callers; automatic zoom is disabled.
export function nextAutoZoom() { return null; }

// What the zoom chip shows. One decimal is plenty; "2.25×" reads as noise.
export function zoomLabel(zoom) {
  const value = Number(zoom);
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${(Math.round(value * 10) / 10).toString()}×`;
}

// Each explicit tap advances a hardware-aligned step, then returns to wide.
export function nextManualZoom(range, zoom) {
  if (!range) return null;
  const quantize = value => range.min + Math.floor((Math.min(value, range.max) - range.min + 1e-8) / range.step) * range.step;
  const steps = [range.min, range.min * 1.5, range.min * 2, range.min * 3]
    .map((step) => quantize(Math.min(step, range.min * zoomCeiling)))
    .filter((step, index, all) => all.indexOf(step) === index);
  const current = Number.isFinite(zoom) && zoom >= range.min ? zoom : range.min;
  const next = steps.find((step) => step > current + range.step / 2);
  // Hardware steps and minima can have more than two decimal places. Only the
  // visible label is rounded; rounding this command can make it unsupported.
  return next ?? range.min;
}
