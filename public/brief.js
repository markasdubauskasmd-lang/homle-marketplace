import { checklistFromTranscript, normaliseChecklistTask } from "./checklist.js?v=20260715-2";
import { clearBriefHandoff, readBriefHandoff } from "./brief-handoff.js";
import { detectPriceSensitiveScope } from "./scope-signals.js";
import { briefReadiness, briefRoomOptions, briefScopeConfirmationIsCurrent, briefScopeFingerprint, briefSourceFingerprint, maxBriefPhotos, maxBriefVideos, normaliseBriefRoom, roomSpeechMarker } from "./brief-readiness.js?v=20260715-2";
import { newSubmissionKey } from "./submission-key.js";
import { cleanerHandoffPreview } from "./cleaner-handoff-preview.js";
import { checklistChangeReview } from "./checklist-change-review.js";
import { clearBriefDraft, readBriefDraft, saveBriefDraft } from "./brief-draft.js";

const cameraInput = document.querySelector("#brief-camera");
const photoInput = document.querySelector("#brief-photos");
const photoPreview = document.querySelector("#photo-preview");
const photoCount = document.querySelector("#photo-count");
const captureRoomSelect = document.querySelector("#capture-room");
const captureRoomStatus = document.querySelector("#capture-room-status");
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
const speechRoomContext = document.querySelector("#speech-room-context");
const form = document.querySelector("#job-brief-form");
const errorBox = document.querySelector("#brief-error");
const successBox = document.querySelector("#brief-success");
const saveButton = document.querySelector("#save-brief");
const checklistChangePanel = document.querySelector("#checklist-change-review");
const checklistChangeSummary = checklistChangePanel.querySelector("[data-change-summary]");
const checklistAdded = checklistChangePanel.querySelector("[data-change-added]");
const checklistRemoved = checklistChangePanel.querySelector("[data-change-removed]");
const applyChecklistChange = checklistChangePanel.querySelector("[data-apply-summary]");
const keepChecklist = checklistChangePanel.querySelector("[data-keep-checklist]");
const draftStatus = document.querySelector("#brief-draft-status");
const draftTitle = draftStatus.querySelector("[data-draft-title]");
const draftCopy = draftStatus.querySelector("[data-draft-copy]");
const discardDraft = draftStatus.querySelector("[data-discard-draft]");
const photos = [];
let submitting = false;
let submissionComplete = false;
let pendingSubmission = null;
let confirmedScopeFingerprint = "";
let summarisedSourceFingerprint = "";
let pendingChecklistChange = null;
let draftSaveTimer = null;
let restoredDraft = false;
let browserOnline = navigator.onLine !== false;
let activeDraftReference = "";
const roomOptions = briefRoomOptions;
const privateRequestToken = /^[A-Za-z0-9_-]{32}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : "";
if (privateRequestToken) history.replaceState(null, "", `${location.pathname}${location.search}`);

roomOptions.forEach((area) => {
  const option = document.createElement("option");
  option.value = area;
  option.textContent = area;
  captureRoomSelect.append(option);
});

function currentCaptureRoom() {
  return normaliseBriefRoom(captureRoomSelect.value);
}

function renderCaptureRoomControl() {
  const room = currentCaptureRoom();
  const disabled = !room;
  cameraInput.disabled = disabled;
  photoInput.disabled = disabled;
  cameraInput.closest(".photo-picker").classList.toggle("is-disabled", disabled);
  photoInput.closest(".photo-picker").classList.toggle("is-disabled", disabled);
  captureRoomStatus.textContent = room
    ? `New visuals will be labelled ${room}. You can change the room on any card before submitting.`
    : "Choose a room to unlock the camera and existing-photo buttons.";
  speechRoomContext.textContent = room
    ? `Voice notes will be grouped under ${room}. Change the current room as you walk.`
    : "Choose a current room before speaking, or name the room in your instructions.";
}

