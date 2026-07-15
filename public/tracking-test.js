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
const deleteButton = document.querySelector("[data-delete-test]");
const consent = document.querySelector("[data-location-consent]");
const controllerMessage = document.querySelector("[data-controller-message]");

let privateToken = fragmentToken;
let viewerLink = "";
let phoneViewerLink = "";
let locationWatchId = null;
let streamController = null;
let sendingLocation = false;
let firstPoint = null;
let deleted = false;

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

function renderSnapshot(snapshot) {
  if (!snapshot || deleted) return;
  sessionPanel.hidden = false;
  setup.hidden = true;
  document.querySelector("[data-role-label]").textContent = snapshot.role === "cleaner" ? "Cleaner controller" : "Landlord viewer";
  document.querySelector("[data-session-reference]").textContent = `Test reference ${snapshot.reference} · expires ${formatTime(snapshot.expiresAt)}`;
  const stateLabels = { waiting: "Waiting for location", live: "Location sharing live", stale: "Latest point expired", stopped: "Location sharing stopped", deleted: "Test deleted", expired: "Test expired" };
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
    document.querySelector("[data-recorded-at]").textContent = snapshot.state === "stopped" ? "Point removed" : "No current point";
    setConnection(snapshot.state === "stopped" ? "Sharing stopped" : "Private stream connected", heading, snapshot.state);
  }
  stopButton.disabled = locationWatchId === null;
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
consent.addEventListener("change", () => { startButton.disabled = !consent.checked || locationWatchId !== null; });
startButton.addEventListener("click", startLocation);
stopButton.addEventListener("click", stopLocation);
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
