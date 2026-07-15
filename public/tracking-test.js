const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const role = new URLSearchParams(window.location.search).get("role") === "landlord" ? "landlord" : "cleaner";
const fragmentToken = tokenPattern.test(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "";
if (window.location.hash) history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

const setup = document.querySelector("[data-test-setup]");
const sessionPanel = document.querySelector("[data-test-session]");
const createButton = document.querySelector("[data-create-test]");
const setupMessage = document.querySelector("[data-setup-message]");
const controllerControls = document.querySelector("[data-controller-controls]");
const viewerControls = document.querySelector("[data-viewer-controls]");
const viewerLinkPanel = document.querySelector("[data-viewer-link-panel]");
const viewerLinkInput = document.querySelector("[data-viewer-link]");
const startButton = document.querySelector("[data-start-location]");
const stopButton = document.querySelector("[data-stop-location]");
const arriveButton = document.querySelector("[data-arrive]");
const deleteButton = document.querySelector("[data-delete-test]");
const consent = document.querySelector("[data-location-consent]");
const controllerMessage = document.querySelector("[data-controller-message]");
const jobController = document.querySelector("[data-job-controller]");
const startCleaningButton = document.querySelector("[data-start-cleaning]");
const finishCleaningButton = document.querySelector("[data-finish-cleaning]");
const jobMessage = document.querySelector("[data-job-message]");

let privateToken = fragmentToken;
let viewerLink = "";
let phoneViewerLink = "";
let locationWatchId = null;
let streamController = null;
let sendingLocation = false;
let firstPoint = null;
let deleted = false;
let latestSnapshot = null;

function isLoopbackPage() {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
}

function tokenHeaders() {
  return { "X-Tracking-Test-Token": privateToken, "Accept": "application/json" };
}

function setConnection(label, detail, state = "waiting") {
  document.querySelector("[data-connection-label]").textContent = label;
  document.querySelector("[data-connection-detail]").textContent = detail;
  document.querySelector("[data-connection-dot]").dataset.state = state;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function renderJob(snapshot) {
  const job = snapshot.job;
  if (!job) return;
  const phaseLabels = { "not-started": snapshot.state === "arrived" ? "Ready to start cleaning" : "Waiting for arrival", "in-progress": "Cleaning in progress", finished: "Cleaning test finished" };
  document.querySelector("[data-job-heading]").textContent = phaseLabels[job.phase] || "Cleaning progress";
  document.querySelector("[data-job-detail]").textContent = job.phase === "finished"
    ? `All ${job.totalTasks} sample tasks completed at ${formatTime(job.finishedAt)}.`
    : job.phase === "in-progress"
      ? `${job.completedTasks} of ${job.totalTasks} tasks complete${job.issueTasks ? ` · ${job.issueTasks} issue${job.issueTasks === 1 ? "" : "s"} to resolve` : ""}.`
      : snapshot.state === "arrived" ? "The Cleaner has arrived and can start the sample checklist." : "The Cleaner starts this sample checklist after arriving. The Landlord view updates automatically.";
  document.querySelector("[data-job-percent]").textContent = `${job.percent}%`;
  const progress = document.querySelector("[data-job-progress]");
  progress.setAttribute("aria-valuenow", String(job.percent));
  progress.querySelector("span").style.width = `${job.percent}%`;
  jobController.hidden = snapshot.role !== "cleaner";
  startCleaningButton.disabled = snapshot.state !== "arrived" || job.phase !== "not-started";
  finishCleaningButton.disabled = job.phase !== "in-progress" || job.completedTasks !== job.totalTasks || job.issueTasks > 0;
  for (const task of job.tasks) {
    const row = document.querySelector(`[data-live-task="${task.id}"]`);
    if (!row) continue;
    row.dataset.status = task.status;
    row.querySelector("[data-task-status]").textContent = task.status === "completed" ? "Complete" : task.status === "issue" ? "Issue" : "Pending";
    row.querySelector("[data-task-updated]").textContent = task.updatedAt ? `Updated ${formatTime(task.updatedAt)}` : "Not started";
    const actions = row.querySelector("[data-task-actions]");
    actions.hidden = snapshot.role !== "cleaner" || job.phase !== "in-progress";
    row.querySelector("[data-task-complete]").disabled = task.status === "completed";
    row.querySelector("[data-task-issue]").disabled = task.status === "issue";
    row.querySelector("[data-task-reset]").disabled = task.status === "pending";
  }
}

function renderSnapshot(snapshot) {
  if (!snapshot || deleted) return;
  latestSnapshot = snapshot;
  sessionPanel.hidden = false;
  setup.hidden = true;
  document.querySelector("[data-role-label]").textContent = snapshot.role === "cleaner" ? "Cleaner controller" : "Landlord viewer";
  document.querySelector("[data-session-reference]").textContent = `Test reference ${snapshot.reference} · expires ${formatTime(snapshot.expiresAt)}`;
  const stateLabels = { waiting: "Waiting for location", live: "Location sharing live", stale: "Latest point expired", stopped: "Location sharing stopped", arrived: "Cleaner has arrived", finished: "Cleaning test finished", deleted: "Test deleted", expired: "Test expired" };
  const heading = stateLabels[snapshot.state] || "Private location test";
  document.querySelector("[data-session-heading]").textContent = heading;
  document.querySelector("[data-session-state]").textContent = snapshot.state;
  document.querySelector("[data-session-state]").dataset.state = snapshot.state;
  const marker = document.querySelector("[data-location-marker]");
  if (snapshot.location) {
    const { latitude, longitude, accuracyMetres, recordedAt } = snapshot.location;
    document.querySelector("[data-latitude]").textContent = latitude.toFixed(5);
    document.querySelector("[data-longitude]").textContent = longitude.toFixed(5);
    document.querySelector("[data-accuracy]").textContent = `±${Math.round(accuracyMetres)} metres`;
    document.querySelector("[data-recorded-at]").textContent = formatTime(recordedAt);
    firstPoint ||= { latitude, longitude };
    const northMetres = (latitude - firstPoint.latitude) * 111_320;
    const eastMetres = (longitude - firstPoint.longitude) * 111_320 * Math.cos(latitude * Math.PI / 180);
    const x = Math.max(-115, Math.min(115, eastMetres * 2));
    const y = Math.max(-95, Math.min(95, -northMetres * 2));
    marker.style.setProperty("--tracking-x", `${x}px`);
    marker.style.setProperty("--tracking-y", `${y}px`);
    marker.hidden = false;
    setConnection("Live private stream", `Latest point received at ${formatTime(recordedAt)}`, "live");
  } else {
    marker.hidden = true;
    document.querySelector("[data-latitude]").textContent = "Waiting";
    document.querySelector("[data-longitude]").textContent = "Waiting";
    document.querySelector("[data-accuracy]").textContent = "Waiting";
    document.querySelector("[data-recorded-at]").textContent = ["stopped", "arrived", "finished"].includes(snapshot.state) ? "Point removed" : "No current point";
    setConnection(snapshot.state === "stopped" ? "Sharing stopped" : "Private stream connected", heading, snapshot.state);
  }
  stopButton.disabled = locationWatchId === null;
  arriveButton.disabled = snapshot.role !== "cleaner" || snapshot.state !== "live";
  startButton.disabled = snapshot.role !== "cleaner" || !consent.checked || locationWatchId !== null || !["waiting", "live"].includes(snapshot.state);
  renderJob(snapshot);
}

async function readError(response) {
  try { return (await response.json()).error || "The tracking test request failed."; } catch { return "The tracking test request failed."; }
}

async function sendLocation(position) {
  if (sendingLocation || !privateToken || deleted) return;
  sendingLocation = true;
  try {
    const response = await fetch("/api/tracking-test/location", {
      method: "PUT",
      headers: { ...tokenHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMetres: position.coords.accuracy })
    });
    if (!response.ok) throw new Error(await readError(response));
    renderSnapshot(await response.json());
    controllerMessage.textContent = "Latest real position shared with the private viewer.";
  } catch (error) {
    controllerMessage.textContent = error.message;
  } finally {
    sendingLocation = false;
  }
}

function stopBrowserWatch() {
  if (locationWatchId !== null) navigator.geolocation.clearWatch(locationWatchId);
  locationWatchId = null;
  startButton.disabled = !consent.checked;
  stopButton.disabled = true;
}

async function startLocation() {
  if (!consent.checked) return;
  if (!window.isSecureContext || !isLoopbackPage()) {
    controllerMessage.textContent = "Real location is available only from the trusted localhost page. Phone control needs an approved HTTPS deployment.";
    return;
  }
  if (!navigator.geolocation) {
    controllerMessage.textContent = "This browser does not provide geolocation.";
    return;
  }
  startButton.disabled = true;
  controllerMessage.textContent = "Waiting for browser location permission…";
  locationWatchId = navigator.geolocation.watchPosition(sendLocation, (error) => {
    controllerMessage.textContent = error.code === 1 ? "Location permission was denied. You can allow it in the browser and try again." : "The browser could not get a current position. Keep this page in the foreground and try again.";
    stopBrowserWatch();
  }, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 });
  stopButton.disabled = false;
}

