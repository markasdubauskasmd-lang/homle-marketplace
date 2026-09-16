// applyConstraints replaces a track's complete constraint set. Torch and zoom
// must share ownership and preserve the camera's framing/performance settings.
export function createCameraConstraintCoordinator({ getTrack, onSettled = () => {}, timeoutMs = 3000,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  const tracks = new WeakMap();
  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000;
  const active = track => track === getTrack() && track?.readyState !== "ended";
  const failure = (code, message) => Object.assign(new Error(message), { code, recoverCamera: true });

  function change(request) {
    const track = getTrack();
    if (!track || typeof track.applyConstraints !== "function") return Promise.resolve(null);
    let entry = tracks.get(track);
    if (!entry) { entry = { tail: Promise.resolve(), pending: null }; tracks.set(track, entry); }
    const result = entry.tail.then(async () => {
      if (!active(track)) return null;
      // A UI deadline cannot cancel hardware. Never overlap the outstanding
      // request; replacing the camera gives the replacement its own queue.
      if (entry.pending) throw failure("camera-constraint-busy", "Camera controls are still responding");
      const settings = track.getSettings?.() || {};
      const patch = typeof request === "function" ? request(settings, track) : request;
      if (!patch) return null;
      const retained = {};
      if (Number.isFinite(settings.zoom) && settings.zoom > 0) retained.zoom = settings.zoom;
      if (typeof settings.torch === "boolean") retained.torch = settings.torch;
      const controls = { ...retained, ...patch };
      const replaced = new Set(Object.keys(controls));
      const previous = track.getConstraints?.() || {};
      const constraints = Object.fromEntries(Object.entries(previous).filter(([key]) => key !== "advanced" && !replaced.has(key)));
      const advanced = (Array.isArray(previous.advanced) ? previous.advanced : [])
        .map(value => Object.fromEntries(Object.entries(value).filter(([key]) => !replaced.has(key))))
        .filter(value => Object.keys(value).length);
      // Remove previous values for the controls we own before appending their
      // joint state. Contradictory advanced sets can otherwise skip the new one.
      constraints.advanced = [...advanced, controls];
      const operation = Promise.resolve(track.applyConstraints(constraints)).then(() => ({
        settings: { ...(track.getSettings?.() || {}) }, patch
      }));
      entry.pending = operation;
      operation.then(value => {
        if (entry.pending === operation) entry.pending = null;
        if (active(track)) {
          try { onSettled(value.settings); } catch { /* UI callbacks cannot poison the hardware queue. */ }
        }
      }, () => { if (entry.pending === operation) entry.pending = null; });
      let timer;
      try {
        const value = await Promise.race([operation, new Promise((resolve, reject) => {
          timer = setTimer(() => reject(failure("camera-constraint-timeout", "Camera controls timed out")), deadline);
        })]);
        return active(track) ? value : null;
      } finally { clearTimer(timer); }
    });
    entry.tail = result.catch(() => {});
    return result;
  }
  return Object.freeze({ change, isPending: track => Boolean(track && tracks.get(track)?.pending) });
}
