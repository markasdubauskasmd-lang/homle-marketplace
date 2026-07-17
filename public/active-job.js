import {
  activeBookingId,
  activeJobAction,
  activeJobMessagingOpen,
  activeJobRole,
  activeJobStage,
  activeJobStages,
  activeJobStatusLabels,
  bookingReviewPayload,
  bookingReviewView,
  bookingDisputePayload,
  bookingDisputeView,
  cleanerReviewResponse,
  createClientMessageId,
  elapsedLabel,
  jobPhotoFileCheck,
  jobPhotoSha256,
  jobPhotoUploadAllowed,
  mergeBookingMessages,
  progressSummary,
  safeDateTime,
  taskCanBeDecided,
  taskCanBeQuickCompleted,
  taskNeedsCleanerTermsConfirmation,
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
const messageForm = document.querySelector("[data-message-form]");
const messageInput = document.querySelector("[data-message-input]");
const messageSend = document.querySelector("[data-message-send]");
const messageOlder = document.querySelector("[data-message-older]");
const photoControls = document.querySelector("[data-photo-controls]");
const photoCameraInput = document.querySelector("[data-photo-camera-input]");
const photoLibraryInput = document.querySelector("[data-photo-library-input]");
const photoDialog = document.querySelector("[data-photo-dialog]");
const photoForm = document.querySelector("[data-photo-form]");
const photoType = document.querySelector("[data-photo-type]");
const photoTask = document.querySelector("[data-photo-task]");
const photoUpload = document.querySelector("[data-photo-upload]");
const photoCancel = document.querySelector("[data-photo-cancel]");
const photoViewer = document.querySelector("[data-photo-viewer]");
const photoViewerImage = document.querySelector("[data-photo-viewer-image]");
const reviewComplete = document.querySelector("[data-review-complete]");
const reviewForm = document.querySelector("[data-review-form]");
const reviewSubmit = document.querySelector("[data-review-submit]");
const reviewResponseForm = document.querySelector("[data-review-response-form]");
const reviewResponseSubmit = document.querySelector("[data-review-response-submit]");
const disputeForm = document.querySelector("[data-dispute-form]");
const disputeSubmit = document.querySelector("[data-dispute-submit]");
const state = { account: null, role: "", status: "", tracking: null, progress: null, property: null, review: null, reviewLoading: false, reviewMutationInFlight: false, dispute: null, disputeLoading: false, disputeMutationInFlight: false, disputeRetry: null, messages: [], messageCursor: null, messagesHasMore: false, messageRetry: null, messageLoading: false, messageSending: false, photoFile: null, photoPreviewUrl: "", photoRetry: null, photoUploadInFlight: false, photoViewInFlight: false, eventSource: null, watchId: null, lastLocationAt: 0, locationRequestInFlight: false, mutationInFlight: false };

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

function showMessageFeedback(message, kind = "info") {
  const feedback = document.querySelector("[data-message-feedback]");
  feedback.hidden = !message;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
}

function showReviewFeedback(message, kind = "info") {
  const feedback = document.querySelector("[data-review-feedback]");
  feedback.hidden = !message;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
}

function showDisputeFeedback(message, kind = "info") {
  const feedback = document.querySelector("[data-dispute-feedback]");
  feedback.hidden = !message;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
}

function showPhotoFeedback(message, kind = "info") {
  const feedback = document.querySelector("[data-photo-feedback]");
  feedback.hidden = !message;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
}

function showPhotoUploadState(message, kind = "info") {
  const feedback = document.querySelector("[data-photo-upload-state]");
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

function applyMessagePage(page, { preserveCursor = false } = {}) {
  if (page?.bookingId !== bookingId || !Array.isArray(page.messages)) throw new Error("The private booking chat could not be verified.");
  state.messages = mergeBookingMessages(state.messages, page.messages);
  if (!preserveCursor) {
    state.messagesHasMore = page.hasMore === true;
    state.messageCursor = page.nextCursor || null;
  }
}

function messagePagePath(cursor = null) {
  const url = new URL(`/api/marketplace/bookings/${bookingId}/messages`, location.origin);
  url.searchParams.set("limit", "50");
  if (cursor) {
    url.searchParams.set("beforeCreatedAt", cursor.beforeCreatedAt);
    url.searchParams.set("beforeMessageId", cursor.beforeMessageId);
  }
  return `${url.pathname}${url.search}`;
}

function currentStatus() {
  const values = [state.status, state.tracking?.status, state.progress?.status].filter(Boolean);
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
    : stopped ? "Homle no longer receives the Cleaner’s position for this booking." : "No Cleaner coordinates are being collected.";
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
  button.textContent = "Save detailed update";
  button.dataset.pendingLabel = "Saving update…";
  form.append(field("Task status", select), field("Cleaner note", note), button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = select.value;
    if ((status === "skipped" || status === "issue-reported") && !note.value.trim()) return showFeedback("Add a short note before skipping a task or reporting an issue.", "error");
    await saveTaskUpdate(task, status, note.value, button, "Task update saved for both booking participants.");
  });
  return form;
}

async function saveTaskUpdate(task, status, note, button, successMessage) {
  await runMutation(button, async () => {
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks/${task.taskId}`, "PUT", { status, note });
    state.progress = result.progress;
    render();
    showFeedback(successMessage, "success");
  });
}

function taskControls(task) {
  const wrapper = document.createElement("div");
  wrapper.className = "active-task-controls";
  if (taskCanBeQuickCompleted(state.role, currentStatus(), task)) {
    const complete = document.createElement("button");
    complete.className = "button active-task-complete";
    complete.type = "button";
    complete.textContent = "Mark task complete";
    complete.setAttribute("aria-label", `Mark ${task.roomName || "room"}: ${task.description || "cleaning task"} complete`);
    complete.dataset.pendingLabel = "Saving task…";
    complete.addEventListener("click", () => saveTaskUpdate(task, "completed", task.latestNote || "", complete, `${task.roomName || "Room"} task marked complete.`));
    wrapper.append(complete);
  }
  const more = document.createElement("details");
  more.className = "active-task-more";
  const summary = document.createElement("summary");
  summary.textContent = task.status === "completed" ? "Change status or add note" : "More options or add note";
  summary.setAttribute("aria-label", `More options for ${task.roomName || "room"}: ${task.description || "cleaning task"}`);
  more.append(summary, taskEditor(task));
  wrapper.append(more);
  return wrapper;
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

function termsConfirmationButton(task) {
  const button = document.createElement("button");
  button.className = "button button-outline";
  button.type = "button";
  button.textContent = "Confirm it fits current time and pay";
  button.dataset.pendingLabel = "Confirming terms…";
  button.addEventListener("click", () => {
    if (!globalThis.confirm("Confirm that you can complete this task within the remaining booked time and your already agreed pay? If not, report an issue instead.")) return;
    runMutation(button, async () => {
      const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks/${task.taskId}/terms-confirmation`, "POST");
      state.progress = result.progress;
      render();
      showFeedback("Current booking time and pay confirmed. The Landlord can now decide.", "success");
    });
  });
  return button;
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
    if (task.unexpected && task.cleanerFrozenTermsConfirmed !== true && task.landlordApprovalStatus === "pending") {
      const boundary = document.createElement("small");
      boundary.className = "active-task-approval";
      boundary.textContent = "Not approved work: Cleaner confirmation of current booking time and pay is still required.";
      article.append(boundary);
    }
    const updateAllowed = taskCanBeUpdated(state.role, currentStatus()) && (task.unexpected !== true || task.landlordApprovalStatus === "approved");
    if (updateAllowed) article.append(taskControls(task));
    if (taskCanBeDecided(state.role, task)) article.append(decisionButtons(task));
    if (taskNeedsCleanerTermsConfirmation(state.role, currentStatus(), task)) article.append(termsConfirmationButton(task));
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

