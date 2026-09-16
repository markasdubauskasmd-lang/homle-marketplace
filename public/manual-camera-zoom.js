import { nextManualZoom, zoomRange } from "./camera-assist.js";

// Serialize changes on each camera. A queued reset must win over an earlier
// zoom-in, and a detached track must never update the replacement camera's UI.
export function createManualCameraZoom({ getTrack, onChange, onError, timeoutMs = 3000 }) {
  const queues = new WeakMap();
  const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000;
  return function changeZoom(reset = false) {
    const track = getTrack();
    if (!track || (typeof track !== "object" && typeof track !== "function")) return Promise.resolve(false);
    let entry = queues.get(track);
    if (!entry) { entry = { queue: Promise.resolve(), pending: null }; queues.set(track, entry); }
    entry.queue = entry.queue.then(async () => {
      if (!track || track !== getTrack() || track.readyState === "ended") return false;
      let timer;
      try {
        // applyConstraints has no cancellation API. After its deadline, do not
        // overlap another change on that track: a late zoom could undo Reset.
        // A reopened camera has its own queue and is immediately usable.
        if (entry.pending) throw Object.assign(new Error("Camera zoom is still responding"), { code: "zoom-busy", recoverCamera: true });
        const range = zoomRange(track.getCapabilities?.());
        if (!range || !track.applyConstraints) return false;
        const current = Number(track.getSettings?.()?.zoom) || range.min;
        const target = reset ? range.min : nextManualZoom(range, current);
        const operation = Promise.resolve(track.applyConstraints({ advanced: [{ zoom: target }] }));
        entry.pending = operation;
        const settled = () => { if (entry.pending === operation) entry.pending = null; };
        operation.then(settled, settled);
        await Promise.race([operation, new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error("Camera zoom timed out"), { code: "zoom-timeout", recoverCamera: true })), deadlineMs);
        })]);
        if (track !== getTrack() || track.readyState === "ended") return false;
        const actual = Number(track.getSettings?.()?.zoom);
        if (!Number.isFinite(actual)) throw new Error("Zoom could not be verified");
        onChange(actual);
        if (Math.abs(actual - target) > range.step / 2) throw new Error("Camera did not apply zoom");
        return true;
      } catch (error) {
        if (track === getTrack() && track.readyState !== "ended") {
          // Rejected or silently ignored constraints need the same escape as a
          // timeout. Otherwise Reset can retry an unusable track forever.
          onError(Object.assign(new Error(error?.message || "The camera could not change zoom"), {
            name: error?.name || "Error", code: error?.code || "zoom-failed", recoverCamera: true
          }));
        }
        return false;
      } finally {
        clearTimeout(timer);
      }
    });
    return entry.queue;
  };
}
