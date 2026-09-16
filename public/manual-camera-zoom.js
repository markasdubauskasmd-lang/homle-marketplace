import { nextManualZoom, zoomRange } from "./camera-assist.js";
import { createCameraConstraintCoordinator } from "./camera-constraints.js";

// A shared coordinator orders zoom with torch changes on the same camera.
// Standalone callers receive the identical per-track ownership and deadlines.
export function createManualCameraZoom({ getTrack, onChange, onError, timeoutMs = 3000, cameraConstraints }) {
  const coordinator = cameraConstraints || createCameraConstraintCoordinator({ getTrack, timeoutMs });
  return async function changeZoom(reset = false) {
    const track = getTrack();
    if (!track || (typeof track !== "object" && typeof track !== "function")) return false;
    let range;
    try {
      const result = await coordinator.change((settings, currentTrack) => {
        range = zoomRange(currentTrack.getCapabilities?.());
        if (!range) return null;
        const current = Number(settings.zoom) || range.min;
        return { zoom: reset ? range.min : nextManualZoom(range, current) };
      });
      if (!result || track !== getTrack() || track.readyState === "ended") return false;
      const actual = Number(result.settings.zoom);
      if (!Number.isFinite(actual)) throw new Error("Zoom could not be verified");
      onChange(actual);
      if (Math.abs(actual - result.patch.zoom) > range.step / 2) throw new Error("Camera did not apply zoom");
      return true;
    } catch (error) {
      if (track === getTrack() && track.readyState !== "ended") {
        onError(Object.assign(new Error(error?.message || "The camera could not change zoom"), {
          name: error?.name || "Error",
          code: String(error?.code || "zoom-failed").replace(/^camera-constraint-/, "zoom-"), recoverCamera: true
        }));
      }
      return false;
    }
  };
}
