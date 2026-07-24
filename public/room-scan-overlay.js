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
  frameQualityAdvice,
  nextDetectionDelay,
  scanSummary,
  scanTranscript,
  roomPresets,
  normaliseRoomName,
  findRoom,
  canAddRoom,
  upsertRoom,
  removeRoom,
  rosterSummary
} from "./room-scan-model.js";
import { validatedGuidedRoomPhotoDimensions, validatedGuidedRoomPhotoFile } from "./room-photo-selection.js";
import { extractRoomVideoFrames, maximumRoomVideoFrames, roomVideoContactSheetLayout } from "./room-video-frames.js";

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
    <p class="scan-detector-state" data-detector-state role="status" aria-live="polite" hidden></p>
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
        <button class="button ghost" type="button" data-video-fallback>Record short room video</button>
        <button class="button ghost" type="button" data-camera-retry>Try live camera again</button>
        <button class="button ghost" type="button" data-note-open>Describe by voice or typing</button>
      </div>
      <input type="file" accept="image/*" capture="environment" data-camera-fallback-input hidden>
      <input type="file" accept="video/*" capture="environment" data-video-fallback-input hidden>
    </div>
  </div>

  <div class="scan-top">
    <button class="scan-close" type="button" data-close aria-label="Close the room scan">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <div class="scan-room-lbl"><span class="rec-dot" aria-hidden="true"></span><span data-room-label>Kitchen</span></div>
    <button class="scan-count" type="button" data-rooms-open><span data-shot-count>0</span> rooms</button>
  </div>

  <section class="voice" data-voice-panel aria-label="Room note" hidden>
    <div class="voice-head">
      <span class="rec-dot" aria-hidden="true"></span><span data-voice-status>Room note</span>
      <span class="voice-time" data-voice-time>0:00</span>
      <button class="voice-done" type="button" data-note-done>Done</button>
    </div>
    <div class="wave" data-wave aria-hidden="true"></div>
    <label class="voice-note-label" for="homle-room-note">Check what Homle heard</label>
    <textarea class="voice-txt" id="homle-room-note" data-room-note maxlength="5000" rows="4" placeholder="For example: Do not clean inside the oven. Wipe the worktops."></textarea>
    <p class="voice-note-help">Speak naturally or type. Correct anything before confirming this room.</p>
  </section>

  <div class="deck" data-camera-deck>
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
      <button class="deck-btn" type="button" data-video-fallback aria-label="Record a short room video">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>
        <span class="deck-btn-lbl">Video</span>
      </button>
    </div>
    <button class="deck-note-alt" type="button" data-note-open>Type or review this room’s note</button>
    <button class="deck-camera-alt" type="button" data-camera-fallback>Live camera blank? Open your phone camera</button>
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

  <div class="scan-discard" data-discard hidden role="alertdialog" aria-modal="true" aria-labelledby="homle-discard-title" aria-describedby="homle-discard-copy">
    <div class="scan-discard-in">
      <p class="scan-discard-eyebrow" data-discard-eyebrow>Unsaved room scan</p>
      <h2 id="homle-discard-title" data-discard-title>Leave this room scan?</h2>
      <p id="homle-discard-copy" data-discard-copy>Your confirmed rooms and notes are only held on this screen.</p>
      <div class="scan-discard-actions">
        <button class="button" type="button" data-discard-keep>Keep scanning</button>
        <button class="button ghost" type="button" data-discard-confirm>Discard scan</button>
      </div>
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
// The detector's own input is a few hundred pixels square, so there is nothing
// to gain from handing it a full 720p+ camera frame — only a larger texture to
// upload on every pass. Frames longer than this on their longest edge are copied
// down first; the aspect ratio is preserved so box geometry is unaffected.
const DETECT_INPUT_SIZE = 320;
// Framing guidance is sampled at most this often. A pixel readback is synchronous,
// and advice that changes faster than a person can react is just flicker.
const QUALITY_SAMPLE_MS = 900;
// Small enough that the readback and the loop over it are trivial, large enough to
// tell a dim or smeared room from a sharp one.
const QUALITY_SAMPLE_WIDTH = 64;
const QUALITY_SAMPLE_HEIGHT = 48;

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
    // Requested together rather than one after the next. Each tag already sets
    // `async = false`, so the browser still executes them in this order — it just
    // stops waiting for one megabyte to arrive before asking for the next file.
    await Promise.all(detectorScripts.map(loadDetectorScript));
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