function photoTypeLabel(value) {
  if (value === "before") return "Before cleaning";
  if (value === "after") return "After cleaning";
  return "Issue or damage";
}

function renderPhotos() {
  const list = document.querySelector("[data-photo-list]");
  const photos = Array.isArray(state.progress?.photos) ? state.progress.photos : [];
  const tasks = new Map((state.progress?.tasks || []).map((task) => [task.taskId, `${task.roomName}: ${task.description}`]));
  list.replaceChildren();
  for (const photo of photos) {
    const article = document.createElement("article");
    article.className = `active-photo active-photo-${photo.photoType || "evidence"}`;
    const copy = document.createElement("div");
    const type = document.createElement("span");
    type.textContent = photoTypeLabel(photo.photoType);
    const title = document.createElement("strong");
    title.textContent = photo.taskId && tasks.has(photo.taskId) ? tasks.get(photo.taskId) : "Whole visit evidence";
    const time = document.createElement("time");
    time.dateTime = photo.createdAt || "";
    time.textContent = safeDateTime(photo.createdAt);
    copy.append(type, title, time);
    if (photo.note) {
      const note = document.createElement("p");
      note.textContent = photo.note;
      copy.append(note);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-outline";
    button.textContent = "Open private photo";
    button.addEventListener("click", () => openPrivatePhoto(photo, button));
    article.append(copy, button);
    list.append(article);
  }
  document.querySelector("[data-photo-empty]").hidden = photos.length > 0;
  document.querySelector("[data-photo-count]").textContent = String(photos.length);
}

function reviewScoreItem(label, value) {
  if (!Number.isInteger(Number(value))) return null;
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = `${label} `;
  detail.textContent = `${value}/5`;
  wrapper.append(term, detail);
  return wrapper;
}

function renderReviewSummary(review) {
  const summary = document.querySelector("[data-review-summary]");
  summary.hidden = !review;
  if (!review) return;
  const stars = document.querySelector("[data-review-stars]");
  stars.textContent = `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`;
  stars.setAttribute("aria-label", `${review.rating} out of 5 stars`);
  document.querySelector("[data-review-overall]").textContent = `${review.rating}/5 overall`;
  const scores = document.querySelector("[data-review-scores]");
  scores.replaceChildren(...[
    reviewScoreItem("Quality", review.qualityRating),
    reviewScoreItem("Punctuality", review.punctualityRating),
    reviewScoreItem("Communication", review.communicationRating),
    reviewScoreItem("Professionalism", review.professionalismRating)
  ].filter(Boolean));
  scores.hidden = scores.childElementCount === 0;
  const written = document.querySelector("[data-review-text]");
  written.hidden = !review.writtenReview;
  written.textContent = review.writtenReview || "";
  const moderation = document.querySelector("[data-review-moderation]");
  moderation.hidden = !(state.role === "landlord" && review.moderationNote);
  moderation.textContent = review.moderationNote ? `Homle moderation note: ${review.moderationNote}` : "";
  const response = document.querySelector("[data-review-response]");
  response.hidden = !review.cleanerResponse;
  response.querySelector("p").textContent = review.cleanerResponse || "";
}

function renderReview() {
  const card = document.querySelector("[data-review-card]");
  const view = bookingReviewView(state.role, currentStatus(), state.review);
  card.hidden = !view.visible;
  if (!view.visible) return;
  document.querySelector("[data-review-title]").textContent = view.title;
  document.querySelector("[data-review-copy]").textContent = view.copy;
  const stateLabel = document.querySelector("[data-review-state]");
  stateLabel.textContent = view.mode === "confirm-completion" ? "Landlord confirmation needed"
    : view.mode === "submit-review" ? "Ready to rate"
      : state.review?.moderationStatus === "approved" ? "Approved verified review"
        : state.review?.moderationStatus === "rejected" ? "Not public"
          : state.review ? "Moderation pending" : "Private booking status";
  document.querySelector("[data-review-confirm]").hidden = view.mode !== "confirm-completion";
  reviewForm.hidden = view.mode !== "submit-review";
  reviewResponseForm.hidden = view.mode !== "respond";
  reviewComplete.disabled = state.reviewMutationInFlight;
  reviewSubmit.disabled = state.reviewMutationInFlight;
  reviewResponseSubmit.disabled = state.reviewMutationInFlight;
  for (const button of [reviewComplete, reviewSubmit, reviewResponseSubmit]) {
    if (state.reviewMutationInFlight) button.setAttribute("aria-busy", "true"); else button.removeAttribute("aria-busy");
  }
  renderReviewSummary(state.review);
}

function renderDispute() {
  const card = document.querySelector("[data-dispute-card]");
  const view = bookingDisputeView(currentStatus(), state.dispute);
  card.hidden = !view.visible;
  if (!view.visible) return;
  disputeForm.hidden = !view.canOpen;
  disputeSubmit.disabled = state.disputeMutationInFlight;
  if (state.disputeMutationInFlight) disputeSubmit.setAttribute("aria-busy", "true"); else disputeSubmit.removeAttribute("aria-busy");
  const summary = document.querySelector("[data-dispute-summary]");
  summary.hidden = state.dispute === null;
  const stateLabel = document.querySelector("[data-dispute-state]");
  if (!state.dispute) {
    stateLabel.textContent = currentStatus() === "disputed" ? "Loading case record" : "Booking participants only";
    document.querySelector("[data-dispute-copy]").textContent = currentStatus() === "disputed" ? "This booking is paused while Homle loads its private case record." : "If something serious is wrong with this visit, record it here. Opening a case pauses the normal booking lifecycle until an Administrator records an outcome.";
    return;
  }
  stateLabel.textContent = state.dispute.status === "open" ? "Case recorded" : state.dispute.status === "reviewing" ? "Administrator reviewing" : "Case resolved";
  document.querySelector("[data-dispute-copy]").textContent = state.dispute.status === "resolved" ? "The Administrator decision and booking outcome are recorded below." : "The normal booking lifecycle is paused while this private case is open.";
  document.querySelector("[data-dispute-category]").textContent = state.dispute.category.replaceAll("-", " ");
  document.querySelector("[data-dispute-status]").textContent = state.dispute.status;
  document.querySelector("[data-dispute-created]").textContent = safeDateTime(state.dispute.createdAt);
  document.querySelector("[data-dispute-description]").textContent = state.dispute.description;
  const outcomeRow = document.querySelector("[data-dispute-outcome-row]");
  outcomeRow.hidden = !state.dispute.resolutionOutcome;
  document.querySelector("[data-dispute-outcome]").textContent = state.dispute.resolutionOutcome || "";
  const resolutionRow = document.querySelector("[data-dispute-resolution-row]");
  resolutionRow.hidden = !state.dispute.resolutionNote;
  document.querySelector("[data-dispute-resolution]").textContent = state.dispute.resolutionNote || "";
}

function privatePhotoUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("The short-lived private photo link is invalid."); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((!local && url.protocol !== "https:") || url.username || url.password) throw new Error("The short-lived private photo link is invalid.");
  return url.toString();
}

