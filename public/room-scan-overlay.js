import {
  guidedRooms,
  maximumShots,
  processingSteps,
  nextRoomName,
  scanHint,
  canFinishScan,
  shotLabel,
  usableDetections,
  usableLiveBoxes,
  boxAtPoint,
  fitBoxToFrame,
  frameBoxToSourceRect,
  cocoLabel,
  roomReadingPayload,
  mergeItemReadings,
  trackDetections,
  drawableTracks,
  nextDetectionDelay,
  scanSummary
} from "./room-scan-model.js";

// The room scan as an overlay any page can open in place. It builds and owns
// its own DOM, so nothing has to be duplicated into every host page, and it
// resolves with the scan result directly — the journey never has to hand the
// checklist to itself through storage and hope it survives a navigation.

const markup = `
<div class="scan-stage" data-scan-stage>
  <div class="vf" data-viewfinder>
    <video class="vf-feed" data-camera playsinline muted autoplay></video>
    <canvas class="vf-capture" data-capture-canvas hidden></canvas>
    <div class="mesh" data-mesh></div>
    <div data-detection-layer></div>
    <div class="sweep" data-sweep></div>
    <div class="reticle" aria-hidden="true">
      <div class="ret-c ret-tl"></div><div class="ret-c ret-tr"></div>
      <div class="ret-c ret-bl"></div><div class="ret-c ret-br"></div>
    </div>
    <img class="vf-still" data-still hidden alt="">
    <div class="flash" data-flash></div>
    <div class="vf-blocked" data-camera-blocked hidden>
      <h2>Homle needs your camera</h2>
      <p data-camera-blocked-reason>Allow camera access to scan your rooms, or describe them by voice instead.</p>
      <div class="vf-blocked-actions">
        <button class="button" type="button" data-camera-fallback>Open phone camera</button>
        <button class="button ghost" type="button" data-camera-retry>Try live camera again</button>
        <button class="button ghost" type="button" data-close>Describe by voice instead</button>
      </div>
      <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-camera-fallback-input hidden>
    </div>
  </div>

  <div class="scan-top">
    <button class="scan-close" type="button" data-close aria-label="Close the room scan">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <div class="scan-room-lbl"><span class="rec-dot" aria-hidden="true"></span><span data-room-label>Living room</span></div>
    <div class="scan-count"><span data-shot-count>0</span> captured</div>
  </div>

  <section class="voice" data-voice-panel aria-live="polite">
    <div class="voice-head">
      <span class="rec-dot" aria-hidden="true"></span><span>Voice note · recording</span>
      <span class="voice-time" data-voice-time>0:00</span>
    </div>
    <div class="wave" data-wave aria-hidden="true"></div>
    <p class="voice-txt" data-voice-text><span class="cur" aria-hidden="true"></span></p>
    <div class="voice-tags" data-voice-tags></div>
  </section>

  <div class="deck">
    <p class="deck-hint" data-hint role="status">Point at the room and tap the shutter</p>
    <div class="shots" data-shots></div>
    <div class="pick" data-selection hidden>
      <p class="pick-hint" data-selection-hint role="status">Tap what needs cleaning. Tap anywhere else to add something we missed.</p>
      <div class="pick-row">
        <button class="button ghost" type="button" data-retake>Retake</button>
        <button class="button" type="button" data-read-room>Read this room</button>
      </div>
    </div>
    <div class="deck-row">
      <button class="deck-btn" type="button" data-mic aria-pressed="false">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>
        <span class="deck-btn-lbl">Voice note</span>
      </button>
      <button class="shutter" type="button" data-shutter aria-label="Capture this room"><i aria-hidden="true"></i></button>
      <button class="deck-btn" type="button" data-done disabled>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>
        <span class="deck-btn-lbl">Done</span>
      </button>
    </div>
  </div>

  <div class="scan-consent" data-consent hidden>
    <div class="scan-consent-in">
      <h2>Read my rooms automatically?</h2>
      <p>Homle can look at each photo and pick out the fixtures and how dirty each room is, so your checklist fills itself in.</p>
      <p class="scan-consent-detail">To do that, <strong>the photo of each room is sent to our AI provider (Anthropic) to be read</strong>, along with what you say. Photos are read and discarded — they are not stored there. Nothing else about you, your address or your account is sent.</p>
      <div class="scan-consent-actions">
        <button class="button" type="button" data-consent-allow>Yes, read my rooms</button>
        <button class="button ghost" type="button" data-consent-decline>No — just take the photos</button>
      </div>
      <p class="scan-consent-note">You can scan either way. Declining only means you write the checklist yourself.</p>
    </div>
  </div>

  <div class="proc" data-processing>
    <div class="proc-in">
      <div class="ring">
        <svg width="112" height="112" aria-hidden="true"><circle class="bg" cx="56" cy="56" r="52"/><circle class="fg" data-ring cx="56" cy="56" r="52"/></svg>
        <div class="ring-pct" data-ring-percent>0%</div>
      </div>
      <h3>Reading your home</h3>
      <p class="proc-step" data-processing-step>Preparing your photos</p>
      <div class="proc-log" data-processing-log></div>
    </div>
  </div>
</div>
<div class="scan-toast" data-toast role="status" aria-live="polite" hidden></div>
`;

const ringCircumference = 326;

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

/* ── The on-device detector ─────────────────────────── */