// Some mobile browsers resolve getUserMedia() before the video element has
// received a usable frame. Treating the stream object alone as success leaves a
// blank viewfinder whose shutter can only say "warming up" forever. Exporting
// the readiness boundary keeps that browser-specific failure directly tested.
export function waitForCameraFrame(video, timeoutMs = 6000) {
  const hasFrame = () => video.videoWidth > 0
    && video.videoHeight > 0
    && Number(video.readyState) >= 2;
  if (hasFrame()) return Promise.resolve();
  return new Promise((resolveFrame, rejectFrame) => {
    let settled = false;
    let timer = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", check);
      video.removeEventListener("canplay", check);
      video.removeEventListener("playing", check);
      if (error) rejectFrame(error);
      else resolveFrame();
    };
    const check = () => {
      if (hasFrame()) finish();
    };
    video.addEventListener("loadedmetadata", check);
    video.addEventListener("canplay", check);
    video.addEventListener("playing", check);
    timer = setTimeout(() => {
      const error = new Error("The live camera opened but did not provide a picture.");
      error.name = "CameraNotReadyError";
      finish(error);
    }, timeoutMs);
    check();
  });
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
      stage: $("[data-scan-stage]"), viewfinder: $("[data-viewfinder]"), camera: $("[data-camera]"), canvas: $("[data-capture-canvas]"),
      blocked: $("[data-camera-blocked]"), blockedReason: $("[data-camera-blocked-reason]"), retry: $("[data-camera-retry]"),
      fallbacks: $$("[data-camera-fallback]"), fallbackInput: $("[data-camera-fallback-input]"),
      videoFallbacks: $$("[data-video-fallback]"), videoFallbackInput: $("[data-video-fallback-input]"),
      mesh: $("[data-mesh]"), detections: $("[data-detection-layer]"), detectorState: $("[data-detector-state]"), flash: $("[data-flash]"),
      still: $("[data-still]"), roomLabel: $("[data-room-label]"), shotCount: $("[data-shot-count]"), hint: $("[data-hint]"),
      mic: $("[data-mic]"), shutter: $("[data-shutter]"),
      selection: $("[data-selection]"), selectionHint: $("[data-selection-hint]"), retake: $("[data-retake]"), readRoom: $("[data-read-room]"),
      hub: $("[data-hub]"), hubTitle: $("[data-hub-title]"), hubSub: $("[data-hub-sub]"), hubRooms: $("[data-hub-rooms]"),
      hubAddLabel: $("[data-hub-add-lbl]"), hubChoices: $("[data-hub-choices]"), hubOtherForm: $("[data-hub-other-form]"),
      hubOther: $("[data-hub-other]"), hubFinish: $("[data-hub-finish]"), roomsOpen: $$("[data-rooms-open]"),
      voice: $("[data-voice-panel]"), voiceTime: $("[data-voice-time]"), wave: $("[data-wave]"),
      voiceStatus: $("[data-voice-status]"), note: $("[data-room-note]"), noteDone: $("[data-note-done]"), noteOpen: $$("[data-note-open]"),
      deck: $("[data-camera-deck]"),
      consent: $("[data-consent]"), consentAllow: $("[data-consent-allow]"), consentDecline: $("[data-consent-decline]"),
      discard: $("[data-discard]"), discardEyebrow: $("[data-discard-eyebrow]"),
      discardTitle: $("[data-discard-title]"), discardCopy: $("[data-discard-copy]"),
      discardKeep: $("[data-discard-keep]"), discardConfirm: $("[data-discard-confirm]"),
      toast: $("[data-toast]")
    };

    const state = {
      stream: null, cameraStarting: false, resumeCameraOnVisible: false,
      rooms: [], capturing: false, photoProcessing: false, videoProcessing: false,
      voiceOn: false, voiceUsed: false, roomTranscripts: new Map(), seconds: 0,
      voiceGeneration: 0,
      timers: { wave: null, clock: null, cameraResume: null }, recognition: null,
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
      // Inference runs on a small copy of the frame, not the full camera
      // resolution, and the viewfinder box is measured once rather than on every
      // pass. Both are recreated on demand, so an orientation change is safe.
      detectCanvas: null, viewRect: null,
      // Framing guidance, sampled off the detector's own frame.
      lastQualityAt: 0, qualityKind: "", qualityMessage: "", qualityCanvas: null,
      // Detection boxes, reused between passes and keyed by tracker id.
      boxNodes: new Map(),
      // Kept separate from `generation`: pausing detection must never discard a
      // room reading that is still in flight.
      detectionGeneration: 0,
      tracks: [], nextTrackId: 1, liveDetectionAvailable: true
    };

    let toastTimer = null;
    let discardPreviousFocus = null;
    let discardMode = "scan";
    let discardRoomName = "";
    function toast(message) {
      el.toast.textContent = message;
      el.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
    }

    function hasScanProgress() {
      if (state.rooms.length || state.frozenFrame || state.photoProcessing || state.videoProcessing) return true;
      return [...state.roomTranscripts.values()].some((note) => String(note || "").trim());
    }

    function setScanBackgroundInert(inert) {
      for (const child of el.stage.children) {
        if (child === el.discard) continue;
        child.inert = inert;
        if (inert) child.setAttribute("aria-hidden", "true");
        else child.removeAttribute("aria-hidden");
      }
    }

    function hideDiscard({ restoreFocus = true } = {}) {
      if (el.discard.hidden) return;
      el.discard.hidden = true;
      setScanBackgroundInert(false);
      const focusTarget = discardPreviousFocus;
      discardPreviousFocus = null;
      if (restoreFocus && focusTarget instanceof HTMLElement && overlay.contains(focusTarget)) {
        focusTarget.focus({ preventScroll: true });
      }
    }

    function openDiscardDecision({ mode, roomName = "", eyebrow, title, copy, keepLabel, confirmLabel }) {
      if (!el.discard.hidden || state.closed) return;
      discardMode = mode;
      discardRoomName = roomName;
      el.discardEyebrow.textContent = eyebrow;
      el.discardTitle.textContent = title;
      el.discardCopy.textContent = copy;
      el.discardKeep.textContent = keepLabel;
      el.discardConfirm.textContent = confirmLabel;
      discardPreviousFocus = document.activeElement;
      setScanBackgroundInert(true);
      el.discard.hidden = false;
      el.discardKeep.focus({ preventScroll: true });
    }

    function showDiscard() {
      if (!el.discard.hidden || state.closed) return;
      // Stop listening before displaying a decision over the camera. The exact
      // visible draft is retained, including a final word still on screen.
      if (!el.voice.hidden) setRoomTranscriptDraft(el.note.value);
      if (state.voiceOn) stopVoice({ silent: true });
      const roomCount = state.rooms.length;
      const roomLabel = `${roomCount} confirmed room${roomCount === 1 ? "" : "s"}`;
      const hasCurrentWork = Boolean(state.frozenFrame || roomTranscript().trim());
      openDiscardDecision({
        mode: "scan",
        eyebrow: "Unsaved room scan",
        title: "Leave this room scan?",
        copy: roomCount
          ? `Your ${roomLabel}${hasCurrentWork ? " and current edits" : ""} are only held on this screen. Discarding removes them.`
          : "Your current room photo or note is only held on this screen. Discarding removes it.",
        keepLabel: "Keep scanning",
        confirmLabel: "Discard scan"
      });
    }

    function showRoomRemoval(rawName) {
      const room = findRoom(state.rooms, rawName);
      if (!room || state.closed) return;
      openDiscardDecision({
        mode: "room",
        roomName: room.name,
        eyebrow: "Change room scan",
        title: `Remove ${room.name}?`,
        copy: `Its photo, note and checklist tasks will be removed from this scan. Your other rooms stay unchanged.`,
        keepLabel: "Keep room",
        confirmLabel: "Remove room"
      });
    }

    function confirmDiscardDecision() {
      if (discardMode !== "room") return close(null);
      const removedName = discardRoomName;
      const key = transcriptKey(removedName);
      state.rooms = removeRoom(state.rooms, removedName);
      state.roomTranscripts.delete(key);
      if (transcriptKey(state.currentRoom) === key) state.currentRoom = "";
      discardMode = "scan";
      discardRoomName = "";
      hideDiscard({ restoreFocus: false });
      renderHub();
      el.hubOther.focus({ preventScroll: true });
      toast(`${removedName} removed from this scan.`);
    }

    function requestClose() {
      if (state.closed) return;
      if (hasScanProgress()) showDiscard();
      else close(null);
    }

    function onBeforeUnload(event) {
      if (state.closed || !hasScanProgress()) return;
      event.preventDefault();
      // Browsers deliberately replace this with their own privacy-safe copy.
      event.returnValue = "";
    }

    function transcriptKey(roomName = state.currentRoom) {
      return normaliseRoomName(roomName).toLowerCase();
    }

    function roomTranscript(roomName = state.currentRoom) {
      const key = transcriptKey(roomName);
      if (!key) return "";
      if (state.roomTranscripts.has(key)) return state.roomTranscripts.get(key);
      return String(findRoom(state.rooms, roomName)?.transcript || "").replace(/\s+/g, " ").trim().slice(0, 5000);
    }

    function setRoomTranscript(value, roomName = state.currentRoom) {
      const key = transcriptKey(roomName);
      if (!key) return "";
      const note = String(value || "").replace(/\s+/g, " ").trim().slice(0, 5000);
      state.roomTranscripts.set(key, note);
      return note;
    }

    function setRoomTranscriptDraft(value, roomName = state.currentRoom) {
      const key = transcriptKey(roomName);
      if (!key) return "";
      const note = String(value || "").slice(0, 5000);
      state.roomTranscripts.set(key, note);
      return note;
    }

    function renderRoomNoteControls(note = roomTranscript()) {
      const hasNote = Boolean(String(note || "").trim());
      el.mic.classList.toggle("ready", hasNote && !state.voiceOn);
      const micLabel = el.mic.querySelector(".deck-btn-lbl");
      if (micLabel) micLabel.textContent = hasNote ? "Add voice" : "Voice note";
      for (const button of el.noteOpen) button.textContent = hasNote ? "Review this room’s note" : "Type a room note";
    }

    function renderVoiceTranscript(interim = "") {
      el.note.value = `${roomTranscript()} ${String(interim || "").trim()}`.trim();
      renderRoomNoteControls(el.note.value);
    }

    function openNoteEditor({ focus = false } = {}) {
      renderVoiceTranscript();
      el.voice.hidden = false;
      el.voice.classList.add("on");
      if (focus) setTimeout(() => el.note.focus({ preventScroll: true }), 0);
    }

    function closeNoteEditor() {
      if (state.voiceOn) stopVoice({ silent: true });
      setRoomTranscript(el.note.value);
      renderVoiceTranscript();
      el.voice.classList.remove("on", "recording");
      el.voice.hidden = true;
      el.hint.innerHTML = roomTranscript()
        ? "<b>Room note ready</b> — check the photo, then confirm"
        : "Point at the room and tap the shutter";
    }

    /* ── The hub: choose a room, review the scan, return to a room ── */

    // One screen is shown at a time. The hub covers the camera; the camera keeps
    // running behind it so re-entering a room is instant, but detection is paused
    // while nobody is pointing at anything.
    function showScreen(name) {
      state.screen = name;
      el.hub.hidden = name === "live";
      // Showing or hiding the hub changes the viewfinder's box.
      state.viewRect = null;
      if (name === "live") { el.roomLabel.textContent = state.currentRoom; startDetection(); }
      else stopDetection();
      renderDetectorState();
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
        li.className = "hub-room-row";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hub-room";
        button.dataset.room = room.name;
        const meta = room.itemCount
          ? `${room.itemCount} object${room.itemCount === 1 ? "" : "s"} · ${room.conditionLabel}`
          : "No objects yet";
        // What was picked, and whether a spoken note is attached — the two things
        // the review was missing, so a room can be checked without reopening it.
        const shown = room.itemLabels.slice(0, 4).join(", ");
        const extra = room.itemLabels.length > 4 ? ` +${room.itemLabels.length - 4} more` : "";
        const detail = [shown ? shown + extra : "", room.hasNote ? "Voice note added" : ""].filter(Boolean).join(" · ");
        button.append(
          Object.assign(document.createElement("span"), { className: "hub-room-name", textContent: room.name }),
          Object.assign(document.createElement("span"), { className: "hub-room-meta", textContent: meta })
        );
        if (detail) button.append(Object.assign(document.createElement("span"), { className: "hub-room-detail", textContent: detail }));
        button.append(Object.assign(document.createElement("span"), { className: "hub-room-edit", textContent: "Edit" }));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "hub-room-remove";
        remove.dataset.roomRemove = room.name;
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${room.name} from this scan`);
        li.append(button, remove);
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
      // A late result from the phone's speech service must not land after the
      // current room changes. The note itself is already retained in the room
      // map before the recogniser is released.
      if (state.voiceOn) stopVoice({ silent: true });
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
      if (state.voiceOn) stopVoice({ silent: true });
      const existing = findRoom(state.rooms, name);
      if (!existing && !canAddRoom(state.rooms, name)) return toast("That's as many rooms as one scan can carry.");
      state.roomSession += 1;
      state.currentRoom = name;
      const key = transcriptKey(name);
      if (!state.roomTranscripts.has(key)) setRoomTranscript(existing?.transcript || "", name);
      renderVoiceTranscript();
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
      // Advice about the last room's lighting must not carry into this one.
      state.qualityKind = "";
      state.qualityMessage = "";
      state.lastQualityAt = 0;
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
        if (state.closed || document.hidden) {
          for (const track of stream.getTracks()) track.stop();
          state.resumeCameraOnVisible = !state.closed;
          return;
        }
        state.stream = stream;
        el.camera.srcObject = stream;
        el.blocked.hidden = true;
        el.deck.hidden = false;
        el.deck.inert = false;
        el.deck.removeAttribute("aria-hidden");
        el.shutter.disabled = false;
        await el.camera.play();
        await waitForCameraFrame(el.camera);
        if (state.closed) { stopCamera(); return; }
        // Nothing has left the device at this point and nothing will: the
        // detector is local, and starting it now is what gives the Landlord
        // boxes to tap the moment they freeze a frame.
        startDetection();
      } catch (error) {
        stopCamera();
        if (state.closed) return;
        const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
        const stalled = error?.name === "CameraNotReadyError" || error?.name === "AbortError";
        blockCamera(denied
          ? "Live camera permission is blocked. Open the phone camera below, or allow Camera in your browser settings and retry."
          : stalled
            ? "The live camera opened but no picture arrived. Open the phone camera below, or try the live camera again."
            : "No live camera could be opened. Use the phone camera below to take each room photo instead.");
      }
    }

    function blockCamera(reason) {
      el.blockedReason.textContent = reason;
      el.blocked.hidden = false;
      // The recovery card sits over the camera deck. Inert keeps the covered
      // mic, shutter and duplicate fallback actions out of keyboard and screen
      // reader navigation until a usable frame exists again.
      el.deck.hidden = true;
      el.deck.inert = true;
      el.deck.setAttribute("aria-hidden", "true");
      el.shutter.disabled = true;
    }

    function stopCamera() {
      for (const track of state.stream?.getTracks?.() || []) track.stop();
      state.stream = null;
      try { el.camera.pause(); } catch {}
      el.camera.srcObject = null;
    }

    function scheduleCameraResume() {
      window.clearTimeout(state.timers.cameraResume);
      state.timers.cameraResume = window.setTimeout(() => {
        if (state.closed || document.hidden || !state.resumeCameraOnVisible) return;
        if (state.frozen) {
          state.resumeCameraOnVisible = false;
          return;
        }
        if (state.photoProcessing || state.videoProcessing || state.loadingRoom || state.capturing) {
          scheduleCameraResume();
          return;
        }
        state.resumeCameraOnVisible = false;
        startCamera();
      }, 350);
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
      if (!video.videoWidth || !video.videoHeight || Number(video.readyState) < 2) return null;
      return drawVisibleRegion(video, video.videoWidth, video.videoHeight);
    }

    // Only decodes — it does not touch the shared canvas. The caller draws to the
    // canvas synchronously, after confirming the Landlord is still in this room,
    // so an abandoned decode from a room already left cannot redraw the canvas a
    // later crop is cut from.
    function decodePhoto(file) {
      return new Promise((resolveImage, rejectImage) => {
        try {
          validatedGuidedRoomPhotoFile(file);
        } catch (error) {
          rejectImage(error);
          return;
        }
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(objectUrl);
          try {
            validatedGuidedRoomPhotoDimensions(image.naturalWidth, image.naturalHeight);
            resolveImage(image);
          } catch (error) {
            rejectImage(error);
          }
        };
        image.onerror = () => { URL.revokeObjectURL(objectUrl); rejectImage(new TypeError("That photo could not be opened.")); };
        image.src = objectUrl;
      });
    }

    /* ── Choosing what matters ── */

    // Live boxes and selectable boxes are drawn the same way; only whether they
    // respond to a tap and whether they read as chosen differs.
    // The live loop repaints several times a second, so the boxes are pooled and
    // keyed by the tracker's stable id: a box that is still there is moved rather
    // than destroyed and rebuilt. That removes ~24 element allocations per pass,
    // and — because the nodes now survive between passes — the fade in the
    // stylesheet finally has something to transition, which it never did while
    // every node was created already carrying its final class.
    function paintBoxes(boxes, { selectable = false } = {}) {
      const pool = state.boxNodes;
      const keep = new Set();
      for (const item of boxes) {
        keep.add(item.id);
        let node = pool.get(item.id);
        if (!node) {
          const box = document.createElement("div");
          const tag = document.createElement("span");
          tag.className = "det-tag";
          box.appendChild(tag);
          node = { box, tag, className: "", geometry: "", label: null };
          pool.set(item.id, node);
          el.detections.appendChild(box);
        }
        const className = `det-box show${selectable ? " pickable" : ""}${state.selectedIds.has(item.id) ? " picked" : ""}`;
        if (node.className !== className) {
          node.box.className = className;
          node.className = className;
        }
        const geometry = `left:${item.x}%;top:${item.y}%;width:${item.width}%;height:${item.height}%`;
        if (node.geometry !== geometry) {
          node.box.style.cssText = geometry;
          node.geometry = geometry;
        }
        const label = item.label || "";
        if (node.label !== label) {
          node.tag.textContent = label;
          node.tag.hidden = !label;
          node.label = label;
        }
      }
      for (const [id, node] of pool) {
        if (keep.has(id)) continue;
        node.box.remove();
        pool.delete(id);
      }
    }

    // Anything that empties the layer directly has to drop the pool with it, or
    // the next paint would reuse nodes that are no longer in the document.
    function clearBoxes() {
      state.boxNodes.clear();
      el.detections.innerHTML = "";
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
      // The cached viewfinder box is only valid for the current layout.
      state.viewRect = null;
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
      clearBoxes();
      // Back to full-bleed: live boxes are percentages of the viewfinder again.
      resetLayout();
      if (state.stream) startDetection();
      else startCamera();
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
      if (state.voiceOn) stopVoice({ silent: true });
      setRoomTranscript(el.note.value);
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
      const spokenNote = roomTranscript(roomName);

      // A fresh capture always reads — its boxes are raw detections that need
      // naming, grading and notes. A revisit reads only when the set of objects
      // actually changed: adding one needs it named, and removing one must
      // re-scope the room so a task like "clean the oven" cannot outlive the oven
      // and quietly keep pricing a job for it. An unchanged save reads nothing.
      const originalCount = Array.isArray(existing.detections) ? existing.detections.length : 0;
      const keptCount = chosen.filter((box) => box.kind !== "manual").length;
      const spokenChanged = spokenNote !== String(existing.transcript || "").replace(/\s+/g, " ").trim();
      const changed = chosen.some((box) => box.kind === "manual") || keptCount < originalCount || spokenChanged;
      // Clearing every object on a revisit means the room genuinely has none —
      // it must not fall through to a whole-room read, which would rediscover
      // exactly what the Landlord just removed.
      const clearedRevisit = revisit && chosen.length === 0 && !spokenNote;
      const mustRead = (!revisit || changed) && !clearedRevisit;

      if (mustRead && !state.consentAsked) await askConsent();
      if (session !== state.roomSession || state.closed) { state.capturing = false; return; }

      let room;
      if (clearedRevisit) {
        // An emptied room: no objects, and so no scoped tasks and no grade.
        room = { name: roomName, image: frame, detections: [], tasks: [], condition: "", transcript: spokenNote };
      } else if (mustRead) {
        el.flash.classList.remove("pop"); void el.flash.offsetWidth; el.flash.classList.add("pop");
        el.mesh.classList.add("on");
        el.viewfinder.classList.add("scanning");
        el.hint.innerHTML = "<b>Reading the room…</b> one moment";
        let reading = { detections: [], tasks: [], condition: "" };
        let readingError = "";
        try { reading = await readRoom(frame, roomName, chosen, spokenNote); } catch (error) {
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
          condition: reading.condition || "",
          transcript: spokenNote
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
          condition: existing.condition || "",
          transcript: spokenNote
        };
      }

      if (session !== state.roomSession || state.closed) return;
      const replacing = Boolean(existing);
      state.rooms = upsertRoom(state.rooms, room);
      state.tracks = [];
      state.capturing = false;
      toHub();
      // Saving a room used to be silent: the only sign it had worked was a new row
      // appearing on the hub. Confirm it explicitly, and say what the next room
      // would be so the walkthrough keeps its momentum.
      if (!readingError) {
        const count = room.detections.length;
        const items = count ? `${count} ${count === 1 ? "item" : "items"}` : "photo";
        // Suggested from the rooms not yet covered, never from how many have been
        // captured: which room comes next is the Landlord's choice, and a home is
        // not a fixed list. Silent once the common rooms are all done.
        const remaining = roomPresets.filter((preset) => !findRoom(state.rooms, preset));
        const upcoming = remaining.length ? ` Next: ${remaining[0].toLowerCase()}?` : "";
        toast(`${room.name} saved — ${items}${replacing ? " updated" : ""}.${upcoming}`);
      }
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
      if (state.loadingRoom || state.capturing || state.photoProcessing) return;
      state.photoProcessing = true;
      for (const button of el.fallbacks) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
      }
      const session = state.roomSession;
      try {
        const image = await decodePhoto(file);
        // Decoding is async; if the Landlord has since left this room or a stored
        // photo is loading into the canvas, drop it before it can draw over.
        if (state.closed || session !== state.roomSession || state.loadingRoom || state.capturing) return;
        const frame = drawVisibleRegion(image, image.naturalWidth, image.naturalHeight);
        if (!frame) throw new TypeError("That photo could not be opened.");
        el.blocked.hidden = true;
        el.deck.hidden = false;
        el.deck.inert = false;
        el.deck.removeAttribute("aria-hidden");
        // A photo chosen from the phone's own camera never had a live
        // viewfinder, so there are no detected boxes to start from — but it can
        // still be marked up by hand before it is read.
        freezeFrame(frame);
      } catch (error) {
        if (session === state.roomSession) blockCamera(error?.message || "That room photo could not be opened. Try another one.");
      } finally {
        state.photoProcessing = false;
        if (!state.closed) {
          for (const button of el.fallbacks) {
            button.disabled = false;
            button.removeAttribute("aria-busy");
          }
          if (state.resumeCameraOnVisible) scheduleCameraResume();
        }
      }
    }

    function videoContactSheet(frames) {
      return Promise.all(frames.map((frame) => decodePhoto(frame))).then((images) => new Promise((resolve, reject) => {
        if (!images.length) return reject(new TypeError("No readable room frames were found in that video."));
        const rect = el.viewfinder.getBoundingClientRect();
        const first = images[0];
        const fallbackAspect = first.naturalWidth / first.naturalHeight;
        const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : fallbackAspect;
        const canvas = document.createElement("canvas");
        if (aspect >= 1) {
          canvas.width = 1280;
          canvas.height = Math.max(1, Math.round(1280 / aspect));
        } else {
          canvas.height = 1280;
          canvas.width = Math.max(1, Math.round(1280 * aspect));
        }
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return reject(new TypeError("This browser cannot prepare the room video. Use room photos instead."));
        context.fillStyle = "#050506";
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Pick the grid that preserves the greatest number of source pixels.
        // Portrait and landscape clips therefore both stay useful instead of
        // being forced through a layout that turns every frame into a thumbnail.
        const layout = roomVideoContactSheetLayout({
          frameCount: images.length,
          sourceWidth: first.naturalWidth,
          sourceHeight: first.naturalHeight,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height
        });
        const { cellWidth, cellHeight } = layout;
        images.forEach((image, index) => {
          const column = index % layout.columns;
          const row = Math.floor(index / layout.columns);
          const scale = Math.min(cellWidth / image.naturalWidth, cellHeight / image.naturalHeight);
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          const x = column * cellWidth + (cellWidth - width) / 2;
          const y = row * cellHeight + (cellHeight - height) / 2;
          context.drawImage(image, x, y, width, height);
          if (index > 0) {
            context.strokeStyle = "rgba(255,255,255,.45)";
            context.lineWidth = 2;
            context.strokeRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
          }
        });
        const timer = window.setTimeout(() => reject(new TypeError("The room video took too long to prepare. Try a shorter clip.")), 10_000);
        canvas.toBlob((blob) => {
          window.clearTimeout(timer);
          if (!blob?.size || blob.type !== "image/jpeg") return reject(new TypeError("The room video could not be prepared. Use room photos instead."));
          if (typeof File === "function") return resolve(new File([blob], "room-video-scan.jpg", { type: "image/jpeg", lastModified: Date.now() }));
          Object.defineProperty(blob, "name", { configurable: true, value: "room-video-scan.jpg" });
          resolve(blob);
        }, "image/jpeg", 0.8);
      }));
    }

    // A short room video is an input convenience, not another private record.
    // The raw clip and its audio never leave the phone: three frames are
    // extracted and combined locally into one reviewable room sheet, which then
    // follows the exact same consent and room-reading path as a photograph. One
    // provider request sees the beginning, middle and end without tripling cost.
    async function captureSelectedVideo(file) {
      if (state.loadingRoom || state.capturing || state.videoProcessing || !file) return;
      state.videoProcessing = true;
      el.shutter.disabled = true;
      for (const button of el.videoFallbacks) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
      }
      const previousHint = el.hint.textContent;
      el.hint.innerHTML = "<b>Preparing the room video…</b> raw video stays on this phone";
      try {
        const frames = await extractRoomVideoFrames(file, { frameCount: maximumRoomVideoFrames });
        if (state.closed) return;
        const sheet = await videoContactSheet(frames);
        if (state.closed) return;
        await captureSelectedPhoto(sheet);
        if (!state.closed) toast("Three room views are ready. The raw video and audio stayed on this phone.");
      } catch (error) {
        if (!state.closed) {
          const message = error?.message || "That room video could not be opened. Record a shorter clip or use a photo.";
          if (!el.blocked.hidden) el.blockedReason.textContent = message;
          toast(message);
        }
      } finally {
        state.videoProcessing = false;
        if (!state.closed) {
          el.shutter.disabled = !el.blocked.hidden;
          for (const button of el.videoFallbacks) {
            button.disabled = false;
            button.removeAttribute("aria-busy");
          }
          if (!state.frozen) el.hint.textContent = previousHint || "Point at the room and tap the shutter";
        }
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

    async function readRoom(image, roomName, items = [], transcript = "") {
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
      const payload = roomReadingPayload({ roomName, transcript: String(transcript || "").slice(-1200), roomFrame: image, items: selected });
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

    // Begins the one-time detector load. Safe to call repeatedly and safe to call
    // before the camera exists: `loadDetectorOnce` is idempotent. Called as soon
    // as the overlay opens so the megabytes travel while the Landlord is still
    // choosing a room and granting camera permission, instead of after.
    function warmDetector() {
      if (state.detectorState !== "idle") return;
      state.detectorState = "loading";
      renderDetectorState();
      loadDetectorOnce().then((model) => {
        if (state.closed) return;
        state.detector = model;
        state.detectorState = "ready";
        renderDetectorState();
      }).catch(() => {
        // The scan carries on exactly as it did before any of this existed:
        // photographs, voice notes and boxes added by hand.
        state.detectorState = "unavailable";
        state.liveDetectionAvailable = false;
        renderDetectorState();
      });
    }

    // Until now the detector's state was never shown, so a Landlord on a slow
    // connection watched a camera that simply did not find anything and had no
    // way to know why. The badge says what is happening and disappears once
    // boxes can actually appear.
    function renderDetectorState() {
      if (!el.detectorState) return;
      const live = state.screen === "live";
      if (!live || state.frozen) {
        el.detectorState.hidden = true;
        return;
      }
      // Once the detector is up, this line is where framing guidance goes: it is
      // the more useful thing to say about a live frame, and only one of the two
      // ever needs saying at a time.
      if (state.detectorState === "ready") {
        if (!state.qualityMessage) {
          el.detectorState.hidden = true;
          return;
        }
        el.detectorState.hidden = false;
        el.detectorState.dataset.kind = "guide";
        el.detectorState.textContent = state.qualityMessage;
        return;
      }
      if (state.detectorState === "unavailable") {
        el.detectorState.hidden = false;
        el.detectorState.dataset.kind = "off";
        el.detectorState.textContent = "Automatic object finding is unavailable — tap anything in the frame to mark it yourself.";
        return;
      }
      el.detectorState.hidden = false;
      el.detectorState.dataset.kind = "loading";
      el.detectorState.textContent = "Getting the object finder ready… you can already photograph the room or tap to mark items.";
    }

    function startDetection() {
      // Only while the Landlord is actually pointing at a room. Behind the hub
      // the camera is warm but there is nothing to detect, so the loop stays off.
      if (state.screen !== "live" || state.closed || state.frozen || !state.stream) return;
      if (!state.liveDetectionAvailable || state.rafId) return;
      warmDetector();

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

    // A phone camera hands us 720p or more. The detector only ever sees a few
    // hundred pixels a side, so uploading the full frame to the GPU and letting
    // the model shrink it is work paid for on every pass. Copying into one
    // reusable small canvas first keeps the aspect ratio — which is what makes
    // the box maths below scale-invariant — and cuts the per-frame cost sharply.
    function inferenceFrame(video) {
      const longest = Math.max(video.videoWidth, video.videoHeight);
      if (longest <= DETECT_INPUT_SIZE) return video;
      const scale = DETECT_INPUT_SIZE / longest;
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      let canvas = state.detectCanvas;
      if (!canvas) canvas = state.detectCanvas = document.createElement("canvas");
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas.getContext("2d").drawImage(video, 0, 0, width, height);
      return canvas;
    }

    // Brightness and detail, read off the small frame already drawn for the
    // detector, so guidance costs one `getImageData` on a few hundred pixels rather
    // than any extra work on the camera path. Sampled every few passes, not every
    // pass — a readback is the one genuinely synchronous thing here.
    function sampleFrameQuality(source) {
      if (!source) return;
      const now = Date.now();
      if (now - state.lastQualityAt < QUALITY_SAMPLE_MS) return;
      state.lastQualityAt = now;
      // Its own small canvas, flagged for readback. Reading pixels back off the
      // detector's canvas would push that one off the GPU path it is there to use.
      let canvas = state.qualityCanvas;
      if (!canvas) {
        canvas = state.qualityCanvas = document.createElement("canvas");
        canvas.width = QUALITY_SAMPLE_WIDTH;
        canvas.height = QUALITY_SAMPLE_HEIGHT;
      }
      let pixels;
      try {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      } catch { return; }
      const stride = 4;
      let total = 0;
      let deltas = 0;
      let count = 0;
      let previous = null;
      for (let index = 0; index < pixels.length; index += stride) {
        const luma = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
        total += luma;
        if (previous !== null) deltas += Math.abs(luma - previous);
        previous = luma;
        count += 1;
      }
      if (!count) return;
      const advice = frameQualityAdvice({ luma: total / count, detail: count > 1 ? deltas / (count - 1) : 0 });
      const key = advice ? advice.kind : "";
      if (key === state.qualityKind) return;
      state.qualityKind = key;
      state.qualityMessage = advice ? advice.message : "";
      renderDetectorState();
    }

    // Measuring the viewfinder forces layout. It only changes when the window or
    // orientation does, so it is measured once and reused until invalidated.
    function viewfinderRect() {
      if (!state.viewRect) state.viewRect = el.viewfinder.getBoundingClientRect();
      return state.viewRect;
    }

    async function runDetection(generation) {
      const video = el.camera;
      // Mobile Safari reports zero dimensions until metadata has loaded.
      if (!video.videoWidth || !video.videoHeight) return;
      detectorBusy = true;
      const startedAt = Date.now();
      try {
        const source = inferenceFrame(video);
        sampleFrameQuality(source);
        const found = await state.detector.detect(source, 12);
        if (state.closed || state.frozen || generation !== state.detectionGeneration) return;
        const rect = viewfinderRect();
        const mapped = [];
        for (const item of found) {
          const [x, y, width, height] = Array.isArray(item?.bbox) ? item.bbox : [];
          const box = fitBoxToFrame({ x, y, width, height }, {
            // The boxes come back in the coordinates of whatever was inferred on,
            // so the frame it was measured against is the one to map from.
            videoWidth: source.width || video.videoWidth,
            videoHeight: source.height || video.videoHeight,
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
        clearBoxes();
      } finally {
        detectorBusy = false;
        // A phone that needs 400ms a frame is asked for fewer, rather than
        // being pinned at full load until the viewfinder itself stutters.
        state.detectionInterval = nextDetectionDelay(Date.now() - startedAt);
      }
    }

    function pauseForBackground() {
      state.resumeCameraOnVisible ||= Boolean(state.stream) && !state.frozen;
      stopDetection();
      stopCamera();
      if (state.voiceOn) stopVoice({ silent: true });
    }

    function resumeAfterBackground() {
      if (state.closed || document.hidden) return;
      if (state.resumeCameraOnVisible) scheduleCameraResume();
      else if (state.stream) startDetection();
    }

    function onVisibility() {
      if (document.hidden) pauseForBackground();
      else resumeAfterBackground();
    }

    function onPageHide() { pauseForBackground(); }
    function onPageShow() { resumeAfterBackground(); }

    /* ── Voice ── */
    function buildWave() {
      el.wave.innerHTML = "";
      for (let index = 0; index < 34; index += 1) el.wave.appendChild(document.createElement("b"));
    }

    function startVoice() {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) {
        openNoteEditor({ focus: true });
        el.hint.textContent = "Voice listening is unavailable here. Type the room note instead.";
        return toast("Type the room note, then tap Done.");
      }
      const recognition = new Recognition();
      const generation = state.voiceGeneration + 1;
      state.voiceGeneration = generation;
      recognition.lang = document.documentElement.lang || "en-GB";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        if (state.recognition !== recognition || generation !== state.voiceGeneration) return;
        let finalText = "";
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result.isFinal) finalText += result[0].transcript;
          else interim += result[0].transcript;
        }
        if (finalText) setRoomTranscript(`${roomTranscript()} ${finalText}`);
        renderVoiceTranscript(interim);
      };
      recognition.onerror = () => {
        if (state.recognition === recognition && generation === state.voiceGeneration) stopVoice({ failed: true });
      };
      recognition.onend = () => {
        if (state.recognition === recognition && generation === state.voiceGeneration && state.voiceOn) stopVoice();
      };
      try { recognition.start(); } catch {
        openNoteEditor({ focus: true });
        el.hint.textContent = "Listening could not start. Type the room note or try the microphone again.";
        return toast("Listening could not start. Your typed note still works.");
      }

      state.recognition = recognition;
      state.voiceOn = true;
      state.voiceUsed = true;
      state.seconds = 0;
      el.voice.hidden = false;
      el.voice.classList.add("on", "recording");
      el.voiceStatus.textContent = "Voice note · recording";
      el.mic.classList.remove("ready");
      el.mic.classList.add("rec");
      el.mic.setAttribute("aria-pressed", "true");
      el.hint.innerHTML = "<b>Listening…</b> just talk normally";

      const bars = $$("[data-wave] b");
      state.timers.wave = setInterval(() => {
        for (const [index, bar] of bars.entries()) {
          const base = Math.abs(Math.sin((Date.now() / 170) + index * 0.55));
          // scaleY rather than height: a transform does not lay out, and the
          // per-bar randomness is gone — it forced a fresh value every tick for
          // every bar and the sine already reads as a moving wave.
          bar.style.transform = `scaleY(${(0.2 + base * 0.72).toFixed(3)})`;
          bar.style.opacity = String(0.45 + base * 0.55);
        }
      }, 70);
      state.timers.clock = setInterval(() => {
        state.seconds += 1;
        el.voiceTime.textContent = `${Math.floor(state.seconds / 60)}:${String(state.seconds % 60).padStart(2, "0")}`;
      }, 1000);
    }

    function stopVoice({ silent = false, failed = false } = {}) {
      state.voiceOn = false;
      state.voiceGeneration += 1;
      clearInterval(state.timers.wave);
      clearInterval(state.timers.clock);
      const recognition = state.recognition;
      state.recognition = null;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try { recognition.stop(); } catch {}
      }
      el.mic.classList.remove("rec");
      el.mic.setAttribute("aria-pressed", "false");
      el.voice.classList.remove("recording");
      el.voiceStatus.textContent = failed ? "Room note · listening stopped" : "Room note · review";
      for (const bar of $$("[data-wave] b")) bar.style.height = "18%";
      if (silent) {
        el.voice.classList.remove("on");
        el.voice.hidden = true;
        return;
      }
      if (failed) el.hint.textContent = "Listening stopped. Your notes so far are kept.";
      else if (roomTranscript()) {
        el.hint.innerHTML = "<b>Check the room note</b> — correct anything before confirming";
        toast("Check what Homle heard, then tap Done");
      }
      openNoteEditor();
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
        transcript: scanTranscript(state.rooms),
        // These compressed JPEGs stay only in this in-memory return value. The
        // guided booking journey can upload them after it has created the
        // authenticated private draft, but saveDraft() never serialises them
        // into sessionStorage. A refresh therefore cannot leave photographs of
        // a home in browser storage.
        photos: state.rooms.filter((room) => Array.isArray(room.tasks) && room.tasks.length).map((room) => ({
          roomName: room.name,
          note: String(room.transcript || "").trim(),
          dataUrl: room.image
        })),
        rooms: state.rooms.map((room) => ({
          name: room.name,
          condition: room.condition,
          fixtures: (room.detections || []).map((detection) => detection.label),
          note: String(room.transcript || "").trim()
        })),
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
      window.clearTimeout(state.timers.cameraResume);
      document.removeEventListener("keydown", onKeyDown);
      // A listener left on `document` or `window` keeps this whole closure alive
      // — the video element and the model with it — for the lifetime of the page.
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onViewportResize);
      window.removeEventListener("orientationchange", onViewportResize);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.body.style.overflow = previousOverflow;
      overlay.remove();
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
      resolve(result || null);
    }

    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      if (!el.discard.hidden) hideDiscard();
      else requestClose();
    }

    buildWave();
    el.shutter.addEventListener("click", capture);
    el.viewfinder.addEventListener("click", onViewfinderTap);
    // On a fresh room "Retake" clears the frame back to the live camera; on a
    // revisit it discards the edit and reopens the live camera to rescan.
    el.retake.addEventListener("click", () => (state.revisiting ? prepareLiveRoom() : unfreeze()));
    el.readRoom.addEventListener("click", confirmSelection);
    el.mic.addEventListener("click", () => (state.voiceOn ? stopVoice() : startVoice()));
    for (const button of el.noteOpen) button.addEventListener("click", () => openNoteEditor({ focus: true }));
    el.noteDone.addEventListener("click", closeNoteEditor);
    el.note.addEventListener("focus", () => { if (state.voiceOn) stopVoice(); });
    el.note.addEventListener("input", () => {
      // Keep the exact in-progress value. Trimming here would erase the space
      // after each word before the phone keyboard can enter the next one.
      setRoomTranscriptDraft(el.note.value);
      renderRoomNoteControls(el.note.value);
    });
    el.retry.addEventListener("click", startCamera);
    for (const button of el.fallbacks) {
      button.addEventListener("click", () => {
        el.fallbackInput.value = "";
        el.fallbackInput.click();
      });
    }
    el.fallbackInput.addEventListener("change", () => {
      const [file] = el.fallbackInput.files || [];
      if (file) captureSelectedPhoto(file);
    });
    for (const button of el.videoFallbacks) button.addEventListener("click", () => {
      if (state.videoProcessing || state.capturing || state.loadingRoom) return;
      el.videoFallbackInput.value = "";
      el.videoFallbackInput.click();
    });
    el.videoFallbackInput.addEventListener("change", () => {
      const [file] = el.videoFallbackInput.files || [];
      if (file) captureSelectedVideo(file);
    });

    // The hub: the count in the top bar and the deck button both open it, one tap
    // to review or switch room. Choosing a room chip, tapping a scanned room, or
    // naming another room all enter that room; Finish ends the scan.
    // Not while a room is being read — jumping to the hub mid-read would drop
    // the room the Landlord just confirmed.
    for (const button of el.roomsOpen) button.addEventListener("click", () => { if (state.screen === "live" && !state.capturing) toHub(); });
    el.hub.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-room-remove]");
      if (remove) return showRoomRemoval(remove.dataset.roomRemove);
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

    for (const button of $$("[data-close]")) button.addEventListener("click", requestClose);
    el.discardKeep.addEventListener("click", hideDiscard);
    el.discardConfirm.addEventListener("click", confirmDiscardDecision);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onViewportResize);
    window.addEventListener("orientationchange", onViewportResize);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("beforeunload", onBeforeUnload);

    // Open on the hub so the first thing asked is which room — and warm the
    // camera and detector behind it so entering that room is instant.
    renderHub();
    showScreen("hub");
    startCamera();
    // The several megabytes of detector start moving now, in parallel with the
    // camera permission prompt and the room choice, so entering the first room is
    // not the moment the download begins.
    warmDetector();
    el.hubOther.focus?.({ preventScroll: true });
  });
}
