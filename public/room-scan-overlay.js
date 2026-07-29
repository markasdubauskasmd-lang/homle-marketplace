import {
  canFinishScan,
  usableDetections,
  usableLiveBoxes,
  boxAtPoint,
  coverSourceRect,
  fitBoxToFrame,
  frameBoxToSourceRect,
  cocoLabel,
  implausibleForRoom,
  frameSignature,
  signatureDistance,
  movementAdvice,
  signatureChangeSpread,
  objectFramingAdvice,
  conditionReviewAdvice,
  shouldCaptureKeyframe,
  roomCoverageProgress,
  walkingReadIsBlocked,
  mergeRoomInventory,
  mergeSavedDetections,
  mergeInventoryIntoSavedDetections,
  inventoryDisplayLabel,
  itemQuantity,
  inventoryKey,
  resolveRoomCondition,
  conditionTag,
  correctInventoryItem,
  detectionMinimumScore,
  joinSpokenText,
  preferredSpeechLanguage,
  roomReadingPayload,
  mergeItemReadings,
  trackDetections,
  drawableTracks,
  frameQualityStats,
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
  unresolvedRoomReadKey,
  unresolvedRoomConditionKey,
  rosterSummary
} from "./room-scan-model.js";
import { checklistFromTranscript } from "./checklist.js";
import { clearRoomNotesDraft, readRoomNotesDraft, saveRoomNotesDraft } from "./room-note-draft.js";
import { validatedGuidedRoomPhotoDimensions, validatedGuidedRoomPhotoFile } from "./room-photo-selection.js";
import { extractRoomVideoFrames, maximumRoomVideoFrames, roomVideoContactSheetLayout } from "./room-video-frames.js";
import { applyRedaction, redactedAreaRatio, redactionRegions, redactionSummary, shouldRedact, unusableRedactionRatio } from "./room-photo-redaction.js";
import { createScanEventReporter, elapsedSince } from "./scan-events.js";
import { storedCsrf } from "./session-csrf.js";

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
  <p class="scan-progress" data-live-progress role="status" aria-live="polite">
    <b data-live-progress-step>1 of 3</b>
    <span data-live-progress-copy>Choose a room</span>
    <span class="scan-progress-meter" data-live-progress-meter role="progressbar" aria-label="Room coverage" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0" hidden><i aria-hidden="true"></i></span>
  </p>

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
    <!-- What the room has found so far. Fills itself as the Landlord walks, so the
         evidence that the scan is working is on screen rather than implied. -->
    <div class="found" data-found hidden>
      <p class="found-head"><span data-found-count>0</span> <span data-found-noun>items</span> found <span class="found-busy" data-found-busy hidden aria-hidden="true"></span></p>
      <ul class="found-list" data-found-list aria-live="polite"></ul>
    </div>
    <p class="deck-hint" data-hint role="status">Just walk around the room — items save themselves</p>
    <!-- Opt-in (?scanDebug=1). Every screenshot of a misbehaving scan has forced
         the same first question: were frames read at all, or read and wrong? The
         counters that answer it were already kept and never shown. -->
    <dl class="scan-debug" data-scan-debug hidden></dl>
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
      <p class="hub-progress" data-hub-progress role="status" aria-live="polite"><b data-hub-progress-step>1 of 3</b><span data-hub-progress-copy>Choose a room to begin</span></p>
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
      <p>Walk around and Homle picks out the fixtures and how dirty each room is as you go, so your checklist fills itself in.</p>
      <p class="scan-consent-detail">To do that, <strong>a few still frames from each room are sent to our AI provider (Anthropic) to be read</strong>, along with what you say. Frames are taken automatically as you move to a new part of the room — up to four while you walk, plus one when you confirm the room. Never a video stream. They are read and discarded, not stored there. Nothing else about you, your address or your account is sent.</p>
      <div class="scan-consent-actions">
        <button class="button" type="button" data-consent-allow>Yes, read my rooms</button>
        <button class="button ghost" type="button" data-consent-decline>No — just take the photos</button>
      </div>
      <p class="scan-consent-note">You can scan either way. Declining only means you write the checklist yourself.</p>
    </div>
  </div>

  <div class="scan-item-editor" data-item-editor hidden role="dialog" aria-modal="true" aria-labelledby="homle-item-editor-title">
    <form class="scan-item-editor-in" data-item-editor-form>
      <p class="scan-item-editor-eyebrow">Check detected item</p>
      <h2 id="homle-item-editor-title">Name and cleaning level</h2>
      <label class="scan-item-editor-label" for="homle-item-editor-name">Item name</label>
      <input class="scan-item-editor-name" id="homle-item-editor-name" data-item-editor-name type="text" maxlength="40" autocomplete="off" required>
      <fieldset class="scan-item-condition">
        <legend>How much cleaning does it need?</legend>
        <div class="scan-item-condition-options">
          <label><input type="radio" name="homle-item-condition" value="clean"><span>Clean</span></label>
          <label><input type="radio" name="homle-item-condition" value="light"><span>Light</span></label>
          <label><input type="radio" name="homle-item-condition" value="medium"><span>Medium</span></label>
          <label><input type="radio" name="homle-item-condition" value="heavy"><span>Heavy</span></label>
        </div>
      </fieldset>
      <p class="scan-item-editor-help">Choose a level only when you can tell. Your choice replaces the automatic assessment.</p>
      <div class="scan-item-editor-actions">
        <button class="button ghost" type="button" data-item-editor-cancel>Cancel</button>
        <button class="button" type="submit">Save item</button>
      </div>
    </form>
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

