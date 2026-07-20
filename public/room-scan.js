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

const $ = (selector) => document.querySelector(selector);
const el = {
  stage: $("[data-scan-stage]"),
  viewfinder: $("[data-viewfinder]"),
  camera: $("[data-camera]"),
  canvas: $("[data-capture-canvas]"),
  blocked: $("[data-camera-blocked]"),
  blockedReason: $("[data-camera-blocked-reason]"),
  retry: $("[data-camera-retry]"),
  mesh: $("[data-mesh]"),
  detections: $("[data-detection-layer]"),
  sweep: $("[data-sweep]"),
  flash: $("[data-flash]"),
  roomLabel: $("[data-room-label]"),
  shotCount: $("[data-shot-count]"),
  hint: $("[data-hint]"),
  shots: $("[data-shots]"),
  mic: $("[data-mic]"),
  shutter: $("[data-shutter]"),
  done: $("[data-done]"),
  voice: $("[data-voice-panel]"),
  voiceTime: $("[data-voice-time]"),
  wave: $("[data-wave]"),
  voiceText: $("[data-voice-text]"),
  voiceTags: $("[data-voice-tags]"),
  processing: $("[data-processing]"),
  processingStep: $("[data-processing-step]"),
  processingLog: $("[data-processing-log]"),
  ring: $("[data-ring]"),
  ringPercent: $("[data-ring-percent]"),
  results: $("[data-results]"),
  resultTime: $("[data-result-time]"),
  resultRooms: $("[data-result-rooms]"),
  resultCondition: $("[data-result-condition]"),
  resultNote: $("[data-result-note]"),
  resultList: $("[data-result-list]"),
  scopedFrom: $("[data-scoped-from]"),
  noteCard: $("[data-note-card]"),
  noteEcho: $("[data-note-echo]"),
  accept: $("[data-accept-scan]"),
  rescan: $("[data-rescan]"),
  still: $("[data-still]"),
  consent: $("[data-consent]"),
  consentAllow: $("[data-consent-allow]"),
  consentDecline: $("[data-consent-decline]"),
  toast: $("[data-toast]")
};

const state = {
  stream: null,
  cameraStarting: false,
  shots: [],
  capturing: false,
  voiceOn: false,
  voiceUsed: false,
  transcript: "",
  seconds: 0,
  timers: { wave: null, clock: null },
  recognition: null,
  visionAvailable: true,
  // Explicitly granted per scan. Until it is true no photograph leaves the
  // device — not even to Homle's own server.
  readingAllowed: false,
  consentAsked: false,
  // Bumped on every reset. A reading that returns against an old generation
  // belongs to a scan that no longer exists and is discarded.
  generation: 0
};

const ringCircumference = 326;

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

/* ── Camera ───────────────────────────────────────────
   A real rear camera. If it cannot be opened the scan
   says so plainly and offers the spoken route, rather
   than showing an empty black frame. */