function appendCurrentRoomMarker() {
  const marker = roomSpeechMarker(currentCaptureRoom());
  if (!marker) return false;
  transcript.value = [transcript.value.trim(), marker].filter(Boolean).join(" ");
  transcript.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

captureRoomSelect.addEventListener("change", () => {
  renderCaptureRoomControl();
  if (listening) appendCurrentRoomMarker();
});
renderCaptureRoomControl();

document.querySelectorAll("[data-year]").forEach((element) => { element.textContent = String(new Date().getFullYear()); });
const presetReference = new URLSearchParams(location.search).get("reference");
if (/^REQ-[A-Z0-9]{8}$/i.test(presetReference || "")) {
  form.elements.requestId.value = presetReference.toUpperCase();
  if (privateRequestToken) {
    form.elements.requestId.readOnly = true;
    form.elements.email.required = false;
    document.querySelector("[data-request-email-label]").hidden = true;
    const handoffNote = document.querySelector("#brief-handoff-note");
    handoffNote.querySelector("strong").textContent = "Private request tracker connected.";
    handoffNote.querySelector("span").textContent = "Your request was verified by this private link; your email is not repeated on this page.";
    handoffNote.hidden = false;
  }
  let handoff = null;
  try { if (!privateRequestToken) handoff = readBriefHandoff(window.sessionStorage, presetReference); } catch {}
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

function currentRequestReference() {
  const value = String(form.elements.requestId.value || "").trim().toUpperCase();
  return /^REQ-[A-Z0-9]{8}$/.test(value) ? value : "";
}

function hasDraftText() {
  return Boolean(transcript.value.trim() || checklistTasks().length);
}

function draftReferenceMismatch() {
  const reference = currentRequestReference();
  return Boolean(activeDraftReference && reference && activeDraftReference !== reference && hasDraftText());
}

function renderDraftStatus() {
  draftStatus.classList.toggle("is-offline", !browserOnline);
  discardDraft.hidden = !hasDraftText();
  if (!browserOnline) {
    draftTitle.textContent = "You are offline — your text is protected";
    draftCopy.textContent = "Reconnect before submitting. Notes and checklist remain in this tab; photos and videos are never stored in the recovery draft.";
  } else if (draftReferenceMismatch()) {
    draftTitle.textContent = "Check the request reference";
    draftCopy.textContent = `This text remains linked to ${activeDraftReference} and will not be copied to a different cleaning request.`;
  } else if (restoredDraft) {
    draftTitle.textContent = "Your notes and checklist were recovered";
    draftCopy.textContent = "Add the room photos or videos again, then summarise once more. Visuals are never stored in the browser recovery draft.";
  } else {
    draftTitle.textContent = "Private reload protection is on";
    draftCopy.textContent = "Your spoken or typed notes and checklist stay in this tab for up to 30 minutes. Photos and videos are never stored in the recovery draft.";
  }
}

function saveCurrentDraft() {
  clearTimeout(draftSaveTimer);
  const reference = currentRequestReference();
  if (!reference) { renderDraftStatus(); return; }
  if (!activeDraftReference) activeDraftReference = reference;
  if (activeDraftReference !== reference) { renderDraftStatus(); return; }
  try { saveBriefDraft(window.sessionStorage, { reference, transcript: transcript.value, tasks: checklistTasks() }); } catch {}
  renderDraftStatus();
}

function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveCurrentDraft, 250);
  renderDraftStatus();
}

function restoreCurrentDraft() {
  const reference = currentRequestReference();
  if (!reference || (activeDraftReference && activeDraftReference !== reference) || hasDraftText()) return false;
  activeDraftReference = reference;
  let draft = null;
  try { draft = readBriefDraft(window.sessionStorage, reference); } catch {}
  if (!draft) return false;
  transcript.value = draft.transcript;
  checklist.value = draft.tasks.join("\n");
  summarisedSourceFingerprint = "";
  confirmedScopeFingerprint = "";
  form.elements.scopeCompleteConfirmed.checked = false;
  restoredDraft = true;
  return true;
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
    requestAuthorised: Boolean(privateRequestToken),
    transcript: transcript.value,
    tasks: checklistTasks(),
    photos,
    checklistCurrent: summarisedSourceFingerprint === currentSourceFingerprint(),
    scopeCompleteConfirmed,
    consent: form.elements.consent.checked
  });
}

function clearChecklistChangeReview() {
  pendingChecklistChange = null;
  checklistChangePanel.hidden = true;
  checklistAdded.replaceChildren();
  checklistRemoved.replaceChildren();
}

function appendChangeItems(container, title, tasks, emptyCopy) {
  const section = document.createElement("section");
  const heading = document.createElement("strong");
  heading.textContent = title;
  section.append(heading);
  if (tasks.length) {
    const list = document.createElement("ul");
    tasks.forEach((task) => {
      const item = document.createElement("li");
      item.textContent = task;
      list.append(item);
    });
    section.append(list);
  } else {
    const empty = document.createElement("span");
    empty.textContent = emptyCopy;
    section.append(empty);
  }
  container.append(section);
}