// Served from this origin, every file of it. The site's Content-Security-Policy
// is `script-src 'self'` with `connect-src 'self'`, so a CDN tag or the
// library's default model URL would simply be blocked — and vendoring also means
// no third party is told which homes are being scanned, or when.
// The version is in the path on purpose. These files are served `immutable`
// with a one-year lifetime, so a replacement must arrive at a new URL or
// browsers that already hold the old one will never ask again. Re-vendoring
// means a new directory, never an overwrite.
const detectorScripts = Object.freeze([
  "/vendor/tfjs-4.22.0/tf-core.min.js",
  "/vendor/tfjs-4.22.0/tf-converter.min.js",
  "/vendor/tfjs-4.22.0/tf-backend-webgl.min.js",
  "/vendor/tfjs-4.22.0/coco-ssd.min.js"
]);
const detectorModelUrl = "/vendor/coco-ssd-lite-v1/model.json";

function loadDetectorScript(source) {
  return new Promise((done, fail) => {
    const existing = document.querySelector(`script[data-room-detector="${source}"]`);
    if (existing) {
      if (existing.dataset.ready === "true") return done();
      existing.addEventListener("load", () => done(), { once: true });
      existing.addEventListener("error", () => fail(new Error("detector-unavailable")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = source;
    script.async = false;
    script.dataset.roomDetector = source;
    script.addEventListener("load", () => { script.dataset.ready = "true"; done(); }, { once: true });
    script.addEventListener("error", () => fail(new Error("detector-unavailable")), { once: true });
    document.head.appendChild(script);
  });
}

// One detector for the life of the page, deliberately shared and deliberately
// not disposed when the overlay closes. The weights are several megabytes and
// each load creates a WebGL context; building a new one every time the scan is
// reopened would re-parse all of it and stack up contexts until the browser
// refuses to create any more. A single attempt is made, and a failed one is
// remembered rather than retried — a phone without a working WebGL backend will
// not grow one, and retrying just costs battery.
let detectorLoad = null;
// The model is shared, so the guard against overlapping inference has to be
// shared too. An overlay closed and reopened mid-inference would otherwise have
// two callers inside `detect()` on the same model at once.
let detectorBusy = false;

function loadDetectorOnce() {
  if (detectorLoad) return detectorLoad;
  detectorLoad = (async () => {
    for (const source of detectorScripts) await loadDetectorScript(source);
    const runtime = globalThis.tf;
    const detection = globalThis.cocoSsd;
    if (!runtime || !detection) throw new Error("detector-unavailable");
    // WebGL only. The WASM backend needs `wasm-unsafe-eval` in the policy, and
    // weakening the CSP for the whole site to speed up one screen is not a
    // trade worth making.
    if (!(await runtime.setBackend("webgl"))) throw new Error("detector-unavailable");
    await runtime.ready();
    // Without `modelUrl` this fetches from storage.googleapis.com, which
    // connect-src blocks — the scan would show no boxes and report no error.
    return await detection.load({ base: "lite_mobilenet_v2", modelUrl: detectorModelUrl });
  })();
  return detectorLoad;
}

/**
 * Opens the room scan over the current page.
 * Resolves with the scan result, or null if the Landlord closed it without
 * finishing — the caller never has to guess which happened.
 */
export function openRoomScan() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "scan-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Room scan");
    overlay.innerHTML = markup;
    document.body.appendChild(overlay);
    // The page behind must not scroll under the camera.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previouslyFocused = document.activeElement;

    const $ = (selector) => overlay.querySelector(selector);
    const $$ = (selector) => [...overlay.querySelectorAll(selector)];
    const el = {
      viewfinder: $("[data-viewfinder]"), camera: $("[data-camera]"), canvas: $("[data-capture-canvas]"),
      blocked: $("[data-camera-blocked]"), blockedReason: $("[data-camera-blocked-reason]"), retry: $("[data-camera-retry]"),
      fallback: $("[data-camera-fallback]"), fallbackInput: $("[data-camera-fallback-input]"),
      mesh: $("[data-mesh]"), detections: $("[data-detection-layer]"), sweep: $("[data-sweep]"), flash: $("[data-flash]"),
      still: $("[data-still]"), roomLabel: $("[data-room-label]"), shotCount: $("[data-shot-count]"), hint: $("[data-hint]"),
      shots: $("[data-shots]"), mic: $("[data-mic]"), shutter: $("[data-shutter]"), done: $("[data-done]"),
      selection: $("[data-selection]"), selectionHint: $("[data-selection-hint]"), retake: $("[data-retake]"), readRoom: $("[data-read-room]"),
      voice: $("[data-voice-panel]"), voiceTime: $("[data-voice-time]"), wave: $("[data-wave]"), voiceText: $("[data-voice-text]"),
      consent: $("[data-consent]"), consentAllow: $("[data-consent-allow]"), consentDecline: $("[data-consent-decline]"),
      processing: $("[data-processing]"), processingStep: $("[data-processing-step]"), processingLog: $("[data-processing-log]"),
      ring: $("[data-ring]"), ringPercent: $("[data-ring-percent]"), toast: $("[data-toast]")
    };

    const state = {
      stream: null, cameraStarting: false, shots: [], capturing: false,
      voiceOn: false, voiceUsed: false, transcript: "", seconds: 0,
      timers: { wave: null, clock: null }, recognition: null,
      visionAvailable: true, readingAllowed: false, consentAsked: false,
      generation: 0, closed: false,
      // Selection. The frame is frozen before anything is chosen, so a crop can
      // never be cut from pixels the camera has since moved on from.
      frozen: false, frozenFrame: "", candidates: [], selectedIds: new Set(),
      manualCount: 0, cropCanvas: null,
      // On-device detection. Entirely local: the model is same-origin and no
      // frame it looks at leaves the phone.
      detector: null, detectorState: "idle", detecting: false,
      rafId: 0, lastDetectionAt: 0, detectionInterval: 200,
      // Kept separate from `generation`: pausing detection must never discard a
      // room reading that is still in flight.
      detectionGeneration: 0,
      tracks: [], nextTrackId: 1, liveDetectionAvailable: true
    };

    let toastTimer = null;
    function toast(message) {
      el.toast.textContent = message;
      el.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
    }

    /* ── Camera ── */
    async function startCamera() {
      if (state.cameraStarting || state.stream || state.closed) return;
      state.cameraStarting = true;
      try { await openCamera(); } finally { state.cameraStarting = false; }
    }

    async function openCamera() {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        return blockCamera("This browser cannot open a camera. You can still describe each room by voice.");
      }
      if (!globalThis.isSecureContext) {
        return blockCamera("A camera needs a secure connection. Open Homle on its https address and try again.");
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
        // The overlay may have been closed while the permission prompt was open.
        if (state.closed) { for (const track of stream.getTracks()) track.stop(); return; }
        state.stream = stream;
        el.camera.srcObject = stream;
        el.blocked.hidden = true;
        el.shutter.disabled = false;
        await el.camera.play().catch(() => {});
        // Nothing has left the device at this point and nothing will: the
        // detector is local, and starting it now is what gives the Landlord
        // boxes to tap the moment they freeze a frame.
        startDetection();
      } catch (error) {
        const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
        blockCamera(denied
          ? "Live camera permission is blocked. Open the phone camera below, or allow Camera in your browser settings and retry."
          : "No live camera could be opened. Use the phone camera below to take each room photo instead.");
      }
    }

    function blockCamera(reason) {
      el.blockedReason.textContent = reason;
      el.blocked.hidden = false;
      el.shutter.disabled = true;
    }

    function stopCamera() {
      for (const track of state.stream?.getTracks?.() || []) track.stop();
      state.stream = null;
    }

    /* ── Capture ── */

    // The viewfinder shows the camera through `object-fit: cover`, so the
    // Landlord only ever sees a centred crop of the full sensor frame. Capturing
    // the whole frame would mean boxes drawn in viewfinder coordinates no longer
    // line up with the pixels underneath them, and a crop cut from one space
    // using coordinates from the other lands on the wrong object.
    //
    // Capturing exactly the region `cover` displays collapses that to a single
    // coordinate space: a percentage of the viewfinder is a percentage of this
    // canvas. It also means what gets read is precisely what was on screen.
    function drawVisibleRegion(source, sourceWidth, sourceHeight) {
      if (!sourceWidth || !sourceHeight) return null;
      const rect = el.viewfinder.getBoundingClientRect();
      const aspect = rect.width && rect.height ? rect.width / rect.height : sourceWidth / sourceHeight;
      let regionWidth = sourceWidth;
      let regionHeight = Math.round(sourceWidth / aspect);
      if (regionHeight > sourceHeight) {
        regionHeight = sourceHeight;
        regionWidth = Math.round(sourceHeight * aspect);
      }
      const offsetX = Math.round((sourceWidth - regionWidth) / 2);
      const offsetY = Math.round((sourceHeight - regionHeight) / 2);
      const scale = Math.min(1, 1280 / Math.max(regionWidth, regionHeight));
      el.canvas.width = Math.max(1, Math.round(regionWidth * scale));
      el.canvas.height = Math.max(1, Math.round(regionHeight * scale));
      el.canvas.getContext("2d").drawImage(source, offsetX, offsetY, regionWidth, regionHeight, 0, 0, el.canvas.width, el.canvas.height);
      // Quality is kept high here deliberately: this frame is what the room's
      // condition is graded from, and condition changes what the customer is
      // charged. Bytes are saved on the crops instead.
      return el.canvas.toDataURL("image/jpeg", 0.82);
    }

    function currentFrame() {
      const video = el.camera;
      if (!video.videoWidth || !video.videoHeight) return null;
      return drawVisibleRegion(video, video.videoWidth, video.videoHeight);
    }

    function selectedPhotoFrame(file) {
      return new Promise((resolveFrame, rejectFrame) => {
        if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) {
          rejectFrame(new TypeError("Choose a JPEG, PNG or WebP room photo up to 15 MB."));
          return;
        }
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        const finish = () => URL.revokeObjectURL(objectUrl);
        image.onload = () => {
          try {
            const frame = drawVisibleRegion(image, image.naturalWidth, image.naturalHeight);
            finish();
            if (!frame) { rejectFrame(new TypeError("That photo could not be opened.")); return; }
            resolveFrame(frame);
          } catch (error) {
            finish();
            rejectFrame(error);
          }
        };
        image.onerror = () => { finish(); rejectFrame(new TypeError("That photo could not be opened.")); };
        image.src = objectUrl;
      });
    }

    function paintDetections(detections) {
      el.detections.innerHTML = "";
      detections.forEach((detection, index) => {
        const box = document.createElement("div");
        box.className = "det-box";
        box.style.cssText = `left:${detection.x}%;top:${detection.y}%;width:${detection.width}%;height:${detection.height}%`;
        const tag = document.createElement("span");
        tag.className = "det-tag";
        tag.textContent = detection.label;
        if (detection.note) tag.appendChild(Object.assign(document.createElement("em"), { textContent: detection.note }));
        box.appendChild(tag);
        el.detections.appendChild(box);
        setTimeout(() => box.classList.add("show"), 260 + index * 200);
      });
    }

    /* ── Choosing what matters ── */

    // Live boxes and selectable boxes are drawn the same way; only whether they
    // respond to a tap and whether they read as chosen differs.
    function paintBoxes(boxes, { selectable = false } = {}) {
      el.detections.innerHTML = "";
      for (const item of boxes) {
        const box = document.createElement("div");
        box.className = `det-box show${selectable ? " pickable" : ""}${state.selectedIds.has(item.id) ? " picked" : ""}`;
        box.style.cssText = `left:${item.x}%;top:${item.y}%;width:${item.width}%;height:${item.height}%`;
        if (item.label) {
          const tag = document.createElement("span");
          tag.className = "det-tag";
          tag.textContent = item.label;
          box.appendChild(tag);
        }
        el.detections.appendChild(box);
      }
    }

    function selectionCount() {
      return state.selectedIds.size;
    }

    // The reader takes twelve items. The cap counts what has been chosen, not
    // what the detector happened to find: counting candidates meant twelve
    // irrelevant detections could block the Landlord from marking the air fryer,
    // the exact case hand-picked boxes exist for.
    const maximumSelectedItems = 12;
    const selectionLimitMessage = "That's as many items as one room can carry.";
    function atSelectionLimit() {
      return selectionCount() >= maximumSelectedItems;
    }

    // While live, boxes are percentages of the viewfinder and the video fills it
    // through `object-fit: cover`. A frozen frame cannot rely on that: rotating
    // the phone changes the viewfinder's aspect ratio, `cover` re-crops the
    // still to suit, and every box — still a percentage of the viewfinder —
    // would then sit over different pixels than the crop cut from the canvas.
    //
    // So the frozen still and the box layer are pinned to one letterboxed
    // rectangle with the captured frame's exact aspect ratio. A percentage of
    // that rectangle is a percentage of the canvas, at any window size, and the
    // two can no longer disagree.
    function layoutFrozen() {
      if (!state.frozen || !el.canvas.width || !el.canvas.height) return;
      const rect = el.viewfinder.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const scale = Math.min(rect.width / el.canvas.width, rect.height / el.canvas.height);
      const width = el.canvas.width * scale;
      const height = el.canvas.height * scale;
      const left = (rect.width - width) / 2;
      const top = (rect.height - height) / 2;
      for (const node of [el.still, el.detections]) {
        node.style.left = `${left}px`;
        node.style.top = `${top}px`;
        node.style.width = `${width}px`;
        node.style.height = `${height}px`;
        node.style.right = "auto";
        node.style.bottom = "auto";
      }
      // The rectangle already has the image's aspect ratio, so filling it
      // neither crops nor distorts.
      el.still.style.objectFit = "fill";
    }

    function resetLayout() {
      for (const node of [el.still, el.detections]) node.removeAttribute("style");
    }

    function onViewportResize() {
      if (state.frozen) layoutFrozen();
    }

    function refreshSelection() {
      paintBoxes(state.candidates, { selectable: true });
      const chosen = selectionCount();
      el.readRoom.disabled = false;
      el.readRoom.textContent = chosen ? `Read ${chosen} item${chosen === 1 ? "" : "s"}` : "Read the whole room";
      el.selectionHint.textContent = state.candidates.length
        ? "Tap what needs cleaning. Tap anywhere else to add something we missed."
        : "Tap anything that needs cleaning — a worktop, a shower, an air fryer.";
    }

    // Freezing before anything is chosen is what makes the crops trustworthy: a
    // box picked on a live feed would be cut from whatever the phone had moved
    // on to by the time the request was built.
    function freezeFrame(frame, { preselect = "" } = {}) {
      state.frozen = true;
      state.frozenFrame = frame;
      stopDetection();
      el.still.src = frame;
      el.still.hidden = false;
      el.selection.hidden = false;
      el.viewfinder.classList.add("picking");
      // Whatever the detector had settled on becomes the starting selection.
      state.candidates = usableLiveBoxes(drawableTracks(state.tracks).map((track) => ({
        id: `d${track.id}`, x: track.x, y: track.y, width: track.width, height: track.height,
        label: track.label, kind: "detected", score: track.score
      })));
      state.selectedIds = new Set(preselect ? [preselect] : []);
      layoutFrozen();
      refreshSelection();
    }

    function unfreeze() {
      state.frozen = false;
      state.frozenFrame = "";
      state.candidates = [];
      state.selectedIds = new Set();
      state.manualCount = 0;
      el.still.hidden = true;
      el.still.removeAttribute("src");
      el.selection.hidden = true;
      el.viewfinder.classList.remove("picking");
      el.detections.innerHTML = "";
      // Back to full-bleed: live boxes are percentages of the viewfinder again.
      resetLayout();
      if (state.stream) startDetection();
    }

    // A tap that misses every box adds one. This is the whole reason the scan
    // does not regress: the detector has no idea what an air fryer, a shower
    // screen, a worktop or a radiator is, and those are the things a cleaner is
    // actually being asked about.
    const manualBoxSize = 18;
    function tapPoint(event) {
      // Frozen, the boxes live in the letterboxed rectangle rather than the
      // whole viewfinder, so a tap has to be measured against the same thing the
      // boxes were drawn in or every hit test is offset.
      const rect = (state.frozen ? el.detections : el.viewfinder).getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      // A tap in the letterbox margin is outside the photograph entirely.
      if (x < 0 || y < 0 || x > 100 || y > 100) return null;
      return { x, y };
    }

    function onViewfinderTap(event) {
      if (state.closed || state.capturing || !el.blocked.hidden) return;
      const point = tapPoint(event);
      if (!point) return;
      if (!state.frozen) {
        // Tapping the live feed freezes it, and lands on whatever was tapped.
        const frame = currentFrame();
        if (!frame) return toast("The camera is still warming up — try again in a moment.");
        const live = usableLiveBoxes(drawableTracks(state.tracks).map((track) => ({
          id: `d${track.id}`, x: track.x, y: track.y, width: track.width, height: track.height,
          label: track.label, kind: "detected", score: track.score
        })));
        const hit = boxAtPoint(live, point.x, point.y);
        freezeFrame(frame, { preselect: hit ? hit.id : "" });
        return;
      }
      const hit = boxAtPoint(state.candidates, point.x, point.y);
      if (hit) {
        if (state.selectedIds.has(hit.id)) state.selectedIds.delete(hit.id);
        else {
          // The cap applies here too. Without it a thirteenth item could be
          // selected and then silently truncated server-side, so the Landlord
          // would see it chosen and never learn it was dropped.
          if (atSelectionLimit()) return toast(selectionLimitMessage);
          state.selectedIds.add(hit.id);
        }
        refreshSelection();
        return;
      }
      if (atSelectionLimit()) return toast(selectionLimitMessage);
      state.manualCount += 1;
      const id = `m${state.manualCount}`;
      const [box] = usableLiveBoxes([{
        id,
        x: Math.max(0, Math.min(100 - manualBoxSize, point.x - manualBoxSize / 2)),
        y: Math.max(0, Math.min(100 - manualBoxSize, point.y - manualBoxSize / 2)),
        width: manualBoxSize, height: manualBoxSize, label: "", kind: "manual", score: 1
      }]);
      if (!box) return;
      state.candidates = [...state.candidates, box];
      state.selectedIds.add(id);
      refreshSelection();
    }

    // Only a hand-picked box needs its own close-up. A detected one is already
    // visible in the room frame, so paying to send it twice would be waste.
    function cropFor(box) {
      if (box.kind !== "manual") return "";
      const rect = frameBoxToSourceRect(box, { canvasWidth: el.canvas.width, canvasHeight: el.canvas.height });
      if (!rect) return "";
      if (!state.cropCanvas) state.cropCanvas = document.createElement("canvas");
      const longEdge = Math.max(rect.sWidth, rect.sHeight);
      // Never upscale: enlarging a small crop costs bytes and adds nothing.
      const scale = Math.min(1, 384 / longEdge);
      state.cropCanvas.width = Math.max(1, Math.round(rect.sWidth * scale));
      state.cropCanvas.height = Math.max(1, Math.round(rect.sHeight * scale));
      state.cropCanvas.getContext("2d").drawImage(
        el.canvas, rect.sx, rect.sy, rect.sWidth, rect.sHeight,
        0, 0, state.cropCanvas.width, state.cropCanvas.height
      );
      return state.cropCanvas.toDataURL("image/jpeg", 0.72);
    }

    function addThumbnail(dataUrl, roomName) {
      const shot = document.createElement("div");
      shot.className = "shot";
      const image = document.createElement("img");
      image.src = dataUrl;
      image.alt = `${roomName} capture`;
      const ok = document.createElement("span");
      ok.className = "shot-ok";
      ok.innerHTML = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" stroke-width="4"><path d="M20 6 9 17l-5-5"/></svg>';
      shot.append(image, Object.assign(document.createElement("i"), { textContent: shotLabel(roomName) }), ok);
      el.shots.appendChild(shot);
      el.shots.scrollLeft = el.shots.scrollWidth;
    }

    function askConsent() {
      return new Promise((settleConsent) => {
        state.consentAsked = true;
        el.consent.hidden = false;
        const settle = (allowed) => {
          el.consent.hidden = true;
          el.consentAllow.removeEventListener("click", allow);
          el.consentDecline.removeEventListener("click", decline);
          state.readingAllowed = allowed;
          if (!allowed) toast("Photos stay on your phone. You'll write the checklist yourself.");
          settleConsent(allowed);
        };
        const allow = () => settle(true);
        const decline = () => settle(false);
        el.consentAllow.addEventListener("click", allow);
        el.consentDecline.addEventListener("click", decline);
      });
    }

    async function captureFrame(frame, items = []) {
      if (state.capturing || state.shots.length >= maximumShots || state.closed) return;
      if (!state.consentAsked) await askConsent();
      if (state.closed) return;
      const generation = state.generation;
      state.capturing = true;
      el.shutter.disabled = true;
      el.done.disabled = true;
      el.selection.hidden = true;
      el.viewfinder.classList.remove("picking");

      el.flash.classList.remove("pop"); void el.flash.offsetWidth; el.flash.classList.add("pop");
      el.sweep.classList.remove("go"); void el.sweep.offsetWidth; el.sweep.classList.add("go");
      el.mesh.classList.add("on");
      el.viewfinder.classList.add("scanning");
      el.hint.innerHTML = "<b>Reading the room…</b> hold still";

      const roomName = nextRoomName(state.shots.length);
      addThumbnail(frame, roomName);
      el.still.src = frame;
      el.still.hidden = false;

      let reading = { detections: [], tasks: [], condition: "" };
      let readingError = "";
      try { reading = await readRoom(frame, roomName, items); } catch (error) {
        state.visionAvailable = false;
        readingError = error?.code === "sign-in-required"
          ? "Photo saved. Sign in to let Homle read rooms automatically; you can still finish with voice notes."
          : "Photo saved, but automatic room reading is unavailable. Keep scanning and review the checklist yourself.";
      }
      if (generation !== state.generation || state.closed) return;

      const detections = reading.detections;
      paintDetections(detections);
      state.shots.push({
        name: roomName, image: frame, detections,
        tasks: Array.isArray(reading.tasks) ? reading.tasks : [],
        condition: reading.condition || ""
      });

      setTimeout(() => {
        if (generation !== state.generation || state.closed) return;
        el.mesh.classList.remove("on");
        el.viewfinder.classList.remove("scanning");
        state.capturing = false;
        // Back to a live viewfinder for the next room, with the previous room's
        // boxes, tracks and selection cleared so nothing carries over.
        state.tracks = [];
        unfreeze();
        if (!state.stream && state.shots.length < maximumShots) {
          blockCamera("Room photo added. Open the phone camera again for the next room.");
        } else {
          el.shutter.disabled = !el.blocked.hidden || state.shots.length >= maximumShots;
        }
        el.shotCount.textContent = String(state.shots.length);
        el.roomLabel.textContent = nextRoomName(state.shots.length);
        el.hint.innerHTML = scanHint(state.shots.length, { voiceUsed: state.voiceUsed });
        if (canFinishScan(state.shots.length)) {
          el.done.disabled = false;
          el.done.classList.add("ready");
        }
        if (readingError) toast(readingError);
      }, detections.length ? 1800 : 900);
    }

    // The shutter freezes first and reads second, so there is always a chance to
    // choose — or correct — what the room is read for.
    async function capture() {
      if (state.frozen) return confirmSelection();
      const frame = currentFrame();
      if (!frame) return toast("The camera is still warming up — try again in a moment.");
      freezeFrame(frame);
    }

    async function confirmSelection() {
      const chosen = state.candidates.filter((box) => state.selectedIds.has(box.id));
      await captureFrame(state.frozenFrame, chosen);
    }

    async function captureSelectedPhoto(file) {
      try {
        const frame = await selectedPhotoFrame(file);
        el.blocked.hidden = true;
        // A photo chosen from the phone's own camera never had a live
        // viewfinder, so there are no detected boxes to start from — but it can
        // still be marked up by hand before it is read.
        freezeFrame(frame);
      } catch (error) {
        blockCamera(error?.message || "That room photo could not be opened. Try another one.");
      }
    }

    async function recoverCsrf() {
      const current = storedCsrf();
      if (current) return current;
      try {
        const response = await fetch("/api/marketplace/auth/session", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}"
        });
        if (!response.ok) return "";
        const result = await response.json();
        if (!result?.csrfToken) return "";
        sessionStorage.setItem("tideway_csrf", result.csrfToken);
        return sessionStorage.getItem("tideway_csrf") || "";
      } catch { return ""; }
    }

    async function readRoom(image, roomName, items = []) {
      if (!state.readingAllowed || !state.visionAvailable) return { detections: [], tasks: [], condition: "" };
      const csrf = await recoverCsrf();
      if (!csrf) throw Object.assign(new Error("A signed-in Landlord session is required."), { code: "sign-in-required" });

      const selected = items.map((item) => ({
        id: item.id, kind: item.kind, label: item.label,
        box: { x: item.x, y: item.y, width: item.width, height: item.height },
        score: item.score, crop: cropFor(item)
      }));
      // The route rejects anything over its body limit with a 413 the Landlord
      // could only ever read as a generic failure, so the budget is settled here
      // rather than discovered on the way back.
      const payload = roomReadingPayload({ roomName, transcript: state.transcript.slice(-1200), roomFrame: image, items: selected });
      if (!payload.withinLimit) throw new Error("reading-too-large");

      const response = await fetch("/api/marketplace/landlord/room-reading", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(payload.body)
      });
      if (response.status === 503) { state.visionAvailable = false; return { detections: [], tasks: [], condition: "" }; }
      if (!response.ok) throw new Error("reading-failed");
      const result = await response.json();
      return {
        // With a selection the device already owns the geometry and only the
        // names come back; without one the whole frame was read the old way and
        // the boxes it asserts still have to be checked against the frame.
        detections: selected.length ? mergeItemReadings(items, result) : usableDetections(result?.detections),
        tasks: Array.isArray(result?.tasks) ? result.tasks : [],
        condition: result?.condition || ""
      };
    }

    /* ── Live detection ── */

    // Detection runs before the consent question is asked, and that is
    // deliberate: the model is same-origin and every frame it looks at stays on
    // the phone. Consent governs the network call, which is the only point at
    // which anything about this home leaves the device.
    function liveBoxes() {
      return usableLiveBoxes(drawableTracks(state.tracks).map((track) => ({
        id: `d${track.id}`, x: track.x, y: track.y, width: track.width, height: track.height,
        label: track.label, kind: "detected", score: track.score
      })));
    }

    function startDetection() {
      if (state.closed || state.frozen || !state.stream) return;
      if (!state.liveDetectionAvailable || state.rafId) return;

      if (state.detectorState === "idle") {
        state.detectorState = "loading";
        loadDetectorOnce().then((model) => {
          if (state.closed) return;
          state.detector = model;
          state.detectorState = "ready";
        }).catch(() => {
          // The scan carries on exactly as it did before any of this existed:
          // photographs, voice notes and boxes added by hand.
          state.detectorState = "unavailable";
          state.liveDetectionAvailable = false;
        });
      }

      state.detectionGeneration += 1;
      const generation = state.detectionGeneration;
      function step() {
        state.rafId = 0;
        if (state.closed || state.frozen || generation !== state.detectionGeneration) return;
        state.rafId = requestAnimationFrame(step);
        if (state.detectorState !== "ready" || detectorBusy) return;
        const now = Date.now();
        if (now - state.lastDetectionAt < state.detectionInterval) return;
        state.lastDetectionAt = now;
        runDetection(generation);
      }
      state.rafId = requestAnimationFrame(step);
    }

    function stopDetection() {
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = 0;
      // A detection resolving from a previous run must not paint over a frame
      // the Landlord has since frozen.
      state.detectionGeneration += 1;
    }

    async function runDetection(generation) {
      const video = el.camera;
      // Mobile Safari reports zero dimensions until metadata has loaded.
      if (!video.videoWidth || !video.videoHeight) return;
      detectorBusy = true;
      const startedAt = Date.now();
      try {
        const found = await state.detector.detect(video, 12);
        if (state.closed || state.frozen || generation !== state.detectionGeneration) return;
        const rect = el.viewfinder.getBoundingClientRect();
        const mapped = [];
        for (const item of found) {
          const [x, y, width, height] = Array.isArray(item?.bbox) ? item.bbox : [];
          const box = fitBoxToFrame({ x, y, width, height }, {
            videoWidth: video.videoWidth, videoHeight: video.videoHeight,
            frameWidth: rect.width, frameHeight: rect.height
          });
          if (box) mapped.push({ ...box, className: item.class, score: item.score });
        }
        const tracked = trackDetections(state.tracks, mapped, { nextId: state.nextTrackId });
        state.tracks = tracked.tracks;
        state.nextTrackId = tracked.nextId;
        paintBoxes(liveBoxes());
      } catch {
        // A detector that starts failing mid-scan must not wedge the loop or
        // leave stale boxes floating over a live camera. Guarded like the
        // success path, so a rejection arriving from a previous run cannot wipe
        // the boxes off a frame the Landlord has since frozen and is choosing on.
        if (state.closed || state.frozen || generation !== state.detectionGeneration) return;
        state.detectorState = "unavailable";
        state.liveDetectionAvailable = false;
        state.tracks = [];
        el.detections.innerHTML = "";
      } finally {
        detectorBusy = false;
        // A phone that needs 400ms a frame is asked for fewer, rather than
        // being pinned at full load until the viewfinder itself stutters.
        state.detectionInterval = nextDetectionDelay(Date.now() - startedAt);
      }
    }

    function onVisibility() {
      if (document.hidden) stopDetection();
      else startDetection();
    }

    /* ── Voice ── */
    function buildWave() {
      el.wave.innerHTML = "";
      for (let index = 0; index < 34; index += 1) el.wave.appendChild(document.createElement("b"));
    }

    function startVoice() {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) return toast("This browser cannot listen. Type your notes after the scan instead.");
      const recognition = new Recognition();
      recognition.lang = document.documentElement.lang || "en-GB";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let finalText = "";
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result.isFinal) finalText += result[0].transcript;
          else interim += result[0].transcript;
        }
        if (finalText) state.transcript = `${state.transcript} ${finalText}`.trim().slice(0, 5000);
        el.voiceText.textContent = `${state.transcript} ${interim}`.trim();
        el.voiceText.appendChild(Object.assign(document.createElement("span"), { className: "cur" }));
      };
      recognition.onerror = () => stopVoice({ failed: true });
      recognition.onend = () => { if (state.voiceOn) stopVoice(); };
      try { recognition.start(); } catch { return toast("Listening could not start — try again in a moment."); }

      state.recognition = recognition;
      state.voiceOn = true;
      state.voiceUsed = true;
      state.seconds = 0;
      el.voice.classList.add("on");
      el.mic.classList.add("rec");
      el.mic.setAttribute("aria-pressed", "true");
      el.hint.innerHTML = "<b>Listening…</b> just talk normally";

      const bars = $$("[data-wave] b");
      state.timers.wave = setInterval(() => {
        for (const [index, bar] of bars.entries()) {
          const base = Math.sin((Date.now() / 170) + index * 0.55);
          bar.style.height = `${Math.min(100, 20 + Math.abs(base) * 55 + Math.random() * 24)}%`;
          bar.style.opacity = String(0.45 + Math.abs(base) * 0.55);
        }
      }, 70);
      state.timers.clock = setInterval(() => {
        state.seconds += 1;
        el.voiceTime.textContent = `${Math.floor(state.seconds / 60)}:${String(state.seconds % 60).padStart(2, "0")}`;
      }, 1000);
    }

    function stopVoice({ silent = false, failed = false } = {}) {
      state.voiceOn = false;
      clearInterval(state.timers.wave);
      clearInterval(state.timers.clock);
      try { state.recognition?.stop(); } catch {}
      state.recognition = null;
      el.mic.classList.remove("rec");
      el.mic.setAttribute("aria-pressed", "false");
      for (const bar of $$("[data-wave] b")) bar.style.height = "18%";
      if (silent) { el.voice.classList.remove("on"); return; }
      if (failed) el.hint.textContent = "Listening stopped. Your notes so far are kept.";
      else if (state.transcript.trim()) {
        el.hint.innerHTML = "<b>Voice note saved</b> — added to your checklist";
        toast("Voice note attached to this scan");
      }
      setTimeout(() => el.voice.classList.remove("on"), 1400);
    }

    /* ── Reading the scan ── */
    function setProgress(percent) {
      const bounded = Math.max(0, Math.min(100, percent));
      el.ringPercent.textContent = `${Math.round(bounded)}%`;
      el.ring.style.strokeDashoffset = String(ringCircumference - (ringCircumference * bounded) / 100);
    }

    function logLine(label, value) {
      const row = document.createElement("div");
      row.className = "plog";
      row.innerHTML = '<span class="tick"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#2ED47A" stroke-width="4"><path d="M20 6 9 17l-5-5"/></svg></span>';
      row.append(Object.assign(document.createElement("span"), { textContent: label }), Object.assign(document.createElement("b"), { textContent: value }));
      el.processingLog.appendChild(row);
      requestAnimationFrame(() => row.classList.add("on"));
    }

    async function finishScan() {
      if (!canFinishScan(state.shots.length) || state.closed) return;
      stopVoice({ silent: true });
      el.processing.classList.add("on");
      el.processingLog.innerHTML = "";
      setProgress(0);

      const summary = scanSummary(state.shots);
      const steps = [
        ["Preparing your photos", `${state.shots.length} captured`],
        ["Reading each room", `${summary.roomCount || state.shots.length} rooms`],
        ["Identifying fixtures", summary.fixtureCount ? `${summary.fixtureCount} found` : "not available"],
        ["Judging condition", summary.conditionLabel],
        ["Adding your spoken notes", state.transcript.trim() ? "attached" : "none"],
        ["Scoping the work", summary.tasks.length ? `${summary.tasks.length} tasks` : "review needed"]
      ];
      for (const [index, [label, value]] of steps.entries()) {
        if (state.closed) return;
        el.processingStep.textContent = processingSteps[index] || label;
        await new Promise((wait) => setTimeout(wait, 340));
        logLine(label, value);
        setProgress(((index + 1) / steps.length) * 100);
      }
      await new Promise((wait) => setTimeout(wait, 700));
      if (state.closed) return;
      // The camera has no further job once the scan is read.
      stopCamera();
      close({
        tasks: summary.tasks,
        transcript: state.transcript.trim(),
        rooms: state.shots.map((room) => ({ name: room.name, condition: room.condition, fixtures: room.detections.map((detection) => detection.label) })),
        guideTime: summary.durationLabel,
        capturedAt: new Date().toISOString()
      });
    }

    /* ── Teardown ── */
    function close(result) {
      if (state.closed) return;
      state.closed = true;
      state.generation += 1;
      stopVoice({ silent: true });
      stopCamera();
      // The loop stops here. The detector itself is a page-level singleton and
      // is deliberately left loaded rather than rebuilt on every open — see
      // `loadDetectorOnce`.
      stopDetection();
      state.detector = null;
      clearTimeout(toastTimer);
      document.removeEventListener("keydown", onKeyDown);
      // A listener left on `document` or `window` keeps this whole closure alive
      // — the video element and the model with it — for the lifetime of the page.
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onViewportResize);
      window.removeEventListener("orientationchange", onViewportResize);
      document.body.style.overflow = previousOverflow;
      overlay.remove();
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
      resolve(result || null);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") close(null);
    }

    buildWave();
    el.shutter.addEventListener("click", capture);
    el.viewfinder.addEventListener("click", onViewfinderTap);
    el.retake.addEventListener("click", unfreeze);
    el.readRoom.addEventListener("click", confirmSelection);
    el.mic.addEventListener("click", () => (state.voiceOn ? stopVoice() : startVoice()));
    el.done.addEventListener("click", finishScan);
    el.retry.addEventListener("click", startCamera);
    el.fallback.addEventListener("click", () => {
      el.fallbackInput.value = "";
      el.fallbackInput.click();
    });
    el.fallbackInput.addEventListener("change", () => {
      const [file] = el.fallbackInput.files || [];
      if (file) captureSelectedPhoto(file);
    });
    for (const button of $$("[data-close]")) button.addEventListener("click", () => close(null));
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onViewportResize);
    window.addEventListener("orientationchange", onViewportResize);

    el.roomLabel.textContent = guidedRooms[0];
    startCamera();
    el.shutter.focus({ preventScroll: true });
  });
}