async function startCamera() {
  // Two concurrent starts would leave the first stream live and unreachable,
  // so the camera light could stay on with nothing able to turn it off.
  if (state.cameraStarting || state.stream) return;
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
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    el.camera.srcObject = state.stream;
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

/* ── Capture ──────────────────────────────────────────
   The frame is drawn to a canvas and read once. The
   photo stays in the page unless assisted reading is
   configured, in which case only that frame is sent. */
function currentFrame() {
  const video = el.camera;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const longEdge = 1280;
  const scale = Math.min(1, longEdge / Math.max(width, height));
  el.canvas.width = Math.round(width * scale);
  el.canvas.height = Math.round(height * scale);
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
    if (detection.note) {
      const note = document.createElement("em");
      note.textContent = detection.note;
      tag.appendChild(note);
    }
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
  const label = document.createElement("i");
  label.textContent = shotLabel(roomName);
  const ok = document.createElement("span");
  ok.className = "shot-ok";
  ok.innerHTML = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" stroke-width="4"><path d="M20 6 9 17l-5-5"/></svg>';
  shot.append(image, label, ok);
  el.shots.appendChild(shot);
  el.shots.scrollLeft = el.shots.scrollWidth;
}

// Asked once per scan, before the first photograph is taken, so the decision is
// made before anything could have been sent rather than after.
function askConsent() {
  return new Promise((resolve) => {
    state.consentAsked = true;
    el.consent.hidden = false;
    const settle = (allowed) => {
      el.consent.hidden = true;
      el.consentAllow.removeEventListener("click", allow);
      el.consentDecline.removeEventListener("click", decline);
      state.readingAllowed = allowed;
      if (!allowed) toast("Photos stay on your phone. You'll write the checklist yourself.");
      resolve(allowed);
    };
    const allow = () => settle(true);
    const decline = () => settle(false);
    el.consentAllow.addEventListener("click", allow);
    el.consentDecline.addEventListener("click", decline);
  });
}

async function capture() {
  if (state.capturing || state.shots.length >= maximumShots) return;
  if (!state.consentAsked) await askConsent();
  const frame = currentFrame();
  if (!frame) return toast("The camera is still warming up — try again in a moment.");
  const generation = state.generation;
  state.capturing = true;
  el.shutter.disabled = true;
  // Finishing or resetting mid-read would attach this reading to the wrong
  // scan, so both are held until the room is done.
  el.done.disabled = true;

  el.flash.classList.remove("pop"); void el.flash.offsetWidth; el.flash.classList.add("pop");
  el.sweep.classList.remove("go"); void el.sweep.offsetWidth; el.sweep.classList.add("go");
  el.mesh.classList.add("on");
  el.viewfinder.classList.add("scanning");
  el.hint.innerHTML = "<b>Reading the room…</b> hold still";

  const roomName = nextRoomName(state.shots.length);
  addThumbnail(frame, roomName);

  // Boxes are drawn over the still that was actually read, so they always
  // surround what they describe even if the phone has since moved.
  el.still.src = frame;
  el.still.hidden = false;

  // The detection pass is best effort. If it is unavailable or fails, the photo
  // is still captured and the room is still scoped from what was said about it.
  let reading = { detections: [], tasks: [], condition: "" };
  try {
    reading = await readRoom(frame, roomName);
  } catch {
    state.visionAvailable = false;
  }

  // The scan was reset or left while this room was being read; its result
  // belongs to a scan that no longer exists.
  if (generation !== state.generation) return;

  const detections = usableDetections(reading.detections);
  paintDetections(detections);

  state.shots.push({
    name: roomName,
    image: frame,
    detections,
    tasks: Array.isArray(reading.tasks) ? reading.tasks : [],
    condition: reading.condition || ""
  });

  setTimeout(() => {
    if (generation !== state.generation) return;
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

// Assisted reading of one captured room. Absent or failing, the scan continues
// without detections rather than blocking the walkthrough.
async function readRoom(image, roomName) {
  // No photograph leaves the device until reading was explicitly allowed.
  if (!state.readingAllowed || !state.visionAvailable) return { detections: [], tasks: [], condition: "" };
  const csrf = storedCsrf();
  if (!csrf) { state.visionAvailable = false; return { detections: [], tasks: [], condition: "" }; }
  const response = await fetch("/api/marketplace/landlord/room-reading", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ roomName, image, transcript: state.transcript.slice(-1200) })
  });
  if (response.status === 503) { state.visionAvailable = false; return { detections: [], tasks: [], condition: "" }; }
  if (!response.ok) throw new Error("reading-failed");
  return await response.json();
}

/* ── Voice note ───────────────────────────────────────
   Real speech recognition. The transcript shown is what
   the browser actually heard, never a scripted string. */
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

  const bars = [...el.wave.querySelectorAll("b")];
  state.timers.wave = setInterval(() => {
    for (const [index, bar] of bars.entries()) {
      const base = Math.sin((Date.now() / 170) + index * 0.55);
      bar.style.height = `${Math.min(100, 20 + Math.abs(base) * 55 + Math.random() * 24)}%`;
      bar.style.opacity = String(0.45 + Math.abs(base) * 0.55);
    }
  }, 70);
  state.timers.clock = setInterval(() => {
    state.seconds += 1;
    const minutes = Math.floor(state.seconds / 60);
    el.voiceTime.textContent = `${minutes}:${String(state.seconds % 60).padStart(2, "0")}`;
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
  for (const bar of el.wave.querySelectorAll("b")) bar.style.height = "18%";
  if (silent) { el.voice.classList.remove("on"); return; }
  if (failed) {
    el.hint.textContent = "Listening stopped. Your notes so far are kept.";
  } else if (state.transcript.trim()) {
    el.hint.innerHTML = "<b>Voice note saved</b> — added to your checklist";
    toast("Voice note attached to this scan");
  }
  setTimeout(() => el.voice.classList.remove("on"), 1400);
}

/* ── Reading the scan ─────────────────────────────────
   Each log line appears only when that step has really
   completed, so the ring reflects work rather than a
   fixed animation. */
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
  if (!canFinishScan(state.shots.length)) return;
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
    el.processingStep.textContent = processingSteps[index] || label;
    // Paced so each completed step is legible, not to fake work that is
    // already done — the readings themselves finished during capture.
    await new Promise((resolve) => setTimeout(resolve, 340));
    logLine(label, value);
    setProgress(((index + 1) / steps.length) * 100);
  }

  await new Promise((resolve) => setTimeout(resolve, 700));
  el.processing.classList.remove("on");
  // The camera has no further job once the scan is read. Leaving it live behind
  // the results would keep the recording indicator on indefinitely.
  stopCamera();
  showResults(summary);
}

