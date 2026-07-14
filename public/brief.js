import { checklistFromTranscript, normaliseChecklistTask } from "./checklist.js";
import { clearBriefHandoff, readBriefHandoff } from "./brief-handoff.js";

const photoInput = document.querySelector("#brief-photos");
const photoPreview = document.querySelector("#photo-preview");
const photoCount = document.querySelector("#photo-count");
const transcript = document.querySelector("#brief-transcript");
const checklist = document.querySelector("#brief-checklist");
const checklistPreview = document.querySelector("#checklist-preview");
const taskCount = document.querySelector("#task-count");
const voiceButton = document.querySelector("#voice-button");
const voiceStatus = document.querySelector("#voice-status");
const form = document.querySelector("#job-brief-form");
const errorBox = document.querySelector("#brief-error");
const successBox = document.querySelector("#brief-success");
const saveButton = document.querySelector("#save-brief");
const photos = [];
const roomOptions = ["Kitchen", "Bathroom", "Bedroom", "Living room", "Hallway", "Stairs", "Office", "Communal area", "Other area"];

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
}

function generateChecklist({ scroll = true, showEmptyError = true } = {}) {
  const roomNotes = photos
    .filter((photo) => photo.area && photo.note.trim())
    .map((photo) => `In the ${photo.area}, ${photo.note.trim()}`)
    .join(". ");
  const tasks = checklistFromTranscript([roomNotes, transcript.value].filter(Boolean).join(". "));
  checklist.value = tasks.join("\n");
  renderChecklist();
  if (tasks.length && scroll) document.querySelector("#checklist-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  else if (!tasks.length && showEmptyError) showError("Add some spoken or typed cleaning instructions before creating the checklist.");
  return tasks;
}

document.querySelector("#generate-checklist").addEventListener("click", () => generateChecklist());
checklist.addEventListener("input", renderChecklist);

function renderPhotos() {
  photoPreview.replaceChildren();
  photoCount.textContent = `${photos.length}/6`;
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
    const image = document.createElement("img");
    image.src = photo.previewUrl;
    image.alt = `Selected property photo ${index + 1}`;
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
    select.addEventListener("change", () => { photo.area = select.value; });
    label.append(select);
    const noteLabel = document.createElement("label");
    noteLabel.append(document.createTextNode("What this photo shows"));
    const note = document.createElement("textarea");
    note.rows = 3;
    note.maxLength = 500;
    note.placeholder = "For example: grease around the hob; wipe tiles and clean the extractor cover. Do not include access codes.";
    note.value = photo.note;
    note.addEventListener("input", () => { photo.note = note.value; });
    noteLabel.append(note);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "Remove photo";
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(photo.previewUrl);
      photos.splice(index, 1);
      renderPhotos();
    });
    controls.append(label, noteLabel, remove);
    card.append(image, controls);
    photoPreview.append(card);
  });
}

photoInput.addEventListener("change", () => {
  const selected = Array.from(photoInput.files || []);
  const available = 6 - photos.length;
  if (selected.length > available) showError(`You can add ${available} more ${available === 1 ? "photo" : "photos"}.`);
  selected.slice(0, available).forEach((file) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return;
    if (file.size > 10 * 1024 * 1024) { showError(`${file.name} is over 10 MB. Choose a smaller photo.`); return; }
    photos.push({ file, area: "", note: "", previewUrl: URL.createObjectURL(file) });
  });
  photoInput.value = "";
  renderPhotos();
});

function photoDataUrl(photo) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      resolve(canvas.toDataURL("image/jpeg", 0.76));
    };
    image.onerror = () => reject(new Error("A selected photo could not be read."));
    image.src = URL.createObjectURL(photo.file);
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
  if (!form.checkValidity()) { form.reportValidity(); showError("Complete the request details and required confirmation."); return; }
  if (!photos.length) { showError("Add at least one property photo."); return; }
  if (photos.some((photo) => !photo.area)) { showError("Choose the correct room for every photo."); return; }
  if (photos.some((photo) => photo.note.trim().length < 3)) { showError("Add a short room note explaining what every photo shows."); return; }
  if (!tasks.length) { showError("Create and review at least one cleaner task."); return; }
  const uncoveredAreas = [...new Set(photos.map((photo) => photo.area))].filter((area) => !tasks.some((task) => task.toLowerCase().startsWith(`${area.toLowerCase()}:`)));
  if (uncoveredAreas.length) { showError(`Add at least one checklist task for: ${uncoveredAreas.join(", ")}. Use the room notes, then summarise again.`); return; }
  saveButton.disabled = true;
  saveButton.textContent = "Preparing private room scan…";
  try {
    const encodedPhotos = [];
    for (const photo of photos) encodedPhotos.push({ area: photo.area, note: photo.note.trim(), dataUrl: await photoDataUrl(photo) });
    const response = await fetch(form.action, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ requestId: form.elements.requestId.value, email: form.elements.email.value, transcript: transcript.value, checklist: tasks, photos: encodedPhotos, consent: form.elements.consent.checked })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "The job brief could not be saved.");
    successBox.querySelector("[data-brief-reference]").textContent = result.reference;
    const statusLink = successBox.querySelector("[data-status-link]");
    if (statusLink && result.customerStatusToken) {
      statusLink.href = `/request-status#${result.customerStatusToken}`;
      statusLink.hidden = false;
    }
    try { clearBriefHandoff(window.sessionStorage); } catch {}
    successBox.hidden = false;
    successBox.focus();
  } catch (error) {
    showError(error.message);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Complete private room scan";
  }
});

renderChecklist();
renderPhotos();
