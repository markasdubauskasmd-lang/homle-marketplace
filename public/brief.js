import { checklistFromTranscript, normaliseChecklistTask } from "./checklist.js";
import { clearBriefHandoff, readBriefHandoff } from "./brief-handoff.js";
import { detectPriceSensitiveScope } from "./scope-signals.js";
import { briefReadiness, briefRoomOptions, briefScopeConfirmationIsCurrent, briefScopeFingerprint, briefSourceFingerprint, maxBriefPhotos, maxBriefVideos } from "./brief-readiness.js";

const photoInput = document.querySelector("#brief-photos");
const photoPreview = document.querySelector("#photo-preview");
const photoCount = document.querySelector("#photo-count");
const transcript = document.querySelector("#brief-transcript");
const checklist = document.querySelector("#brief-checklist");
const checklistPreview = document.querySelector("#checklist-preview");
const taskCount = document.querySelector("#task-count");
const scopeSignalPreview = document.querySelector("#scope-signal-preview");
const scopeSignalList = document.querySelector("#scope-signal-list");
const scanReadiness = document.querySelector("#scan-readiness");
const scanReadinessTitle = document.querySelector("#scan-readiness-title");
const scanReadinessList = document.querySelector("#scan-readiness-list");
const voiceButton = document.querySelector("#voice-button");
const voiceStatus = document.querySelector("#voice-status");
const form = document.querySelector("#job-brief-form");
const errorBox = document.querySelector("#brief-error");
const successBox = document.querySelector("#brief-success");
const saveButton = document.querySelector("#save-brief");
const photos = [];
let submitting = false;
let submissionComplete = false;
let confirmedScopeFingerprint = "";
let summarisedSourceFingerprint = "";
const roomOptions = briefRoomOptions;

document.querySelectorAll("[data-year]").forEach((element) => { element.textContent = String(new Date().getFullYear()); });
const presetReference = new URLSearchParams(location.search).get("reference");
if (/^REQ-[A-Z0-9]{8}$/i.test(presetReference || "")) {
  form.elements.requestId.value = presetReference.toUpperCase();
  let handoff = null;
  try { handoff = readBriefHandoff(window.sessionStorage, presetReference); } catch {}
  if (handoff) {
    form.elements.email.value = handoff.email;
    document.querySelector("#brief-handoff-note").hidden = false;
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.focus();
}

function checklistTasks() {
  return [...new Map(checklist.value.split(/\r?\n/).map(normaliseChecklistTask).filter(Boolean).map((task) => [task.toLowerCase(), task])).values()].slice(0, 40);
}

function currentScopeFingerprint() {
  return briefScopeFingerprint({ transcript: transcript.value, tasks: checklistTasks(), photos });
}

function currentSourceFingerprint() {
  return briefSourceFingerprint({ transcript: transcript.value, photos });
}

function currentReadiness() {
  const scopeCompleteConfirmed = briefScopeConfirmationIsCurrent({ checked: form.elements.scopeCompleteConfirmed.checked, confirmedFingerprint: confirmedScopeFingerprint, currentFingerprint: currentScopeFingerprint() });
  return briefReadiness({
    requestId: form.elements.requestId.value,
    email: form.elements.email.value,
    transcript: transcript.value,
    tasks: checklistTasks(),
    photos,
    checklistCurrent: summarisedSourceFingerprint === currentSourceFingerprint(),
    scopeCompleteConfirmed,
    consent: form.elements.consent.checked
  });
}

function renderReadiness() {
  if (form.elements.scopeCompleteConfirmed.checked && !briefScopeConfirmationIsCurrent({ checked: true, confirmedFingerprint: confirmedScopeFingerprint, currentFingerprint: currentScopeFingerprint() })) {
    form.elements.scopeCompleteConfirmed.checked = false;
  }
  const readiness = currentReadiness();
  scanReadiness.classList.toggle("scan-ready", readiness.ready);
  scanReadinessTitle.textContent = readiness.ready
    ? "Room scan ready to submit"
    : `${readiness.remaining} required ${readiness.remaining === 1 ? "item" : "items"} remaining`;
  scanReadinessList.replaceChildren();
  readiness.items.forEach((check) => {
    const item = document.createElement("li");
    item.className = check.complete ? "ready" : "pending";
    const marker = document.createElement("span");
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = check.complete ? "✓" : "○";
    item.append(marker, document.createTextNode(check.label));
    scanReadinessList.append(item);
  });
  saveButton.disabled = submitting || submissionComplete;
  saveButton.setAttribute("aria-busy", submitting ? "true" : "false");
  if (submitting) saveButton.textContent = "Preparing private room scan...";
  else if (submissionComplete) saveButton.textContent = "Room scan submitted";
  else if (!readiness.ready) saveButton.textContent = `Check ${readiness.remaining} remaining ${readiness.remaining === 1 ? "item" : "items"}`;
  else saveButton.textContent = "Complete private room scan";
  return readiness;
}

function renderScopeSignals() {
  const signals = detectPriceSensitiveScope({ transcript: transcript.value, checklist: checklistTasks(), photos });
  scopeSignalList.replaceChildren();
  signals.forEach((signal) => {
    const item = document.createElement("li");
    item.textContent = signal.label;
    scopeSignalList.append(item);
  });
  scopeSignalPreview.hidden = !signals.length;
}

function renderChecklist() {
  const tasks = checklistTasks();
  checklistPreview.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement("li");
    empty.textContent = "Generate the checklist to preview the cleaner tasks.";
    checklistPreview.append(empty);
  } else {
    tasks.forEach((task) => {
      const item = document.createElement("li");
      item.textContent = task;
      checklistPreview.append(item);
    });
  }
  taskCount.textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
  renderScopeSignals();
  renderReadiness();
}