function showResults(summary) {
  el.resultTime.textContent = summary.durationLabel;
  el.resultRooms.textContent = String(state.shots.length);
  el.resultCondition.textContent = summary.conditionLabel;
  el.scopedFrom.textContent = state.transcript.trim()
    ? `Scoped from ${state.shots.length} ${state.shots.length === 1 ? "photo" : "photos"} + voice note`
    : `Scoped from ${state.shots.length} ${state.shots.length === 1 ? "photo" : "photos"}`;

  el.resultNote.textContent = summary.tasks.length
    ? ""
    : "We could not scope tasks automatically from this scan. Your photos and notes are kept — add the checklist yourself on the next step.";

  el.resultList.innerHTML = "";
  for (const room of state.shots) {
    const item = document.createElement("div");
    item.className = "det-item";
    const icon = document.createElement("div");
    icon.className = "ic";
    icon.textContent = shotLabel(room.name).slice(0, 2);
    const body = document.createElement("div");
    const name = Object.assign(document.createElement("div"), { className: "nm", textContent: room.name });
    const detail = Object.assign(document.createElement("div"), {
      className: "ds",
      textContent: room.detections.length
        ? room.detections.map((detection) => detection.label).join(" · ")
        : "Captured — no fixtures read automatically"
    });
    body.append(name, detail);
    const right = document.createElement("div");
    right.className = "rt";
    right.innerHTML = `<b>${room.tasks.length}</b><span>${room.tasks.length === 1 ? "task" : "tasks"}</span>`;
    item.append(icon, body, right);
    el.resultList.appendChild(item);
  }

  if (state.transcript.trim()) {
    el.noteCard.hidden = false;
    el.noteEcho.textContent = `“${state.transcript.trim()}”`;
  }

  el.results.hidden = false;
  el.results.scrollTop = 0;
}

// The scan hands its result to the existing request draft. Nothing is booked
// here; the Landlord still confirms scope, timing and price.
function acceptScan() {
  const summary = scanSummary(state.shots);
  try {
    sessionStorage.setItem("homle_scan_result", JSON.stringify({
      tasks: summary.tasks,
      transcript: state.transcript.trim(),
      rooms: state.shots.map((room) => ({ name: room.name, condition: room.condition, fixtures: room.detections.map((d) => d.label) })),
      capturedAt: new Date().toISOString()
    }));
  } catch {
    toast("This browser could not carry the scan forward. Your notes are still on screen.");
    return;
  }
  stopCamera();
  location.assign("/landlord/dashboard?start=booking&from=scan");
}

function resetScan() {
  // Any reading still in flight belongs to the scan being discarded.
  state.generation += 1;
  state.shots = [];
  state.transcript = "";
  state.voiceUsed = false;
  state.visionAvailable = true;
  state.capturing = false;
  // The last full frame would otherwise stay in canvas memory after the scan
  // it belonged to was thrown away.
  el.canvas.width = 0;
  el.canvas.height = 0;
  el.still.hidden = true;
  el.still.removeAttribute("src");
  el.detections.innerHTML = "";
  el.noteCard.hidden = true;
  el.noteEcho.textContent = "";
  el.shots.innerHTML = "";
  el.shotCount.textContent = "0";
  el.roomLabel.textContent = guidedRooms[0];
  el.hint.textContent = scanHint(0);
  el.done.disabled = true;
  el.done.classList.remove("ready");
  el.voiceText.textContent = "";
  el.voiceText.appendChild(Object.assign(document.createElement("span"), { className: "cur" }));
  el.voiceTags.innerHTML = "";
  el.results.hidden = true;
  el.shutter.disabled = false;
  // finishScan released the camera; a fresh scan needs it back.
  startCamera();
}

buildWave();
el.shutter.addEventListener("click", capture);
el.mic.addEventListener("click", () => (state.voiceOn ? stopVoice() : startVoice()));
el.done.addEventListener("click", finishScan);
el.retry.addEventListener("click", startCamera);
el.accept.addEventListener("click", acceptScan);
el.rescan.addEventListener("click", resetScan);
window.addEventListener("pageshow", (event) => { if (event.persisted && el.results.hidden) startCamera(); });
window.addEventListener("pagehide", () => { stopVoice({ silent: true }); stopCamera(); });

el.roomLabel.textContent = guidedRooms[0];
startCamera();