async function stopLocation() {
  stopBrowserWatch();
  const response = await fetch("/api/tracking-test/stop", { method: "POST", headers: tokenHeaders() });
  if (!response.ok) return void (controllerMessage.textContent = await readError(response));
  renderSnapshot(await response.json());
  controllerMessage.textContent = "Location sharing stopped and the current point was removed.";
}

async function postControllerAction(path, successMessage) {
  const response = await fetch(path, { method: "POST", headers: tokenHeaders() });
  if (!response.ok) throw new Error(await readError(response));
  const snapshot = await response.json();
  renderSnapshot(snapshot);
  jobMessage.textContent = successMessage;
  return snapshot;
}

async function arrive() {
  stopBrowserWatch();
  try {
    await postControllerAction("/api/tracking-test/arrive", "Arrival recorded. The current location point was removed automatically.");
    controllerMessage.textContent = "Arrived. Location sharing is off and the current point has been removed.";
  } catch (error) {
    controllerMessage.textContent = error.message;
  }
}

async function startCleaning() {
  try { await postControllerAction("/api/tracking-test/cleaning/start", "Cleaning started. Task actions are now available."); }
  catch (error) { jobMessage.textContent = error.message; }
}

async function updateTask(taskId, status) {
  try {
    const response = await fetch("/api/tracking-test/task", {
      method: "PUT",
      headers: { ...tokenHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, status })
    });
    if (!response.ok) throw new Error(await readError(response));
    renderSnapshot(await response.json());
    jobMessage.textContent = status === "completed" ? "Task marked complete." : status === "issue" ? "Issue reported. Resolve it by completing or resetting the task." : "Task reset to pending.";
  } catch (error) { jobMessage.textContent = error.message; }
}

