import {
  activeBookingId,
  activeJobAction,
  activeJobRole,
  activeJobStage,
  activeJobStages,
  activeJobStatusLabels,
  elapsedLabel,
  progressSummary,
  safeDateTime,
  taskCanBeDecided,
  taskCanBeUpdated
} from "./active-job-model.js";

const bookingId = activeBookingId(location.pathname, location.search);
const gate = document.querySelector("[data-job-gate]");
const workspace = document.querySelector("[data-job-workspace]");
const retry = document.querySelector("[data-gate-retry]");
const signIn = document.querySelector("[data-gate-sign-in]");
const primaryAction = document.querySelector("[data-primary-action]");
const pauseAction = document.querySelector("[data-pause-action]");
const addTaskAction = document.querySelector("[data-add-task-action]");
const pauseDialog = document.querySelector("[data-pause-dialog]");
const pauseForm = document.querySelector("[data-pause-form]");
const taskDialog = document.querySelector("[data-task-dialog]");
const taskForm = document.querySelector("[data-task-form]");
const state = { account: null, role: "", tracking: null, progress: null, property: null, eventSource: null, watchId: null, lastLocationAt: 0, locationRequestInFlight: false, mutationInFlight: false };

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());
document.querySelector("[data-booking-reference]").textContent = bookingId ? bookingId.slice(0, 8).toUpperCase() : "Invalid";

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function showGate(title, copy, { kind = "info", allowSignIn = false, allowRetry = false } = {}) {
  stopLocationSharing();
  closeLiveStream();
  workspace.hidden = true;
  gate.hidden = false;
  gate.dataset.kind = kind;
  document.querySelector("[data-gate-title]").textContent = title;
  document.querySelector("[data-gate-copy]").textContent = copy;
  signIn.hidden = !allowSignIn;
  retry.hidden = !allowRetry;
}

function showFeedback(message, kind = "info") {
  const feedback = document.querySelector("[data-action-feedback]");
  feedback.hidden = !message;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
}

function showLocationFeedback(message, kind = "info") {
  const feedback = document.querySelector("[data-location-feedback]");
  feedback.hidden = !message;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers: { Accept: "application/json", ...headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || "The active booking could not be updated."), { statusCode: response.status, code: result.code || "request-failed" });
  return result;
}