async function openPrivatePhoto(photo, button) {
  if (state.photoViewInFlight) return;
  state.photoViewInFlight = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  showPhotoFeedback("Requesting a short-lived private view…");
  try {
    const result = await requestJson(`/api/marketplace/bookings/${bookingId}/cleaning-progress/photos/${photo.photoId}/access`);
    if (result.photo?.photoId !== photo.photoId) throw new Error("The private photo response could not be verified.");
    const expiresAt = Date.parse(result.photo.expiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 6 * 60_000) throw new Error("The private photo viewing window could not be verified.");
    photoViewerImage.src = privatePhotoUrl(result.photo.url);
    photoViewerImage.alt = `${photoTypeLabel(result.photo.photoType)}${result.photo.note ? `: ${result.photo.note}` : ""}`;
    document.querySelector("[data-photo-viewer-type]").textContent = photoTypeLabel(result.photo.photoType);
    document.querySelector("[data-photo-viewer-title]").textContent = photo.taskId ? "Checklist evidence" : "Whole visit evidence";
    document.querySelector("[data-photo-viewer-note]").textContent = result.photo.note || "No private note was added.";
    photoViewer.showModal();
    showPhotoFeedback("");
  } catch (error) {
    showPhotoFeedback(error.message || "The private photo could not be opened. Try again.", "error");
  } finally {
    state.photoViewInFlight = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function closePhotoViewer() {
  photoViewer.close();
  photoViewerImage.removeAttribute("src");
  photoViewerImage.alt = "";
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

function renderMessages({ forceBottom = false } = {}) {
  const list = document.querySelector("[data-message-list]");
  const stayAtBottom = forceBottom || list.scrollHeight - list.scrollTop - list.clientHeight < 72;
  list.replaceChildren();
  for (const message of state.messages) {
    const own = message.senderRole === state.role;
    const article = document.createElement("article");
    article.className = `active-message${own ? " active-message-own" : ""}`;
    const heading = document.createElement("div");
    const sender = document.createElement("strong");
    sender.textContent = own ? "You" : message.senderRole === "cleaner" ? "Cleaner" : "Landlord";
    const time = document.createElement("time");
    time.dateTime = message.createdAt;
    time.textContent = safeDateTime(message.createdAt);
    const body = document.createElement("p");
    body.textContent = message.body;
    heading.append(sender, time);
    article.append(heading, body);
    list.append(article);
  }
  document.querySelector("[data-message-empty]").hidden = state.messages.length > 0;
  messageOlder.hidden = !state.messagesHasMore;
  messageOlder.disabled = state.messageLoading;
  messageOlder.textContent = state.messageLoading ? "Loading earlier messages…" : "Load earlier messages";
  const open = activeJobMessagingOpen(currentStatus());
  messageInput.disabled = !open || state.messageSending;
  messageSend.disabled = !open || state.messageSending;
  messageSend.textContent = state.messageSending ? "Sending…" : open ? "Send privately" : "Messaging closed";
  if (state.messageSending) messageSend.setAttribute("aria-busy", "true"); else messageSend.removeAttribute("aria-busy");
  if (stayAtBottom) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
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
  photoControls.hidden = !["before", "after", "issue"].some((kind) => jobPhotoUploadAllowed(state.role, currentStatus(), kind));
  for (const button of photoControls.querySelectorAll("button")) button.disabled = state.photoUploadInFlight;
}

function render() {
  const status = currentStatus();
  gate.hidden = true;
  workspace.hidden = false;
  document.querySelector("[data-role-label]").textContent = state.role === "cleaner" ? "Cleaner active job" : "Landlord live view";
  document.querySelector("[data-status-heading]").textContent = activeJobStatusLabels[status] || "Private booking";
  document.querySelector("[data-status-copy]").textContent = status === "cancelled" ? "This booking is closed and location sharing has stopped." : "Updates are shared only with the Cleaner and Landlord on this booking.";
  document.querySelector("[data-workspace-link]").href = state.role === "cleaner" ? "/cleaner/dashboard" : "/landlord/dashboard";
  document.querySelector("[data-live-state]").textContent = state.eventSource ? "Live updates connected" : "Opening live updates";
  renderStages(status);
  renderJourney();
  renderProgress();
  renderPhotos();
  renderReview();
  renderDispute();
  renderProperty();
  renderMessages();
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

async function loadReview({ quiet = false } = {}) {
  if (!["awaiting-review", "completed"].includes(currentStatus()) || state.reviewLoading) return;
  state.reviewLoading = true;
  try {
    const result = await requestJson(`/api/marketplace/bookings/${bookingId}/reviews`);
    state.review = result.review || null;
    if (!workspace.hidden) renderReview();
  } catch (error) {
    if (!quiet) showReviewFeedback(error.message || "The verified review could not be loaded. Try again.", "error");
  } finally { state.reviewLoading = false; }
}

async function loadDispute({ quiet = false } = {}) {
  if (state.disputeLoading) return;
  state.disputeLoading = true;
  try {
    const result = await requestJson(`/api/marketplace/bookings/${bookingId}/dispute`);
    state.dispute = result.dispute || null;
    if (!workspace.hidden) renderDispute();
  } catch (error) {
    if (!quiet) showDisputeFeedback(error.message || "The private booking case could not be loaded. Try again.", "error");
  } finally { state.disputeLoading = false; }
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
      if (snapshot.status) state.status = snapshot.status;
      if (snapshot.tracking) state.tracking = snapshot.tracking;
      if (snapshot.progress) state.progress = snapshot.progress;
      if (snapshot.messages) applyMessagePage(snapshot.messages, { preserveCursor: true });
      render();
      if (["awaiting-review", "completed"].includes(currentStatus())) void loadReview({ quiet: true });
      if (state.dispute || currentStatus() === "disputed") void loadDispute({ quiet: true });
      if (["completed", "cancelled"].includes(snapshot.status)) {
        closeLiveStream();
        setConnection("closed", "Booking updates finished", "This booking is now closed.");
      }
    } catch {
      setConnection("offline", "Update could not be verified", "Homle kept the last verified booking state and will reconnect.");
    }
  });
  stream.addEventListener("stream-error", () => setConnection("offline", "Live update interrupted", "The secure connection will retry automatically."));
  stream.addEventListener("error", () => setConnection("offline", "Reconnecting securely", "The last verified state remains visible while Homle reconnects."));
}

function positionOptions() {
  return { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 };
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!globalThis.isSecureContext || !navigator.geolocation) return reject(new Error("Live location needs HTTPS and location permission. Open Homle on its secure domain, then try again."));
    navigator.geolocation.getCurrentPosition(resolve, reject, positionOptions());
  });
}