async function finishCleaning() {
  try { await postControllerAction("/api/tracking-test/cleaning/finish", "Cleaning test completed. The Landlord view has the final 100% update."); }
  catch (error) { jobMessage.textContent = error.message; }
}

async function deleteTest() {
  stopBrowserWatch();
  const response = await fetch("/api/tracking-test/session", { method: "DELETE", headers: tokenHeaders() });
  if (!response.ok) return void (controllerMessage.textContent = await readError(response));
  deleted = true;
  streamController?.abort();
  privateToken = "";
  sessionPanel.hidden = true;
  setup.hidden = false;
  setupMessage.textContent = "The private test and its current point were deleted from server memory.";
}

async function streamSnapshots() {
  streamController?.abort();
  streamController = new AbortController();
  while (privateToken && !deleted && !streamController.signal.aborted) {
    try {
      setConnection("Connecting", "Opening the private live stream…", "waiting");
      const response = await fetch("/api/tracking-test/events", { headers: { ...tokenHeaders(), "Accept": "text/event-stream" }, signal: streamController.signal });
      if (!response.ok || !response.body) throw new Error(await readError(response));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
          if (data) renderSnapshot(JSON.parse(data));
        }
      }
      if (!deleted) await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    } catch (error) {
      if (streamController.signal.aborted || deleted) break;
      setConnection("Connection interrupted", error.message || "Retrying the private stream…", "stale");
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    }
  }
}

async function initialisePrivateRole() {
  if (!privateToken) return;
  setup.hidden = true;
  sessionPanel.hidden = false;
  controllerControls.hidden = role !== "cleaner";
  viewerControls.hidden = role !== "landlord";
  deleteButton.hidden = role !== "cleaner";
  const response = await fetch("/api/tracking-test/snapshot", { headers: tokenHeaders() });
  if (!response.ok) {
    sessionPanel.hidden = true;
    setup.hidden = false;
    setupMessage.textContent = await readError(response);
    return;
  }
  const snapshot = await response.json();
  if (snapshot.role !== role) {
    sessionPanel.hidden = true;
    setup.hidden = false;
    setupMessage.textContent = "This private link does not match the selected test role.";
    privateToken = "";
    return;
  }
  renderSnapshot(snapshot);
  streamSnapshots();
}

