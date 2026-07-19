const bookingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messagingStatuses = new Set(["pending-cleaner-acceptance", "confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "disputed"]);
const jobPhotoMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const jobPhotoStatuses = new Set(["cleaner-arrived", "cleaning-in-progress", "awaiting-review"]);
const disputeCategories = new Set(["quality", "damage", "access", "safety", "conduct", "payment", "other"]);
const disputableStatuses = new Set(["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "disputed"]);

export const activeJobStages = Object.freeze([
  "confirmed",
  "cleaner-en-route",
  "cleaner-arrived",
  "cleaning-in-progress",
  "awaiting-review",
  "completed"
]);

export const activeJobStatusLabels = Object.freeze({
  confirmed: "Booking confirmed",
  "cleaner-en-route": "Cleaner en route",
  "cleaner-arrived": "Cleaner arrived",
  "cleaning-in-progress": "Cleaning in progress",
  "awaiting-review": "Cleaning finished",
  completed: "Booking completed",
  cancelled: "Booking cancelled",
  disputed: "Booking disputed"
});

export function activeBookingId(pathname, search = "") {
  const pathMatch = String(pathname || "").match(/^\/bookings\/([0-9a-f-]{36})(?:\/(?:tracking|cleaning-progress))?\/?$/i);
  const supplied = pathMatch?.[1] || new URLSearchParams(String(search || "")).get("bookingId") || "";
  return bookingIdPattern.test(supplied) ? supplied.toLowerCase() : "";
}

export function activeJobRole(account) {
  const roles = Array.isArray(account?.roles) ? account.roles : [];
  if ((account?.selectedRole === "cleaner" || account?.selectedRole === "landlord") && roles.includes(account.selectedRole)) return account.selectedRole;
  if (roles.includes("cleaner") && !roles.includes("landlord")) return "cleaner";
  if (roles.includes("landlord") && !roles.includes("cleaner")) return "landlord";
  return "";
}

export function activeJobStage(status) {
  const index = activeJobStages.indexOf(status);
  if (index >= 0) return index;
  return status === "cancelled" || status === "disputed" ? activeJobStages.length : 0;
}

export function activeJobAction(role, tracking = {}, progress = {}) {
  if (role !== "cleaner") return Object.freeze({ kind: "none", label: "Live booking updates", enabled: false });
  const candidates = [tracking.status, progress.status].filter(Boolean);
  const status = candidates.sort((left, right) => activeJobStage(right) - activeJobStage(left))[0] || "";
  if (status === "confirmed") return Object.freeze({ kind: "start-journey", label: "Start journey", enabled: true });
  if (status === "cleaner-en-route") {
    if (tracking.sharingState !== "live") return Object.freeze({ kind: "resume-location", label: "Resume location sharing", enabled: true });
    return Object.freeze({ kind: "arrive", label: "I have arrived", enabled: true });
  }
  if (status === "cleaner-arrived") return Object.freeze({ kind: "start-cleaning", label: "Start cleaning", enabled: true });
  if (status === "cleaning-in-progress") {
    const resolved = Number(progress.resolvedTasks) || 0;
    const total = Number(progress.totalTasks) || 0;
    const ready = total > 0 && resolved === total;
    return Object.freeze({ kind: "finish-cleaning", label: ready ? "Finish cleaning" : `Resolve ${Math.max(0, total - resolved)} task${total - resolved === 1 ? "" : "s"} first`, enabled: ready });
  }
  return Object.freeze({ kind: "none", label: status === "awaiting-review" || status === "completed" ? "Cleaning complete" : "No action available", enabled: false });
}

export function taskCanBeDecided(role, task) {
  return role === "landlord" && task?.unexpected === true && task?.cleanerFrozenTermsConfirmed === true && task?.landlordApprovalStatus === "pending";
}

export function taskNeedsCleanerTermsConfirmation(role, status, task) {
  return role === "cleaner" && status === "cleaning-in-progress" && task?.unexpected === true && task?.cleanerFrozenTermsConfirmed !== true && task?.landlordApprovalStatus === "pending";
}

export function taskCanBeUpdated(role, status) {
  return role === "cleaner" && status === "cleaning-in-progress";
}

export function taskCanBeQuickCompleted(role, status, task) {
  if (!taskCanBeUpdated(role, status) || task?.status === "completed") return false;
  return task?.unexpected !== true || task.landlordApprovalStatus === "approved";
}

export function activeJobMessagingOpen(status) {
  return messagingStatuses.has(status);
}

export function bookingDisputeView(status, dispute = null) {
  const visible = disputableStatuses.has(status) || dispute !== null;
  if (!visible) return Object.freeze({ visible: false, canOpen: false });
  return Object.freeze({ visible: true, canOpen: dispute === null && status !== "disputed", status: dispute?.status || null });
}

export function bookingDisputePayload(input = {}) {
  const requestId = String(input.requestId || "").trim().toLowerCase();
  const category = String(input.category || "").trim().toLowerCase();
  const description = reviewText(input.description, 5000, "Case description");
  if (!bookingIdPattern.test(requestId)) throw new TypeError("Secure case retry protection is unavailable.");
  if (!disputeCategories.has(category)) throw new TypeError("Choose what the case is about.");
  if (description.length < 20) throw new TypeError("Describe what happened using at least 20 characters.");
  if (input.confirmed !== true) throw new TypeError("Confirm that the case description is accurate before submitting.");
  return Object.freeze({ requestId, category, description });
}

export function bookingReviewView(role, status, review = null) {
  if (!['landlord', 'cleaner'].includes(role) || !['awaiting-review', 'completed'].includes(status)) return Object.freeze({ visible: false, mode: 'hidden' });
  if (role === 'landlord' && status === 'awaiting-review') return Object.freeze({ visible: true, mode: 'confirm-completion', title: 'Confirm the finished clean', copy: 'Check the completed tasks, notes and private photos before marking this booking complete.' });
  if (role === 'landlord' && !review) return Object.freeze({ visible: true, mode: 'submit-review', title: 'Rate this completed clean', copy: 'Your rating is tied to this completed booking. Only an approved review affects the Cleaner’s public rating.' });
  if (role === 'landlord') return Object.freeze({ visible: true, mode: 'submitted', title: 'Review submitted', copy: review.moderationStatus === 'approved' ? 'This verified review is approved and contributes to the Cleaner’s public rating.' : review.moderationStatus === 'rejected' ? 'This review is not public. Homle’s moderation note is shown below.' : 'This review is awaiting moderation and is not public yet.' });
  if (status === 'awaiting-review') return Object.freeze({ visible: true, mode: 'waiting-for-completion', title: 'Waiting for Landlord confirmation', copy: 'Your completed checklist and evidence are ready for the Landlord to review.' });
  if (!review) return Object.freeze({ visible: true, mode: 'review-unavailable', title: 'Review not available yet', copy: 'A Landlord review appears here only after it has been approved. No private moderation details are shown.' });
  if (!review.cleanerResponse) return Object.freeze({ visible: true, mode: 'respond', title: 'Your approved review', copy: 'You may add one professional public response. It cannot be edited after submission.' });
  return Object.freeze({ visible: true, mode: 'responded', title: 'Your approved review', copy: 'Your one professional response has been published with this review.' });
}

function reviewScore(value, label, required = false) {
  if (!required && (value == null || value === '')) return null;
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new TypeError(`${label} must be from 1 to 5.`);
  return score;
}

function reviewText(value, maximum, label) {
  const normalized = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
  if (normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) throw new TypeError(`${label} is invalid.`);
  return normalized;
}

export function bookingReviewPayload(input = {}) {
  return Object.freeze({
    rating: reviewScore(input.rating, 'Overall rating', true),
    qualityRating: reviewScore(input.qualityRating, 'Quality rating'),
    punctualityRating: reviewScore(input.punctualityRating, 'Punctuality rating'),
    communicationRating: reviewScore(input.communicationRating, 'Communication rating'),
    professionalismRating: reviewScore(input.professionalismRating, 'Professionalism rating'),
    writtenReview: reviewText(input.writtenReview, 3000, 'Written review')
  });
}

export function cleanerReviewResponse(value) {
  const response = reviewText(value, 2000, 'Cleaner response');
  if (!response) throw new TypeError('Add a professional response before submitting.');
  return response;
}

export function mergeBookingMessages(current, incoming, maximum = 500) {
  const records = new Map();
  for (const value of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!bookingIdPattern.test(value?.messageId || "") || !["cleaner", "landlord"].includes(value?.senderRole) || typeof value?.body !== "string" || value.body.length < 1 || value.body.length > 2000 || !Number.isFinite(Date.parse(value?.createdAt || ""))) continue;
    records.set(value.messageId.toLowerCase(), Object.freeze({ messageId: value.messageId.toLowerCase(), senderRole: value.senderRole, body: value.body, createdAt: new Date(value.createdAt).toISOString() }));
  }
  const ordered = [...records.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.messageId.localeCompare(right.messageId));
  return Object.freeze(ordered.slice(-Math.max(1, Math.min(1000, Number(maximum) || 500))));
}

export function createClientMessageId(cryptography = globalThis.crypto) {
  if (typeof cryptography?.randomUUID === "function") return cryptography.randomUUID();
  if (typeof cryptography?.getRandomValues !== "function") throw new Error("Secure message retry protection is unavailable in this browser.");
  const bytes = cryptography.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function jobPhotoMimeType(file) {
  const supplied = String(file?.type || "").trim().toLowerCase();
  if (jobPhotoMimeTypes.has(supplied)) return supplied;
  if (supplied === "image/heif" || (!supplied && /\.(?:heic|heif)$/i.test(String(file?.name || "")))) return "image/heic";
  return "";
}

export function jobPhotoFileCheck(file) {
  if (!file || typeof file.arrayBuffer !== "function") return Object.freeze({ ok: false, error: "Choose one job photo." });
  const byteSize = Number(file.size);
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > 15_000_000) return Object.freeze({ ok: false, error: "Choose a photo smaller than 15 MB." });
  const mimeType = jobPhotoMimeType(file);
  if (!mimeType) return Object.freeze({ ok: false, error: "Choose a JPEG, PNG, WebP or HEIC photo." });
  return Object.freeze({ ok: true, byteSize, mimeType });
}

export function jobPhotoUploadAllowed(role, status, photoType = "after") {
  if (role !== "cleaner" || !jobPhotoStatuses.has(status) || !["before", "after", "issue"].includes(photoType)) return false;
  return !(photoType === "before" && status === "awaiting-review");
}

export async function jobPhotoSha256(file, cryptography = globalThis.crypto) {
  const checked = jobPhotoFileCheck(file);
  if (!checked.ok) throw new TypeError(checked.error);
  if (typeof cryptography?.subtle?.digest !== "function") throw new Error("Secure photo verification requires HTTPS in this browser.");
  const digest = await cryptography.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function progressSummary(progress = {}) {
  const total = Math.max(0, Number(progress.totalTasks) || 0);
  const completed = Math.min(total, Math.max(0, Number(progress.completedTasks) || 0));
  const resolved = Math.min(total, Math.max(0, Number(progress.resolvedTasks) || 0));
  const suppliedPercent = Number(progress.overallPercentage);
  const percentage = Number.isFinite(suppliedPercent) ? Math.min(100, Math.max(0, Math.round(suppliedPercent))) : total ? Math.round((resolved / total) * 100) : 0;
  return Object.freeze({ total, completed, resolved, percentage, unresolved: Math.max(0, total - resolved) });
}

export function safeDateTime(value, options = {}) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: options.date === false ? undefined : "medium", timeStyle: "short" }).format(date);
}

export function elapsedLabel(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const arrivedStatuses = new Set(["cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed"]);

// Only a genuine arrival puts the Cleaner marker on the home. A journey still in
// progress is capped short of it, so the picture can never imply the Cleaner is
// at the door before the arrival is actually recorded.
const travellingProgressCap = 0.94;

// Journey progress is derived from the estimated arrival time rather than from
// coordinates, so the customer's home position never has to reach the client to
// draw the approach.
//
// `memory` carries what earlier renders established for this booking:
// `baselineMinutes` (the longest remaining time seen, which only ever grows) and
// `achievedPercent` (the furthest the marker has travelled). Progress is
// monotonic — a journey that deteriorates holds its position and reports itself
// as delayed rather than animating the Cleaner backwards down the road. The
// remaining-minutes readout always tells the truth, so a delay is still visible
// to the customer as a number even while the marker holds.
export function journeyProgress(tracking = {}, memory = {}, now = Date.now()) {
  const status = tracking?.status;
  if (arrivedStatuses.has(status)) return Object.freeze({ known: true, arrived: true, delayed: false, percent: 1, remainingMinutes: 0, baselineMinutes: null, achievedPercent: null });
  const live = tracking?.sharingState === "live" && tracking?.location;
  const eta = live ? new Date(live.estimatedArrivalAt || "") : null;
  if (!eta || Number.isNaN(eta.getTime())) return Object.freeze({ known: false, arrived: false, delayed: false, percent: 0, remainingMinutes: null, baselineMinutes: null, achievedPercent: null });
  const remainingMinutes = Math.max(0, Math.ceil((eta.getTime() - now) / 60000));
  const suppliedBaseline = Number(memory?.baselineMinutes);
  const baseline = Number.isFinite(suppliedBaseline) && suppliedBaseline > remainingMinutes ? suppliedBaseline : remainingMinutes;
  const travelled = baseline > 0 ? Math.min(travellingProgressCap, Math.max(0, 1 - remainingMinutes / baseline)) : travellingProgressCap;
  const suppliedAchieved = Number(memory?.achievedPercent);
  const achieved = Number.isFinite(suppliedAchieved) && suppliedAchieved > travelled ? suppliedAchieved : travelled;
  return Object.freeze({
    known: true,
    arrived: false,
    delayed: achieved > travelled,
    percent: achieved,
    remainingMinutes,
    baselineMinutes: baseline,
    achievedPercent: achieved
  });
}

export function journeyDistanceLabel(progress = {}) {
  if (progress.arrived) return "Arrived";
  if (!progress.known || progress.remainingMinutes == null) return "Not available";
  if (progress.remainingMinutes <= 1) return "Arriving now";
  return `About ${progress.remainingMinutes} min away${progress.delayed ? " — running later than expected" : ""}`;
}