function coordinates(position) {
  return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMetres: position.coords.accuracy };
}

function locationFailure(error) {
  const denied = error?.code === 1;
  showLocationFeedback(denied ? "Location permission was denied. Homle did not start sharing; allow location in browser settings and try again." : error?.message || "Your current position could not be read. Check GPS and connection, then try again.", "error");
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
  const originalLabel = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (button.dataset.pendingLabel) button.textContent = button.dataset.pendingLabel;
  showFeedback("");
  try { await operation(); }
  catch (error) {
    showFeedback(error.message || "The booking could not be updated. No unverified change was shown.", "error");
    if (error.statusCode === 401) showGate("Sign in again", "Your account session has expired. Location sharing has stopped and no further booking changes were attempted.", { kind: "authentication", allowSignIn: true });
  } finally {
    state.mutationInFlight = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = originalLabel;
    if (!workspace.hidden) renderActions();
  }
}

async function runReviewMutation(button, operation) {
  if (state.reviewMutationInFlight) return;
  state.reviewMutationInFlight = true;
  showReviewFeedback("");
  renderReview();
  try { await operation(); }
  catch (error) {
    showReviewFeedback(error.message || "The review could not be updated. No unverified change was shown.", "error");
    if (error.statusCode === 401) showGate("Sign in again", "Your account session expired before the review change was saved.", { kind: "authentication", allowSignIn: true });
  } finally {
    state.reviewMutationInFlight = false;
    if (!workspace.hidden) renderReview();
  }
}

