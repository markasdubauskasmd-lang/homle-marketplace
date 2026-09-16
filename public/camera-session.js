function cancelled() {
  return Object.assign(new Error("Camera session cancelled"), { name: "AbortError", code: "camera-session-cancelled" });
}

function release(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try { track.stop(); } catch { /* Release every track even if one has ended. */ }
  }
}

function bounded(operation, signal, milliseconds) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (settle, value) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      settle(value);
    };
    const abort = () => finish(reject, cancelled());
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else timer = setTimeout(() => finish(reject, Object.assign(
      new Error("The camera did not respond in time"), { name: "CameraNotReadyError" }
    )), milliseconds);
    // Always observe completion, including rejections after a deadline/stop.
    operation.then(value => finish(resolve, value), error => finish(reject, error));
  });
}

// Browser permission and playback promises are allowed to stay pending. Bound
// both waits, and own late streams so abandoning a prompt cannot reopen camera
// hardware or overwrite a newer session.
export function createCameraSession({ getUserMedia, timeoutMs = 10000, playbackTimeoutMs = 6000, isCancelled = () => false }) {
  const acquisitionDeadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000;
  const playbackDeadline = Number.isFinite(playbackTimeoutMs) && playbackTimeoutMs > 0 ? playbackTimeoutMs : 6000;
  let current = null, activeStream = null;

  function stop() {
    const previous = current;
    current = null;
    previous?.abort();
    release(activeStream);
    activeStream = null;
  }

  async function acquire(constraints) {
    stop();
    const owner = new AbortController();
    current = owner;
    try {
      if (isCancelled()) throw cancelled();
      const operation = Promise.resolve().then(() => {
        if (owner.signal.aborted || isCancelled()) throw cancelled();
        return getUserMedia(constraints);
      }).then(stream => {
        if (current !== owner || owner.signal.aborted || isCancelled()) {
          release(stream);
          throw cancelled();
        }
        activeStream = stream;
        return stream;
      });
      const stream = await bounded(operation, owner.signal, acquisitionDeadline);
      if (current !== owner || owner.signal.aborted || isCancelled()) throw cancelled();
      return stream;
    } catch (error) {
      if (current === owner) stop();
      throw error;
    }
  }

  async function play(video, stream) {
    return waitFor(stream, () => video.play(), playbackDeadline);
  }

  async function waitFor(stream, task, timeout = playbackDeadline) {
    const owner = current;
    if (!owner || activeStream !== stream || owner.signal.aborted || isCancelled()) {
      if (owner && activeStream === stream) stop();
      throw cancelled();
    }
    try {
      await bounded(Promise.resolve().then(() => {
        if (current !== owner || owner.signal.aborted || isCancelled()) throw cancelled();
        return task(owner.signal);
      }), owner.signal, timeout);
      if (current !== owner || owner.signal.aborted || isCancelled()) throw cancelled();
    } catch (error) {
      if (current === owner) stop();
      throw error;
    }
  }

  const isActive = stream => Boolean(current && !current.signal.aborted && activeStream === stream && !isCancelled());
  return Object.freeze({ acquire, play, waitFor, stop, isActive });
}
