import {
  guidedRooms,
  maximumShots,
  processingSteps,
  nextRoomName,
  scanHint,
  canFinishScan,
  shotLabel,
  usableDetections,
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
        <button class="button" type="button" data-camera-retry>Try camera again</button>
        <button class="button ghost" type="button" data-close>Describe by voice instead</button>
      </div>
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
      mesh: $("[data-mesh]"), detections: $("[data-detection-layer]"), sweep: $("[data-sweep]"), flash: $("[data-flash]"),
      still: $("[data-still]"), roomLabel: $("[data-room-label]"), shotCount: $("[data-shot-count]"), hint: $("[data-hint]"),
      shots: $("[data-shots]"), mic: $("[data-mic]"), shutter: $("[data-shutter]"), done: $("[data-done]"),
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
      generation: 0, closed: false
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
      } catch (error) {
        const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
        blockCamera(denied
          ? "Camera access was declined. Allow it in your browser settings, or describe each room by voice instead."
          : "No camera could be opened on this device. You can still describe each room by voice.");
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
    function currentFrame() {
      const video = el.camera;
      if (!video.videoWidth || !video.videoHeight) return null;
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      el.canvas.width = Math.round(video.videoWidth * scale);
      el.canvas.height = Math.round(video.videoHeight * scale);
      el.canvas.getContext("2d").drawImage(video, 0, 0, el.canvas.width, el.canvas.height);
      return el.canvas.toDataURL("image/jpeg", 0.82);
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

    async function capture() {
      if (state.capturing || state.shots.length >= maximumShots || state.closed) return;
      if (!state.consentAsked) await askConsent();
      if (state.closed) return;
      const frame = currentFrame();
      if (!frame) return toast("The camera is still warming up — try again in a moment.");
      const generation = state.generation;
      state.capturing = true;
      el.shutter.disabled = true;
      el.done.disabled = true;

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
      try { reading = await readRoom(frame, roomName); } catch { state.visionAvailable = false; }
      if (generation !== state.generation || state.closed) return;

      const detections = usableDetections(reading.detections);
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
        el.detections.innerHTML = "";
        el.still.hidden = true;
        el.still.removeAttribute("src");
        state.capturing = false;
        el.shutter.disabled = !el.blocked.hidden || state.shots.length >= maximumShots;
        el.shotCount.textContent = String(state.shots.length);
        el.roomLabel.textContent = nextRoomName(state.shots.length);
        el.hint.innerHTML = scanHint(state.shots.length, { voiceUsed: state.voiceUsed });
        if (canFinishScan(state.shots.length)) {
          el.done.disabled = false;
          el.done.classList.add("ready");
        }
      }, detections.length ? 1800 : 900);
    }

    async function readRoom(image, roomName) {
      if (!state.readingAllowed || !state.visionAvailable) return { detections: [], tasks: [], condition: "" };
      const csrf = storedCsrf();
      if (!csrf) { state.visionAvailable = false; return { detections: [], tasks: [], condition: "" }; }
      const response = await fetch("/api/marketplace/landlord/room-reading", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ roomName, image, transcript: state.transcript.slice(-1200) })
      });
      if (response.status === 503) { state.visionAvailable = false; return { detections: [], tasks: [], condition: "" }; }
      if (!response.ok) throw new Error("reading-failed");
      return await response.json();
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
      clearTimeout(toastTimer);
      document.removeEventListener("keydown", onKeyDown);
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
    el.mic.addEventListener("click", () => (state.voiceOn ? stopVoice() : startVoice()));
    el.done.addEventListener("click", finishScan);
    el.retry.addEventListener("click", startCamera);
    for (const button of $$("[data-close]")) button.addEventListener("click", () => close(null));
    document.addEventListener("keydown", onKeyDown);

    el.roomLabel.textContent = guidedRooms[0];
    startCamera();
    el.shutter.focus({ preventScroll: true });
  });
}