async function createTest() {
  if (!window.isSecureContext || !isLoopbackPage()) {
    setupMessage.textContent = "Create the real-location test from http://127.0.0.1:4173/tracking-test on this computer.";
    return;
  }
  createButton.disabled = true;
  setupMessage.textContent = "Creating a private in-memory test…";
  try {
    const response = await fetch("/api/tracking-test/session", { method: "POST", headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(await readError(response));
    const result = await response.json();
    privateToken = result.controllerToken;
    viewerLink = `${window.location.origin}/tracking-test?role=landlord#${result.viewerToken}`;
    viewerLinkInput.value = viewerLink;
    const phoneOrigin = Array.isArray(result.viewerOrigins) ? result.viewerOrigins.find((origin) => /^http:\/\/(?:\d{1,3}\.){3}\d{1,3}:\d+$/.test(origin)) : "";
    phoneViewerLink = phoneOrigin ? `${phoneOrigin}/tracking-test?role=landlord#${result.viewerToken}` : "";
    if (phoneViewerLink) {
      document.querySelector("[data-phone-viewer-link]").value = phoneViewerLink;
      document.querySelector("[data-phone-viewer-panel]").hidden = false;
    }
    viewerLinkPanel.hidden = false;
    controllerControls.hidden = false;
    viewerControls.hidden = true;
    deleteButton.hidden = false;
    renderSnapshot(result.snapshot);
    streamSnapshots();
  } catch (error) {
    setupMessage.textContent = error.message;
  } finally {
    createButton.disabled = false;
  }
}

createButton.addEventListener("click", createTest);
consent.addEventListener("change", () => { startButton.disabled = !consent.checked || locationWatchId !== null || !["waiting", "live"].includes(latestSnapshot?.state); });
startButton.addEventListener("click", startLocation);
stopButton.addEventListener("click", stopLocation);
arriveButton.addEventListener("click", arrive);
startCleaningButton.addEventListener("click", startCleaning);
finishCleaningButton.addEventListener("click", finishCleaning);
document.querySelector("[data-task-list]").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const row = event.target.closest("[data-live-task]");
  if (!button || !row || role !== "cleaner" || latestSnapshot?.job?.phase !== "in-progress") return;
  const status = button.hasAttribute("data-task-complete") ? "completed" : button.hasAttribute("data-task-issue") ? "issue" : button.hasAttribute("data-task-reset") ? "pending" : "";
  if (status) updateTask(row.dataset.liveTask, status);
});
deleteButton.addEventListener("click", deleteTest);
document.querySelector("[data-open-viewer]").addEventListener("click", () => { if (viewerLink) window.open(viewerLink, "_blank", "noopener"); });
document.querySelector("[data-copy-viewer]").addEventListener("click", async () => {
  if (!viewerLink) return;
  try {
    await navigator.clipboard.writeText(viewerLink);
    controllerMessage.textContent = "Private Landlord viewer link copied. Share it only with the person testing this session.";
  } catch {
    viewerLinkInput.focus();
    viewerLinkInput.select();
    controllerMessage.textContent = "Copy was unavailable. The private viewer link is selected for you.";
  }
});
document.querySelector("[data-copy-phone-viewer]").addEventListener("click", async () => {
  if (!phoneViewerLink) return;
  const input = document.querySelector("[data-phone-viewer-link]");
  try {
    await navigator.clipboard.writeText(phoneViewerLink);
    controllerMessage.textContent = "Private same-Wi-Fi phone viewer link copied.";
  } catch {
    input.focus();
    input.select();
    controllerMessage.textContent = "Copy was unavailable. The phone viewer link is selected for you.";
  }
});
window.addEventListener("pagehide", () => {
  streamController?.abort();
  stopBrowserWatch();
});

if (!fragmentToken && (!window.isSecureContext || !isLoopbackPage())) {
  createButton.disabled = true;
  setupMessage.textContent = "Real location control requires the trusted localhost page. A phone can use a private Landlord viewer link, but phone location control needs approved HTTPS.";
}
initialisePrivateRole();