function generateChecklist({ scroll = true, showEmptyError = true } = {}) {
  const sourceFingerprint = currentSourceFingerprint();
  const roomNotes = photos
    .filter((photo) => photo.area && photo.note.trim())
    .map((photo) => `In the ${photo.area}, ${photo.note.trim()}`)
    .join(". ");
  const tasks = checklistFromTranscript([roomNotes, transcript.value].filter(Boolean).join(". "));
  checklist.value = tasks.join("\n");
  summarisedSourceFingerprint = tasks.length ? sourceFingerprint : "";
  renderChecklist();
  if (tasks.length && scroll) document.querySelector("#checklist-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  else if (!tasks.length && showEmptyError) showError("Add some spoken or typed cleaning instructions before creating the checklist.");
  return tasks;
}

document.querySelector("#generate-checklist").addEventListener("click", () => generateChecklist());
checklist.addEventListener("input", renderChecklist);
transcript.addEventListener("input", () => { renderScopeSignals(); renderReadiness(); });
form.elements.requestId.addEventListener("input", renderReadiness);
form.elements.email.addEventListener("input", renderReadiness);
form.elements.scopeCompleteConfirmed.addEventListener("change", () => {
  confirmedScopeFingerprint = form.elements.scopeCompleteConfirmed.checked ? currentScopeFingerprint() : "";
  renderReadiness();
});
form.elements.consent.addEventListener("change", renderReadiness);

function renderPhotos() {
  photoPreview.replaceChildren();
  const videoCount = photos.filter((photo) => photo.kind === "video").length;
  photoCount.textContent = `${photos.length}/${maxBriefPhotos} visuals${videoCount ? ` · ${videoCount}/${maxBriefVideos} videos` : ""}`;
  if (!photos.length) {
    const empty = document.createElement("p");
    empty.className = "empty-photo-state";
    empty.textContent = "No photos added yet.";
    photoPreview.append(empty);
    return;
  }
  photos.forEach((photo, index) => {
    const card = document.createElement("article");
    card.className = "photo-preview-card";
    const visual = document.createElement(photo.kind === "video" ? "video" : "img");
    visual.src = photo.previewUrl;
    if (photo.kind === "video") {
      visual.controls = true;
      visual.preload = "metadata";
      visual.muted = true;
      visual.setAttribute("aria-label", `Selected room video ${index + 1}`);
    } else {
      visual.alt = `Selected property photo ${index + 1}`;
    }
    const controls = document.createElement("div");
    const label = document.createElement("label");
    label.append(document.createTextNode("Area"));
    const select = document.createElement("select");
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = "Choose room";
    prompt.disabled = true;
    prompt.selected = !photo.area;
    select.append(prompt);
    roomOptions.forEach((area) => {
      const option = document.createElement("option");
      option.value = area;
      option.textContent = area;
      option.selected = area === photo.area;
      select.append(option);
    });
    select.addEventListener("change", () => { photo.area = select.value; renderScopeSignals(); renderReadiness(); });
    label.append(select);
    const noteLabel = document.createElement("label");
    noteLabel.append(document.createTextNode("What this photo shows"));
    const note = document.createElement("textarea");
    note.rows = 3;
    note.maxLength = 500;
    note.placeholder = "For example: grease around the hob; wipe tiles and clean the extractor cover. Do not include access codes.";
    note.value = photo.note;
    note.addEventListener("input", () => { photo.note = note.value; renderScopeSignals(); renderReadiness(); });
    noteLabel.append(note);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = photo.kind === "video" ? "Remove video" : "Remove photo";
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(photo.previewUrl);
      photos.splice(index, 1);
      renderPhotos();
      renderScopeSignals();
      renderReadiness();
    });
    controls.append(label, noteLabel, remove);
    card.append(visual, controls);
    photoPreview.append(card);
  });
}

function videoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      callback();
    };
    timer = setTimeout(() => finish(() => reject(new Error(`${file.name} took too long to inspect. Choose a shorter video.`))), 10000);
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(() => resolve(video.duration));
    video.onerror = () => finish(() => reject(new Error(`${file.name} could not be read. Use an MP4, MOV or WebM video.`)));
    video.src = objectUrl;
  });
}

photoInput.addEventListener("change", async () => {
  const selected = Array.from(photoInput.files || []);
  const available = maxBriefPhotos - photos.length;
  if (selected.length > available) showError(`You can add ${available} more room ${available === 1 ? "visual" : "visuals"}.`);
  for (const file of selected.slice(0, available)) {
    const isImage = /^image\/(jpeg|png|webp)$/.test(file.type);
    const isVideo = /^video\/(mp4|webm|quicktime)$/.test(file.type);
    if (!isImage && !isVideo) { showError(`${file.name} is not a supported photo or video.`); continue; }
    if (isImage && file.size > 10 * 1024 * 1024) { showError(`${file.name} is over 10 MB. Choose a smaller photo.`); continue; }
    if (isVideo && file.size > 15 * 1024 * 1024) { showError(`${file.name} is over 15 MB. Choose a shorter video.`); continue; }
    if (isVideo && photos.filter((photo) => photo.kind === "video").length >= maxBriefVideos) { showError(`Add no more than ${maxBriefVideos} short room videos.`); continue; }
    let durationSeconds = 0;
    if (isVideo) {
      try { durationSeconds = await videoDuration(file); } catch (error) { showError(error.message); continue; }
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30) { showError(`${file.name} must be 30 seconds or shorter.`); continue; }
    }
    photos.push({ file, kind: isVideo ? "video" : "image", durationSeconds, area: "", note: "", previewUrl: URL.createObjectURL(file) });
  }
  photoInput.value = "";
  renderPhotos();
  renderScopeSignals();
  renderReadiness();
});

