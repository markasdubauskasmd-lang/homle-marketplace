import { nextManualZoom, zoomRange } from "./camera-assist.js";

// Serialize changes on each camera. A queued reset must win over an earlier
// zoom-in, and a detached track must never update the replacement camera's UI.
export function createManualCameraZoom({ getTrack, onChange, onError }) {
  let queue = Promise.resolve();
  return function changeZoom(reset = false) {
    const track = getTrack();
    queue = queue.then(async () => {
      if (!track || track !== getTrack() || track.readyState === "ended") return false;
      try {
        const range = zoomRange(track.getCapabilities?.());
        if (!range || !track.applyConstraints) return false;
        const current = Number(track.getSettings?.()?.zoom) || range.min;
        const target = reset ? range.min : nextManualZoom(range, current);
        await track.applyConstraints({ advanced: [{ zoom: target }] });
        if (track !== getTrack() || track.readyState === "ended") return false;
        const actual = Number(track.getSettings?.()?.zoom);
        if (!Number.isFinite(actual)) throw new Error("Zoom could not be verified");
        onChange(actual);
        if (Math.abs(actual - target) > range.step / 2) throw new Error("Camera did not apply zoom");
        return true;
      } catch {
        if (track === getTrack()) onError();
        return false;
      }
    });
    return queue;
  };
}