async function mutate(path, method = "POST", body = {}) {
  const csrf = storedCsrf();
  if (!csrf) throw Object.assign(new Error("Your secure editing token is missing. Sign in again before changing this booking."), { statusCode: 401 });
  return requestJson(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
}

function currentStatus() {
  const values = [state.tracking?.status, state.progress?.status].filter(Boolean);
  return values.sort((left, right) => activeJobStage(right) - activeJobStage(left))[0] || "confirmed";
}

function renderStages(status) {
  const current = activeJobStage(status);
  const interrupted = status === "cancelled" || status === "disputed";
  for (const item of document.querySelectorAll("[data-stage-list] [data-stage]")) {
    const index = activeJobStages.indexOf(item.dataset.stage);
    item.classList.toggle("complete", !interrupted && index < current);
    item.classList.toggle("current", !interrupted && index === current);
    item.querySelector("span").textContent = !interrupted && index < current ? "✓" : String(index + 1);
  }
}

function renderJourney() {
  const tracking = state.tracking || {};
  const live = tracking.sharingState === "live" && tracking.location;
  const stopped = ["cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "cancelled"].includes(currentStatus());
  document.querySelector("[data-journey-title]").textContent = activeJobStatusLabels[currentStatus()] || "Private booking journey";
  document.querySelector("[data-cleaner-name]").textContent = tracking.cleaner?.displayName || "Assigned Cleaner";
  document.querySelector("[data-scheduled-start]").textContent = safeDateTime(tracking.scheduledStartAt || state.progress?.scheduledStartAt);
  document.querySelector("[data-eta]").textContent = live?.estimatedArrivalAt ? safeDateTime(live.estimatedArrivalAt, { date: false }) : stopped ? "Arrived" : "Not available";
  document.querySelector("[data-location-time]").textContent = live?.recordedAt ? safeDateTime(live.recordedAt) : tracking.arrivedAt ? safeDateTime(tracking.arrivedAt) : "Not recorded";
  document.querySelector("[data-location-marker]").hidden = !live;
  const surface = document.querySelector("[data-location-surface]");
  surface.dataset.state = live ? "live" : stopped ? "stopped" : "off";
  document.querySelector("[data-location-heading]").textContent = live ? "Live position received" : stopped ? "Location sharing stopped" : "Location sharing is off";
  document.querySelector("[data-location-copy]").textContent = live
    ? `Updated ${safeDateTime(live.recordedAt, { date: false })}. Only the latest point is retained.`
    : stopped ? "Tideway no longer receives the Cleaner’s position for this booking." : "No Cleaner coordinates are being collected.";
}

function labelledTaskStatus(value) {
  return String(value || "not-started").replaceAll("-", " ");
}

function field(label, control) {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  wrapper.append(control);
  return wrapper;
}

function taskEditor(task) {
  const form = document.createElement("form");
  form.className = "active-task-editor";
  const select = document.createElement("select");
  select.name = "status";
  select.setAttribute("aria-label", `Status for ${task.description}`);
  for (const value of ["not-started", "in-progress", "completed", "skipped", "issue-reported"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelledTaskStatus(value);
    option.selected = value === task.status;
    select.append(option);
  }
  const note = document.createElement("textarea");
  note.name = "note";
  note.rows = 2;
  note.maxLength = 2000;
  note.placeholder = "Add a note; required if skipped or reporting an issue";
  note.value = task.latestNote || "";
  const button = document.createElement("button");
  button.className = "button button-outline";
  button.type = "submit";
  button.textContent = "Save task update";
  form.append(field("Task status", select), field("Cleaner note", note), button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = select.value;
    if ((status === "skipped" || status === "issue-reported") && !note.value.trim()) return showFeedback("Add a short note before skipping a task or reporting an issue.", "error");
    await runMutation(button, async () => {
      const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks/${task.taskId}`, "PUT", { status, note: note.value });
      state.progress = result.progress;
      render();
      showFeedback("Task update saved for both booking participants.", "success");
    });
  });
  return form;
}

function decisionButtons(task) {
  const wrapper = document.createElement("div");
  wrapper.className = "active-task-decisions";
  const approve = document.createElement("button");
  approve.className = "button";
  approve.type = "button";
  approve.textContent = "Approve at current price";
  const decline = document.createElement("button");
  decline.className = "button button-outline";
  decline.type = "button";
  decline.textContent = "Decline task";
  approve.addEventListener("click", () => decideUnexpectedTask(task, "approved", approve));
  decline.addEventListener("click", () => decideUnexpectedTask(task, "declined", decline));
  wrapper.append(approve, decline);
  return wrapper;
}

async function decideUnexpectedTask(task, decision, button) {
  if (decision === "approved" && !globalThis.confirm("Approve this additional task without changing the frozen booking price or Cleaner pay?")) return;
  await runMutation(button, async () => {
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks/${task.taskId}/decision`, "POST", { decision, priceUnchangedConfirmed: decision === "approved" });
    state.progress = result.progress;
    render();
    showFeedback(`Unexpected task ${decision}.`, "success");
  });
}

function renderTasks() {
  const list = document.querySelector("[data-task-list]");
  list.replaceChildren();
  const tasks = Array.isArray(state.progress?.tasks) ? state.progress.tasks : [];
  document.querySelector("[data-task-empty]").hidden = tasks.length > 0;
  for (const task of tasks) {
    const article = document.createElement("article");
    article.className = `active-task active-task-${task.status || "not-started"}`;
    const heading = document.createElement("div");
    const room = document.createElement("span");
    room.textContent = task.roomName || "Room";
    const title = document.createElement("strong");
    title.textContent = task.description || "Cleaning task";
    const status = document.createElement("em");
    status.textContent = task.unexpected ? `${labelledTaskStatus(task.status)} · unexpected task` : labelledTaskStatus(task.status);
    heading.append(room, title, status);
    article.append(heading);
    if (task.latestNote) {
      const note = document.createElement("p");
      note.textContent = task.latestNote;
      article.append(note);
    }
    if (task.unexpected && task.landlordApprovalStatus) {
      const approval = document.createElement("small");
      approval.className = "active-task-approval";
      approval.textContent = `Landlord decision: ${task.landlordApprovalStatus}`;
      article.append(approval);
    }
    if (taskCanBeUpdated(state.role, currentStatus())) article.append(taskEditor(task));
    if (taskCanBeDecided(state.role, task)) article.append(decisionButtons(task));
    list.append(article);
  }
}

function renderProgress() {
  const summary = progressSummary(state.progress || {});
  document.querySelector("[data-progress-percent]").textContent = `${summary.percentage}%`;
  document.querySelector("[data-progress-bar]").style.width = `${summary.percentage}%`;
  document.querySelector("[role=progressbar]").setAttribute("aria-valuenow", String(summary.percentage));
  document.querySelector("[data-completed-count]").textContent = String(summary.completed);
  document.querySelector("[data-resolved-count]").textContent = String(summary.resolved);
  document.querySelector("[data-total-count]").textContent = String(summary.total);
  document.querySelector("[data-elapsed]").textContent = elapsedLabel(state.progress?.elapsedSeconds);
  document.querySelector("[data-pause-notice]").hidden = state.progress?.isPaused !== true;
  document.querySelector("[data-photo-count]").textContent = String(Array.isArray(state.progress?.photos) ? state.progress.photos.length : 0);
  renderTasks();
}

function renderProperty() {
  const card = document.querySelector("[data-property-card]");
  if (!state.property) return void (card.hidden = true);
  card.hidden = false;
  document.querySelector("[data-property-name]").textContent = state.property.name || "Cleaning property";
  const address = state.property.exactAddress;
  document.querySelector("[data-property-address]").textContent = address ? [address.addressLine1, address.addressLine2, address.locality, address.postcode].filter(Boolean).join(", ") : "Exact address is protected for this booking state.";
  document.querySelector("[data-property-access]").textContent = state.property.accessInstructions || "Not supplied";
  document.querySelector("[data-property-parking]").textContent = state.property.parkingInstructions || "Not supplied";
  document.querySelector("[data-property-notes]").textContent = state.property.specialNotes || "Not supplied";
}

function renderActions() {
  const action = activeJobAction(state.role, state.tracking, state.progress);
  primaryAction.textContent = action.label;
  primaryAction.disabled = !action.enabled || state.mutationInFlight;
  primaryAction.dataset.action = action.kind;
  document.querySelector("[data-action-eyebrow]").textContent = state.role === "cleaner" ? "Cleaner action" : "Landlord view";
  document.querySelector("[data-action-title]").textContent = state.role === "cleaner" ? action.label : "Watch the clean live";
  document.querySelector("[data-action-copy]").textContent = state.role === "cleaner"
    ? "Every action is checked against your assigned booking and written to its audit history."
    : "Journey and task updates arrive automatically. Only the assigned Cleaner can change their work status.";
  const cleaning = currentStatus() === "cleaning-in-progress";
  pauseAction.hidden = state.role !== "cleaner" || !cleaning;
  pauseAction.textContent = state.progress?.isPaused ? "Resume cleaning" : "Pause cleaning";
  addTaskAction.hidden = state.role !== "cleaner" || !cleaning;
}

function render() {
  const status = currentStatus();
  gate.hidden = true;
  workspace.hidden = false;
  document.querySelector("[data-role-label]").textContent = state.role === "cleaner" ? "Cleaner active job" : "Landlord live view";
  document.querySelector("[data-status-heading]").textContent = activeJobStatusLabels[status] || "Private booking";
  document.querySelector("[data-status-copy]").textContent = status === "cancelled" ? "This booking is closed and location sharing has stopped." : "Updates are shared only with the Cleaner and Landlord on this booking.";
  document.querySelector("[data-workspace-link]").href = state.role === "cleaner" ? "/cleaner/profile" : "/landlord/dashboard";
  document.querySelector("[data-live-state]").textContent = state.eventSource ? "Live updates connected" : "Opening live updates";
  renderStages(status);
  renderJourney();
  renderProgress();
  renderProperty();
  renderActions();
  if (["cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "cancelled", "disputed"].includes(status)) stopLocationSharing();
}

function setConnection(kind, title, copy) {
  document.querySelector("[data-connection-dot]").dataset.kind = kind;
  document.querySelector("[data-connection-title]").textContent = title;
  document.querySelector("[data-connection-copy]").textContent = copy;
  document.querySelector("[data-live-state]").textContent = title;
}

function closeLiveStream() {
  state.eventSource?.close();
  state.eventSource = null;
}

function openLiveStream() {
  closeLiveStream();
  if (!bookingId || typeof EventSource !== "function") return setConnection("offline", "Live connection unavailable", "Use Try again to refresh the booking safely.");
  const stream = new EventSource(`/api/marketplace/bookings/${bookingId}/events`, { withCredentials: true });
  state.eventSource = stream;
  stream.addEventListener("open", () => setConnection("live", "Live updates connected", "Durable booking changes will appear automatically."));
  stream.addEventListener("booking-snapshot", (event) => {
    try {
      const snapshot = JSON.parse(event.data);
      if (snapshot.bookingId !== bookingId) throw new Error("Booking mismatch");
      if (snapshot.tracking) state.tracking = snapshot.tracking;
      if (snapshot.progress) state.progress = snapshot.progress;
      render();
      if (["completed", "cancelled", "disputed"].includes(snapshot.status)) {
        closeLiveStream();
        setConnection("closed", "Booking updates finished", "This booking is now closed.");
      }
    } catch {
      setConnection("offline", "Update could not be verified", "Tideway kept the last verified booking state and will reconnect.");
    }
  });
  stream.addEventListener("stream-error", () => setConnection("offline", "Live update interrupted", "The secure connection will retry automatically."));
  stream.addEventListener("error", () => setConnection("offline", "Reconnecting securely", "The last verified state remains visible while Tideway reconnects."));
}

function positionOptions() {
  return { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 };
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!globalThis.isSecureContext || !navigator.geolocation) return reject(new Error("Live location needs HTTPS and location permission. Open Tideway on its secure domain, then try again."));
    navigator.geolocation.getCurrentPosition(resolve, reject, positionOptions());
  });
}

function coordinates(position) {
  return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMetres: position.coords.accuracy };
}

function locationFailure(error) {
  const denied = error?.code === 1;
  showLocationFeedback(denied ? "Location permission was denied. Tideway did not start sharing; allow location in browser settings and try again." : error?.message || "Your current position could not be read. Check GPS and connection, then try again.", "error");
}

function stopLocationSharing() {
  if (state.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  state.locationRequestInFlight = false;
}

function startLocationWatch() {
  stopLocationSharing();
  if (!globalThis.isSecureContext || !navigator.geolocation) return locationFailure(new Error("Live location needs HTTPS and location permission."));
  state.watchId = navigator.geolocation.watchPosition(async (position) => {
    if (Date.now() - state.lastLocationAt < 10_000 || state.locationRequestInFlight) return;
    state.locationRequestInFlight = true;
    try {
      const result = await mutate(`/api/marketplace/bookings/${bookingId}/journey/location`, "PUT", coordinates(position));
      state.lastLocationAt = Date.now();
      state.tracking = result.tracking;
      showLocationFeedback("Your current position is sharing with this booking only.", "success");
      render();
    } catch (error) {
      if ([401, 403, 409].includes(error.statusCode)) stopLocationSharing();
      locationFailure(error);
    } finally { state.locationRequestInFlight = false; }
  }, locationFailure, positionOptions());
}

async function runMutation(button, operation) {
  if (state.mutationInFlight) return;
  state.mutationInFlight = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  showFeedback("");
  try { await operation(); }
  catch (error) {
    showFeedback(error.message || "The booking could not be updated. No unverified change was shown.", "error");
    if (error.statusCode === 401) showGate("Sign in again", "Your account session has expired. Location sharing has stopped and no further booking changes were attempted.", { kind: "authentication", allowSignIn: true });
  } finally {
    state.mutationInFlight = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (!workspace.hidden) renderActions();
  }
}

async function handlePrimaryAction() {
  const action = primaryAction.dataset.action;
  await runMutation(primaryAction, async () => {
    if (action === "start-journey" || action === "resume-location") {
      showLocationFeedback("Requesting your current location…");
      let position;
      try { position = await currentPosition(); } catch (error) { locationFailure(error); return; }
      const path = action === "start-journey" ? `/api/marketplace/bookings/${bookingId}/journey/start` : `/api/marketplace/bookings/${bookingId}/journey/location`;
      const method = action === "start-journey" ? "POST" : "PUT";
      const result = await mutate(path, method, { ...coordinates(position), ...(action === "start-journey" ? { consentGranted: true } : {}) });
      state.tracking = result.tracking;
      state.lastLocationAt = Date.now();
      startLocationWatch();
      showLocationFeedback("Location sharing is on for this confirmed booking. Keep this page open while travelling.", "success");
    } else if (action === "arrive") {
      const result = await mutate(`/api/marketplace/bookings/${bookingId}/journey/arrive`);
      state.tracking = result.tracking;
      stopLocationSharing();
      showLocationFeedback("Arrival recorded. Location sharing has stopped automatically.", "success");
    } else if (action === "start-cleaning") {
      const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/start`);
      state.progress = result.progress;
      showFeedback("Cleaning started. Task updates are now visible to the Landlord.", "success");
    } else if (action === "finish-cleaning") {
      if (!globalThis.confirm("Finish this cleaning job? Every resolved task and completion time will be recorded for the Landlord.")) return;
      const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/finish`);
      state.progress = result.progress;
      stopLocationSharing();
      showFeedback("Cleaning finished. The Landlord can now review the completed job.", "success");
    }
    render();
  });
}

function openPauseDialog() {
  if (state.progress?.isPaused) {
    return runMutation(pauseAction, async () => {
      const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/pause`, "POST", { paused: false, note: "" });
      state.progress = result.progress;
      render();
      showFeedback("Cleaning resumed.", "success");
    });
  }
  pauseForm.reset();
  pauseDialog.showModal();
}

pauseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const note = new FormData(pauseForm).get("note")?.toString().trim() || "";
  if (!note) return pauseForm.reportValidity();
  pauseDialog.close();
  runMutation(pauseAction, async () => {
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/pause`, "POST", { paused: true, note });
    state.progress = result.progress;
    render();
    showFeedback("Cleaning paused and the Landlord can see the update.", "success");
  });
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!taskForm.reportValidity()) return;
  const body = Object.fromEntries(new FormData(taskForm).entries());
  body.estimatedAdditionalMinutes = Number(body.estimatedAdditionalMinutes);
  taskDialog.close();
  runMutation(addTaskAction, async () => {
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks`, "POST", body);
    state.progress = result.progress;
    taskForm.reset();
    render();
    showFeedback("Unexpected task sent to the Landlord for approval.", "success");
  });
});

for (const button of document.querySelectorAll("[data-dialog-cancel]")) button.addEventListener("click", () => button.closest("dialog").close());

function updateNetworkState() {
  const banner = document.querySelector("[data-network-state]");
  banner.hidden = navigator.onLine;
  document.querySelector("[data-network-copy]").textContent = "You are offline. Tideway has stopped sending updates and will reconnect when the connection returns.";
  if (!navigator.onLine) setConnection("offline", "Offline", "The last verified booking state remains visible.");
}

async function load() {
  if (!bookingId) return showGate("Open a valid private booking link", "This address does not contain a valid booking reference. No booking or location information was requested.", { kind: "error" });
  showGate("Opening your private booking…", "Tideway is checking your account and participant access.");
  try {
    try { state.account = (await requestJson("/api/marketplace/account")).account; }
    catch (error) {
      if ([404, 503].includes(error.statusCode)) return showGate("Secure marketplace accounts are not connected yet", "The active-job screen is ready, but it remains closed until Tideway’s protected database and HTTPS runtime pass staging.", { kind: "unavailable", allowRetry: true });
      throw error;
    }
    state.role = activeJobRole(state.account);
    if (!state.role) return showGate("Choose a Cleaner or Landlord workspace", "This account has not completed role onboarding for active bookings.", { kind: "authentication", allowSignIn: true });
    const [trackingResult, progressResult, propertyResult] = await Promise.all([
      requestJson(`/api/marketplace/bookings/${bookingId}/tracking`),
      requestJson(`/api/marketplace/bookings/${bookingId}/cleaning-progress`),
      requestJson(`/api/marketplace/bookings/${bookingId}/property`).catch(() => ({ property: null }))
    ]);
    state.tracking = trackingResult.tracking;
    state.progress = progressResult.progress;
    state.property = propertyResult.property;
    showFeedback("");
    render();
    openLiveStream();
  } catch (error) {
    if (error.statusCode === 401) showGate("Sign in to open this booking", "Live journey and cleaning updates are private to the confirmed booking participants.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403 || error.statusCode === 404) showGate("This account cannot open the booking", "Use the assigned Cleaner or owning Landlord account. Tideway has not revealed any booking details.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 503) showGate("Secure marketplace accounts are temporarily unavailable", "No location sharing started and no booking update was attempted. Try again when the protected runtime is healthy.", { kind: "unavailable", allowRetry: true });
    else showGate("The booking could not be opened", "No location sharing started. Check your connection and try again.", { kind: "error", allowRetry: true });
  }
}

primaryAction.addEventListener("click", handlePrimaryAction);
pauseAction.addEventListener("click", openPauseDialog);
addTaskAction.addEventListener("click", () => { taskForm.reset(); taskDialog.showModal(); });
retry.addEventListener("click", load);
window.addEventListener("online", () => { updateNetworkState(); if (!state.eventSource && !workspace.hidden) openLiveStream(); });
window.addEventListener("offline", updateNetworkState);
window.addEventListener("pagehide", () => { stopLocationSharing(); closeLiveStream(); });
updateNetworkState();
load();