function handleCompletionConfirmation() {
  if (!globalThis.confirm("Confirm that this cleaning visit is complete? Check the task list, notes, issues and after photos first.")) return;
  void runReviewMutation(reviewComplete, async () => {
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/completion`);
    if (result.booking?.bookingId !== bookingId || result.booking?.status !== "completed") throw new Error("The completed booking response could not be verified.");
    state.status = "completed";
    state.review = null;
    showReviewFeedback("Booking completed. You can now leave one verified review.", "success");
    render();
  });
}

function handleReviewSubmission(event) {
  event.preventDefault();
  if (!reviewForm.reportValidity()) return;
  let payload;
  try { payload = bookingReviewPayload(Object.fromEntries(new FormData(reviewForm).entries())); }
  catch (error) { return showReviewFeedback(error.message, "error"); }
  if (!globalThis.confirm(`Submit this ${payload.rating}-star verified review? It cannot be replaced after submission.`)) return;
  void runReviewMutation(reviewSubmit, async () => {
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/reviews`, "POST", payload);
    if (result.review?.bookingId !== bookingId) throw new Error("The submitted review response could not be verified.");
    state.review = result.review;
    reviewForm.reset();
    showReviewFeedback("Verified review submitted for Homle moderation.", "success");
    renderReview();
  });
}

function handleReviewResponse(event) {
  event.preventDefault();
  if (!reviewResponseForm.reportValidity()) return;
  let response;
  try { response = cleanerReviewResponse(new FormData(reviewResponseForm).get("response")); }
  catch (error) { return showReviewFeedback(error.message, "error"); }
  if (!globalThis.confirm("Publish this professional response? It cannot be edited after submission.")) return;
  void runReviewMutation(reviewResponseSubmit, async () => {
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/reviews/response`, "POST", { response });
    if (result.review?.bookingId !== bookingId || !result.review?.cleanerResponse) throw new Error("The Cleaner response could not be verified.");
    state.review = result.review;
    reviewResponseForm.reset();
    showReviewFeedback("Your professional response is now attached to the approved review.", "success");
    renderReview();
  });
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
  body.withinBookedTermsConfirmed = body.withinBookedTermsConfirmed === "on";
  taskDialog.close();
  runMutation(addTaskAction, async () => {
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/tasks`, "POST", body);
    state.progress = result.progress;
    taskForm.reset();
    render();
    showFeedback("Unexpected task sent to the Landlord for approval.", "success");
  });
});

function clearPhotoSelection({ close = false } = {}) {
  if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
  state.photoPreviewUrl = "";
  state.photoFile = null;
  state.photoRetry = null;
  photoCameraInput.value = "";
  photoLibraryInput.value = "";
  document.querySelector("[data-photo-preview]").removeAttribute("src");
  if (close && photoDialog.open) photoDialog.close();
}