function photoDataUrl(photo) {
  if (photo.kind === "video") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const timer = setTimeout(() => { reader.abort(); reject(new Error("A selected video took too long to prepare. Remove it and choose a shorter video.")); }, 20000);
      reader.onload = () => { clearTimeout(timer); resolve(reader.result); };
      reader.onerror = () => { clearTimeout(timer); reject(new Error("A selected video could not be read. Remove it and choose another video.")); };
      reader.onabort = () => clearTimeout(timer);
      reader.readAsDataURL(photo.file);
    });
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(photo.file);
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("A selected photo took too long to prepare. Remove it and try a smaller photo."))), 15000);
    image.onload = () => {
      try {
        const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("This browser could not prepare the selected photo.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.76);
        finish(() => resolve(dataUrl));
      } catch (error) {
        finish(() => reject(error));
      }
    };
    image.onerror = () => finish(() => reject(new Error("A selected photo could not be read. Remove it and choose another photo.")));
    image.src = objectUrl;
  });
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let voiceErrorMessage = "";
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-GB";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => { listening = true; voiceErrorMessage = ""; voiceButton.textContent = "Stop speaking"; voiceStatus.textContent = "Listening… describe the rooms and tasks. Concise bullets appear automatically."; };
  recognition.onend = () => {
    listening = false;
    voiceButton.textContent = "Start speaking";
    if (voiceErrorMessage) { voiceStatus.textContent = voiceErrorMessage; return; }
    const tasks = generateChecklist({ scroll: false, showEmptyError: false });
    voiceStatus.textContent = tasks.length
      ? `Voice capture stopped. ${tasks.length} concise ${tasks.length === 1 ? "bullet" : "bullets"} created below for review.`
      : "Voice capture stopped. Speak again or type the instructions below.";
  };
  recognition.onerror = (event) => {
    voiceErrorMessage = event.error === "not-allowed"
      ? "Microphone access was not allowed. Type the instructions instead."
      : "Voice capture stopped. You can continue by typing.";
    voiceStatus.textContent = voiceErrorMessage;
  };
  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const words = event.results[index][0].transcript.trim();
      if (event.results[index].isFinal) finalText += `${words}. `;
      else interimText += words;
    }
    if (finalText) {
      transcript.value = `${transcript.value.trim()} ${finalText}`.trim();
      const tasks = generateChecklist({ scroll: false, showEmptyError: false });
      voiceStatus.textContent = `${tasks.length} concise ${tasks.length === 1 ? "bullet" : "bullets"} created so far. Keep speaking or stop to review.`;
    }
    if (interimText) voiceStatus.textContent = `Listening: ${interimText}`;
  };
  voiceStatus.textContent = "Voice capture is available. Your browser may provide the speech-to-text service.";
  voiceButton.addEventListener("click", () => { if (listening) recognition.stop(); else recognition.start(); });
} else {
  voiceButton.disabled = true;
  voiceStatus.textContent = "Voice capture is not supported in this browser. Type the instructions below instead.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  successBox.hidden = true;
  const tasks = checklistTasks();
  const readiness = currentReadiness();
  if (!readiness.ready) { showError(`Complete the remaining room-scan checks: ${readiness.items.filter((item) => !item.complete).map((item) => item.label).join("; ")}.`); return; }
  if (!form.checkValidity()) { form.reportValidity(); showError("Complete the request details and required confirmation."); return; }
  if (!photos.length) { showError("Add at least one property photo."); return; }
  if (photos.some((photo) => !photo.area)) { showError("Choose the correct room for every photo."); return; }
  if (photos.some((photo) => photo.note.trim().length < 3)) { showError("Add a short room note explaining what every photo shows."); return; }
  if (!tasks.length) { showError("Create and review at least one cleaner task."); return; }
  const uncoveredAreas = [...new Set(photos.map((photo) => photo.area))].filter((area) => !tasks.some((task) => task.toLowerCase().startsWith(`${area.toLowerCase()}:`)));
  if (uncoveredAreas.length) { showError(`Add at least one checklist task for: ${uncoveredAreas.join(", ")}. Use the room notes, then summarise again.`); return; }
  submitting = true;
  renderReadiness();
  saveButton.textContent = "Preparing private room scan…";
  try {
    const encodedPhotos = [];
    for (let index = 0; index < photos.length; index += 1) {
      saveButton.textContent = `Preparing visual ${index + 1} of ${photos.length}…`;
      const photo = photos[index];
      encodedPhotos.push({ area: photo.area, note: photo.note.trim(), kind: photo.kind || "image", durationSeconds: photo.durationSeconds || 0, dataUrl: await photoDataUrl(photo) });
    }
    saveButton.textContent = "Saving private room scan…";
    const controller = new AbortController();
    const requestTimer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ requestId: form.elements.requestId.value, email: form.elements.email.value, transcript: transcript.value, checklist: tasks, photos: encodedPhotos, scopeCompleteConfirmed: form.elements.scopeCompleteConfirmed.checked, consent: form.elements.consent.checked, sharePhotosWithSelectedCleaner: form.elements.sharePhotosWithSelectedCleaner.checked }),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("The room scan took too long to save. Your entries are still here—check the connection and try again.");
      throw error;
    } finally {
      clearTimeout(requestTimer);
    }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "The job brief could not be saved.");
    successBox.querySelector("[data-brief-reference]").textContent = result.reference;
    const statusLink = successBox.querySelector("[data-status-link]");
    if (statusLink && result.customerStatusToken) {
      statusLink.href = `/request-status#${result.customerStatusToken}`;
      statusLink.hidden = false;
    }
    try {
      sessionStorage.setItem("tidewayBriefComplete", JSON.stringify({ reference: result.reference, customerStatusToken: result.customerStatusToken || "", storedAt: Date.now() }));
    } catch {}
    try { clearBriefHandoff(window.sessionStorage); } catch {}
    submissionComplete = true;
    successBox.hidden = false;
    successBox.focus();
    const completionFragment = [result.customerStatusToken || "", result.reference || ""].join("|");
    location.assign(`/brief-complete#${completionFragment}`);
  } catch (error) {
    showError(error.message);
  } finally {
    submitting = false;
    renderReadiness();
  }
});

renderChecklist();
renderPhotos();