function showChecklistChangeReview(review, sourceFingerprint, { scroll = true } = {}) {
  pendingChecklistChange = { tasks: review.next, sourceFingerprint };
  checklistAdded.replaceChildren();
  checklistRemoved.replaceChildren();
  checklistChangeSummary.textContent = review.orderChanged
    ? "The same tasks were reordered. Your current checklist has not been changed."
    : `${review.added.length} ${review.added.length === 1 ? "task" : "tasks"} added · ${review.removed.length} ${review.removed.length === 1 ? "task" : "tasks"} removed. Your current checklist has not been changed.`;
  appendChangeItems(checklistAdded, "Would be added", review.added, "No new tasks");
  appendChangeItems(checklistRemoved, "Would be removed", review.removed, "No tasks removed");
  checklistChangePanel.hidden = false;
  if (scroll) checklistChangePanel.scrollIntoView({ behavior: "smooth", block: "center" });
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
  const referenceMismatch = draftReferenceMismatch();
  saveButton.disabled = submitting || submissionComplete || !browserOnline || referenceMismatch;
  saveButton.setAttribute("aria-busy", submitting ? "true" : "false");
  if (submitting) saveButton.textContent = "Preparing private room scan...";
  else if (submissionComplete) saveButton.textContent = "Room scan submitted";
  else if (!browserOnline) saveButton.textContent = "Offline — reconnect to submit";
  else if (referenceMismatch) saveButton.textContent = "Check request reference";
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
  const handoff = cleanerHandoffPreview({ tasks, photographedAreas: photos.map((photo) => photo.area), roomOptions });
  checklistPreview.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement("p");
    empty.className = "cleaner-handoff-empty";
    empty.textContent = "Generate the checklist to preview the cleaner tasks.";
    checklistPreview.append(empty);
  } else {
    handoff.groups.forEach((group) => {
      const card = document.createElement("article");
      card.className = `cleaner-handoff-room${group.work.length ? "" : " cleaner-handoff-room-missing"}`;
      const heading = document.createElement("div");
      heading.className = "cleaner-handoff-room-heading";
      const title = document.createElement("h3");
      title.textContent = group.room;
      const count = document.createElement("span");
      count.textContent = group.work.length ? `${group.work.length} cleaning ${group.work.length === 1 ? "task" : "tasks"}` : "No cleaning task yet";
      heading.append(title, count);
      card.append(heading);
      if (group.work.length) {
        const workList = document.createElement("ul");
        workList.className = "cleaner-handoff-work";
        group.work.forEach((instruction) => {
          const item = document.createElement("li");
          item.textContent = instruction;
          workList.append(item);
        });
        card.append(workList);
      }
      if (group.exclusions.length) {
        const boundary = document.createElement("div");
        boundary.className = "cleaner-handoff-boundaries";
        const boundaryTitle = document.createElement("strong");
        boundaryTitle.textContent = "Leave alone";
        const boundaryList = document.createElement("ul");
        group.exclusions.forEach((instruction) => {
          const item = document.createElement("li");
          item.textContent = instruction;
          boundaryList.append(item);
        });
        boundary.append(boundaryTitle, boundaryList);
        card.append(boundary);
      }
      checklistPreview.append(card);
    });
  }
  taskCount.textContent = `${handoff.workCount} cleaning ${handoff.workCount === 1 ? "task" : "tasks"}${handoff.exclusionCount ? ` · ${handoff.exclusionCount} ${handoff.exclusionCount === 1 ? "boundary" : "boundaries"}` : ""}`;
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
  const currentTasks = checklistTasks();
  if (!tasks.length) {
    clearChecklistChangeReview();
    summarisedSourceFingerprint = "";
    renderChecklist();
    if (showEmptyError) showError("No cleaning tasks could be summarised. Your current checklist was kept; add clearer room instructions and try again.");
    return tasks;
  }
  const review = checklistChangeReview(currentTasks, tasks);
  if (currentTasks.length && review.changed) {
    summarisedSourceFingerprint = "";
    showChecklistChangeReview(review, sourceFingerprint, { scroll });
    renderChecklist();
    return tasks;
  }
  clearChecklistChangeReview();
  if (!currentTasks.length) checklist.value = tasks.join("\n");
  summarisedSourceFingerprint = sourceFingerprint;
  renderChecklist();
  if (scroll) document.querySelector("#checklist-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  scheduleDraftSave();
  return tasks;
}