// JPEG compression is one of the most expensive synchronous operations in the
// camera path. `toDataURL()` performs it before returning, which made the live
// viewfinder pause every time an automatic walking frame was prepared. Modern
// mobile browsers expose `toBlob()` specifically so encoding can finish
// asynchronously. FileReader then converts the Blob to the data URL expected by
// the existing JSON API, without changing image dimensions, quality or backend
// contracts.
//
// The synchronous path remains only as a compatibility fallback for an older
// browser without both APIs. It is deliberately exported so the non-blocking
// path and fallback can be tested without opening a camera.
export function encodeCanvasJpeg(canvas, quality) {
  if (!canvas) return Promise.reject(new TypeError("A canvas is required."));
  const encodeSynchronously = () => {
    if (typeof canvas.toDataURL !== "function") throw new TypeError("This browser cannot encode the room frame.");
    const image = canvas.toDataURL("image/jpeg", quality);
    if (!String(image || "").startsWith("data:image/")) throw new TypeError("The room frame could not be encoded.");
    return image;
  };

  if (typeof canvas.toBlob !== "function" || typeof globalThis.FileReader !== "function") {
    try { return Promise.resolve(encodeSynchronously()); }
    catch (error) { return Promise.reject(error); }
  }

  return new Promise((resolveImage, rejectImage) => {
    let settled = false;
    const finish = (image, error) => {
      if (settled) return;
      settled = true;
      if (error) rejectImage(error);
      else resolveImage(image);
    };
    const fallback = () => {
      try { finish(encodeSynchronously()); }
      catch (error) { finish("", error); }
    };

    try {
      canvas.toBlob((blob) => {
        if (!blob) return fallback();
        let reader;
        try { reader = new globalThis.FileReader(); }
        catch { return fallback(); }
        reader.onload = () => {
          const image = typeof reader.result === "string" ? reader.result : "";
          if (!image.startsWith("data:image/")) return fallback();
          finish(image);
        };
        reader.onerror = fallback;
        reader.onabort = fallback;
        try { reader.readAsDataURL(blob); }
        catch { fallback(); }
      }, "image/jpeg", quality);
    } catch {
      fallback();
    }
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
      liveProgress: $("[data-live-progress]"), liveProgressStep: $("[data-live-progress-step]"), liveProgressCopy: $("[data-live-progress-copy]"),
      liveProgressMeter: $("[data-live-progress-meter]"),
      mic: $("[data-mic]"), shutter: $("[data-shutter]"),
      scanDebug: $("[data-scan-debug]"),
      found: $("[data-found]"), foundList: $("[data-found-list]"), foundCount: $("[data-found-count]"),
      foundNoun: $("[data-found-noun]"), foundBusy: $("[data-found-busy]"),
      selection: $("[data-selection]"), selectionHint: $("[data-selection-hint]"), retake: $("[data-retake]"), readRoom: $("[data-read-room]"),
      hub: $("[data-hub]"), hubTitle: $("[data-hub-title]"), hubSub: $("[data-hub-sub]"), hubRooms: $("[data-hub-rooms]"),
      hubAddLabel: $("[data-hub-add-lbl]"), hubChoices: $("[data-hub-choices]"), hubOtherForm: $("[data-hub-other-form]"),
      hubOther: $("[data-hub-other]"), hubFinish: $("[data-hub-finish]"), roomsOpen: $$("[data-rooms-open]"),
      hubProgress: $("[data-hub-progress]"), hubProgressStep: $("[data-hub-progress-step]"), hubProgressCopy: $("[data-hub-progress-copy]"),
      voice: $("[data-voice-panel]"), voiceTime: $("[data-voice-time]"), wave: $("[data-wave]"),
      voiceStatus: $("[data-voice-status]"), note: $("[data-room-note]"), noteDone: $("[data-note-done]"), noteOpen: $$("[data-note-open]"),
      deck: $("[data-camera-deck]"),
      consent: $("[data-consent]"), consentAllow: $("[data-consent-allow]"), consentDecline: $("[data-consent-decline]"),
      itemEditor: $("[data-item-editor]"), itemEditorForm: $("[data-item-editor-form]"),
      itemEditorName: $("[data-item-editor-name]"), itemEditorCancel: $("[data-item-editor-cancel]"),
      discard: $("[data-discard]"), discardEyebrow: $("[data-discard-eyebrow]"),
      discardTitle: $("[data-discard-title]"), discardCopy: $("[data-discard-copy]"),
      discardKeep: $("[data-discard-keep]"), discardConfirm: $("[data-discard-confirm]"),
      toast: $("[data-toast]")
    };

    // Created per scan, so a queue can never outlive the overlay that filled it.
    const scanEvents = createScanEventReporter({
      send: (path, options) => fetch(path, { credentials: "same-origin", cache: "no-store", ...options }),
      token: storedCsrf
    });

    const state = {
      stream: null, cameraStarting: false, resumeCameraOnVisible: false,
      rooms: [], capturing: false, photoProcessing: false, videoProcessing: false,
      liveCaptureUsed: false, fallbackCaptureUsed: false,
      privateRegions: [], privateRegionSource: null, lastRedaction: null,
      startedAt: Date.now(), roomStartedAt: Date.now(),
      voiceOn: false, voiceUsed: false, roomTranscripts: new Map(), seconds: 0,
      voiceGeneration: 0,
      // Counters, not a log. Inference runs several times a second, so a line per
      // event would drown the console; a running total answers the question that
      // actually gets asked when a scan looks wrong — is the room filter working,
      // or is it eating everything?
      pendingReads: 0, roomReadControllers: new Set(), finishWarningKey: "",
      // Monotonic identity for a saved room revision. A response from an older
      // photo must never update a same-named room that has since been removed,
      // rescanned or edited.
      nextReadingRevision: 1,
      // `navigator.onLine === false` is the browser's explicit no-network state.
      // Local detection keeps running, while paid room reads wait without
      // consuming the per-room allowance. Confirmed rooms saved during the gap
      // are retried once the browser reports a connection again.
      networkOffline: navigator.onLine === false, networkDeferredRooms: new Set(),
      // Read once: the readout is for testers, and mid-scan URL edits are not a flow.
      scanDebug: /[?&]scanDebug=1/.test(window.location.search),
      motionSpreads: [],
      diagnostics: {
        suppressedByRoom: 0, framesInferred: 0, detectorErrors: 0,
        keyframeEncodeErrors: 0, keyframesRead: 0
      },
      // Walking the room. `signature` and `previousSignature` are the coarse
      // brightness grids the quality pass already computes; the rest is what
      // decides whether the current view is worth a read.
      signature: null, previousSignature: null,
      // Per room, and NOT reset when the Landlord walks back in. A scalar counter
      // reset on entry meant a lap of the hall bought another four reads of the
      // same kitchen, and the consent promises a per-room bound, not a per-visit
      // one. Reads are tracked by room: a slow Kitchen response cannot block the
      // Bathroom now in front of the camera, while the model helper still caps
      // total walking-read concurrency at two.
      keyframeBudgets: new Map(), keyframeActiveRooms: new Set(),
      // What the room has accumulated so far, keyed by room name. Survives the
      // Landlord walking out and back in, which one-shot capture never did.
      inventories: new Map(),
      // Tasks and condition from the walking reads. Labels alone were a display:
      // an item shown as saved that produced no checklist line and no condition
      // grade contributes nothing to what the Cleaner is asked to do or what the
      // job is priced at, which made the whole walk decorative.
      walkEvidence: new Map(),
      // Items the Landlord deleted. Without this a read already in flight, or the
      // next one, merges the same label straight back and the removal looks broken.
      dismissed: new Map(),
      timers: { wave: null, clock: null, cameraResume: null, noteRecovery: null }, recognition: null,
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
      manualCount: 0,
      // On-device detection. Entirely local: the model is same-origin and no
      // frame it looks at leaves the phone.
      detector: null, detectorState: "idle", detecting: false,
      rafId: 0, lastDetectionAt: 0, detectionInterval: 200,
      // Inference runs on a small copy of the frame, not the full camera
      // resolution, and the viewfinder box is measured once rather than on every
      // pass. Both are recreated on demand, so an orientation change is safe.
      detectCanvas: null, viewRect: null,
      // Framing guidance, sampled off the detector's own frame.
      lastQualityAt: 0, qualityKind: "", qualityMessage: "", framingMessage: "", qualityCanvas: null, motionDistances: [],
      notesForgotten: false,
      // Detection boxes, reused between passes and keyed by tracker id.
      boxNodes: new Map(),
      // Kept separate from `generation`: pausing detection must never discard a
      // room reading that is still in flight.
      detectionGeneration: 0,
      tracks: [], nextTrackId: 1, liveDetectionAvailable: true,
      roomReadController: null, frameCallbackKind: ""
    };

    let toastTimer = null;
    let discardPreviousFocus = null;
    let discardMode = "scan";
    let discardRoomName = "";
    let itemEditorKey = "";
    let itemEditorPreviousFocus = null;
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

    function setScanBackgroundInert(inert, except = el.discard) {
      for (const child of el.stage.children) {
        if (child === except) continue;
        child.inert = inert;
        if (inert) child.setAttribute("aria-hidden", "true");
        else child.removeAttribute("aria-hidden");
      }
    }

    function closeItemEditor({ restoreFocus = true } = {}) {
      if (el.itemEditor.hidden) return;
      el.itemEditor.hidden = true;
      setScanBackgroundInert(false, el.itemEditor);
      const focusTarget = itemEditorPreviousFocus;
      itemEditorPreviousFocus = null;
      itemEditorKey = "";
      if (state.screen === "live" && !state.frozen && state.stream) startDetection();
      if (restoreFocus && focusTarget instanceof HTMLElement && overlay.contains(focusTarget)) {
        focusTarget.focus({ preventScroll: true });
      }
    }

    function openItemEditor(key, trigger) {
      const current = inventoryFor().find((item) => item.key === key);
      if (!current || state.closed) return;
      itemEditorKey = key;
      itemEditorPreviousFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
      el.itemEditorName.value = current.label;
      const options = el.itemEditorForm.elements["homle-item-condition"];
      for (const option of options ? [...options] : []) option.checked = option.value === current.condition;
      stopDetection();
      el.itemEditor.hidden = false;
      setScanBackgroundInert(true, el.itemEditor);
      requestAnimationFrame(() => {
        el.itemEditorName.focus({ preventScroll: true });
        el.itemEditorName.select();
      });
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
      // Discarding the whole scan has to take the saved notes with it. Leaving them
      // behind to reappear on the next open would make the choice a lie.
      if (discardMode !== "room") { forgetRoomNotes(); return close(null); }
      const removedName = discardRoomName;
      const key = transcriptKey(removedName);
      state.rooms = removeRoom(state.rooms, removedName);
      state.roomTranscripts.delete(key);
      // What the walk found goes with it: left behind, re-adding a room of the
      // same name would resurrect items the Landlord had just removed.
      state.inventories.delete(key);
      state.walkEvidence.delete(key);
      // The BUDGET deliberately stays. Deleting it made remove-and-re-add an
      // unlimited supply of paid reads, which is exactly the bound the consent
      // promises. The room keeps its generation bump below, so anything still in
      // flight for it lands nowhere.
      const budget = state.keyframeBudgets.get(key);
      if (budget) budget.generation += 1;
      rememberRoomNotes();
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
      flushRoomNotes();
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
      scheduleNoteRecovery();
      return note;
    }

    // Room notes — and only the notes — are kept so a backgrounded tab or a stray
    // tap cannot lose the walkthrough. Debounced, because speech recognition fires
    // continuously while a Landlord is talking.
    function rememberRoomNotes() {
      // A scan the Landlord discarded, or finished and handed on, must never be
      // written again by a later reconcile.
      if (state.notesForgotten) return;
      const notes = [];
      for (const [room, note] of state.roomTranscripts) {
        if (String(note || "").trim()) notes.push({ room, note });
      }
      try { saveRoomNotesDraft(window.sessionStorage, notes); } catch {}
    }
    function scheduleNoteRecovery() {
      window.clearTimeout(state.timers.noteRecovery);
      state.timers.noteRecovery = window.setTimeout(rememberRoomNotes, 400);
    }
    // Writes any pending debounced save immediately. Used when the page is about to
    // go away, where a 400ms timer will never fire.
    function flushRoomNotes() {
      if (!state.timers.noteRecovery) return;
      window.clearTimeout(state.timers.noteRecovery);
      state.timers.noteRecovery = null;
      rememberRoomNotes();
    }

    function forgetRoomNotes() {
      state.notesForgotten = true;
      window.clearTimeout(state.timers.noteRecovery);
      state.timers.noteRecovery = null;
      try { clearRoomNotesDraft(window.sessionStorage); } catch {}
    }

    // Recovered on open so the notes are already attached to their rooms when the
    // Landlord walks back in. Photographs are never restored — there are none to
    // restore — so the recovery message says exactly what came back.
    function restoreRoomNotes() {
      let draft = null;
      try { draft = readRoomNotesDraft(window.sessionStorage); } catch {}
      if (!draft) return;
      let restored = 0;
      for (const { room, note } of draft.notes) {
        const key = transcriptKey(room);
        if (!key || state.roomTranscripts.has(key)) continue;
        state.roomTranscripts.set(key, note);
        restored += 1;
      }
      if (restored) toast(`${restored} unfinished room ${restored === 1 ? "note" : "notes"} recovered from this tab. Photos are not kept.`);
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
      // Nothing is being aimed at while the note panel covers the viewfinder, and
      // on a phone the keyboard is about to take the screen. Inference here would
      // only cost battery and compete with typing.
      stopDetection();
      renderDetectorState();
      if (focus) setTimeout(() => el.note.focus({ preventScroll: true }), 0);
    }

    function closeNoteEditor() {
      if (state.voiceOn) stopVoice({ silent: true });
      setRoomTranscript(el.note.value);
      renderVoiceTranscript();
      el.voice.classList.remove("on", "recording");
      el.voice.hidden = true;
      // The keyboard closing changes the viewfinder's box, and aiming resumes.
      state.viewRect = null;
      startDetection();
      renderDetectorState();
      el.hint.innerHTML = roomTranscript()
        ? "<b>Room note ready</b> — check the photo, then confirm"
        : "Just walk around the room — items save themselves";
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
      renderScanProgress();
    }

    function renderScanProgress() {
      const saved = state.rooms.length;
      const hub = state.screen === "hub";
      el.liveProgress.hidden = hub;
      if (hub) {
        el.hubProgressStep.textContent = saved ? "3 of 3" : "1 of 3";
        el.hubProgressCopy.textContent = saved
          ? `${saved} ${saved === 1 ? "room" : "rooms"} ready — finish or add another`
          : "Choose a room to begin";
        return;
      }
      if (state.capturing) {
        el.liveProgressMeter.hidden = true;
        el.liveProgressStep.textContent = "Saving";
        el.liveProgressCopy.textContent = `Reading ${state.currentRoom}`;
      } else if (state.frozen) {
        el.liveProgressMeter.hidden = true;
        el.liveProgressStep.textContent = "3 of 3";
        el.liveProgressCopy.textContent = `${selectionCount()} selected — check and confirm`;
      } else if (state.readingAllowed && state.visionAvailable) {
        const budget = keyframeBudget(state.currentRoom);
        const progress = roomCoverageProgress(budget.completedCount, { attemptedCount: budget.capturedCount });
        const busy = state.keyframeActiveRooms.has(transcriptKey(state.currentRoom));
        el.liveProgressMeter.hidden = false;
        el.liveProgressMeter.dataset.level = String(progress.count);
        el.liveProgressMeter.setAttribute("aria-valuemax", String(progress.total));
        el.liveProgressMeter.setAttribute("aria-valuenow", String(progress.count));
        el.liveProgressMeter.setAttribute("aria-valuetext", `${progress.count} of ${progress.total} distinct room views`);
        el.liveProgressStep.textContent = `${progress.count} of ${progress.total} views`;
        el.liveProgressCopy.textContent = busy ? "Checking this view…" : progress.copy;
      } else {
        el.liveProgressMeter.hidden = true;
        el.liveProgressStep.textContent = "2 of 3";
        el.liveProgressCopy.textContent = `Capture ${state.currentRoom}`;
      }
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
      renderScanProgress();

      // Rooms already scanned — tap one to reopen its photo and edit its objects.
      el.hubRooms.innerHTML = "";
      for (const room of rooms) {
        const li = document.createElement("li");
        li.className = "hub-room-row";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hub-room";
        button.dataset.room = room.name;
        const meta = room.readingStatus === "reading"
          // Saved already — this is about the automatic naming, not the room.
          ? "Saved · reading it now…"
          : room.readingStatus === "needs-retry"
          ? "Automatic reading incomplete — tap to retry"
          : room.itemCount
          ? `${room.itemCount} object${room.itemCount === 1 ? "" : "s"} · ${room.conditionLabel}`
          : "No objects yet";
        // What was picked, and whether a spoken note is attached — the two things
        // the review was missing, so a room can be checked without reopening it.
        const shown = room.itemLabels.slice(0, 4).join(", ");
        const extra = room.itemLabels.length > 4 ? ` +${room.itemLabels.length - 4} more` : "";
        const detail = [shown ? shown + extra : "", room.hasNote ? "Room note added" : ""].filter(Boolean).join(" · ");
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
      el.hint.innerHTML = "Just walk around the room — items save themselves";
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
      // The found list is per room; the read budget is looked up per room too, so
      // there is nothing to reset here. Re-entering a room deliberately keeps
      // whatever of its budget has already been spent.
      renderInventory();
      const key = transcriptKey(name);
      if (!state.roomTranscripts.has(key)) setRoomTranscript(existing?.transcript || "", name);
      renderVoiceTranscript();
      showScreen("live");
      // Asked on the way IN, not on the way out.
      //
      // Consent used to be requested when a room was confirmed, which was fine
      // when confirming was also when the one photograph got read. Now the reading
      // happens while the Landlord walks, so asking at the end meant the first room
      // was walked with the hint promising "items save themselves" and nothing
      // being read at all — the headline behaviour did not work until room two.
      //
      // Deliberately not awaited: the camera and the on-device highlight start
      // immediately behind the sheet, so declining costs nothing and allowing does
      // not stall the viewfinder.
      if (!state.consentAsked) void askConsent();
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
      // The motion memory goes with it. Walking through a doorway IS fast motion,
      // and a stale fast sample from the previous room plus the scene jump into
      // this one would read as a sweep and hold back the first paid read.
      state.motionDistances = [];
      state.motionSpreads = [];
      state.signature = null;
      state.previousSignature = null;
      state.qualityMessage = "";
      state.framingMessage = "";
      state.lastQualityAt = 0;
      unfreeze();
      el.hint.innerHTML = "Just walk around the room — items save themselves";
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
          label: detection.label, note: detection.note || "", kind: "detected", score: 1,
          // The reader's verdict about this object, so the review paints it where
          // the customer is actually looking — on the thing itself.
          condition: detection.condition || "",
          conditionConfidence: detection.conditionConfidence,
          conditionConfirmed: detection.conditionConfirmed === true,
          soiling: detection.soiling || []
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
          // 720p contains more detail than the 1280px stored room frame can use,
          // while starting faster and moving fewer pixels through the preview
          // than an unnecessary full-HD request.
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 24, max: 30 },
            resizeMode: { ideal: "crop-and-scale" }
          },
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
      // The single most useful device-compatibility signal there is, and one only
      // the browser can see. The reason string is deliberately not sent — it is
      // written for a person and can name a file the customer chose.
      scanEvents.record("scan.camera.unavailable");
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
    function viewfinderSourceRect(sourceWidth, sourceHeight) {
      const rect = viewfinderRect();
      // Before first layout (or in a synthetic test host) the source aspect is
      // the only honest fallback. That keeps every pixel rather than inventing a
      // crop from a zero-sized viewfinder.
      const frameWidth = rect.width || sourceWidth;
      const frameHeight = rect.height || sourceHeight;
      return coverSourceRect({ sourceWidth, sourceHeight, frameWidth, frameHeight });
    }

    // Maps the detector's source-space boxes onto the cropped, scaled canvas and
    // erases them.
    //
    // A photograph of a home is being handed to a stranger. The scanner already
    // asks the Landlord not to photograph people or paperwork, but asking is not
    // a control, and until this existed a face or a payslip in frame was stored
    // intact and served to the assigned Cleaner under a signed URL.
    function redactPrivateContent(canvas, sourceRect, scale) {
      const regions = state.privateRegions;
      if (!Array.isArray(regions) || !regions.length) {
        state.lastRedaction = null;
        return;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      // Source pixels to canvas pixels: subtract the crop origin, then apply the
      // same scale the frame was drawn at.
      const onCanvas = regions.map((region) => {
        const [x, y, width, height] = region.bbox.map(Number);
        if (![x, y, width, height].every(Number.isFinite)) return null;
        return {
          class: region.class,
          bbox: [(x - sourceRect.sx) * scale, (y - sourceRect.sy) * scale, width * scale, height * scale]
        };
      }).filter(Boolean);
      const mappedRegions = redactionRegions(onCanvas, { width: canvas.width, height: canvas.height });
      if (!mappedRegions.length) {
        state.lastRedaction = null;
        return;
      }
      applyRedaction(context, mappedRegions, { document });
      state.lastRedaction = {
        summary: redactionSummary(mappedRegions),
        ratio: redactedAreaRatio(mappedRegions, { width: canvas.width, height: canvas.height })
      };
      // A count, never what was hidden. "One person was blurred" is a statistic;
      // "a person was blurred in the bedroom" is not.
      scanEvents.record("scan.redaction.applied", { count: mappedRegions.length });
    }

    scanEvents.record("scan.session.started");

    function drawVisibleRegion(source, sourceWidth, sourceHeight) {
      if (!sourceWidth || !sourceHeight) return null;
      const sourceRect = viewfinderSourceRect(sourceWidth, sourceHeight);
      if (!sourceRect) return null;
      // 1600, not 1280. This frame is what the room's condition is graded from,
      // and condition is decided by fine texture: the chalky ring at a tap base,
      // the sheen of grease on a splashback, the grey film along a skirting
      // board. Those are high-frequency detail, which is the first thing
      // downscaling and JPEG throw away — so at 1280 the evidence was being
      // destroyed before the model ever saw it, and no prompt could recover it.
      const scale = Math.min(1, 1600 / Math.max(sourceRect.sWidth, sourceRect.sHeight));
      el.canvas.width = Math.max(1, Math.round(sourceRect.sWidth * scale));
      el.canvas.height = Math.max(1, Math.round(sourceRect.sHeight * scale));
      el.canvas.getContext("2d").drawImage(
        source,
        sourceRect.sx, sourceRect.sy, sourceRect.sWidth, sourceRect.sHeight,
        0, 0, el.canvas.width, el.canvas.height
      );
      // Nothing leaves this function unredacted.
      //
      // This is the one place every uploaded frame, every crop source and every
      // frame sent for reading is produced, which is exactly why the erasure
      // belongs here rather than at each call site: a new caller added later
      // inherits it instead of having to remember it.
      redactPrivateContent(el.canvas, sourceRect, scale);
      // 0.90, and deliberately generous. At 0.82 the compressor was smoothing
      // away exactly the speckle and film that distinguish a limescaled tap from
      // a white one. `roomReadingPayload` measures the real serialized size and
      // drops crops before it drops this frame, so the budget is spent where the
      // grading happens.
      return el.canvas.toDataURL("image/jpeg", 0.90);
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

    // A phone-camera photo and a locally-built video contact sheet never pass
    // through the live detection loop. They need their own inference before the
    // shared canvas is drawn; otherwise an earlier live frame's boxes can blur
    // the wrong pixels while a person in the selected photo remains visible.
    async function refreshPrivateRegionsForSource(source, width, height) {
      state.privateRegions = [];
      state.privateRegionSource = null;
      state.lastRedaction = null;
      let detector = state.detector;
      if (!detector) {
        try {
          detector = await loadDetectorOnce();
          state.detector = detector;
          state.detectorState = "ready";
          renderDetectorState();
        } catch {
          state.detectorState = "unavailable";
          state.liveDetectionAvailable = false;
          renderDetectorState();
          throw new TypeError("This phone could not run the private-content check. Use the live camera or a voice note instead.");
        }
      }
      const deadline = Date.now() + 6_000;
      while (detectorBusy && Date.now() < deadline) {
        await new Promise((resume) => window.setTimeout(resume, 40));
      }
      if (detectorBusy) throw new TypeError("The private-content check is still busy. Try this photo again.");
      detectorBusy = true;
      try {
        const found = await detector.detect(source, 12, detectionMinimumScore);
        state.privateRegions = (Array.isArray(found) ? found : [])
          .filter((item) => shouldRedact(item?.class))
          .map((item) => ({ class: item.class, bbox: Array.isArray(item?.bbox) ? item.bbox : [] }));
        state.privateRegionSource = { width, height };
      } catch {
        throw new TypeError("This photo could not be checked for people or private screens. Use the live camera or a voice note instead.");
      } finally {
        detectorBusy = false;
      }
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
          const box = document.createElement("button");
          box.type = "button";
          const tag = document.createElement("span");
          tag.className = "det-tag";
          box.appendChild(tag);
          node = { box, tag, className: "", geometry: "", label: null, grade: "" };
          pool.set(item.id, node);
          el.detections.appendChild(box);
        }
        const className = `det-box show${selectable ? " pickable" : ""}${state.selectedIds.has(item.id) ? " picked" : ""}`;
        if (node.className !== className) {
          node.box.className = className;
          node.className = className;
        }
        node.box.disabled = !selectable;
        node.box.dataset.detectionId = item.id;
        node.box.setAttribute("aria-pressed", String(state.selectedIds.has(item.id)));
        node.box.setAttribute("aria-label", `${state.selectedIds.has(item.id) ? "Remove" : "Select"} ${item.label || "highlighted object"}`);
        const geometry = `left:${item.x}%;top:${item.y}%;width:${item.width}%;height:${item.height}%`;
        if (node.geometry !== geometry) {
          node.box.style.cssText = geometry;
          node.geometry = geometry;
        }
        // The grade colours the glow. Live boxes carry no condition, so the live
        // view keeps its single neutral state; on the review, a limescaled tap
        // reads amber or red AT the tap rather than only in the side list.
        const grade = item.condition || "";
        if (node.grade !== grade) {
          if (grade) node.box.dataset.grade = grade; else delete node.box.dataset.grade;
          node.grade = grade;
        }
        // What the tag says, in order of usefulness: the soiling seen ("Limescale"),
        // else the item's name. Clean objects show their name only when selectable —
        // a caption on every clean thing would bury the ones needing attention.
        const conditionText = conditionTag(item);
        const label = conditionText
          ? (item.label ? `${item.label} · ${conditionText}` : conditionText)
          : (item.label || "");
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
      renderScanProgress();
    }

    // Freezing before anything is chosen is what makes the crops trustworthy: a
    // box picked on a live feed would be cut from whatever the phone had moved
    // on to by the time the request was built.
    //
    // `live` records which capture path produced the frame. A live viewfinder
    // gets detection, tracking, quality gating and movement guidance; a photo
    // chosen from the phone's own camera gets none of them. Reporting the two
    // as one device class would average their accuracy together and hide the
    // gap, which is the opposite of what the stored scan is for.
    function freezeFrame(frame, { preselect = "", live = true } = {}) {
      // A live capture or a phone photo is a fresh frame, not an edit of a stored
      // one, so its save must read. Only openRevisit marks a frame as an edit.
      state.revisiting = false;
      if (live) state.liveCaptureUsed = true; else state.fallbackCaptureUsed = true;
      state.frozen = true;
      state.frozenFrame = frame;
      stopDetection();
      el.still.src = frame;
      el.still.hidden = false;
      el.selection.hidden = false;
      el.viewfinder.classList.add("picking");
      // Whatever the detector had settled on becomes the starting selection.
      state.candidates = live ? usableLiveBoxes(drawableTracks(state.tracks).map((track) => ({
        id: `d${track.id}`, x: track.x, y: track.y, width: track.width, height: track.height,
        label: track.label, kind: "detected", score: track.score
      }))) : [];
      state.selectedIds = new Set(preselect ? [preselect] : []);
      layoutFrozen();
      refreshSelection();
    }

    function unfreeze() {
      state.frozen = false;
      // Stale guidance from before the freeze must not reappear with the live feed.
      state.qualityKind = "";
      // The motion memory goes with it. Walking through a doorway IS fast motion,
      // and a stale fast sample from the previous room plus the scene jump into
      // this one would read as a sweep and hold back the first paid read.
      state.motionDistances = [];
      state.motionSpreads = [];
      state.signature = null;
      state.previousSignature = null;
      state.qualityMessage = "";
      state.framingMessage = "";
      state.lastQualityAt = 0;
      renderDetectorState();
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

    function toggleDetectedItem(id) {
      if (!state.frozen || state.capturing || !id) return;
      if (state.selectedIds.has(id)) state.selectedIds.delete(id);
      else {
        if (atSelectionLimit()) return toast(selectionLimitMessage);
        state.selectedIds.add(id);
      }
      refreshSelection();
    }

    // The room frame gives context, but it cannot tell the reader WHICH tap,
    // shower screen or appliance the customer selected when several are visible.
    // Every deliberately selected object therefore gets a focused crop. This is
    // condition evidence as much as identity evidence: limescale, mould and fine
    // grease disappear first when a surface is only a small part of a room photo.
    //
    // `source` was decoded from the immutable room-frame data URL. A later room
    // capture therefore cannot change these pixels.
    async function cropFor(box, source) {
      if (!source) return "";
      const rect = frameBoxToSourceRect(box, { canvasWidth: source.width, canvasHeight: source.height });
      if (!rect) return "";
      const canvas = document.createElement("canvas");
      const longEdge = Math.max(rect.sWidth, rect.sHeight);
      // Never upscale: enlarging a small crop costs bytes and adds nothing.
      const scale = Math.min(1, 512 / longEdge);
      canvas.width = Math.max(1, Math.round(rect.sWidth * scale));
      canvas.height = Math.max(1, Math.round(rect.sHeight * scale));
      canvas.getContext("2d").drawImage(
        source, rect.sx, rect.sy, rect.sWidth, rect.sHeight,
        0, 0, canvas.width, canvas.height
      );
      // Blob encoding yields instead of synchronously compressing every selected
      // object on the same frame as the red-button press.
      return encodeCanvasJpeg(canvas, 0.9);
    }

    function snapshotCropSource(frame) {
      if (typeof frame !== "string" || !frame.startsWith("data:image/")) return Promise.resolve(null);
      return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          const snapshot = document.createElement("canvas");
          snapshot.width = image.naturalWidth;
          snapshot.height = image.naturalHeight;
          snapshot.getContext("2d").drawImage(image, 0, 0);
          resolve(snapshot);
        };
        image.onerror = () => resolve(null);
        image.src = frame;
      });
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
          renderScanProgress();
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
      // Emitted after the guards, so a double tap that returns early does not
      // count a second room. Per room rather than per session, so "time to
      // complete a room" is measured rather than inferred by dividing a session
      // by a count.
      scanEvents.record("scan.room.duration_ms", { durationMs: elapsedSince(state.roomStartedAt) ?? 0 });
      scanEvents.record("scan.room.completed", {
        dimensions: { deviceClass: state.liveCaptureUsed ? "guided-web" : state.fallbackCaptureUsed ? "camera-fallback" : "unknown" }
      });
      state.roomStartedAt = Date.now();
      // Claimed before the consent prompt is awaited, not after: otherwise a
      // second activation during that await would slip past — consent already
      // asked, reading not yet allowed — and save an empty room over this one.
      state.capturing = true;
      renderScanProgress();
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
      const mustRead = (!revisit || changed || existing.readingStatus === "needs-retry") && !clearedRevisit;

      if (mustRead && !state.consentAsked) await askConsent();
      if (session !== state.roomSession || state.closed) { state.capturing = false; return; }

      let room;
      let readingRevision = 0;
      if (clearedRevisit) {
        // An emptied room: no objects, and so no scoped tasks and no grade.
        room = { name: roomName, image: frame, detections: [], tasks: [], condition: "", transcript: spokenNote, readingStatus: "manual", readingRevision };
      } else if (mustRead) {
        // SAVED FIRST, READ AFTER.
        //
        // This used to `await` the reading before the room existed and before the
        // hub came back, so pressing the red button meant watching "Reading the
        // room…" for as long as a vision model and a mobile connection took —
        // several seconds, and longer on the stronger tier. Nothing about that
        // wait was necessary: the room, its photograph, the objects the customer
        // chose and their spoken note are all already in hand.
        //
        // So the room is saved immediately with what is known, marked `reading`,
        // and the model call runs on its own. When it lands, the room is updated
        // in place. `readingStatus` already existed for exactly this — a room
        // that is saved but whose reading has not completed.
        readingRevision = state.nextReadingRevision;
        state.nextReadingRevision += 1;
        room = {
          name: roomName, image: frame,
          detections: chosen.map((box) => ({
            id: box.id, label: box.label || "Marked item", note: box.note || "",
            // Kept even though a fresh reading is coming: if that background read
            // fails, "needs-retry" keeps THESE detections, and losing their grades
            // to a transient network error would un-grade the room silently.
            condition: box.condition || "",
            conditionConfidence: box.conditionConfidence,
            conditionConfirmed: box.conditionConfirmed === true,
            soiling: box.soiling || [],
            x: box.x, y: box.y, width: box.width, height: box.height
          })),
          tasks: localRoomTasks(roomName, spokenNote),
          condition: existing?.condition || "",
          transcript: spokenNote,
          readingStatus: "reading",
          readingRevision
        };
      } else {
        // Nothing changed: the objects, grade and tasks already stored are still
        // correct for the same photograph, so it saves without a call.
        room = {
          name: roomName, image: frame,
          detections: chosen.map((box) => ({
            id: box.id, label: box.label, note: box.note || "",
            // An unchanged revisit deliberately buys no new reading, which only
            // works if it also keeps the old one. Dropping condition here meant
            // open-then-save was enough to erase every grade in the room.
            condition: box.condition || "",
            conditionConfidence: box.conditionConfidence,
            conditionConfirmed: box.conditionConfirmed === true,
            soiling: box.soiling || [],
            x: box.x, y: box.y, width: box.width, height: box.height
          })),
          tasks: Array.isArray(existing.tasks) ? existing.tasks : [],
          condition: existing.condition || "",
          transcript: spokenNote,
          readingStatus: existing.readingStatus || "ready",
          readingRevision: Number.isInteger(existing.readingRevision) ? existing.readingRevision : 0
        };
      }

      if (session !== state.roomSession || state.closed) return;

      // Everything the walk found, folded into the room that is about to be saved.
      // Without this the inventory would be a display that vanished on confirm,
      // and the checklist would still only know about whatever was in the one
      // frame the confirmation was graded from — which is the limitation the
      // continuous scan exists to remove.
      //
      // Appended, never replacing: boxes the Landlord drew or tapped on the frozen
      // frame carry real coordinates, and these carry a name and no box.
      // Tasks and condition the walk gathered. Without this the room was saved with
      // whatever the single confirmation frame produced, and every item the walk
      // found contributed a name and nothing else — no checklist line, no minutes,
      // no effect on the grade the job is priced from.
      const evidence = state.walkEvidence.get(transcriptKey(roomName));
      if (evidence) {
        const existingTasks = Array.isArray(room.tasks) ? room.tasks : [];
        const seen = new Set(existingTasks.map((task) => String(task).toLowerCase().trim()));
        room = {
          ...room,
          tasks: [...existingTasks, ...evidence.tasks.filter((task) => !seen.has(task.toLowerCase().trim()))],
          // The confirmation grade wins when it committed to one. Merging it
          // worst-wins with the walking grades let a passing glance override the
          // read that is deliberately framed — and, once the tiers differ, the
          // cheaper model override the dearer one.
          condition: resolveRoomCondition(room.condition, evidence.condition)
        };
      }

      const walked = inventoryFor(roomName);
      if (walked.length) {
        room = {
          ...room,
          // Group same-label objects while keeping the largest simultaneous
          // quantity actually seen. Confirmation and walking are separate views,
          // so adding their counts would count the same chair twice.
          detections: mergeInventoryIntoSavedDetections(room.detections, walked)
        };
      }

      const replacing = Boolean(existing);
      state.rooms = upsertRoom(state.rooms, room);
      state.tracks = [];
      state.capturing = false;
      toHub();
      // Saving a room used to be silent: the only sign it had worked was a new row
      // appearing on the hub. Confirm it explicitly, and say what the next room
      // would be so the walkthrough keeps its momentum.
      // Always confirmed now. The reading no longer happens before this point, so
      // there is no failure to suppress it — a read that fails later says so on
      // its own, from the background, and leaves the room retryable.
      {
        const count = room.detections.reduce((total, detection) => total + itemQuantity(detection), 0);
        const items = count ? `${count} ${count === 1 ? "item" : "items"}` : "photo";
        // Suggested from the rooms not yet covered, never from how many have been
        // captured: which room comes next is the Landlord's choice, and a home is
        // not a fixed list. Silent once the common rooms are all done.
        const remaining = roomPresets.filter((preset) => !findRoom(state.rooms, preset));
        const upcoming = remaining.length ? ` Next: ${remaining[0].toLowerCase()}?` : "";
        toast(`${room.name} saved — ${items}${replacing ? " updated" : ""}.${upcoming}`);
      }
      // The room is already in the roster. Let the browser paint the saved hub
      // and confirmation before any snapshot or crop work begins; condition
      // analysis can follow without tying the red button to image processing.
      if (mustRead) {
        window.setTimeout(() => {
          if (!state.closed) readRoomInBackground({ frame, roomName, chosen, spokenNote, readingRevision });
        }, 0);
      }
    }

    // The shutter freezes first and saves second, so there is always a chance to
    // choose — or correct — what the room is read for.
    async function capture() {
      if (state.screen !== "live" || state.capturing || state.loadingRoom) return;
      if (state.frozen) return confirmSelection();
      const frame = currentFrame();
      if (!frame) return toast("The camera is still warming up — try again in a moment.");
      // A frame that is mostly erased is no longer a photograph of a room, and
      // it is also the frame most likely to have contained somebody. Asking for
      // another is better than storing one whose useful content is gone.
      if (state.lastRedaction && state.lastRedaction.ratio > unusableRedactionRatio) {
        scanEvents.record("scan.redaction.frame_rejected");
        return toast("Most of that photo was a person or a screen, so it was not kept. Point the camera at the room itself.");
      }
      freezeFrame(frame);
      // Said plainly rather than logged quietly. Somebody handing a photograph
      // of their home to a stranger is entitled to know what was removed from
      // it, and to check that against what they remember being in the room.
      if (state.lastRedaction?.summary) toast(state.lastRedaction.summary);
    }

    async function confirmSelection() {
      if (!state.frozen) return;
      // Guarded here as well as inside saveRoom. `saveRoom` is async, so between
      // a first press and its first await there is a window where a second press
      // gets through — enough on a laggy phone for one tap to be registered
      // twice and save the room twice.
      if (state.capturing) return;
      state.capturing = true;
      // Acknowledged on the press itself, before any work. The button used to
      // stay lit while a vision model was called, which reads as a dead button
      // and invites the second press this now refuses.
      el.readRoom.disabled = true;
      el.readRoom.textContent = "Saved";
      el.readRoom.classList.add("saved");
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
      try {
        const chosen = state.candidates.filter((box) => state.selectedIds.has(box.id));
        // Released before saveRoom so its own guard governs from here.
        state.capturing = false;
        await saveRoom(state.frozenFrame, chosen, { revisit: state.revisiting });
      } finally {
        state.capturing = false;
        el.readRoom.disabled = false;
        el.readRoom.textContent = "Confirm room";
        el.readRoom.classList.remove("saved");
      }
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
        await refreshPrivateRegionsForSource(image, image.naturalWidth, image.naturalHeight);
        if (state.closed || session !== state.roomSession || state.loadingRoom || state.capturing) return;
        const frame = drawVisibleRegion(image, image.naturalWidth, image.naturalHeight);
        if (!frame) throw new TypeError("That photo could not be opened.");
        if (state.lastRedaction && state.lastRedaction.ratio > unusableRedactionRatio) {
          throw new TypeError("Most of that photo was a person or a private screen. Point the camera at the room itself and try again.");
        }
        el.blocked.hidden = true;
        el.deck.hidden = false;
        el.deck.inert = false;
        el.deck.removeAttribute("aria-hidden");
        // A photo chosen from the phone's own camera never had a live
        // viewfinder, so there are no detected boxes to start from — but it can
        // still be marked up by hand before it is read.
        freezeFrame(frame, { live: false });
        if (state.lastRedaction?.summary) toast(state.lastRedaction.summary);
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
          if (!state.frozen) el.hint.textContent = previousHint || "Just walk around the room — items save themselves";
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

    // Reads the view the Landlord is currently standing in front of, if it is one
    // worth reading, and folds what comes back into the room's inventory.
    //
    // This is what replaces "stop, aim, tap". The decision of WHICH frames to read
    // is `shouldCaptureKeyframe` and lives in the model, because it is the part
    // that has to be right: too eager and a walk around a kitchen becomes a dozen
    // paid reads, too shy and the far wall is never seen.
    //
    // On-device COCO still drives the live highlight — it is instant, free and
    // never leaves the phone. It is not what fills the inventory, because its
    // eighty classes contain no radiator, wardrobe, blind, shower or air fryer,
    // which is most of what a cleaning quote actually turns on.
    async function maybeReadKeyframe(video) {
      if (!state.readingAllowed || !state.visionAvailable || state.frozen || state.closed) return;
      const roomName = state.currentRoom;
      const roomKey = transcriptKey(roomName);
      const budget = keyframeBudget(roomName);
      const decision = {
        signature: state.signature,
        previousSignature: state.previousSignature,
        lastReadSignature: budget.lastReadSignature,
        now: Date.now(),
        lastCaptureAt: budget.lastCaptureAt,
        capturedCount: budget.capturedCount,
        // Per-room overlap is never useful. One other room may still be landing
        // while the Landlord moves on, but a third waits until capacity returns.
        busy: walkingReadIsBlocked(state.keyframeActiveRooms, roomKey),
        // Guidance is not cosmetic. A frame already judged too dark,
        // overexposed or motion-soft must not become paid pricing evidence or
        // consume one of the room's four reads. The view stays eligible after
        // the Landlord corrects it because no budget state changes here.
        qualityKind: state.qualityKind,
        // A known-offline frame is kept local. Crucially, the decision happens
        // before the budget and signature below are advanced, so reconnection
        // can read the same settled view instead of leaving the room exhausted.
        online: !state.networkOffline
      };
      if (!shouldCaptureKeyframe(decision)) return;

      // Reserve the room before yielding to the asynchronous encoder. Without
      // this, the next video-frame callback sees the old idle state and starts a
      // second encode for the same view. The reservation also participates in the
      // existing two-room cap, so changing rooms cannot create unbounded work.
      state.keyframeActiveRooms.add(roomKey);
      const generation = budget.generation;
      renderInventory();
      renderScanProgress();
      let image = "";
      try {
        // Its own canvas. `el.canvas` belongs to the shutter path, and a keyframe
        // drawn onto it mid-walk would replace the frame a confirmation is about
        // to be graded from.
        let canvas = state.keyframeCanvas;
        if (!canvas) canvas = state.keyframeCanvas = document.createElement("canvas");
        const width = video.videoWidth || 0;
        const height = video.videoHeight || 0;
        if (!width || !height) throw new TypeError("The camera frame is not ready.");
        // Read exactly the same centred object-fit:cover crop that is visible in
        // the viewfinder. Analysing the full sensor frame can spend most of a
        // portrait phone's read on off-screen pixels and save objects the
        // Landlord never saw.
        const sourceRect = viewfinderSourceRect(width, height);
        if (!sourceRect) throw new TypeError("The visible camera frame is not ready.");
        const scale = Math.min(1, 1024 / Math.max(sourceRect.sWidth, sourceRect.sHeight));
        canvas.width = Math.max(1, Math.round(sourceRect.sWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceRect.sHeight * scale));
        canvas.getContext("2d").drawImage(
          video,
          sourceRect.sx, sourceRect.sy, sourceRect.sWidth, sourceRect.sHeight,
          0, 0, canvas.width, canvas.height
        );
        // `toDataURL` compressed the JPEG synchronously here, pausing the live
        // camera up to four times per room. The Blob path yields immediately and
        // keeps the exact same 1024px / 0.72 evidence supplied to the reader.
        image = await encodeCanvasJpeg(canvas, 0.72);
      } catch {
        state.diagnostics.keyframeEncodeErrors += 1;
        state.keyframeActiveRooms.delete(roomKey);
        if (!state.closed) {
          renderInventory();
          renderScanProgress();
        }
        return;
      }
      if (!image
        || state.closed
        || keyframeBudget(roomName).generation !== generation
        || state.networkOffline
        || (state.frozen && transcriptKey(state.currentRoom) === roomKey)) {
        state.keyframeActiveRooms.delete(roomKey);
        if (!state.closed) {
          renderInventory();
          renderScanProgress();
        }
        return;
      }

      budget.lastCaptureAt = decision.now;
      budget.lastReadSignature = decision.signature;
      // Counted BEFORE the request and never refunded. A failure that refunds the
      // attempt is a re-entry hole: the next steady view spends it again, and a
      // timeout or a 5xx can arrive long after the provider has already been
      // billed, so a failed response does not mean a free one.
      budget.capturedCount += 1;
      renderScanProgress();

      // The one caller that is NOT a confirmation. Named explicitly rather than
      // relying on the default, so adding a caller cannot quietly put a walking
      // frame on the dearer tier.
      const readStartedAt = Date.now();
      readRoom(image, roomName, [], roomTranscript(roomName), "walking")
        .then((reading) => {
          // The room may have been removed while this was in flight. Landing its
          // result anyway would recreate an inventory the Landlord just deleted.
          if (state.closed || keyframeBudget(roomName).generation !== generation) return;
          // Coverage means analysed evidence, not a request that happened to
          // leave the phone. The attempt was spent before the request to preserve
          // the bounded cost; only a valid response earns a progress step.
          const completedBudget = keyframeBudget(roomName);
          completedBudget.completedCount = Math.min(completedBudget.capturedCount, completedBudget.completedCount + 1);
          state.diagnostics.keyframesRead += 1;
          state.diagnostics.lastReadMs = Date.now() - readStartedAt;
          state.diagnostics.lastReadFailure = "";
          const dismissed = state.dismissed.get(transcriptKey(roomName)) || new Set();
          const found = (reading?.detections || [])
            // The room filter applies to what a reader names too. It is a better
            // reader than COCO, but "oven" in a bedroom is still wrong.
            .filter((detection) => !implausibleForRoom(detection?.label, roomName))
            // Something the Landlord removed stays removed. Merging it back is the
            // fastest way to make a correction feel ignored.
            .filter((detection) => !dismissed.has(inventoryKey(detection?.label)))
            .map((detection) => ({
              label: detection.label,
              // The reader's own confidence, not a constant. An item it was
              // unsure about must not sort above one it was certain of, and the
              // list is ordered by how sure the room is.
              score: Number.isFinite(detection.confidence) ? detection.confidence : 0.5,
              conditionConfidence: Number.isFinite(detection.conditionConfidence)
                ? detection.conditionConfidence
                : Number.isFinite(detection.confidence) ? detection.confidence : null,
              condition: detection.condition || "",
              soiling: Array.isArray(detection.soiling) ? detection.soiling : [],
              note: detection.note || "",
              x: detection.x, y: detection.y,
              width: detection.width, height: detection.height,
              source: "read"
            }));
          // Tasks and condition are kept even when no new object was named — a
          // second angle on the same room still tells us how dirty it is.
          rememberWalkEvidence(roomName, reading);
          if (!found.length) return;
          setInventory(roomName, mergeRoomInventory(inventoryFor(roomName), found, { now: Date.now() }));
        })
        .catch((error) => {
          // Deliberately no refund. See the note where the count is spent.
          state.diagnostics.detectorErrors += 1;
          state.diagnostics.lastReadFailure = String(error?.code || error?.message || "failed").slice(0, 60);
        })
        .finally(() => {
          state.keyframeActiveRooms.delete(roomKey);
          if (!state.closed) {
            renderInventory();
            renderScanProgress();
          }
        });
    }

    // Rendered with replaceChildren and textContent throughout. Item labels come
    // back from a reader looking at a photograph of a stranger's home; treating
    // one as markup is how a room note becomes an injection.
    // Answers, on screen, the question every bug report has forced us to guess
    // at: did the scanner read frames at all, or read them and get them wrong?
    // Those are different failures with different fixes, and a screenshot alone
    // cannot tell them apart. Opt-in — ?scanDebug=1 — so a customer never sees
    // it; a tester turns it on and their screenshot becomes a diagnosis.
    function renderScanDebug() {
      if (!state.scanDebug || !el.scanDebug) return;
      const budget = keyframeBudget(state.currentRoom);
      const inFlight = state.keyframeActiveRooms.has(transcriptKey(state.currentRoom) || "unnamed");
      const lines = [
        ["detector", state.detectorState],
        ["attempts", `${budget.capturedCount}/${keyframeDefaults.maxPerRoom}${inFlight ? " +1 in flight" : ""}`],
        ["analysed", `${budget.completedCount}/${keyframeDefaults.maxPerRoom}`],
        ["read ok", String(state.diagnostics.keyframesRead)],
        ["room-filtered", String(state.diagnostics.suppressedByRoom)],
        ["errors", `${state.diagnostics.detectorErrors} read · ${state.diagnostics.keyframeEncodeErrors} encode`],
        ["last read", state.diagnostics.lastReadMs ? `${state.diagnostics.lastReadMs}ms` : "—"],
        ["last failure", state.diagnostics.lastReadFailure || "—"],
        ["quality", state.qualityKind || "ok"]
      ];
      el.scanDebug.replaceChildren(...lines.flatMap(([term, value]) => {
        const dt = document.createElement("dt");
        dt.textContent = term;
        const dd = document.createElement("dd");
        dd.textContent = value;
        return [dt, dd];
      }));
      el.scanDebug.hidden = false;
    }

    function renderInventory() {
      renderScanDebug();
      const items = inventoryFor();
      const list = el.foundList;
      if (!list) return;
      const currentRoomBusy = state.keyframeActiveRooms.has(transcriptKey());
      el.found.hidden = items.length === 0 && !currentRoomBusy;
      el.foundBusy.hidden = !currentRoomBusy;
      // Says how many need attention, not how many exist. "16 items found" over a
      // list whose visible rows all read CLEAN told a customer nothing and looked
      // like padding; what they want to know is how much work this room is.
      const totalItems = items.reduce((total, item) => total + itemQuantity(item), 0);
      const needsWork = items
        .filter((item) => item.condition && item.condition !== "clean")
        .reduce((total, item) => total + itemQuantity(item), 0);
      el.foundCount.textContent = String(needsWork || totalItems);
      el.foundNoun.textContent = needsWork
        ? `to clean${totalItems > needsWork ? ` · ${totalItems - needsWork} clean` : ""}`
        : totalItems === 1 ? "item" : "items";

      const rows = items.map((item) => {
        const row = document.createElement("li");
        row.className = "found-item";
        // Seen from more than one angle, or confirmed by the Landlord. Both mean
        // "this is really there", and the tick is the feedback that it is saved.
        if (item.confirmed || item.sightings > 1) row.classList.add("is-sure");
        if (item.confirmed) row.classList.add("is-confirmed");
        if (item.conditionConfirmed) row.classList.add("is-condition-confirmed");

        const name = document.createElement("button");
        name.type = "button";
        name.className = "found-name";
        name.textContent = inventoryDisplayLabel(item);
        // The condition sits on the row because it is the answer being paid for.
        // A row that says only "Worktop" tells a customer nothing they did not
        // already know about their own kitchen.
        if (item.condition) {
          const grade = document.createElement("em");
          grade.className = "found-grade";
          grade.dataset.grade = item.condition;
          grade.textContent = item.condition === "clean" ? "clean" : item.condition;
          name.append(" ", grade);
        } else {
          const grade = document.createElement("em");
          grade.className = "found-grade";
          grade.dataset.grade = "uncertain";
          grade.textContent = "condition unclear";
          name.append(" ", grade);
        }
        // Marked when the reader said it was unsure, so an uncertain answer never
        // looks as settled as a confident one.
        if (Number.isFinite(item.score) && item.score > 0 && item.score < 0.5) name.dataset.unsure = "true";
        if (item.note) name.title = item.note;
        name.dataset.inventoryRename = item.key;
        name.setAttribute("aria-label", `Edit ${inventoryDisplayLabel(item)} name and cleaning level`);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "found-remove";
        remove.dataset.inventoryRemove = item.key;
        remove.setAttribute("aria-label", `Remove ${item.label}`);
        remove.textContent = "×";

        row.append(name, remove);
        return row;
      });
      list.replaceChildren(...rows);
    }

    // Everything a walking read returned beyond the object names. Accumulated so a
    // room ends up with the union of what four angles noticed, not the contents of
    // whichever read happened last.
    function rememberWalkEvidence(roomName, reading) {
      const key = transcriptKey(roomName);
      if (!key || !reading) return;
      const current = state.walkEvidence.get(key) || { tasks: [], condition: "" };
      const seen = new Set(current.tasks.map((task) => String(task).toLowerCase().trim()));
      for (const task of Array.isArray(reading.tasks) ? reading.tasks : []) {
        const line = String(task || "").trim();
        const fingerprint = line.toLowerCase();
        if (!line || seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        current.tasks.push(line);
      }
      // The worst grade any angle saw wins. A kitchen that looks tidy from the
      // doorway and heavy behind the bin is a heavy kitchen — taking the last
      // reading instead would let the final glance undercharge the job.
      current.condition = worseCondition(current.condition, reading.condition);
      state.walkEvidence.set(key, current);
    }

    const conditionRank = { light: 1, medium: 2, heavy: 3 };
    function worseCondition(first, second) {
      const left = String(first || "").toLowerCase();
      const right = String(second || "").toLowerCase();
      if (!conditionRank[right]) return first || "";
      if (!conditionRank[left]) return right;
      return conditionRank[right] > conditionRank[left] ? right : left;
    }

    function inventoryFor(roomName = state.currentRoom) {
      return state.inventories.get(transcriptKey(roomName)) || [];
    }

    function setInventory(roomName, items) {
      const key = transcriptKey(roomName);
      if (!key) return;
      state.inventories.set(key, items);
      renderInventory();
      renderDetectorState();
    }

    // Each room keeps its own budget for the life of the scan. Looked up rather
    // than reset, so walking out of the kitchen and back in does not buy another
    // four reads of it — the consent promises a bound per room, not per visit.
    function keyframeBudget(roomName = state.currentRoom) {
      const key = transcriptKey(roomName) || "unnamed";
      let budget = state.keyframeBudgets.get(key);
      if (!budget) {
        // `generation` is bumped whenever the room is removed. A read already in
        // flight carries the generation it started under, so its result lands
        // nowhere rather than recreating an inventory the Landlord just deleted.
        budget = { lastReadSignature: null, lastCaptureAt: 0, capturedCount: 0, completedCount: 0, generation: 0 };
        state.keyframeBudgets.set(key, budget);
      }
      return budget;
    }

    function mergeSavedTasks(existing, incoming) {
      const seen = new Set();
      const merged = [];
      for (const task of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
        const line = String(task || "").trim();
        const fingerprint = line.toLowerCase();
        if (!line || seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        merged.push(line);
      }
      return merged.slice(0, 12);
    }

    function readRoomInBackground({ frame, roomName, chosen, spokenNote, readingRevision }) {
      if (state.networkOffline) {
        const current = findRoom(state.rooms, roomName);
        if (current?.readingStatus === "reading" && current.readingRevision === readingRevision) {
          state.rooms = upsertRoom(state.rooms, { ...current, readingStatus: "needs-retry" });
          state.networkDeferredRooms.add(transcriptKey(roomName));
        }
        toast(`${roomName} is saved in this scan — keep it open and automatic reading will resume when you're online.`);
        renderHub();
        return;
      }
      state.pendingReads += 1;
      renderHub();
      readRoom(frame, roomName, chosen, spokenNote)
        .then((reading) => {
          // The scan may have been discarded, or this room removed and re-added,
          // while the model was thinking. Updating a room that is no longer the
          // one this reading is about would attach a kitchen's grade to a
          // bathroom, so it lands only on the room it started for.
          if (state.closed) return;
          const current = findRoom(state.rooms, roomName);
          if (!current || current.readingStatus !== "reading" || current.readingRevision !== readingRevision) return;
          state.rooms = upsertRoom(state.rooms, {
            ...current,
            // MERGED, not replaced. The room already holds what the walk found —
            // fixtures seen from angles this one frame does not cover, and the
            // tasks that came with them. Overwriting with this reading's arrays
            // discarded exactly the coverage the walk exists to provide.
            detections: mergeSavedDetections(current.detections, reading.detections),
            tasks: mergeSavedTasks(current.tasks, reading.tasks),
            condition: resolveRoomCondition(reading.condition, current.condition),
            readingStatus: reading.readingStatus || "ready",
            readingRevision: 0
          });
          renderHub();
        })
        .catch((error) => {
          if (state.closed) return;
          const current = findRoom(state.rooms, roomName);
          // An older request may fail after the Landlord has already rescanned
          // this room. It must not mark the newer revision as failed or show a
          // retry message for work that no longer belongs to it.
          if (!current || current.readingStatus !== "reading" || current.readingRevision !== readingRevision) return;
          // Marked for retry rather than lost. The room, its photograph and the
          // customer's own note are already saved — only the automatic naming
          // failed, and tapping the room tries again.
          state.rooms = upsertRoom(state.rooms, { ...current, readingStatus: "needs-retry" });
          const disconnected = state.networkOffline || navigator.onLine === false;
          if (disconnected) state.networkDeferredRooms.add(transcriptKey(roomName));
          toast(disconnected
            ? `${roomName} is saved in this scan — keep it open and automatic reading will resume when you're online.`
            : error?.code === "sign-in-required"
              ? `${roomName} saved. Sign in to let Homle name objects automatically.`
              : `${roomName} saved, but automatic reading did not finish. Tap the room to retry.`);
          renderHub();
        })
        .finally(() => {
          state.pendingReads = Math.max(0, state.pendingReads - 1);
          if (!state.closed) renderHub();
        });
    }

    function resumeDeferredRoomReads() {
      if (state.closed || state.networkOffline || document.hidden || !state.networkDeferredRooms.size) return;
      for (const roomKey of [...state.networkDeferredRooms]) {
        const room = state.rooms.find((candidate) => transcriptKey(candidate?.name) === roomKey);
        state.networkDeferredRooms.delete(roomKey);
        if (!room?.image || room.readingStatus !== "needs-retry") continue;
        const readingRevision = state.nextReadingRevision;
        state.nextReadingRevision += 1;
        state.rooms = upsertRoom(state.rooms, { ...room, readingStatus: "reading", readingRevision });
        readRoomInBackground({
          frame: room.image,
          roomName: room.name,
          chosen: room.detections || [],
          spokenNote: room.transcript || "",
          readingRevision
        });
      }
      renderHub();
    }

    async function readRoom(image, roomName, items = [], transcript = "", purpose = "confirmation") {
      const localDetections = items.map((item) => ({
        id: item.id, label: item.label || "Marked item", note: item.note || "",
        x: item.x, y: item.y, width: item.width, height: item.height
      }));
      if (!state.readingAllowed || !state.visionAvailable) {
        return { detections: localDetections, tasks: localRoomTasks(roomName, transcript), condition: "", readingStatus: "manual" };
      }

      // Decode the immutable frame rather than reading the shared capture canvas.
      // The customer can already be scanning the next room while crops encode;
      // this source can never become that later room.
      const cropSource = items.length ? await snapshotCropSource(image) : null;
      const selected = [];
      for (const item of items) {
        selected.push({
          id: item.id, kind: item.kind, label: item.label,
          box: { x: item.x, y: item.y, width: item.width, height: item.height },
          score: item.score,
          conditionConfidence: item.conditionConfidence,
          crop: await cropFor(item, cropSource)
        });
      }
      // The route rejects anything over its body limit with a 413 the Landlord
      // could only ever read as a generic failure, so the budget is settled here
      // rather than discovered on the way back.
      const payload = roomReadingPayload({ roomName, transcript: String(transcript || "").slice(-1200), roomFrame: image, items: selected, purpose });
      if (!payload.withinLimit) throw new Error("reading-too-large");

      const csrf = await recoverCsrf();
      if (!csrf) throw Object.assign(new Error("A signed-in Landlord session is required."), { code: "sign-in-required" });

      // Each read owns its own controller, and starting one no longer cancels the
      // one before it.
      //
      // Aborting the predecessor was right while reads were strictly sequential —
      // a save blocked until its read finished, so a second read could only mean
      // the first was abandoned. Saving optimistically makes overlap ordinary:
      // confirming the kitchen and walking straight into the bathroom starts a
      // walking read that would have killed the kitchen's confirmation, and the
      // kitchen would have been left saying "reading it now" forever.
      //
      // They are tracked as a set so `close()` can still abort every one.
      const controller = new AbortController();
      state.roomReadControllers.add(controller);
      // Closing the overlay while a read was in flight must still stop it.
      if (state.closed) controller.abort();
      const timer = window.setTimeout(() => controller.abort(), 32_000);
      try {
      const response = await fetch("/api/marketplace/landlord/room-reading", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(payload.body),
        signal: controller.signal
      });
      if (response.status === 503) {
        state.visionAvailable = false;
        return { detections: localDetections, tasks: localRoomTasks(roomName, transcript), condition: "", readingStatus: "manual" };
      }
      if (!response.ok) throw new Error("reading-failed");
      const result = await response.json();
      return {
        // With a selection the device already owns the geometry and only the
        // names come back; without one the whole frame was read the old way and
        // the boxes it asserts still have to be checked against the frame.
        detections: selected.length ? mergeItemReadings(items, result) : usableDetections(result?.detections),
        tasks: Array.isArray(result?.tasks) ? result.tasks : [],
        condition: result?.condition || "",
        readingStatus: "ready"
      };
      } catch (error) {
        if (error?.name === "AbortError") throw Object.assign(new Error("Room reading timed out."), { code: "reading-timeout" });
        throw error;
      } finally {
        window.clearTimeout(timer);
        state.roomReadControllers.delete(controller);
      }
    }

    function localRoomTasks(roomName, transcript) {
      const note = String(transcript || "").trim();
      if (!note) return [];
      return checklistFromTranscript(`In the ${roomName}, ${note}`).map((line) => {
        const divider = line.indexOf(":");
        const task = divider >= 0 ? line.slice(divider + 1).trim() : line.trim();
        return task ? `${roomName}: ${task}` : "";
      }).filter(Boolean);
    }

    /* ── Live detection ── */

    // Detection runs before the consent question is asked, and that is
    // deliberate: the model is same-origin and every frame it looks at stays on
    // the phone. Consent governs the network call, which is the only point at
    // which anything about this home leaves the device.
    function liveBoxes() {
      return usableLiveBoxes(drawableTracks(state.tracks).map((track) => ({
        id: `d${track.id}`, x: track.x, y: track.y, width: track.width, height: track.height,
        // NO LABEL while the camera is live, deliberately.
        //
        // The on-device detector has eighty classes and none of them are the
        // things in a real home, so it answers with its nearest guess and writes
        // it across the object: BOWLS on a printer, PERSON on a monitor, BENCH on
        // a bed, CHAIR on a PC tower. Every one of those was on screen at once in
        // a real scan, and a wrong name printed confidently over the thing itself
        // is worse than no name — it is the single most visible reason to
        // disbelieve everything else the scanner says.
        //
        // The glow still does its job: it shows the scanner is awake, tracking,
        // and has found something worth a look. What each thing IS comes from the
        // reader, in the list below, where it is right often enough to print.
        label: "", kind: "detected", score: track.score
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
        // The glow is optional, the automatic room reader is not. The lightweight
        // frame-quality/keyframe loop below keeps running without WebGL or this
        // model, so a phone that cannot load COCO still gets the promised
        // walk-around room reading as well as photos, notes and manual marking.
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
      if (state.networkOffline) {
        el.detectorState.hidden = false;
        el.detectorState.dataset.kind = "guide";
        el.detectorState.textContent = "Connection paused — object finding stays on your phone. Keep this scan open and room reading will resume automatically.";
        return;
      }
      // Once the detector is up, this line is where framing guidance goes: it is
      // the more useful thing to say about a live frame, and only one of the two
      // ever needs saying at a time.
      if (state.detectorState === "ready") {
        // Lighting and motion outrank distance: moving closer cannot restore
        // detail to a dark or swept frame. The distance hint comes only from
        // stable, currently visible tracks and disappears when one object fills
        // enough of the view for condition evidence.
        const guidance = state.qualityMessage
          || state.framingMessage
          || conditionReviewAdvice(inventoryFor())?.message;
        if (!guidance) {
          el.detectorState.hidden = true;
          return;
        }
        el.detectorState.hidden = false;
        el.detectorState.dataset.kind = "guide";
        el.detectorState.textContent = guidance;
        return;
      }
      if (state.detectorState === "unavailable") {
        el.detectorState.hidden = false;
        el.detectorState.dataset.kind = "off";
        el.detectorState.textContent = "Live object glow is unavailable — room reading still runs automatically. Tap anything to mark it yourself.";
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
      if (state.rafId) return;
      warmDetector();

      state.detectionGeneration += 1;
      const generation = state.detectionGeneration;
      function step() {
        state.rafId = 0;
        if (state.closed || state.frozen || generation !== state.detectionGeneration) return;
        scheduleDetectionFrame(step);
        // Frame selection and assisted reading are not a feature of COCO. While
        // that optional model is loading—or when WebGL/model loading failed—the
        // cheap quality pass still chooses settled views for the room reader.
        if (state.detectorState !== "ready") {
          runKeyframePass(generation);
          return;
        }
        if (detectorBusy) return;
        const now = Date.now();
        if (now - state.lastDetectionAt < state.detectionInterval) return;
        state.lastDetectionAt = now;
        runDetection(generation);
      }
      scheduleDetectionFrame(step);
    }

    function runKeyframePass(generation) {
      const video = el.camera;
      if (state.closed || state.frozen || generation !== state.detectionGeneration) return;
      if (!video.videoWidth || !video.videoHeight) return;
      // `sampleFrameQuality` owns its 900ms throttle and returns true only when a
      // fresh signature was actually measured. This keeps the fallback far
      // lighter than object inference and prevents repeated decisions on stale
      // pixels.
      if (!sampleFrameQuality(video)) return;
      maybeReadKeyframe(video);
    }

    function scheduleDetectionFrame(callback) {
      if (typeof el.camera.requestVideoFrameCallback === "function") {
        state.frameCallbackKind = "video";
        state.rafId = el.camera.requestVideoFrameCallback(callback);
      } else {
        state.frameCallbackKind = "animation";
        state.rafId = requestAnimationFrame(callback);
      }
    }

    function stopDetection() {
      if (state.rafId && state.frameCallbackKind === "video" && typeof el.camera.cancelVideoFrameCallback === "function") {
        el.camera.cancelVideoFrameCallback(state.rafId);
      } else if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = 0;
      state.frameCallbackKind = "";
      // A detection resolving from a previous run must not paint over a frame
      // the Landlord has since frozen.
      state.detectionGeneration += 1;
      // Every freeze goes through here, so this is where guidance about a live
      // frame stops being true — "too dark" must not sit over a frozen photo.
      renderDetectorState();
    }

    // A phone camera hands us 720p or more. The detector only ever sees a few
    // hundred pixels a side, so uploading the full frame to the GPU and letting
    // the model shrink it is work paid for on every pass. The reusable canvas
    // holds the exact visible crop, so cropped-out sensor pixels cannot create a
    // false glow and the model spends its limited resolution on what the
    // Landlord is actually pointing at.
    function inferenceFrame(video) {
      const sourceWidth = video.videoWidth || 0;
      const sourceHeight = video.videoHeight || 0;
      const sourceRect = viewfinderSourceRect(sourceWidth, sourceHeight);
      if (!sourceRect) return video;
      const fullFrame = sourceRect.sx === 0 && sourceRect.sy === 0
        && sourceRect.sWidth === sourceWidth && sourceRect.sHeight === sourceHeight;
      const longest = Math.max(sourceRect.sWidth, sourceRect.sHeight);
      if (fullFrame && longest <= DETECT_INPUT_SIZE) return video;
      const scale = Math.min(1, DETECT_INPUT_SIZE / longest);
      const width = Math.max(1, Math.round(sourceRect.sWidth * scale));
      const height = Math.max(1, Math.round(sourceRect.sHeight * scale));
      let canvas = state.detectCanvas;
      if (!canvas) canvas = state.detectCanvas = document.createElement("canvas");
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas.getContext("2d").drawImage(
        video,
        sourceRect.sx, sourceRect.sy, sourceRect.sWidth, sourceRect.sHeight,
        0, 0, width, height
      );
      return canvas;
    }

    // Brightness and detail, read off the small frame already drawn for the
    // detector, so guidance costs one `getImageData` on a few hundred pixels rather
    // than any extra work on the camera path. Sampled every few passes, not every
    // pass — a readback is the one genuinely synchronous thing here.
    function sampleFrameQuality(source) {
      if (!source) return false;
      const now = Date.now();
      if (now - state.lastQualityAt < QUALITY_SAMPLE_MS) return false;
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
        const sourceWidth = source.videoWidth || source.naturalWidth || source.width || 0;
        const sourceHeight = source.videoHeight || source.naturalHeight || source.height || 0;
        const sourceRect = viewfinderSourceRect(sourceWidth, sourceHeight);
        if (!sourceRect) return false;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        // Guidance and scene signatures must judge the same pixels the
        // Landlord sees and the room reader receives. The full sensor can be
        // mostly outside a portrait viewfinder and can otherwise trigger a
        // movement or lighting decision from invisible pixels.
        context.drawImage(
          source,
          sourceRect.sx, sourceRect.sy, sourceRect.sWidth, sourceRect.sHeight,
          0, 0, canvas.width, canvas.height
        );
        pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      } catch { return false; }
      const { width, height } = canvas;
      const quality = frameQualityStats(pixels, width, height);
      if (!quality) return false;
      // Piggy-backed on the pixel read that was already happening for the quality
      // hint. Walking a room needs to know whether the view has changed, and a
      // second readback purely to answer that would cost a GPU sync every frame.
      state.previousSignature = state.signature;
      state.signature = frameSignature(pixels, width, height);

      // A short memory of how fast the view is changing, for the movement hint.
      // Two samples is ~1.8s of sustained motion — a deliberate sweep, not the
      // single turn to a new wall that walking a room is supposed to involve.
      //
      // Only when both signatures are real. `signatureDistance(null, …)` is
      // defined as 1 — maximally different — which is the right answer for the
      // keyframe picker but would count the first sample of every session as a
      // fast one here, halving the streak the hint is supposed to require.
      if (Array.isArray(state.previousSignature) && Array.isArray(state.signature)) {
        state.motionDistances.push(signatureDistance(state.previousSignature, state.signature));
        // Spread rides alongside distance so the hint can tell a moving camera
        // from a room that moves by itself — colour-cycling fans, an LED wash, a
        // playing television. Both series are trimmed together to stay aligned.
        state.motionSpreads.push(signatureChangeSpread(state.previousSignature, state.signature));
        if (state.motionDistances.length > 3) state.motionDistances.shift();
        if (state.motionSpreads.length > 3) state.motionSpreads.shift();
      }

      // Lighting problems outrank movement: a dark room stays dark however
      // slowly the phone moves, so that is the thing worth saying first.
      const advice = frameQualityAdvice(quality)
        || movementAdvice(state.motionDistances, { spreads: state.motionSpreads });
      const key = advice ? advice.kind : "";
      if (key === state.qualityKind) return true;
      state.qualityKind = key;
      state.qualityMessage = advice ? advice.message : "";
      renderDetectorState();
      return true;
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
        // The third argument is coco-ssd's own minimum score. Omitted before, so its
        // 0.5 default applied and low-confidence guesses reached the tracker at all.
        const found = await state.detector.detect(source, 12, detectionMinimumScore);
        state.diagnostics.framesInferred += 1;
        if (state.closed || state.frozen || generation !== state.detectionGeneration) return;
        const rect = viewfinderRect();
        const mapped = [];
        let suppressed = 0;
        for (const item of found) {
          // The Landlord already told us which room this is, and the detector has
          // no idea. An oven in a bedroom is not a low-confidence oven — it is a
          // chest of drawers, which is exactly what COCO-SSD returned "oven" for on
          // a real scan. Dropped before mapping so it never reaches a track, never
          // draws, and never gets sent for naming.
          if (implausibleForRoom(cocoLabel(item?.class), state.currentRoom)) {
            suppressed += 1;
            continue;
          }
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
        // People, screens and documents are kept in the SOURCE coordinates the
        // detector returned, not the mapped viewfinder ones. The frame that gets
        // uploaded is cut from the source, so redacting it needs boxes measured
        // against the same thing — mapped boxes are for drawing on screen.
        //
        // Deliberately gathered from `found` rather than from the tracks: a
        // person is filtered out of the tracker by implausibleForRoom and by
        // the tracking threshold, and neither of those is a reason to publish
        // their face.
        state.privateRegions = found
          .filter((item) => shouldRedact(item?.class))
          .map((item) => ({ class: item.class, bbox: Array.isArray(item?.bbox) ? item.bbox : [] }));
        state.privateRegionSource = { width: source.width || video.videoWidth, height: source.height || video.videoHeight };
        // Counted rather than logged per frame: at several frames a second, a line
        // per suppression would bury anything else in the console. A running total
        // is enough to tell "the filter is working" from "the filter is eating
        // everything" when diagnosing a scan.
        if (suppressed) state.diagnostics.suppressedByRoom += suppressed;
        const tracked = trackDetections(state.tracks, mapped, { nextId: state.nextTrackId });
        state.tracks = tracked.tracks;
        state.nextTrackId = tracked.nextId;
        paintBoxes(liveBoxes());
        // Update the guidance only when its meaning changes. Detection can run
        // several times a second; rewriting the live-region DOM on every frame
        // would trade a helpful hint for viewfinder work and repeated screen-
        // reader announcements.
        const framingMessage = objectFramingAdvice(state.tracks)?.message || "";
        if (framingMessage !== state.framingMessage) {
          state.framingMessage = framingMessage;
          renderDetectorState();
        }
        // The shutter is no longer the only way a room gets read. Walking around
        // reads the views the Landlord actually stops on, and the inventory below
        // is the union of all of them rather than one photograph.
        maybeReadKeyframe(video);
      } catch (error) {
        // A detector that starts failing mid-scan must not wedge the loop or
        // leave stale boxes floating over a live camera. Guarded like the
        // success path, so a rejection arriving from a previous run cannot wipe
        // the boxes off a frame the Landlord has since frozen and is choosing on.
        if (state.closed || state.frozen || generation !== state.detectionGeneration) return;
        state.diagnostics.detectorErrors += 1;
        // Reported once. The loop stops after this, so a second line would only
        // ever be a duplicate, and the message names the cause rather than the
        // symptom — "boxes stopped appearing" is what gets reported otherwise.
        console.warn("Homle room scan: on-device detection stopped.", error?.message || error);
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
      resumeDeferredRoomReads();
    }

    function onVisibility() {
      if (document.hidden) pauseForBackground();
      else resumeAfterBackground();
    }

    function onPageHide() { flushRoomNotes(); pauseForBackground(); }
    function onPageShow() { resumeAfterBackground(); }

    function onNetworkChange() {
      const offline = navigator.onLine === false;
      if (offline === state.networkOffline) return;
      state.networkOffline = offline;
      renderDetectorState();
      if (offline) {
        toast("Connection paused — keep this scan open. Local object finding still works.");
        return;
      }
      toast("Back online — automatic room reading resumed.");
      resumeDeferredRoomReads();
    }

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
      recognition.lang = preferredSpeechLanguage(
        document.documentElement.lang,
        navigator.languages || navigator.language
      );
      recognition.continuous = true;
      recognition.interimResults = true;
      // The note as it stood when listening started. Everything this session
      // recognises is joined onto it, so the handler below can run any number of
      // times for the same audio and produce the same note.
      let sessionBase = roomTranscript();
      let sessionFinal = "";
      let lastInterim = "";

      recognition.onresult = (event) => {
        if (state.recognition !== recognition || generation !== state.voiceGeneration) return;
        // REBUILT from the whole result list, never appended to.
        //
        // `event.results` is cumulative for the session and `event.resultIndex` is
        // only a hint about what changed. The previous version looped from that
        // index and appended each final onto the stored note, which meant the
        // handler was not idempotent — and Android Chrome fires `onresult`
        // repeatedly covering segments that are already final. Every one of those
        // events re-appended text that was already stored, so a Landlord saying
        // "tidy up the cupboards" got back "tidy tidy up tidy up the tidy up the
        // cupboards tidy up the cupboards". Recomputing from the list instead
        // makes a repeated event a no-op, which is what it should always have been.
        let finalText = "";
        let interim = "";
        // Indexed, NOT `for...of`. `SpeechRecognitionResultList` is a WebIDL
        // interface with an indexed getter and a length and no `iterable<>`
        // declaration, so it has no `Symbol.iterator` and `for...of` throws on it.
        // That would have broken every result event rather than only the repeats.
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result?.[0]) continue;
          if (result.isFinal) finalText += result[0].transcript;
          else interim += result[0].transcript;
        }
        sessionFinal = finalText;
        lastInterim = interim;
        setRoomTranscript(joinSpokenText(sessionBase, sessionFinal));
        renderVoiceTranscript(interim);
      };
      // `continuous` recognition is ended by the browser on its own — Android
      // Chrome stops after a pause and Safari after roughly a minute — and the
      // next session starts `event.results` over from empty. Without re-basing
      // here, the second session's rebuild would overwrite everything the first
      // one heard. Restarting is what lets a Landlord keep talking while they walk.
      recognition.onend = () => {
        if (state.recognition !== recognition || generation !== state.voiceGeneration) return;
        if (!state.voiceOn) return;
        // BOTH, not one or the other. A single event routinely carries a final
        // "tidy up" alongside an interim "the cupboards"; `sessionFinal || lastInterim`
        // kept only the final and dropped the rest of the sentence.
        sessionBase = joinSpokenText(sessionBase, `${sessionFinal} ${lastInterim}`);
        sessionFinal = "";
        lastInterim = "";
        setRoomTranscript(sessionBase);
        try { recognition.start(); } catch { stopVoice(); }
      };

      // A trailing phrase that never reached `isFinal` is still what the Landlord
      // said. Committing it on stop is why "…put the bins out" is not lost when
      // they tap the microphone the moment they finish the sentence.
      recognition.commitPending = () => {
        const spoken = joinSpokenText(sessionBase, `${sessionFinal} ${lastInterim}`);
        if (spoken) setRoomTranscript(spoken);
      };
      recognition.onerror = (event) => {
        if (state.recognition !== recognition || generation !== state.voiceGeneration) return;
        // `no-speech` and `aborted` are the browser reporting a quiet moment, not a
        // failure. Ending the session on them is why listening used to die the
        // first time a Landlord paused to open a cupboard; `onend` restarts instead.
        if (event?.error === "no-speech" || event?.error === "aborted") return;
        recognition.commitPending();
        stopVoice({ failed: true });
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
        // Before the handlers come off, so a phrase that never reached `isFinal` is
        // still kept. Tapping the microphone the instant a sentence ends used to
        // discard it, which read as the app mishearing rather than not listening.
        try { recognition.commitPending?.(); } catch {}
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try { recognition.stop(); } catch {}
      }
      el.mic.classList.remove("rec");
      el.mic.setAttribute("aria-pressed", "false");
      el.voice.classList.remove("recording");
      el.voiceStatus.textContent = failed ? "Room note · listening stopped" : "Room note · review";
      // Reset the transform, not the height: the bars are full height and scaled.
      // Leaving an inline `height` here would shrink the bar the scale applies to,
      // so every later recording drew a flatter and flatter wave.
      for (const bar of $$("[data-wave] b")) bar.style.transform = "scaleY(.2)";
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
      // Finishing while a room is still being read would take the provisional
      // tasks and grade — the ones written locally at save time — straight into
      // the booking, and `close()` aborts the read that was about to replace
      // them. The customer would be quoted from a placeholder and never know.
      //
      // Asked rather than blocked: they may genuinely want to get on, and their
      // photographs and notes are all saved either way.
      const unfinished = state.rooms.filter((room) => room.readingStatus === "reading" || room.readingStatus === "needs-retry");
      const readingKey = unresolvedRoomReadKey(state.rooms);
      const conditionKey = unresolvedRoomConditionKey(state.rooms);
      const unresolvedKey = [readingKey, conditionKey].filter(Boolean).join("||");
      if (unresolvedKey && state.finishWarningKey !== unresolvedKey) {
        state.finishWarningKey = unresolvedKey;
        if (!readingKey) {
          const names = state.rooms
            .filter((room) => unresolvedRoomConditionKey([room]))
            .map((room) => room.name)
            .join(", ");
          toast(`${names}: an item condition still needs checking. Tap the room to move closer or confirm it. Tap Done again to continue.`);
          renderHub();
          return;
        }
        const names = unfinished.map((room) => room.name).join(", ");
        const deferred = unfinished.some((room) => room.readingStatus === "needs-retry");
        const conditionNames = state.rooms
          .filter((room) => unresolvedRoomConditionKey([room]))
          .map((room) => room.name)
          .join(", ");
        const conditionNotice = conditionNames
          ? ` ${conditionNames}: an item condition also needs checking.`
          : "";
        toast((deferred
          ? `${names} still needs automatic reading. Keep this scan open until the connection returns, or tap Done again to finish with its photo and note only.`
          : `Still reading ${names}. Tap Done again to finish now — that room keeps your photo and note but not the automatic detail.`) + conditionNotice);
        renderHub();
        return;
      }
      // Do not let a completed warning leak into a later room. If every read
      // landed, the next unresolved set must earn its own explicit second tap.
      if (!unresolvedKey) state.finishWarningKey = "";
      stopVoice({ silent: true });
      // The notes are being handed to the booking journey, so the recovery copy has
      // done its job and should not survive to be offered again.
      forgetRoomNotes();
      const summary = scanSummary(state.rooms);
      scanEvents.record("scan.session.duration_ms", { durationMs: elapsedSince(state.startedAt) ?? 0 });
      // Flushed here rather than left to the timer: the overlay is about to be
      // torn down and an unsent batch would simply vanish.
      scanEvents.flush();
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
        photos: state.rooms.filter((room) => room?.image).map((room) => ({
          roomName: room.name,
          note: String(room.transcript || "").trim(),
          dataUrl: room.image
        })),
        rooms: state.rooms.map((room) => ({
          name: room.name,
          condition: room.condition,
          fixtures: (room.detections || []).map(inventoryDisplayLabel),
          note: String(room.transcript || "").trim(),
          // The structured reading, not just its display label.
          //
          // `fixtures` is what the journey has always shown: "3 × Chair". It is
          // a rendering, and it was also, until now, the only thing that
          // survived this boundary — the per-item condition, the soiling type,
          // the two confidence scores and the evidence were all discarded when
          // this overlay closed. Everything downstream that needs to explain a
          // price, or improve on one, needs the reading rather than the caption.
          //
          // Geometry is deliberately left behind. The boxes describe one frame
          // of one camera pose and mean nothing outside it, and shipping
          // coordinates that cannot be verified later invites drawing them over
          // the wrong thing.
          objects: (room.detections || []).map((detection) => ({
            inventoryKey: detection.inventoryKey || inventoryKey(detection.label),
            label: detection.label,
            quantity: itemQuantity(detection),
            condition: detection.condition || "",
            soiling: Array.isArray(detection.soiling) ? [...detection.soiling] : [],
            confidenceLabel: Number(detection.confidence) || 0,
            confidenceCondition: Number(detection.conditionConfidence) || 0,
            conditionConfirmed: detection.conditionConfirmed === true,
            evidence: String(detection.note || "").trim(),
            // Hand-marked items reach the reader with no name and are the ones
            // a correction rate should never be measured against.
            origin: detection.conditionConfirmed === true ? "manual" : detection.condition ? "vision" : "detector"
          }))
        })),
        // Which capture path produced this scan. The live viewfinder and the
        // native camera-roll fallback do not see equally well, and averaging
        // their accuracy into one number would hide that.
        deviceClass: state.liveCaptureUsed ? "guided-web" : state.fallbackCaptureUsed ? "camera-fallback" : "unknown",
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
      for (const controller of state.roomReadControllers) controller.abort();
      state.roomReadControllers.clear();
      state.roomReadController = null;
      clearBoxes();
      state.detector = null;
      clearTimeout(toastTimer);
      window.clearTimeout(state.timers.cameraResume);
      window.clearTimeout(state.timers.noteRecovery);
      state.timers.noteRecovery = null;
      // Reconcile rather than merely cancel: if the Landlord cleared a note and then
      // closed, the stored copy has to go too, or it returns on the next open.
      rememberRoomNotes();
      document.removeEventListener("keydown", onKeyDown);
      // A listener left on `document` or `window` keeps this whole closure alive
      // — the video element and the model with it — for the lifetime of the page.
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onViewportResize);
      window.removeEventListener("orientationchange", onViewportResize);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onNetworkChange);
      window.removeEventListener("offline", onNetworkChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.body.style.overflow = previousOverflow;
      overlay.remove();
      // After teardown, deliberately. Releasing the camera and microphone comes
      // before reporting anything, and an abandoned scan is distinguished from a
      // completed one by whether a result is being handed back. Drop-off is the
      // funnel number the audit asked for and nothing the server sees can
      // recover it.
      if (!result) {
        scanEvents.record("scan.session.abandoned", {
          dimensions: { deviceClass: state.liveCaptureUsed ? "guided-web" : state.fallbackCaptureUsed ? "camera-fallback" : "unknown" }
        });
        scanEvents.flush();
      }
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
      resolve(result || null);
    }

    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      if (!el.discard.hidden) hideDiscard();
      else if (!el.itemEditor.hidden) closeItemEditor();
      else requestClose();
    }

    buildWave();
    el.shutter.addEventListener("click", capture);
    // Correcting the list is deliberately one tap away, on the item itself. An
    // automatic scan that cannot be argued with is worse than one that asks.
    el.foundList.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-inventory-remove]");
      if (remove) {
        const key = transcriptKey(state.currentRoom);
        const dismissed = state.dismissed.get(key) || new Set();
        dismissed.add(remove.dataset.inventoryRemove);
        state.dismissed.set(key, dismissed);
        setInventory(state.currentRoom, correctInventoryItem(inventoryFor(), remove.dataset.inventoryRemove, { remove: true }));
        return toast("Removed from this room.");
      }
      const rename = event.target.closest("[data-inventory-rename]");
      if (!rename) return;
      const key = rename.dataset.inventoryRename;
      const current = inventoryFor().find((item) => item.key === key);
      if (!current) return;
      openItemEditor(key, rename);
    });
    el.itemEditorCancel.addEventListener("click", () => closeItemEditor());
    el.itemEditor.addEventListener("click", (event) => {
      if (event.target === el.itemEditor) closeItemEditor();
    });
    el.itemEditorForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const current = inventoryFor().find((item) => item.key === itemEditorKey);
      if (!current) return closeItemEditor({ restoreFocus: false });
      const label = String(el.itemEditorName.value || "").trim();
      if (!label) {
        el.itemEditorName.setCustomValidity("Enter a name for this item.");
        el.itemEditorName.reportValidity();
        return;
      }
      el.itemEditorName.setCustomValidity("");
      const selected = el.itemEditorForm.elements["homle-item-condition"];
      const condition = [...(selected ? selected : [])].find((option) => option.checked)?.value || "";
      const change = { label, confirmed: true };
      if (condition) change.condition = condition;
      setInventory(state.currentRoom, correctInventoryItem(inventoryFor(), itemEditorKey, change));
      closeItemEditor({ restoreFocus: false });
      toast(label !== current.label || (condition && condition !== current.condition) ? `${label} updated.` : `${label} confirmed.`);
    });
    el.viewfinder.addEventListener("click", onViewfinderTap);
    el.detections.addEventListener("click", (event) => {
      const button = event.target.closest("[data-detection-id]");
      if (!button || button.disabled) return;
      event.stopPropagation();
      toggleDetectedItem(button.dataset.detectionId);
    });
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
      scheduleNoteRecovery();
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
    // A mobile keyboard can resize the visual viewport without firing a window
    // resize, which would leave the boxes mapped against the pre-keyboard layout.
    window.visualViewport?.addEventListener("resize", onViewportResize);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onNetworkChange);
    window.addEventListener("offline", onNetworkChange);
    window.addEventListener("beforeunload", onBeforeUnload);

    // Open on the hub so the first thing asked is which room — and warm the
    // camera and detector behind it so entering that room is instant.
    restoreRoomNotes();
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
