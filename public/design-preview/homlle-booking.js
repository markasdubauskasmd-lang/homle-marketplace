/* Homlle — the shared booking record.
 *
 * WHY THIS FILE EXISTS
 * The Cleaner dashboard and the Landlord dashboard are not two systems that
 * sync. They are two views of ONE booking, joined by `bookingId` and told apart
 * by `participantRole`. This module owns that record and the pure functions
 * over it, so a second consumer (the Landlord view) renders from the same
 * source instead of a parallel copy.
 *
 * HOW TO CONNECT IT TO THE LIVE PRODUCT
 * Every export below mirrors the signature already shipping in the repo:
 *   public/booking-summary-model.js   — statuses, buckets, actions, money
 *   public/landlord-dashboard-model.js — request statuses, task/room parsing
 *   public/active-job-model.js         — the live job: stages, actions, photos,
 *                                        progress, disputes, review view
 * So the swap is an import change, not a rewrite:
 *   - replace MOCK_BOOKINGS with `list_my_booking_summaries`
 *   - re-point the pure functions at ./booking-summary-model.js
 * The status strings, label maps and money wording here are copied from that
 * source verbatim so the two cannot drift.
 */

/* ---------------------------------------------------------------------------
 * Statuses — the real machine. Do not invent stages.
 * request:  draft → searching-for-cleaner → cleaner-invited →
 *           pending-cleaner-acceptance → matched | cancelled
 * booking:  pending-cleaner-acceptance → confirmed → cleaner-en-route →
 *           cleaner-arrived → cleaning-in-progress → awaiting-review →
 *           completed | cancelled | disputed
 * ------------------------------------------------------------------------- */

export const bookingSummaryStatusLabels = Object.freeze({
  "pending-cleaner-acceptance": "Awaiting Cleaner response",
  confirmed: "Confirmed",
  "cleaner-en-route": "Cleaner en route",
  "cleaner-arrived": "Cleaner arrived",
  "cleaning-in-progress": "Cleaning in progress",
  "awaiting-review": "Awaiting review",
  completed: "Completed",
  cancelled: "Cancelled",
  disputed: "Under review"
});

export const requestStatusLabels = Object.freeze({
  draft: "Draft — scan not submitted",
  "searching-for-cleaner": "Searching for Cleaner",
  "cleaner-invited": "Cleaner invited",
  "pending-cleaner-acceptance": "Waiting for Cleaner",
  matched: "Matched",
  cancelled: "Cancelled"
});

/* The three statuses a Cleaner moves through on the day. These are the only
 * transitions the Cleaner dashboard triggers itself; everything after
 * awaiting-review belongs to the Landlord. */
export const CLEANER_PROGRESS = Object.freeze([
  "confirmed",
  "cleaner-en-route",
  "cleaner-arrived",
  "cleaning-in-progress",
  "awaiting-review"
]);

const activeStatuses = new Set(["cleaner-en-route", "cleaner-arrived", "cleaning-in-progress"]);
const upcomingStatuses = new Set(["confirmed"]);
const historyStatuses = new Set(["awaiting-review", "completed", "cancelled", "disputed"]);
const cleanerAcceptedStatuses = new Set([
  "confirmed", "cleaner-en-route", "cleaner-arrived",
  "cleaning-in-progress", "awaiting-review", "completed", "disputed"
]);

/* ---------------------------------------------------------------------------
 * Invitations
 * ------------------------------------------------------------------------- */

export function bookingInvitationDeadlineState(booking, now = Date.now()) {
  if (booking?.status !== "pending-cleaner-acceptance") return Object.freeze({ kind: "closed", remainingMs: 0 });
  const deadline = Date.parse(booking.responseDeadline || "");
  if (!Number.isFinite(deadline)) return Object.freeze({ kind: "unavailable", remainingMs: 0 });
  const remainingMs = deadline - now;
  if (remainingMs <= 0) return Object.freeze({ kind: "expired", remainingMs: 0 });
  return Object.freeze({ kind: remainingMs <= 60 * 60_000 ? "urgent" : "open", remainingMs });
}

export function cleanerInvitationDeadlineState(booking, now = Date.now()) {
  if (booking?.canRespond !== true) return Object.freeze({ kind: "closed", remainingMs: 0 });
  return bookingInvitationDeadlineState(booking, now);
}