document.querySelector("#generate-checklist").addEventListener("click", () => generateChecklist());
checklist.addEventListener("input", () => { clearChecklistChangeReview(); renderChecklist(); scheduleDraftSave(); });
transcript.addEventListener("input", () => { clearChecklistChangeReview(); renderScopeSignals(); renderReadiness(); scheduleDraftSave(); });
applyChecklistChange.addEventListener("click", () => {
  if (!pendingChecklistChange || pendingChecklistChange.sourceFingerprint !== currentSourceFingerprint()) {
    clearChecklistChangeReview();
    showError("The speech or room notes changed after this comparison. Summarise again before replacing the checklist.");
    return;
  }
  checklist.value = pendingChecklistChange.tasks.join("\n");
  summarisedSourceFingerprint = pendingChecklistChange.sourceFingerprint;
  clearChecklistChangeReview();
  renderChecklist();
  scheduleDraftSave();
  document.querySelector("#checklist-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});
keepChecklist.addEventListener("click", () => {
  clearChecklistChangeReview();
  summarisedSourceFingerprint = "";
  renderChecklist();
  checklist.focus();
});
form.elements.requestId.addEventListener("input", () => {
  if (restoreCurrentDraft()) renderChecklist();
  renderReadiness();
  scheduleDraftSave();
});
form.elements.email.addEventListener("input", renderReadiness);
form.elements.scopeCompleteConfirmed.addEventListener("change", () => {
  confirmedScopeFingerprint = form.elements.scopeCompleteConfirmed.checked ? currentScopeFingerprint() : "";
  renderReadiness();
});
form.elements.consent.addEventListener("change", renderReadiness);
discardDraft.addEventListener("click", () => {
  try { clearBriefDraft(window.sessionStorage, activeDraftReference || currentRequestReference()); } catch {}
  transcript.value = "";
  checklist.value = "";
  summarisedSourceFingerprint = "";
  confirmedScopeFingerprint = "";
  form.elements.scopeCompleteConfirmed.checked = false;
  restoredDraft = false;
  activeDraftReference = currentRequestReference();
  clearChecklistChangeReview();
  renderChecklist();
  renderDraftStatus();
  transcript.focus();
});

window.addEventListener("online", () => { browserOnline = true; renderDraftStatus(); renderReadiness(); });
window.addEventListener("offline", () => { browserOnline = false; saveCurrentDraft(); renderDraftStatus(); renderReadiness(); });
window.addEventListener("beforeunload", (event) => {
  if (!submissionComplete && photos.length) {
    event.preventDefault();
    event.returnValue = "";
  }
});

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
    select.addEventListener("change", () => { photo.area = select.value; clearChecklistChangeReview(); renderChecklist(); });
    label.append(select);
    const noteLabel = document.createElement("label");
    noteLabel.append(document.createTextNode("What this photo shows"));
    const note = document.createElement("textarea");
    note.rows = 3;
    note.maxLength = 500;
    note.placeholder = "For example: grease around the hob; wipe tiles and clean the extractor cover. Do not include access codes.";
    note.value = photo.note;
    note.addEventListener("input", () => { photo.note = note.value; clearChecklistChangeReview(); renderChecklist(); });
    noteLabel.append(note);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = photo.kind === "video" ? "Remove video" : "Remove photo";
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(photo.previewUrl);
      photos.splice(index, 1);
      renderPhotos();
      clearChecklistChangeReview();
      renderChecklist();
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

async function addSelectedVisuals(selected) {
  const captureRoom = currentCaptureRoom();
  if (!captureRoom) {
    showError("Choose the exact room before adding its photos or videos.");
    captureRoomSelect.focus();
    return;
  }
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
    photos.push({ file, kind: isVideo ? "video" : "image", durationSeconds, area: captureRoom, note: "", previewUrl: URL.createObjectURL(file) });
  }
  renderPhotos();
  clearChecklistChangeReview();
  renderChecklist();
}

cameraInput.addEventListener("change", async () => {
  const selected = Array.from(cameraInput.files || []);
  cameraInput.value = "";
  await addSelectedVisuals(selected);
});

photoInput.addEventListener("change", async () => {
  const selected = Array.from(photoInput.files || []);
  photoInput.value = "";
  await addSelectedVisuals(selected);
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
  recognition.onstart = () => { listening = true; voiceErrorMessage = ""; voiceButton.textContent = "Stop speaking"; voiceStatus.textContent = currentCaptureRoom() ? `Listening in ${currentCaptureRoom()}… describe the work or what you see.` : "Listening… name each room, then describe the work or what you see."; };
  recognition.onend = () => {
    listening = false;
    voiceButton.textContent = "Start speaking";
    if (voiceErrorMessage) { voiceStatus.textContent = voiceErrorMessage; return; }
    const tasks = generateChecklist({ scroll: false, showEmptyError: false });
    voiceStatus.textContent = pendingChecklistChange
      ? "Voice capture stopped. A new summary is ready to compare; your current checklist was not replaced."
      : tasks.length
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
      voiceStatus.textContent = pendingChecklistChange
        ? "New speech changed the proposed summary. Keep speaking, then review the comparison before applying it."
        : `${tasks.length} concise ${tasks.length === 1 ? "bullet" : "bullets"} created so far. Keep speaking or stop to review.`;
    }
    if (interimText) voiceStatus.textContent = `Listening: ${interimText}`;
  };
  voiceStatus.textContent = "Voice capture is available. Your browser may provide the speech-to-text service.";
  voiceButton.addEventListener("click", () => {
    if (listening) recognition.stop();
    else {
      appendCurrentRoomMarker();
      recognition.start();
    }
  });
} else {
  voiceButton.disabled = true;
  voiceStatus.textContent = "Voice capture is not supported in this browser. Type the instructions below instead.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  successBox.hidden = true;
  const tasks = checklistTasks();
  if (!browserOnline) { showError("You are offline. Your text is protected in this tab; reconnect and try again."); return; }
  if (draftReferenceMismatch()) { showError(`These notes belong to ${activeDraftReference}. Restore that request reference or discard the saved text before continuing.`); return; }
  const readiness = currentReadiness();
  if (!readiness.ready) { showError(`Complete the remaining room-scan checks: ${readiness.items.filter((item) => !item.complete).map((item) => item.label).join("; ")}.`); return; }
  if (!form.checkValidity()) { form.reportValidity(); showError("Complete the request details and required confirmation."); return; }
  if (!photos.length) { showError("Add at least one property photo."); return; }
  if (photos.some((photo) => !photo.area)) { showError("Choose the correct room for every photo."); return; }
  if (photos.some((photo) => photo.note.trim().length < 3)) { showError("Add a short room note explaining what every photo shows."); return; }
  if (!tasks.length) { showError("Create and review at least one cleaner task."); return; }
  const handoff = cleanerHandoffPreview({ tasks, photographedAreas: photos.map((photo) => photo.area), roomOptions });
  if (!handoff.workCount) { showError("Add at least one cleaning task; leave-alone boundaries alone cannot be quoted."); return; }
  if (handoff.missingWorkAreas.length) { showError(`Add at least one cleaning task for: ${handoff.missingWorkAreas.join(", ")}. Use the room notes, then summarise again.`); return; }
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
    const submissionBody = JSON.stringify({ requestId: form.elements.requestId.value, email: form.elements.email.value, transcript: transcript.value, checklist: tasks, photos: encodedPhotos, scopeCompleteConfirmed: form.elements.scopeCompleteConfirmed.checked, consent: form.elements.consent.checked, sharePhotosWithSelectedCleaner: form.elements.sharePhotosWithSelectedCleaner.checked });
    if (!pendingSubmission || pendingSubmission.body !== submissionBody) pendingSubmission = { body: submissionBody, key: newSubmissionKey() };
    try {
      response = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "Idempotency-Key": pendingSubmission.key, ...(privateRequestToken ? { "X-Request-Token": privateRequestToken } : {}) },
        body: submissionBody,
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
    if (statusLink && privateRequestToken) {
      statusLink.href = `/request-status#${privateRequestToken}`;
      statusLink.hidden = false;
    }
    try {
      sessionStorage.setItem("tidewayBriefComplete", JSON.stringify({ reference: result.reference, customerStatusToken: privateRequestToken, storedAt: Date.now() }));
    } catch {}
    try { clearBriefHandoff(window.sessionStorage); } catch {}
    try { clearBriefDraft(window.sessionStorage, currentRequestReference()); } catch {}
    pendingSubmission = null;
    submissionComplete = true;
    successBox.hidden = false;
    successBox.focus();
    const completionFragment = [privateRequestToken, result.reference || ""].join("|");
    location.assign(`/brief-complete#${completionFragment}`);
  } catch (error) {
    showError(error.message);
  } finally {
    submitting = false;
    renderReadiness();
  }
});

restoreCurrentDraft();
renderChecklist();
renderPhotos();
renderDraftStatus();