function populatePhotoTasks() {
  const selected = photoTask.value;
  const general = document.createElement("option");
  general.value = "";
  general.textContent = "Whole visit / general evidence";
  const options = [general];
  for (const task of state.progress?.tasks || []) {
    const option = document.createElement("option");
    option.value = task.taskId;
    option.textContent = `${task.roomName}: ${task.description}`;
    options.push(option);
  }
  photoTask.replaceChildren(...options);
  if ([...photoTask.options].some((option) => option.value === selected)) photoTask.value = selected;
}

function selectPhoto(file) {
  const checked = jobPhotoFileCheck(file);
  if (!checked.ok) return showPhotoFeedback(checked.error, "error");
  clearPhotoSelection();
  state.photoFile = file;
  state.photoPreviewUrl = URL.createObjectURL(file);
  const preview = document.querySelector("[data-photo-preview]");
  preview.src = state.photoPreviewUrl;
  document.querySelector("[data-photo-file-name]").textContent = file.name || "Camera photo";
  document.querySelector("[data-photo-file-size]").textContent = `${(checked.byteSize / 1_000_000).toFixed(1)} MB · ${checked.mimeType.replace("image/", "").toUpperCase()}`;
  populatePhotoTasks();
  const status = currentStatus();
  for (const option of photoType.options) option.disabled = !jobPhotoUploadAllowed(state.role, status, option.value);
  photoType.value = jobPhotoUploadAllowed(state.role, status, status === "cleaner-arrived" ? "before" : "after") ? (status === "cleaner-arrived" ? "before" : "after") : "issue";
  photoForm.querySelector('textarea[name="note"]').value = "";
  showPhotoUploadState("");
  showPhotoFeedback("");
  photoDialog.showModal();
}

function checksumBase64(hex) {
  const bytes = String(hex || "").match(/[0-9a-f]{2}/gi);
  if (!bytes || bytes.length !== 32) throw new Error("The private upload checksum could not be verified.");
  return btoa(String.fromCharCode(...bytes.map((value) => Number.parseInt(value, 16))));
}

function verifiedUploadContract(upload, expected) {
  if (!upload || upload.method !== "PUT" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(upload.uploadId || "")) throw new Error("The private upload instruction could not be verified.");
  const url = privatePhotoUrl(upload.uploadUrl);
  const expectedHeaders = ["Content-Type", "X-Amz-Checksum-Sha256", "X-Amz-Meta-Tideway-Sha256", "X-Amz-Server-Side-Encryption"];
  const headers = upload.requiredHeaders;
  if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.keys(headers).length !== expectedHeaders.length || expectedHeaders.some((name) => typeof headers[name] !== "string" || !headers[name])) throw new Error("The private upload instruction could not be verified.");
  if (headers["Content-Type"] !== expected.mimeType || headers["X-Amz-Meta-Tideway-Sha256"] !== expected.checksumSha256 || headers["X-Amz-Checksum-Sha256"] !== checksumBase64(expected.checksumSha256) || headers["X-Amz-Server-Side-Encryption"] !== "AES256") throw new Error("The private upload instruction did not match the selected photo.");
  if (!Number.isFinite(Date.parse(upload.expiresAt || "")) || Date.parse(upload.expiresAt) <= Date.now()) throw new Error("The private upload instruction has expired. Try again.");
  return { uploadId: upload.uploadId.toLowerCase(), url, headers: Object.fromEntries(expectedHeaders.map((name) => [name, headers[name]])) };
}

