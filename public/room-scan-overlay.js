import {
  canFinishScan,
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
  scanSummary,
  roomPresets,
  normaliseRoomName,
  findRoom,
  canAddRoom,
  upsertRoom,
  rosterSummary
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
    <div class="scan-room-lbl"><span class="rec-dot" aria-hidden="true"></span><span data-room-label>Kitchen</span></div>
    <button class="scan-count" type="button" data-rooms-open><span data-shot-count>0</span> rooms</button>
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
    <div class="pick" data-selection hidden>
      <p class="pick-hint" data-selection-hint role="status">Tap what needs cleaning. Tap anywhere else to add something we missed.</p>
      <div class="pick-row">
        <button class="button ghost" type="button" data-retake>Retake</button>
        <button class="button" type="button" data-read-room>Confirm room</button>
      </div>
    </div>
    <div class="deck-row">
      <button class="deck-btn" type="button" data-mic aria-pressed="false">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>
        <span class="deck-btn-lbl">Voice note</span>
      </button>
      <button class="shutter" type="button" data-shutter aria-label="Capture this room"><i aria-hidden="true"></i></button>
      <button class="deck-btn" type="button" data-rooms-open>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18M9 21V9M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/></svg>
        <span class="deck-btn-lbl">Rooms</span>
      </button>
    </div>
  </div>

  <div class="hub" data-hub hidden>
    <div class="hub-in">
      <button class="scan-close hub-close" type="button" data-close aria-label="Close the room scan">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <div class="hub-head">
        <h2 data-hub-title>Which room first?</h2>
        <p class="hub-sub" data-hub-sub>Pick a room and point your camera at it.</p>
      </div>
      <ul class="hub-rooms" data-hub-rooms></ul>
      <div class="hub-add">
        <p class="hub-add-lbl" data-hub-add-lbl>Scan a room</p>
        <div class="hub-choices" data-hub-choices></div>
        <form class="hub-other" data-hub-other-form>
          <input type="text" class="hub-other-input" data-hub-other placeholder="Another room, e.g. Hallway" maxlength="40" autocomplete="off" aria-label="Name another room">
          <button class="button ghost" type="submit">Add</button>
        </form>
      </div>
      <button class="button hub-finish" type="button" data-hub-finish disabled>Finish scan</button>
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

</div>
<div class="scan-toast" data-toast role="status" aria-live="polite" hidden></div>
`;

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
      mic: $("[data-mic]"), shutter: $("[data-shutter]"),
      selection: $("[data-selection]"), selectionHint: $("[data-selection-hint]"), retake: $("[data-retake]"), readRoom: $("[data-read-room]"),
      hub: $("[data-hub]"), hubTitle: $("[data-hub-title]"), hubSub: $("[data-hub-sub]"), hubRooms: $("[data-hub-rooms]"),
      hubAddLabel: $("[data-hub-add-lbl]"), hubChoices: $("[data-hub-choices]"), hubOtherForm: $("[data-hub-other-form]"),
      hubOther: $("[data-hub-other]"), hubFinish: $("[data-hub-finish]"), roomsOpen: $$("[data-rooms-open]"),
      voice: $("[data-voice-panel]"), voiceTime: $("[data-voice-time]"), wave: $("[data-wave]"), voiceText: $("[data-voice-text]"),
      consent: $("[data-consent]"), consentAllow: $("[data-consent-allow]"), consentDecline: $("[data-consent-decline]"),
      toast: $("[data-toast]")
    };

    const state = {
      stream: null, cameraStarting: false, rooms: [], capturing: false,
      voiceOn: false, voiceUsed: false, transcript: "", seconds: 0,
      timers: { wave: null, clock: null }, recognition: null,
      visionAvailable: true, readingAllowed: false, consentAsked: false,
      generation: 0, closed: false,
      // Which screen is showing, and which room is being worked on. The hub is
      // where a room is chosen, the whole scan reviewed, and a scanned room
      // reopened to edit; live is the camera; the two never show at once.
      // roomSession changes on every room entry or return to the hub, so any
      // async work — a read, a photo decode — can tell whether it still belongs.
      screen: "hub", currentRoom: "", revisiting: false, roomSession: 0, loadingRoom: false,
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

    /* ── The hub: choose a room, review the scan, return to a room ── */

    // One screen is shown at a time. The hub covers the camera; the camera keeps
    // running behind it so re-entering a room is instant, but detection is paused
    // while nobody is pointing at anything.
    function showScreen(name) {
      state.screen = name;
      el.hub.hidden = name === "live";
      if (name === "live") { el.roomLabel.textContent = state.currentRoom; startDetection(); }
      else stopDetection();
    }

    function renderHub() {
      const rooms = rosterSummary(state.rooms);
      const scanned = rooms.length > 0;
      el.hubTitle.textContent = scanned ? "Your rooms" : "Which room first?";
      el.hubSub.textContent = scanned
        ? "Tap a room to edit it, add another, or finish."
        : "Pick a room and point your camera at it.";
      el.hubAddLabel.textContent = scanned ? "Add another room" : "Scan a room";
      el.shotCount.textContent = String(rooms.length);
      el.hubFinish.disabled = !canFinishScan(state.rooms.length);

      // Rooms already scanned — tap one to reopen its photo and edit its objects.
      el.hubRooms.innerHTML = "";
      for (const room of rooms) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hub-room";
        button.dataset.room = room.name;
        const meta = room.itemCount
          ? `${room.itemCount} object${room.itemCount === 1 ? "" : "s"} · ${room.conditionLabel}`
          : "No objects yet";
        button.append(
          Object.assign(document.createElement("span"), { className: "hub-room-name", textContent: room.name }),
          Object.assign(document.createElement("span"), { className: "hub-room-meta", textContent: meta }),
          Object.assign(document.createElement("span"), { className: "hub-room-edit", textContent: "Edit" })
        );
        li.appendChild(button);
        el.hubRooms.appendChild(li);
      }

      // Preset chips. A preset already scanned is marked done and reopens on tap.
      el.hubChoices.innerHTML = "";
      for (const preset of roomPresets) {
        if (findRoom(state.rooms, preset)) continue;
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "hub-chip";
        chip.dataset.room = preset;
        chip.textContent = preset;
        el.hubChoices.appendChild(chip);
      }
    }

    function toHub() {
      // Leaving a room invalidates any read or photo decode still in flight for
      // it, and clears the in-progress flag so an abandoned one cannot wedge it.
      state.roomSession += 1;
      state.capturing = false;
      state.loadingRoom = false;
      showScreen("hub");
      // Reset any half-finished selection; startDetection inside unfreeze no-ops
      // because the screen is now the hub.
      unfreeze();
      el.mesh.classList.remove("on");
      el.viewfinder.classList.remove("scanning");
      el.readRoom.disabled = false;
      el.retake.disabled = false;
      el.hint.innerHTML = "Point at the room and tap the shutter";
      renderHub();
    }

    function enterRoom(rawName) {
      const name = normaliseRoomName(rawName);
      if (!name || state.closed || state.capturing) return;
      const existing = findRoom(state.rooms, name);
      if (!existing && !canAddRoom(state.rooms, name)) return toast("That's as many rooms as one scan can carry.");
      state.roomSession += 1;
      state.currentRoom = name;
      showScreen("live");
      if (existing) openRevisit(existing, state.roomSession);
      else prepareLiveRoom();
    }

    function prepareLiveRoom() {
      // A fresh live frame will be captured, so it is not an edit of a stored
      // one: its save must read. This also covers "Rescan" from a revisit.
      state.revisiting = false;
      state.loadingRoom = false;
      state.tracks = [];
      unfreeze();
      el.hint.innerHTML = "Point at the room and tap the shutter";
      if (!state.stream) startCamera();
      else startDetection();
    }

    // Returning to a room reopens its saved photo with its objects on it. No
    // camera, no fresh capture — removing an object is immediate and costs
    // nothing; the room only reads again on save if its objects actually changed.
    function openRevisit(room, session) {
      if (!room?.image) { prepareLiveRoom(); return; }
      // Block the shutter until the stored photo is in place, so a tap during the
      // load cannot start a fresh capture that install() then overwrites.
      state.loadingRoom = true;
      const image = new Image();
      const install = () => {
        // Dropped if the Landlord has already moved on to another room, so a
        // slow-loading photo can never land on top of the wrong one.
        if (state.closed || session !== state.roomSession) return;
        state.loadingRoom = false;
        const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
        el.canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        el.canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        el.canvas.getContext("2d").drawImage(image, 0, 0, el.canvas.width, el.canvas.height);
        state.revisiting = true;
        state.frozen = true;
        state.frozenFrame = room.image;
        stopDetection();
        el.still.src = room.image;
        el.still.hidden = false;
        el.selection.hidden = false;
        el.viewfinder.classList.add("picking");
        // The room's named objects become the starting selection, each already
        // chosen. Their ids are namespaced so a newly added manual box cannot
        // collide with one of them.
        state.candidates = usableLiveBoxes((room.detections || []).map((detection, index) => ({
          id: `s${index}`, x: detection.x, y: detection.y, width: detection.width, height: detection.height,
          label: detection.label, note: detection.note || "", kind: "detected", score: 1
        })));
        state.selectedIds = new Set(state.candidates.map((box) => box.id));
        state.manualCount = 0;
        layoutFrozen();
        refreshSelection();
      };
      image.onload = install;
      image.onerror = () => { if (!state.closed && session === state.roomSession) { state.loadingRoom = false; prepareLiveRoom(); } };
      image.src = room.image;
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

    // Only decodes — it does not touch the shared canvas. The caller draws to the
    // canvas synchronously, after confirming the Landlord is still in this room,
    // so an abandoned decode from a room already left cannot redraw the canvas a
    // later crop is cut from.
    function decodePhoto(file) {
      return new Promise((resolveImage, rejectImage) => {
        if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) {
          rejectImage(new TypeError("Choose a JPEG, PNG or WebP room photo up to 15 MB."));
          return;
        }
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(objectUrl); resolveImage(image); };
        image.onerror = () => { URL.revokeObjectURL(objectUrl); rejectImage(new TypeError("That photo could not be opened.")); };
        image.src = objectUrl;
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
      const objects = `${chosen} object${chosen === 1 ? "" : "s"}`;
      el.readRoom.textContent = state.revisiting
        ? (chosen ? `Save ${objects}` : "Save room")
        : (chosen ? `Confirm ${objects}` : "Read the whole room");
      el.retake.textContent = state.revisiting ? "Rescan" : "Retake";
      el.selectionHint.textContent = state.revisiting
        ? "Tap an object to remove it, or tap empty space to add one. Then save."
        : state.candidates.length
          ? "Tap what needs cleaning. Tap anywhere else to add something we missed."
          : "Tap anything that needs cleaning — a worktop, a shower, an air fryer.";
    }

    // Freezing before anything is chosen is what makes the crops trustworthy: a
    // box picked on a live feed would be cut from whatever the phone had moved
    // on to by the time the request was built.
    function freezeFrame(frame, { preselect = "" } = {}) {
      // A live capture or a phone photo is a fresh frame, not an edit of a stored
      // one, so its save must read. Only openRevisit marks a frame as an edit.
      state.revisiting = false;
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
      if (state.closed || state.capturing || state.loadingRoom || !el.blocked.hidden) return;
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

    // Saving a room: read it if this is a fresh capture or a newly added object
    // needs naming, otherwise keep what is already named and just drop what was
    // removed. Either way it lands in the roster and returns to the hub — no
    // artificial delay, the only wait is the network read when one is needed.
    async function saveRoom(frame, chosen, { revisit = false } = {}) {
      if (state.capturing || state.closed) return;
      // Claimed before the consent prompt is awaited, not after: otherwise a
      // second activation during that await would slip past — consent already
      // asked, reading not yet allowed — and save an empty room over this one.
      state.capturing = true;
      el.readRoom.disabled = true;
      el.retake.disabled = true;
      // Everything that follows belongs to this room and this frame. If the
      // Landlord navigates to another room while a read is in flight, the token
      // changes and the stale result is dropped rather than saved under the wrong
      // room's name.
      const session = state.roomSession;
      const roomName = state.currentRoom;
      const existing = findRoom(state.rooms, roomName) || {};

      // A fresh capture always reads — its boxes are raw detections that need
      // naming, grading and notes. A revisit reads only when the set of objects
      // actually changed: adding one needs it named, and removing one must
      // re-scope the room so a task like "clean the oven" cannot outlive the oven
      // and quietly keep pricing a job for it. An unchanged save reads nothing.
      const originalCount = Array.isArray(existing.detections) ? existing.detections.length : 0;
      const keptCount = chosen.filter((box) => box.kind !== "manual").length;
      const changed = chosen.some((box) => box.kind === "manual") || keptCount < originalCount;
      // Clearing every object on a revisit means the room genuinely has none —
      // it must not fall through to a whole-room read, which would rediscover
      // exactly what the Landlord just removed.
      const clearedRevisit = revisit && chosen.length === 0;
      const mustRead = (!revisit || changed) && !clearedRevisit;

      if (mustRead && !state.consentAsked) await askConsent();
      if (session !== state.roomSession || state.closed) { state.capturing = false; return; }

      let room;
      if (clearedRevisit) {
        // An emptied room: no objects, and so no scoped tasks and no grade.
        room = { name: roomName, image: frame, detections: [], tasks: [], condition: "" };
      } else if (mustRead) {
        el.flash.classList.remove("pop"); void el.flash.offsetWidth; el.flash.classList.add("pop");
        el.mesh.classList.add("on");
        el.viewfinder.classList.add("scanning");
        el.hint.innerHTML = "<b>Reading the room…</b> one moment";
        let reading = { detections: [], tasks: [], condition: "" };
        let readingError = "";
        try { reading = await readRoom(frame, roomName, chosen); } catch (error) {
          state.visionAvailable = false;
          readingError = error?.code === "sign-in-required"
            ? "Room saved. Sign in to let Homle name objects automatically; you can still finish by hand."
            : "Room saved, but automatic reading is unavailable. Review its objects yourself.";
        }
        if (session !== state.roomSession || state.closed) return;
        room = {
          name: roomName, image: frame,
          detections: reading.detections,
          tasks: Array.isArray(reading.tasks) ? reading.tasks : [],
          condition: reading.condition || ""
        };
        if (readingError) toast(readingError);
      } else {
        // Nothing changed: the objects, grade and tasks already stored are still
        // correct for the same photograph, so it saves without a call.
        room = {
          name: roomName, image: frame,
          detections: chosen.map((box) => ({
            id: box.id, label: box.label, note: box.note || "",
            x: box.x, y: box.y, width: box.width, height: box.height
          })),
          tasks: Array.isArray(existing.tasks) ? existing.tasks : [],
          condition: existing.condition || ""
        };
      }

      if (session !== state.roomSession || state.closed) return;
      state.rooms = upsertRoom(state.rooms, room);
      state.tracks = [];
      state.capturing = false;
      toHub();
    }

    // The shutter freezes first and saves second, so there is always a chance to
    // choose — or correct — what the room is read for.
    async function capture() {
      if (state.screen !== "live" || state.capturing || state.loadingRoom) return;
      if (state.frozen) return confirmSelection();
      const frame = currentFrame();
      if (!frame) return toast("The camera is still warming up — try again in a moment.");
      freezeFrame(frame);
    }

    async function confirmSelection() {
      if (!state.frozen) return;
      const chosen = state.candidates.filter((box) => state.selectedIds.has(box.id));
      await saveRoom(state.frozenFrame, chosen, { revisit: state.revisiting });
    }

    async function captureSelectedPhoto(file) {
      if (state.loadingRoom || state.capturing) return;
      const session = state.roomSession;
      try {
        const image = await decodePhoto(file);
        // Decoding is async; if the Landlord has since left this room or a stored
        // photo is loading into the canvas, drop it before it can draw over.
        if (state.closed || session !== state.roomSession || state.loadingRoom || state.capturing) return;
        const frame = drawVisibleRegion(image, image.naturalWidth, image.naturalHeight);
        if (!frame) throw new TypeError("That photo could not be opened.");
        el.blocked.hidden = true;
        // A photo chosen from the phone's own camera never had a live
        // viewfinder, so there are no detected boxes to start from — but it can
        // still be marked up by hand before it is read.
        freezeFrame(frame);
      } catch (error) {
        if (session === state.roomSession) blockCamera(error?.message || "That room photo could not be opened. Try another one.");
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

      // Crops are cut from the capture canvas up front, before any await. Once
      // the network call is in flight a later capture could redraw that canvas,
      // and a crop taken then would be of the wrong room; taking them now ties
      // them to the frame that is on screen.
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

      const csrf = await recoverCsrf();
      if (!csrf) throw Object.assign(new Error("A signed-in Landlord session is required."), { code: "sign-in-required" });

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
      // Only while the Landlord is actually pointing at a room. Behind the hub
      // the camera is warm but there is nothing to detect, so the loop stays off.
      if (state.screen !== "live" || state.closed || state.frozen || !state.stream) return;
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

    /* ── Finishing the scan ── */

    // Every room was already read as it was confirmed, so finishing is pure
    // local aggregation. There is nothing to load, so there is no loading
    // screen: the old step-by-step "reading your home" animation only ever
    // dramatised work that had already happened.
    function finishScan() {
      if (!canFinishScan(state.rooms.length) || state.closed) return;
      stopVoice({ silent: true });
      const summary = scanSummary(state.rooms);
      // The camera has no further job once the rooms are gathered.
      stopCamera();
      close({
        tasks: summary.tasks,
        transcript: state.transcript.trim(),
        rooms: state.rooms.map((room) => ({ name: room.name, condition: room.condition, fixtures: (room.detections || []).map((detection) => detection.label) })),
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
    // On a fresh room "Retake" clears the frame back to the live camera; on a
    // revisit it discards the edit and reopens the live camera to rescan.
    el.retake.addEventListener("click", () => (state.revisiting ? prepareLiveRoom() : unfreeze()));
    el.readRoom.addEventListener("click", confirmSelection);
    el.mic.addEventListener("click", () => (state.voiceOn ? stopVoice() : startVoice()));
    el.retry.addEventListener("click", startCamera);
    el.fallback.addEventListener("click", () => {
      el.fallbackInput.value = "";
      el.fallbackInput.click();
    });
    el.fallbackInput.addEventListener("change", () => {
      const [file] = el.fallbackInput.files || [];
      if (file) captureSelectedPhoto(file);
    });

    // The hub: the count in the top bar and the deck button both open it, one tap
    // to review or switch room. Choosing a room chip, tapping a scanned room, or
    // naming another room all enter that room; Finish ends the scan.
    // Not while a room is being read — jumping to the hub mid-read would drop
    // the room the Landlord just confirmed.
    for (const button of el.roomsOpen) button.addEventListener("click", () => { if (state.screen === "live" && !state.capturing) toHub(); });
    el.hub.addEventListener("click", (event) => {
      const target = event.target.closest("[data-room]");
      if (target) enterRoom(target.dataset.room);
    });
    el.hubOtherForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = el.hubOther.value;
      el.hubOther.value = "";
      enterRoom(name);
    });
    el.hubFinish.addEventListener("click", finishScan);

    for (const button of $$("[data-close]")) button.addEventListener("click", () => close(null));
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onViewportResize);
    window.addEventListener("orientationchange", onViewportResize);

    // Open on the hub so the first thing asked is which room — and warm the
    // camera and detector behind it so entering that room is instant.
    renderHub();
    showScreen("hub");
    startCamera();
    el.hubOther.focus?.({ preventScroll: true });
  });
}