export function formatInvitationTimeRemaining(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value <= 0) return "less than 1 minute";
  const minutes = Math.max(1, Math.ceil(value / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"}${remainder ? ` ${remainder} min` : ""}`;
}

/* The race the Cleaner dashboard must handle: acting on an invitation the
 * Landlord has already resolved. */
export function cleanerInvitationDecisionState(booking, decision, now = Date.now()) {
  const status = String(booking?.status || "");
  if (["open", "urgent"].includes(cleanerInvitationDeadlineState(booking, now).kind)) return "pending";
  if (decision === "accept" && cleanerAcceptedStatuses.has(status)) return "recorded";
  if (decision === "decline" && status === "cancelled") return "recorded";
  return "different-outcome";
}

/* ---------------------------------------------------------------------------
 * Role-aware views over the shared record
 * ------------------------------------------------------------------------- */

export function bookingSummaryBuckets(bookings, role, now = Date.now()) {
  const records = Array.isArray(bookings) ? bookings.filter((b) => b?.participantRole === role) : [];
  const invitationOpen = (b) => ["open", "urgent"].includes(cleanerInvitationDeadlineState(b, now).kind);
  return Object.freeze({
    pending: Object.freeze(records.filter((b) => role === "cleaner" && invitationOpen(b))),
    waiting: Object.freeze(records.filter((b) => role === "landlord" && b.status === "pending-cleaner-acceptance")),
    active: Object.freeze(records.filter((b) => activeStatuses.has(b.status))),
    upcoming: Object.freeze(records.filter((b) => upcomingStatuses.has(b.status))),
    history: Object.freeze(records.filter((b) => historyStatuses.has(b.status)
      || (role === "cleaner" && b.status === "pending-cleaner-acceptance" && !invitationOpen(b))))
  });
}

export function bookingSummaryPrimaryAction(booking, role, now = Date.now()) {
  if (role === "cleaner" && ["open", "urgent"].includes(cleanerInvitationDeadlineState(booking, now).kind)) {
    return Object.freeze({ kind: "respond", label: "Review request" });
  }
  if (role === "landlord" && booking?.paymentStepAvailable === true) {
    return Object.freeze({ kind: "payment", label: "Authorize booking total" });
  }
  if (booking?.activeJobAvailable === true) {
    return Object.freeze({
      kind: "active-job",
      label: ["awaiting-review", "completed"].includes(booking.status) ? "View job record" : "Open active job"
    });
  }
  return Object.freeze({ kind: "none", label: "No action required" });
}

export function bookingSummaryPriceLabel(role) {
  return role === "cleaner" ? "Your agreed pay" : "Your booking total";
}

/* Prescribed wording. Never paraphrase: these lines are what keeps the product
 * from implying a payment that has not happened. */
export function bookingSummaryMoneyBoundary(booking, role) {
  if (role !== "cleaner" && role !== "landlord") throw new TypeError("Choose a booking participant role.");
  const status = String(booking?.status || "");
  if (role === "cleaner") {
    if (status === "pending-cleaner-acceptance") return "This is the offered Cleaner pay. Nothing is earned or transferred unless you accept and complete the booking.";
    if (status === "completed") return "This is completed job value, not proof of transfer. Payout evidence is verified separately.";
    if (status === "cancelled") return "This cancelled booking is not earned pay and is not proof of a transfer.";
    if (status === "disputed") return "This agreed pay is under review. It is not proof of a transfer.";
    return "This is your agreed Cleaner pay, not a payout receipt. Transfer status is verified separately after completion.";
  }
  if (status === "pending-cleaner-acceptance") return "This is the frozen booking total. No payment has been taken while the Cleaner decides.";
  if (status === "completed") return "This completed booking total is not a receipt or refund record. Final payment evidence is verified separately.";
  if (status === "cancelled") return "This cancelled booking total is not proof that a charge was made.";
  if (status === "disputed") return "This booking total is under review and is not proof of a final charge or refund.";
  if (booking?.paymentAuthorizationReady === true) return "This total is authorized for this booking. Authorization is not a completed charge or Cleaner payout.";
  if (booking?.paymentStepAvailable === true) return "This total still needs authorization. No charge or Cleaner payout has been completed.";
  if (booking?.paymentStepOpensAt) return "Authorization is not open yet. No payment action is required.";
  return "This is your agreed booking total. Final payment and payout evidence is verified separately.";
}

/* ---------------------------------------------------------------------------
 * The Cleaner dashboard's tile contract. These nine values are the whole
 * summary the product exposes — the dashboard should show these, not invent
 * its own metrics.
 * ------------------------------------------------------------------------- */

const safeCount = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const safeMoney = (v) => (Number.isInteger(v) && v > 0 ? v : 0);

export function cleanerDashboardSummary(profile, availability, bookings, payout) {
  if (!Array.isArray(availability) || !Array.isArray(bookings)) throw new TypeError("Cleaner dashboard records are unavailable.");
  const mine = bookings.filter((b) => b?.participantRole === "cleaner");
  const completed = mine.filter((b) => b.status === "completed");
  const committed = mine.filter((b) => cleanerAcceptedStatuses.has(b.status) && b.status !== "completed" && b.status !== "disputed");
  const reviewCount = safeCount(profile?.reviewCount);
  const averageRating = reviewCount > 0 && Number.isFinite(profile?.averageRating)
    && profile.averageRating >= 0 && profile.averageRating <= 5 ? profile.averageRating : 0;
  return Object.freeze({
    profileCompletionPercent: Number.isInteger(profile?.profileCompletionPercent)
      && profile.profileCompletionPercent >= 0 && profile.profileCompletionPercent <= 100 ? profile.profileCompletionPercent : 0,
    profilePublished: profile?.isPublic === true,
    availableWindowCount: availability.filter((w) => w?.status === "available").length,
    averageRating,
    reviewCount,
    completedJobCount: safeCount(profile?.completedJobCount),
    completedJobValuePence: completed.reduce((t, b) => t + safeMoney(b.pricePence), 0),
    committedJobValuePence: committed.reduce((t, b) => t + safeMoney(b.pricePence), 0),
    payoutState: payout == null ? "unavailable" : payout.ready === true ? "ready"
      : payout.status === "action-required" ? "action-required" : "not-started"
  });
}

/* Whether work can reach the Cleaner at all. If either gate is false, no
 * requests are dispatched — the most important thing a dashboard can say. */
export function cleanerMarketplaceCapabilityState(input = {}) {
  const checked = input.checked === true;
  const pricingReady = checked && input.pricingReady === true;
  const geocodingReady = checked && input.geocodingReady === true;
  let notice = null;
  if (!checked) {
    notice = Object.freeze({ key: "checking", title: "Matching status could not be checked",
      copy: "Your profile and availability remain saved. Refresh before relying on new cleaning-request availability." });
  } else if (!pricingReady) {
    notice = Object.freeze({ key: "private-pricing", title: "Cleaner matching prices are being connected",
      copy: "Your profile and availability remain saved. Homle will not send you new cleaning requests until the approved booking pricing checks are ready." });
  } else if (!geocodingReady) {
    notice = Object.freeze({ key: "postcode-geocoding", title: "Postcode distance matching is being connected",
      copy: "Your profile and availability remain saved. Homle will not send you distance-priced requests until service-area and property postcodes can be checked by real distance." });
  }
  return Object.freeze({ checked, pricingReady, geocodingReady, matchingReady: pricingReady && geocodingReady, notice });
}

/* ---------------------------------------------------------------------------
 * The live job — all of this is active-job-model.js, copied verbatim.
 * Note it labels the SAME statuses differently from bookingSummaryStatusLabels:
 * this file's are for the job screen both roles watch, the other's for the
 * booking lists. Use the right map for the surface.
 * ------------------------------------------------------------------------- */

export const activeJobStages = Object.freeze([
  "confirmed", "cleaner-en-route", "cleaner-arrived",
  "cleaning-in-progress", "awaiting-review", "completed"
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

export function activeJobStage(status) {
  const index = activeJobStages.indexOf(status);
  if (index >= 0) return index;
  return status === "cancelled" || status === "disputed" ? activeJobStages.length : 0;
}

/* The product's own action model. The finish gate is HERE — one condition,
 * every task resolved — with its own label for the unmet case. Do not invent
 * a parallel gate. `journeyReadiness` is a real precondition: a journey cannot
 * start until booking authorization has been checked. */
export function activeJobAction(role, tracking = {}, progress = {}, journeyReadiness = {}) {
  if (role !== "cleaner") return Object.freeze({ kind: "none", label: "Live booking updates", enabled: false });
  const candidates = [tracking.status, progress.status].filter(Boolean);
  const status = candidates.sort((left, right) => activeJobStage(right) - activeJobStage(left))[0] || "";
  if (status === "confirmed") {
    if (journeyReadiness.checked !== true) return Object.freeze({ kind: "journey-readiness", label: "Check booking authorization", enabled: true });
    if (journeyReadiness.canStartJourney !== true) return Object.freeze({ kind: "waiting-authorization", label: "Check booking authorization", enabled: true });
    return Object.freeze({ kind: "start-journey", label: "Start journey", enabled: true });
  }
  if (status === "cleaner-en-route") {
    if (tracking.sharingState !== "live") return Object.freeze({ kind: "resume-location", label: "Resume location sharing", enabled: true });
    return Object.freeze({ kind: "arrive", label: "I have arrived", enabled: true });
  }
  if (status === "cleaner-arrived") return Object.freeze({ kind: "start-cleaning", label: "Start cleaning", enabled: true });
  if (status === "cleaning-in-progress") {
    const resolved = Number(progress.resolvedTasks) || 0;
    const total = Number(progress.totalTasks) || 0;
    const ready = total > 0 && resolved === total;
    return Object.freeze({
      kind: "finish-cleaning",
      label: ready ? "Finish cleaning" : `Resolve ${Math.max(0, total - resolved)} task${total - resolved === 1 ? "" : "s"} first`,
      enabled: ready
    });
  }
  return Object.freeze({
    kind: "none",
    label: status === "awaiting-review" || status === "completed" ? "Cleaning complete" : "No action available",
    enabled: false
  });
}

export function progressSummary(progress = {}) {
  const total = Math.max(0, Number(progress.totalTasks) || 0);
  const completed = Math.min(total, Math.max(0, Number(progress.completedTasks) || 0));
  const resolved = Math.min(total, Math.max(0, Number(progress.resolvedTasks) || 0));
  const suppliedPercent = Number(progress.overallPercentage);
  const percentage = Number.isFinite(suppliedPercent)
    ? Math.min(100, Math.max(0, Math.round(suppliedPercent)))
    : total ? Math.round((resolved / total) * 100) : 0;
  return Object.freeze({ total, completed, resolved, percentage, unresolved: Math.max(0, total - resolved) });
}

/* Ticking is only possible while cleaning is in progress — the real rule, and
 * stricter than "lock it once finished". */
export function taskCanBeUpdated(role, status) {
  return role === "cleaner" && status === "cleaning-in-progress";
}

/* An unexpected task needs the Cleaner to confirm frozen terms, then the
 * Landlord to approve it. This is the real "job is bigger than described" flow. */
export function taskNeedsCleanerTermsConfirmation(role, status, task) {
  return role === "cleaner" && status === "cleaning-in-progress" && task?.unexpected === true
    && task?.cleanerFrozenTermsConfirmed !== true && task?.landlordApprovalStatus === "pending";
}

const jobPhotoStatuses = new Set(["cleaner-arrived", "cleaning-in-progress", "awaiting-review"]);

export function jobPhotoUploadAllowed(role, status, photoType = "after") {
  if (role !== "cleaner" || !jobPhotoStatuses.has(status) || !["before", "after", "issue"].includes(photoType)) return false;
  return !(photoType === "before" && status === "awaiting-review");
}

/* The real dispute categories — seven, not the eight the prototype invented. */
export const DISPUTE_CATEGORIES = Object.freeze(["quality", "damage", "access", "safety", "conduct", "payment", "other"]);

export function bookingDisputeView(status, dispute = null) {
  const disputable = new Set(["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "disputed"]);
  const visible = disputable.has(status) || dispute !== null;
  if (!visible) return Object.freeze({ visible: false, canOpen: false });
  return Object.freeze({ visible: true, canOpen: dispute === null && status !== "disputed", status: dispute?.status || null });
}

/* What the Cleaner sees after finishing, and after a review lands. */
export function bookingReviewView(role, status, review = null) {
  if (!["landlord", "cleaner"].includes(role) || !["awaiting-review", "completed"].includes(status)) return Object.freeze({ visible: false, mode: "hidden" });
  if (role === "landlord" && status === "awaiting-review") return Object.freeze({ visible: true, mode: "confirm-completion", title: "Confirm the finished clean", copy: "Check the completed tasks, notes and private photos before marking this booking complete." });
  if (role === "landlord" && !review) return Object.freeze({ visible: true, mode: "submit-review", title: "Rate this completed clean", copy: "Your rating is tied to this completed booking. Only an approved review affects the Cleaner’s public rating." });
  if (role === "landlord") return Object.freeze({ visible: true, mode: "submitted", title: "Review submitted", copy: review.moderationStatus === "approved" ? "This verified review is approved and contributes to the Cleaner’s public rating." : review.moderationStatus === "rejected" ? "This review is not public. Homle’s moderation note is shown below." : "This review is awaiting moderation and is not public yet." });
  if (status === "awaiting-review") return Object.freeze({ visible: true, mode: "waiting-for-completion", title: "Waiting for Landlord confirmation", copy: "Your completed checklist and evidence are ready for the Landlord to review." });
  if (!review) return Object.freeze({ visible: true, mode: "review-unavailable", title: "Review not available yet", copy: "A Landlord review appears here only after it has been approved. No private moderation details are shown." });
  if (!review.cleanerResponse) return Object.freeze({ visible: true, mode: "respond", title: "Your approved review", copy: "You may add one professional public response. It cannot be edited after submission." });
  return Object.freeze({ visible: true, mode: "responded", title: "Your approved review", copy: "Your one professional response has been published with this review." });
}

export function activeJobMessagingOpen(status) {
  return new Set(["pending-cleaner-acceptance", "confirmed", "cleaner-en-route", "cleaner-arrived",
    "cleaning-in-progress", "awaiting-review", "completed", "disputed"]).has(status);
}

export function elapsedLabel(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/* ---------------------------------------------------------------------------
 * Formatting — Europe/London, matching the live product
 * ------------------------------------------------------------------------- */

export function formatBookingMoney(pence) {
  if (!Number.isInteger(pence) || pence < 1 || pence > 10_000_000) return "Price unavailable";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

export function formatBookingWindow(startValue, endValue) {
  const start = new Date(startValue || "");
  const end = new Date(endValue || "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return "Schedule unavailable";
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }).format(start);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  return `${date}, ${time.format(start)}–${time.format(end)}`;
}

/* Rooms are inferred from the Landlord's task lines exactly as the request
 * model does it, so the Cleaner's checklist groups the way the client wrote it. */
const naturalTaskRooms = Object.freeze([
  ["Kitchen", /\bkitchen\b/i],
  ["Bathroom", /\bbathroom\b|\bshower room\b|\ben[ -]?suite\b|\btoilet\b|\bwc\b/i],
  ["Bedroom", /\bbed ?room\b/i],
  ["Living Room", /\bliving room\b|\blounge\b|\bsitting room\b/i],
  ["Hallway", /\bhallway\b|\bcorridor\b|\blanding\b|\bentrance hall\b/i]
]);

export function inferredTaskRoom(description, fallbackRoomName = "Other") {
  return naturalTaskRooms.find(([, pattern]) => pattern.test(description))?.[0]
    || String(fallbackRoomName || "Other").trim().slice(0, 120) || "Other";
}

/* Group flat {roomName, description} tasks into the Cleaner's room cards. */
export function tasksByRoom(tasks) {
  const grouped = new Map();
  (Array.isArray(tasks) ? tasks : []).forEach((task, index) => {
    const roomName = String(task?.roomName || "").trim() || inferredTaskRoom(task?.description);
    if (!grouped.has(roomName)) grouped.set(roomName, { roomName, items: [] });
    grouped.get(roomName).items.push({ id: `${roomName}-${index}`, description: String(task?.description || "").trim() });
  });
  return [...grouped.values()];
}

/* ---------------------------------------------------------------------------
 * Example data — the ONLY part to throw away when connecting.
 * Shaped exactly like `list_my_booking_summaries` so the swap is one line.
 * One shared scenario: the same three bookings the Landlord view would show
 * with participantRole "landlord".
 * ------------------------------------------------------------------------- */

const HOUR = 60 * 60_000;

export function mockBookings(now = Date.now()) {
  return [
    {
      bookingId: "bk_ls6_deep",
      participantRole: "cleaner",
      counterpartyName: "J. Whitfield",
      status: "confirmed",
      scheduledStartAt: new Date(now + 18 * HOUR).toISOString(),
      scheduledEndAt: new Date(now + 21.5 * HOUR).toISOString(),
      pricePence: 6800,
      outwardPostcode: "LS6",
      cleaningType: "deep-cleans",
      serviceLabel: "Deep clean · 3 bed house",
      travelMiles: 2.4,
      canRespond: false,
      activeJobAvailable: true,
      tasks: [
        { roomName: "Kitchen", description: "Clean inside the oven and remove baked-on grease" },
        { roomName: "Kitchen", description: "Descale the sink and taps" },
        { roomName: "Kitchen", description: "Wipe cupboard fronts and clean inside the fridge" },
        { roomName: "Bathroom", description: "Remove limescale from the shower screen and tiles" },
        { roomName: "Bathroom", description: "Clean and disinfect the toilet, basin and bath" },
        { roomName: "Bedroom", description: "Vacuum the carpet including under the bed" },
        { roomName: "Bedroom", description: "Dust the skirting boards and window sills" },
        { roomName: "Living Room", description: "Vacuum the sofa and clean beneath the cushions" },
        { roomName: "Living Room", description: "Clean the inside of the windows" },
        { roomName: "Hallway", description: "Mop the floor and wipe the front door and frame" }
      ],
      supplementalNote: "Key is in the lockbox by the bin store, code on your booking."
    },
    {
      bookingId: "bk_ls1_regular",
      participantRole: "cleaner",
      counterpartyName: "A. Bello",
      status: "pending-cleaner-acceptance",
      responseDeadline: new Date(now + 2.25 * HOUR).toISOString(),
      scheduledStartAt: new Date(now + 3 * 24 * HOUR).toISOString(),
      scheduledEndAt: new Date(now + 3 * 24 * HOUR + 2 * HOUR).toISOString(),
      pricePence: 3600,
      outwardPostcode: "LS1",
      cleaningType: "regular-domestic",
      serviceLabel: "Regular clean · 2 bed flat",
      travelMiles: 4.1,
      canRespond: true,
      activeJobAvailable: false,
      tasks: [
        { roomName: "Kitchen", description: "Wipe the worktops and clean the hob" },
        { roomName: "Bathroom", description: "Clean the shower, basin and toilet" },
        { roomName: "Living Room", description: "Vacuum and dust the surfaces" }
      ],
      supplementalNote: ""
    },
    {
      bookingId: "bk_ls2_tenancy",
      participantRole: "cleaner",
      counterpartyName: "Ridgeway Lettings",
      status: "pending-cleaner-acceptance",
      responseDeadline: new Date(now + 0.6 * HOUR).toISOString(),
      scheduledStartAt: new Date(now + 5 * 24 * HOUR).toISOString(),
      scheduledEndAt: new Date(now + 5 * 24 * HOUR + 5 * HOUR).toISOString(),
      pricePence: 9500,
      outwardPostcode: "LS2",
      cleaningType: "end-of-tenancy",
      serviceLabel: "End of tenancy",
      travelMiles: 6.8,
      canRespond: true,
      activeJobAvailable: false,
      tasks: [
        { roomName: "Kitchen", description: "Clean inside the oven, fridge and freezer" },
        { roomName: "Kitchen", description: "Clean inside all cupboards" },
        { roomName: "Bathroom", description: "Treat mould around the shower seals" },
        { roomName: "Bedroom", description: "Steam clean the carpet in both bedrooms" },
        { roomName: "Hallway", description: "Clean the interior windows throughout" }
      ],
      supplementalNote: "Property is empty. Parking on the street is free after 18:00."
    }
  ];
}

export const MOCK_PROFILE = Object.freeze({
  displayName: "Amara Nwosu",
  profileCompletionPercent: 62,
  isPublic: false,
  reviewCount: 0,
  averageRating: 0,
  completedJobCount: 0
});

export const MOCK_AVAILABILITY = Object.freeze([
  { windowId: "w1", status: "available" },
  { windowId: "w2", status: "available" },
  { windowId: "w3", status: "available" },
  { windowId: "w4", status: "booked" }
]);

export const MOCK_PAYOUT = Object.freeze({ ready: false, status: "not-started" });

export const MOCK_CAPABILITY = Object.freeze({ checked: true, pricingReady: true, geocodingReady: true });