async function uploadSelectedPhoto() {
  if (state.photoUploadInFlight || !state.photoFile || !photoForm.reportValidity()) return;
  const data = new FormData(photoForm);
  const selectedType = String(data.get("photoType") || "");
  const note = String(data.get("note") || "").trim();
  const taskId = String(data.get("taskId") || "");
  if (!jobPhotoUploadAllowed(state.role, currentStatus(), selectedType)) return showPhotoUploadState("This evidence type is not available at the current booking stage.", "error");
  if (selectedType === "issue" && !note) return showPhotoUploadState("Add a private note explaining the issue or damage.", "error");
  const checked = jobPhotoFileCheck(state.photoFile);
  if (!checked.ok) return showPhotoUploadState(checked.error, "error");
  const retryKey = `${selectedType}\0${taskId}\0${note}`;
  if (!state.photoRetry || state.photoRetry.file !== state.photoFile || state.photoRetry.retryKey !== retryKey) state.photoRetry = { file: state.photoFile, retryKey, checksumSha256: "", intent: null, uploaded: false };
  const retry = state.photoRetry;
  state.photoUploadInFlight = true;
  photoUpload.disabled = true;
  photoCancel.disabled = true;
  photoUpload.setAttribute("aria-busy", "true");
  try {
    if (!retry.checksumSha256) {
      showPhotoUploadState("Verifying the selected photo on this device…");
      retry.checksumSha256 = await jobPhotoSha256(retry.file);
    }
    if (!retry.intent) {
      showPhotoUploadState("Creating a private ten-minute upload…");
      const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/photos/intents`, "POST", { photoType: selectedType, taskId: taskId || null, note: note || null, mimeType: checked.mimeType, byteSize: checked.byteSize, checksumSha256: retry.checksumSha256 });
      retry.intent = verifiedUploadContract(result.upload, { mimeType: checked.mimeType, checksumSha256: retry.checksumSha256 });
    }
    if (!retry.uploaded) {
      showPhotoUploadState("Uploading directly to Homle's private quarantine storage. Keep this page open…");
      const response = await fetch(retry.intent.url, { method: "PUT", mode: "cors", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: retry.intent.headers, body: retry.file, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error("The private photo upload was not accepted. Check the connection and try again.");
      retry.uploaded = true;
    }
    showPhotoUploadState("Removing metadata and verifying the stored photo…");
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/cleaning-progress/photos/${retry.intent.uploadId}/complete`);
    state.progress = result.progress;
    clearPhotoSelection({ close: true });
    render();
    showPhotoFeedback("Private job photo added for both booking participants.", "success");
  } catch (error) {
    if (error.statusCode === 401) {
      clearPhotoSelection({ close: true });
      showGate("Sign in again", "Your account session expired during the private photo upload. The unfinished storage object will expire automatically.", { kind: "authentication", allowSignIn: true });
      return;
    }
    showPhotoUploadState(error.message || "The photo could not be added. Your selection is still here to retry.", "error");
  } finally {
    state.photoUploadInFlight = false;
    photoUpload.disabled = false;
    photoCancel.disabled = false;
    photoUpload.removeAttribute("aria-busy");
    if (!photoDialog.open) showPhotoUploadState("");
    renderActions();
  }
}

for (const input of [photoCameraInput, photoLibraryInput]) input.addEventListener("change", () => { if (input.files?.length) selectPhoto(input.files[0]); });
document.querySelector("[data-photo-camera]").addEventListener("click", () => { photoCameraInput.value = ""; photoCameraInput.click(); });
document.querySelector("[data-photo-library]").addEventListener("click", () => { photoLibraryInput.value = ""; photoLibraryInput.click(); });
photoForm.addEventListener("submit", (event) => { event.preventDefault(); uploadSelectedPhoto(); });
photoForm.addEventListener("input", () => { if (!state.photoUploadInFlight) state.photoRetry = null; });
photoCancel.addEventListener("click", () => { if (!state.photoUploadInFlight) clearPhotoSelection({ close: true }); });
photoDialog.addEventListener("cancel", (event) => { event.preventDefault(); if (!state.photoUploadInFlight) clearPhotoSelection({ close: true }); });
document.querySelector("[data-photo-viewer-close]").addEventListener("click", closePhotoViewer);
photoViewer.addEventListener("close", () => { photoViewerImage.removeAttribute("src"); photoViewerImage.alt = ""; });
photoViewerImage.addEventListener("error", () => { if (photoViewerImage.hasAttribute("src")) showPhotoFeedback("The short-lived photo could not be displayed. Close it and try again.", "error"); });

async function loadEarlierMessages() {
  if (state.messageLoading || !state.messagesHasMore || !state.messageCursor) return;
  state.messageLoading = true;
  const list = document.querySelector("[data-message-list]");
  const previousHeight = list.scrollHeight;
  renderMessages();
  showMessageFeedback("");
  try {
    const page = await requestJson(messagePagePath(state.messageCursor));
    applyMessagePage(page);
    renderMessages();
    requestAnimationFrame(() => { list.scrollTop = Math.max(0, list.scrollHeight - previousHeight); });
  } catch (error) {
    showMessageFeedback(error.message || "Earlier messages could not be loaded. Try again.", "error");
  } finally {
    state.messageLoading = false;
    renderMessages();
  }
}

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.messageSending || !messageForm.reportValidity()) return;
  if (!activeJobMessagingOpen(currentStatus())) return showMessageFeedback("Messaging is closed at this booking stage.", "error");
  const body = messageInput.value.trim();
  if (!body) return showMessageFeedback("Write a message before sending.", "error");
  try {
    if (!state.messageRetry || state.messageRetry.body !== body) state.messageRetry = { body, clientMessageId: createClientMessageId() };
  } catch (error) {
    return showMessageFeedback(error.message, "error");
  }
  state.messageSending = true;
  renderMessages();
  showMessageFeedback("");
  try {
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/messages`, "POST", state.messageRetry);
    if (result.message?.bookingId !== bookingId) throw new Error("The sent booking message could not be verified.");
    state.messages = mergeBookingMessages(state.messages, [result.message]);
    state.messageRetry = null;
    messageForm.reset();
    document.querySelector("[data-message-count]").textContent = "0";
    showMessageFeedback("Message shared privately with this booking participant.", "success");
    renderMessages({ forceBottom: true });
  } catch (error) {
    showMessageFeedback(error.message || "The message could not be sent. Your text is still here to retry.", "error");
  } finally {
    state.messageSending = false;
    renderMessages();
  }
});

messageInput.addEventListener("input", () => {
  document.querySelector("[data-message-count]").textContent = String(messageInput.value.length);
  if (state.messageRetry && state.messageRetry.body !== messageInput.value.trim()) state.messageRetry = null;
});

messageOlder.addEventListener("click", loadEarlierMessages);

disputeForm.addEventListener("input", () => { if (!state.disputeMutationInFlight) state.disputeRetry = null; });
disputeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.disputeMutationInFlight || state.dispute) return;
  state.disputeMutationInFlight = true;
  const values = Object.fromEntries(new FormData(disputeForm));
  try {
    if (!state.disputeRetry) state.disputeRetry = bookingDisputePayload({ ...values, confirmed: values.confirmed === "on", requestId: createClientMessageId() });
    renderDispute();
    showDisputeFeedback("Recording the private case without changing any payment…");
    const result = await mutate(`/api/marketplace/bookings/${bookingId}/dispute`, "POST", state.disputeRetry);
    state.dispute = result.dispute;
    state.status = "disputed";
    state.disputeRetry = null;
    disputeForm.reset();
    showDisputeFeedback("Private case recorded. The normal booking lifecycle is now paused.", "success");
    render();
  } catch (error) {
    showDisputeFeedback(error.message || "The private case could not be recorded. Check the details and try again.", "error");
  } finally { state.disputeMutationInFlight = false; renderDispute(); }
});

for (const button of document.querySelectorAll("[data-dialog-cancel]")) button.addEventListener("click", () => button.closest("dialog").close());

function updateNetworkState() {
  const banner = document.querySelector("[data-network-state]");
  banner.hidden = navigator.onLine;
  document.querySelector("[data-network-copy]").textContent = "You are offline. Homle has stopped sending updates and will reconnect when the connection returns.";
  if (!navigator.onLine) setConnection("offline", "Offline", "The last verified booking state remains visible.");
}

async function load() {
  if (!bookingId) return showGate("Open a valid private booking link", "This address does not contain a valid booking reference. No booking or location information was requested.", { kind: "error" });
  showGate("Opening your private booking…", "Homle is checking your account and participant access.");
  try {
    try { state.account = (await requestJson("/api/marketplace/account")).account; }
    catch (error) {
      if ([404, 503].includes(error.statusCode)) return showGate("Secure marketplace accounts are not connected yet", "The active-job screen is ready, but it remains closed until Homle’s protected database and HTTPS runtime pass staging.", { kind: "unavailable", allowRetry: true });
      throw error;
    }
    state.role = activeJobRole(state.account);
    if (!state.role) return showGate("Choose a Cleaner or Landlord workspace", "This account has not completed role onboarding for active bookings.", { kind: "authentication", allowSignIn: true });
    const [trackingResult, progressResult, propertyResult, messageResult, disputeResult] = await Promise.all([
      requestJson(`/api/marketplace/bookings/${bookingId}/tracking`),
      requestJson(`/api/marketplace/bookings/${bookingId}/cleaning-progress`),
      requestJson(`/api/marketplace/bookings/${bookingId}/property`).catch(() => ({ property: null })),
      requestJson(messagePagePath()),
      requestJson(`/api/marketplace/bookings/${bookingId}/dispute`)
    ]);
    state.tracking = trackingResult.tracking;
    state.progress = progressResult.progress;
    state.status = disputeResult.dispute?.status === "open" || disputeResult.dispute?.status === "reviewing" ? "disputed" : [state.tracking?.status, state.progress?.status].filter(Boolean).sort((left, right) => activeJobStage(right) - activeJobStage(left))[0] || "confirmed";
    state.property = propertyResult.property;
    applyMessagePage(messageResult);
    state.dispute = disputeResult.dispute || null;
    if (["awaiting-review", "completed"].includes(currentStatus())) await loadReview();
    showFeedback("");
    render();
    openLiveStream();
  } catch (error) {
    if (error.statusCode === 401) showGate("Sign in to open this booking", "Live journey and cleaning updates are private to the confirmed booking participants.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403 || error.statusCode === 404) showGate("This account cannot open the booking", "Use the assigned Cleaner or owning Landlord account. Homle has not revealed any booking details.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 503) showGate("Secure marketplace accounts are temporarily unavailable", "No location sharing started and no booking update was attempted. Try again when the protected runtime is healthy.", { kind: "unavailable", allowRetry: true });
    else showGate("The booking could not be opened", "No location sharing started. Check your connection and try again.", { kind: "error", allowRetry: true });
  }
}

primaryAction.addEventListener("click", handlePrimaryAction);
pauseAction.addEventListener("click", openPauseDialog);
addTaskAction.addEventListener("click", () => { taskForm.reset(); taskDialog.showModal(); });
reviewComplete.addEventListener("click", handleCompletionConfirmation);
reviewForm.addEventListener("submit", handleReviewSubmission);
reviewResponseForm.addEventListener("submit", handleReviewResponse);
retry.addEventListener("click", load);
window.addEventListener("online", () => { updateNetworkState(); if (!state.eventSource && !workspace.hidden) openLiveStream(); });
window.addEventListener("offline", updateNetworkState);
window.addEventListener("pagehide", () => { stopLocationSharing(); closeLiveStream(); clearPhotoSelection(); photoViewerImage.removeAttribute("src"); });
updateNetworkState();
load();
