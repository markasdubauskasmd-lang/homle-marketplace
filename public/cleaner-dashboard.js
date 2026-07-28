import { bookingSummaryBuckets, bookingSummaryMoneyBoundary, bookingSummaryPrimaryAction, bookingSummaryPriceLabel, bookingSummaryStatusLabels, cleanerDashboardSummary, cleanerInvitationDeadlineState, cleanerInvitationDecisionState, cleanerMarketplaceCapabilityState, formatBookingMoment, formatBookingMoney, formatBookingWindow, formatInvitationTimeRemaining } from "./booking-summary-model.js?v=20260723-3";
import { applicationStatusLabel, onboardingIcons, onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260728-1";
import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";
import { storedCsrf } from "./session-csrf.js";

const gate = document.querySelector("[data-cleaner-dashboard-gate]");
const dashboard = document.querySelector("[data-cleaner-dashboard]");
const retry = document.querySelector("[data-cleaner-retry]");
const signIn = document.querySelector("[data-cleaner-sign-in]");
const workspaceLink = document.querySelector("[data-cleaner-workspace-link]");
const feedback = document.querySelector("[data-cleaner-dashboard-feedback]");
const declineDialog = document.querySelector("[data-decline-dialog]");
const declineForm = document.querySelector("[data-decline-form]");
const declineCancel = document.querySelector("[data-decline-cancel]");
const networkStatus = document.querySelector("[data-cleaner-network-status]");
let accountRecord = null;
let bookings = [];
let selectedDeclineBookingId = "";
let loading = false;
let responding = false;
let payoutStatus = null;
let availabilityWindows = [];
let cleanerProfile = null;
let marketplaceCapabilities = cleanerMarketplaceCapabilityState();
let invitationDeadlineTimer = null;
let refreshingExpiredInvitations = false;
let expiredInvitationRefreshNeeded = false;

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());


function saveCsrf(token) {
  try { sessionStorage.setItem("tideway_csrf", token); return true; } catch { return false; }
}

function browserOffline() {
  return navigator.onLine === false;
}

function updateNetworkStatus() {
  networkStatus.hidden = !browserOffline();
}

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function showGate(title, copy, { kind = "info", allowSignIn = false, allowRetry = false, workspaceDestination = "", workspaceLabel = "" } = {}) {
  gate.hidden = false;
  gate.dataset.kind = kind;
  document.querySelector("[data-cleaner-gate-title]").textContent = title;
  document.querySelector("[data-cleaner-gate-copy]").textContent = copy;
  signIn.hidden = !allowSignIn;
  retry.hidden = !allowRetry;
  workspaceLink.hidden = !workspaceDestination;
  if (workspaceDestination) {
    workspaceLink.href = workspaceDestination;
    workspaceLink.textContent = `Open ${workspaceLabel} dashboard`;
  }
  dashboard.hidden = true;
}

function showFeedback(message, kind = "info") {
  feedback.hidden = !message;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
  feedback.focus?.();
}

function showPayoutSetupRequired(message) {
  const copy = element("span", "", message);
  const link = element("a", "button button-outline", "Set up payouts");
  link.href = "/cleaner/payouts";
  feedback.hidden = false;
  feedback.dataset.kind = "error";
  feedback.replaceChildren(copy, link);
  feedback.focus?.();
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const mutation = String(rest.method || "GET").toUpperCase() !== "GET";
  if (browserOffline()) throw Object.assign(new Error(mutation ? "You are offline. This decision was not sent; reconnect before trying again." : "You are offline. Reconnect to refresh the Cleaner dashboard."), { code: "browser-offline", uncertain: false });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, signal: controller.signal, headers: { Accept: "application/json", ...headers } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || "The Cleaner dashboard could not be updated."), { statusCode: response.status, code: result.code, uncertain: false });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error(mutation ? "The connection took too long. This decision may have reached Homle; its current status must be checked before trying again." : "The dashboard took too long to load. Check the connection and try again."), { code: "request-timeout", uncertain: mutation });
    if (browserOffline()) throw Object.assign(new Error(mutation ? "The connection was lost. This decision may have reached Homle; reconnect so its current status can be checked before trying again." : "The connection was lost. Reconnect to refresh the Cleaner dashboard."), { code: "browser-offline", uncertain: mutation });
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function recoverCsrf() {
  const current = storedCsrf();
  if (current) return current;
  try {
    const result = await requestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!result.csrfToken || !saveCsrf(result.csrfToken)) throw new Error("The secure editing token could not be stored in this browser.");
    return result.csrfToken;
  } catch (error) {
    if (error.code === "browser-offline") showFeedback("You are offline. No request decision was sent. Reconnect, then try again.", "error");
    else if (error.code === "request-timeout") showFeedback("The secure session refresh took too long. No request decision was sent. Refresh the dashboard, then try again.", "error");
    else showFeedback("Your secure session could not be recovered. Sign in again before answering this request.", "error");
    return "";
  }
}

function bookingFacts(booking) {
  const facts = element("dl", "booking-summary-facts");
  const values = [
    ["When", formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt)],
    ["Area", booking.propertyArea || "Shared after confirmation"],
    ["Checklist", `${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`]
  ];
  for (const [label, value] of values) {
    const wrapper = element("div");
    wrapper.append(element("dt", "", label), element("dd", "", value));
    facts.append(wrapper);
  }
  return facts;
}

function updateInvitationDeadlineCard(card, booking) {
  const state = cleanerInvitationDeadlineState(booking);
  const deadline = card.querySelector("[data-response-deadline]");
  const accept = card.querySelector('[data-invitation-decision="accept"]');
  const decline = card.querySelector('[data-invitation-decision="decline"]');
  const boundary = card.querySelector("[data-invitation-scope-boundary]");
  card.dataset.deadlineState = state.kind;
  if (deadline) {
    deadline.dataset.kind = state.kind;
    deadline.textContent = state.kind === "expired"
      ? "Offer window ended. Checking the current request status…"
      : state.kind === "unavailable"
        ? "Response deadline unavailable. Do not accept this request."
        : state.kind === "closed"
          ? "This offer is no longer open for a response."
          : `Respond within ${formatInvitationTimeRemaining(state.remainingMs)} · by ${formatBookingMoment(booking.responseDeadline)}`;
  }
  const responseOpen = ["open", "urgent"].includes(state.kind);
  if (accept) accept.disabled = !responseOpen || accept.dataset.checklistReady !== "true";
  if (decline) decline.disabled = !responseOpen;
  if (!responseOpen && boundary) boundary.textContent = state.kind === "expired"
    ? "The response window has ended. Homle will refresh this read-only status; no accept or decline decision will be sent."
    : "This invitation cannot be answered safely. Refresh the dashboard before taking another action.";
  return state;
}

async function refreshExpiredInvitations() {
  if (refreshingExpiredInvitations || !expiredInvitationRefreshNeeded || browserOffline()) return;
  refreshingExpiredInvitations = true;
  showFeedback("An offer window ended. Homle is checking the current status without sending a decision.");
  try {
    await refreshBookings();
    expiredInvitationRefreshNeeded = false;
    showFeedback("Offer status refreshed. No expired accept or decline decision was sent.", "success");
  } catch {
    showFeedback("The offer window ended, but Homle could not refresh its server status. The decision buttons remain locked; reconnect and refresh before taking another action.", "error");
  } finally {
    refreshingExpiredInvitations = false;
  }
}

function updateInvitationDeadlines() {
  window.clearTimeout(invitationDeadlineTimer);
  invitationDeadlineTimer = null;
  let nextUpdateMs = Number.POSITIVE_INFINITY;
  let expired = false;
  for (const card of document.querySelectorAll("[data-invitation-booking-id]")) {
    const booking = bookings.find((record) => record.bookingId === card.dataset.invitationBookingId);
    if (!booking) continue;
    const state = updateInvitationDeadlineCard(card, booking);
    if (state.kind === "expired") expired = true;
    else if (["open", "urgent"].includes(state.kind)) nextUpdateMs = Math.min(nextUpdateMs, state.remainingMs, 60_000);
  }
  if (expired) {
    expiredInvitationRefreshNeeded = true;
    queueMicrotask(refreshExpiredInvitations);
    return;
  }
  if (Number.isFinite(nextUpdateMs)) invitationDeadlineTimer = window.setTimeout(updateInvitationDeadlines, Math.max(1_000, nextUpdateMs + 250));
}

function requestScanPreview(booking, pending = false, onReady = () => {}) {
  const details = element("details", "hc-scan");
  details.append(element("summary", "", pending ? "Approved room checklist" : "View private room scan"));
  const body = element("div", "hc-scan-body");
  body.append(element("p", "", "Loading the Landlord-approved room checklist…"));
  details.append(body);
  let loaded = false;
  let loadingScan = false;
  async function loadScan() {
    if (loaded || loadingScan) return;
    loadingScan = true;
    try {
      const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(booking.cleaningRequestId)}/scan`);
      const tasks = Array.isArray(result.scan?.tasks) ? result.scan.tasks : [];
      const photos = Array.isArray(result.scan?.photos) ? result.scan.photos : [];
      if (!tasks.length) throw new Error("The approved room checklist is unavailable. Do not accept this request yet.");
      body.replaceChildren(element("p", "cleaner-scan-privacy", "Only room labels, work notes and approved photos are shown here. The Landlord’s identity, exact address and access details remain hidden until confirmation."));
      const taskHeading = element("h4", "", "Cleaner checklist");
      const taskList = element("div", "cleaner-request-task-list");
      const rooms = new Map();
      for (const task of tasks) {
        const roomName = String(task.roomName || "Room");
        if (!rooms.has(roomName)) rooms.set(roomName, []);
        rooms.get(roomName).push(String(task.description || ""));
      }
      for (const [roomName, roomTasks] of rooms) {
        const room = element("section", "cleaner-request-task-room");
        room.append(element("strong", "", roomName));
        const list = element("ul");
        roomTasks.filter(Boolean).forEach((task) => list.append(element("li", "", task)));
        room.append(list);
        taskList.append(room);
      }
      body.append(taskHeading, taskList);
      const photoHeading = element("h4", "", "Room photos");
      const list = element("ul", "cleaner-request-scan-list");
      for (const photo of photos) {
        const item = element("li");
        const copy = element("div");
        copy.append(element("strong", "", photo.roomName), element("span", "", photo.note || "See the confirmed room checklist for cleaning instructions."));
        const view = element("button", "button button-outline", "View private photo");
        view.type = "button";
        view.addEventListener("click", async () => {
          const privateWindow = window.open("about:blank", "_blank");
          if (privateWindow) privateWindow.opener = null;
          view.disabled = true;
          try {
            if (!privateWindow) throw new Error("Allow this site to open the private photo viewer, then try again.");
            const access = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(booking.cleaningRequestId)}/photos/${encodeURIComponent(photo.photoId)}/access`);
            const url = new URL(access.photo?.url || "");
            if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("The private photo link was unsafe.");
            privateWindow.location.replace(url.toString());
          } catch (error) { privateWindow?.close(); showFeedback(error.message, "error"); }
          finally { view.disabled = false; }
        });
        item.append(copy, view);
        list.append(item);
      }
      body.append(photoHeading, photos.length ? list : element("p", "cleaner-scan-photo-boundary", result.scan?.cleanerPreviewAuthorized === true ? "No approved room photos are attached." : "The Landlord kept photos private until a Cleaner accepts. The exact approved checklist above is still the scope you are deciding on."));
      loaded = true;
      onReady({ taskCount: tasks.length, roomCount: rooms.size });
    } catch (error) {
      body.replaceChildren(element("p", "cleaner-scan-privacy", error.statusCode === 404 ? "The approved checklist is no longer available to this invitation. Do not accept; refresh the dashboard to check its current status." : error.message || "The approved room checklist could not be opened. Try again before accepting."));
      const retryScope = element("button", "button button-outline", "Try checklist again");
      retryScope.type = "button";
      retryScope.addEventListener("click", loadScan);
      body.append(retryScope);
    } finally {
      loadingScan = false;
    }
  }
  details.addEventListener("toggle", () => { if (details.open) loadScan(); });
  if (pending) {
    details.open = true;
    queueMicrotask(loadScan);
  }
  return details;
}

const londonDayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });
const londonDateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric" });
const londonTimeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });

function jobDateBadge(booking) {
  const badge = element("div", "hc-job-date");
  const start = booking.scheduledStartAt ? new Date(booking.scheduledStartAt) : null;
  const valid = start && Number.isFinite(start.getTime());
  badge.append(
    element("span", "hc-job-day", valid ? londonDayFormat.format(start).toUpperCase() : "TBC"),
    element("span", "hc-job-dnum", valid ? londonDateFormat.format(start) : "—")
  );
  return badge;
}

function jobSlotLabel(booking) {
  const start = booking.scheduledStartAt ? new Date(booking.scheduledStartAt) : null;
  const end = booking.scheduledEndAt ? new Date(booking.scheduledEndAt) : null;
  if (!start || !Number.isFinite(start.getTime())) return "Time to be confirmed";
  const from = londonTimeFormat.format(start);
  return end && Number.isFinite(end.getTime()) ? `${from}–${londonTimeFormat.format(end)}` : from;
}

// Mirrors the supplied design's job card: date badge, title/address, three chips,
// right-aligned pay, a notes panel, then the decision row with the live expiry.
function bookingCard(booking, pending = false) {
  const card = element("article", "hc-job");
  const top = element("div", "hc-job-top");
  const invitationState = cleanerInvitationDeadlineState(booking);
  const statusLabel = booking.status === "pending-cleaner-acceptance" && !["open", "urgent"].includes(invitationState.kind)
    ? invitationState.kind === "expired" ? "Offer window ended" : "Offer closed"
    : bookingSummaryStatusLabels[booking.status] || "Booking";

  const head = element("div", "hc-job-head");
  const title = element("a", "hc-job-title", booking.cleaningType || "Cleaning");
  title.href = `/cleaner/jobs/${booking.bookingId}`;
  head.append(title, element("p", "hc-job-addr", `${booking.propertyArea || "Area shared after confirmation"} · ${booking.counterpartyName || "Landlord"}`));
  const chips = element("div", "hc-job-chips");
  chips.append(
    element("span", "hc-chip hc-chip-slot", jobSlotLabel(booking)),
    element("span", "hc-chip", `${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`),
    element("span", "hc-chip", statusLabel)
  );
  head.append(chips);

  const pay = element("div", "hc-job-pay");
  pay.append(
    element("div", "hc-job-pay-amount", formatBookingMoney(booking.pricePence)),
    element("div", "hc-job-pay-sub", bookingSummaryPriceLabel("cleaner"))
  );

  top.append(jobDateBadge(booking), head, pay);
  card.append(top);

  const notes = element("div", "hc-job-notes");
  notes.append(element("b", "", "Homle note: "), document.createTextNode(bookingSummaryMoneyBoundary(booking, "cleaner")));
  card.append(notes);

  if (pending) {
    card.dataset.invitationBookingId = booking.bookingId;
    const foot = element("div", "hc-job-foot");
    const accept = element("button", "hc-btn", "Loading checklist…");
    accept.type = "button";
    accept.disabled = true;
    accept.dataset.invitationDecision = "accept";
    accept.dataset.checklistReady = "false";
    const decline = element("button", "hc-btn-outline", "Decline");
    decline.type = "button";
    decline.dataset.invitationDecision = "decline";
    accept.addEventListener("click", () => acceptBooking(booking, accept));
    decline.addEventListener("click", () => openDecline(booking));
    const deadline = element("span", "hc-job-expiry");
    deadline.dataset.responseDeadline = "";
    deadline.setAttribute("role", "status");
    const scopeBoundary = element("p", "hc-job-boundary", "Acceptance unlocks after the exact room checklist loads. Then one tap confirms this time, scope and pay; Homle rechecks overlaps before confirming.");
    scopeBoundary.dataset.invitationScopeBoundary = "";
    if (booking.cleaningRequestId) card.append(requestScanPreview(booking, true, ({ taskCount, roomCount }) => {
      accept.dataset.checklistReady = "true";
      accept.textContent = `Accept ${formatBookingMoney(booking.pricePence)} job ↗`;
      scopeBoundary.textContent = `${taskCount} approved ${taskCount === 1 ? "task" : "tasks"} across ${roomCount} ${roomCount === 1 ? "room" : "rooms"}. One tap confirms this exact time, scope and pay; Homle rechecks overlaps before confirming.`;
      updateInvitationDeadlineCard(card, booking);
    }));
    else scopeBoundary.textContent = "The exact room checklist is unavailable. Do not accept this request; refresh the dashboard to verify its status.";
    foot.append(accept, decline, deadline, scopeBoundary);
    card.append(foot);
    updateInvitationDeadlineCard(card, booking);
  } else {
    const foot = element("div", "hc-job-foot");
    const action = bookingSummaryPrimaryAction(booking, "cleaner");
    if (action.kind === "active-job") {
      const link = element("a", "hc-job-accepted", `${action.label} →`);
      link.href = `/bookings/${booking.bookingId}`;
      foot.append(link);
    }
    const details = element("a", "hc-job-link", "View details →");
    details.href = `/cleaner/jobs/${booking.bookingId}`;
    foot.append(details);
    card.append(foot);
    if (booking.cleaningRequestId && booking.status !== "pending-cleaner-acceptance" && !["cancelled", "expired"].includes(booking.status)) card.append(requestScanPreview(booking));
  }
  return card;
}

function renderList(targetSelector, emptySelector, records, pending = false) {
  const target = document.querySelector(targetSelector);
  target.replaceChildren(...records.map((booking) => bookingCard(booking, pending)));
  target.hidden = records.length === 0;
  document.querySelector(emptySelector).hidden = records.length > 0;
}

function renderBookings() {
  const buckets = bookingSummaryBuckets(bookings, "cleaner");
  const jobs = [...buckets.active, ...buckets.upcoming];
  renderList("[data-cleaner-pending-list]", "[data-cleaner-pending-empty]", buckets.pending, true);
  renderList("[data-cleaner-job-list]", "[data-cleaner-job-empty]", jobs);
  renderList("[data-cleaner-history-list]", "[data-cleaner-history-empty]", buckets.history);
  document.querySelector("[data-cleaner-pending-count]").textContent = String(buckets.pending.length);
  document.querySelector("[data-cleaner-active-count]").textContent = String(buckets.active.length);
  document.querySelector("[data-cleaner-upcoming-count]").textContent = String(buckets.upcoming.length);
  document.querySelector("[data-cleaner-history-count]").textContent = String(buckets.history.length);
  renderWorkOverview(cleanerDashboardSummary(cleanerProfile, availabilityWindows, bookings, payoutStatus), marketplaceCapabilities, buckets);
  renderNextAction(buckets, cleanerProfile, payoutStatus, availabilityWindows, marketplaceCapabilities);
  updateInvitationDeadlines();
}

function dashboardMoney(pence) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function stepIcon(name) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", onboardingIcons[name] || onboardingIcons.folder);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.7");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "17");
  svg.setAttribute("height", "17");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.append(path);
  return svg;
}

// The design's onboarding strip and sidebar sub-nav, driven by the step list transcribed
// from its own STEPS/TITLES tables. A step Homle cannot record shows as outstanding — it
// is never ticked to flatter the progress bar.
function renderSetupSteps(progress) {
  const chipHost = document.querySelector("[data-cleaner-steps]");
  if (chipHost) chipHost.replaceChildren(...progress.steps.map((step) => {
    const chip = element(step.href ? "a" : "span", "hc-step", `${step.done ? "✓" : "○"} ${step.title}`);
    if (step.href) chip.href = step.href;
    chip.dataset.done = String(step.done);
    if (!step.tracked) chip.title = "Homle does not record this step yet.";
    return chip;
  }));

  const navHost = document.querySelector("[data-onboarding-nav]");
  if (navHost) navHost.replaceChildren(...progress.steps.filter((step) => step.sidebar).map((step) => {
    const item = element(step.href ? "a" : "span", "hc-nav-item hc-nav-sub");
    if (step.href) item.href = step.href;
    else item.setAttribute("aria-disabled", "true");
    item.append(stepIcon(step.icon), element("span", "hc-nav-label", step.title));
    if (step.done) item.append(element("span", "hc-nav-tick", "✓"));
    else if (!step.tracked) item.append(element("span", "hc-nav-dot"));
    return item;
  }));

  // The phone mock's four rows track the first four steps, matching the design.
  const rowHost = document.querySelector("[data-cleaner-phone-rows]");
  if (rowHost) rowHost.replaceChildren(...progress.steps.slice(0, 4).map((step) => {
    const row = element("div", "hc-phone-row");
    row.append(
      element("span", `hc-phone-tick${step.done ? "" : " hc-phone-tick-empty"}`, step.done ? "✓" : ""),
      element("span", `hc-phone-bar${step.done ? "" : " hc-phone-bar-empty"}`)
    );
    return row;
  }));

  setText("[data-cleaner-steps-left]", String(progress.remaining));

  // Do not turn the design into unsupported verification claims. These checks are
  // recorded separately and their status appears only after Homle has evidence.
  const checkHost = document.querySelector("[data-cleaner-check-chips]");
  if (checkHost) {
    const chip = element("span", "hc-setup-chip");
    chip.append(document.createTextNode("Identity and background checks "), element("i", "", "·"), document.createTextNode(" status appears only after Homle records it"));
    checkHost.replaceChildren(chip);
  }
}

function renderAlerts(summary, buckets) {
  const host = document.querySelector("[data-cleaner-alerts]");
  if (!host) return;
  const alerts = [];
  if (summary.profileCompletionPercent < 100) alerts.push(["red", "Your profile is not complete", "Finish it so suitable requests can reach you.", "Complete →", "/cleaner/profile"]);
  if (summary.availableWindowCount === 0) alerts.push(["amber", "No future availability saved", "Add exact windows or Homle cannot match you.", "Add →", "/cleaner/availability"]);
  if (summary.payoutState === "action-required") alerts.push(["amber", "Payout setup is unfinished", "Complete the secure form to receive transfers.", "Continue →", "/cleaner/payouts"]);
  if (summary.payoutState === "not-started") alerts.push(["amber", "Payout account not set up", "Set it up before your first completed job.", "Set up →", "/cleaner/payouts"]);
  if (buckets.pending.length > 0) alerts.push(["red", `${buckets.pending.length} offer${buckets.pending.length === 1 ? "" : "s"} awaiting your reply`, "Offers close automatically when the window ends.", "Review →", "#"]);
  if (summary.profilePublished) alerts.push(["green", "Your public profile is live", "Landlords can find you in the Homle directory.", "", ""]);
  if (!alerts.length) alerts.push(["green", "Nothing needs your attention", "You are set up and ready for suitable requests.", "", ""]);

  host.replaceChildren(...alerts.map(([tone, title, sub, linkLabel, href]) => {
    const row = element("div", `hc-alert hc-alert-${tone}`);
    row.append(element("span", `hc-alert-dot hc-alert-dot-${tone}`));
    const body = element("div", "hc-alert-body");
    body.append(element("div", "hc-alert-title", title), element("div", "hc-alert-sub", sub));
    row.append(body);
    if (linkLabel && href) {
      const link = element("a", "hc-alert-link", linkLabel);
      link.href = href;
      row.append(link);
    }
    return row;
  }));
}

function renderMessages() {
  const host = document.querySelector("[data-cleaner-messages]");
  if (!host) return;
  // Platform-to-Cleaner messaging does not exist; the private inbox does. This points at
  // the real inbox rather than rendering sample messages from an onboarding team.
  const row = element("div", "hc-msg");
  row.append(element("div", "hc-msg-avatar", "H"));
  const body = element("div", "hc-msg-body");
  body.append(
    element("div", "hc-msg-text", "Booking updates arrive in your private inbox."),
    element("div", "hc-msg-meta", "Homle · open Messages to read them")
  );
  row.append(body);
  host.replaceChildren(row);
}

function renderWorkOverview(summary, capabilities, buckets) {
  // Progress follows the design's 18-step onboarding model, not the server's
  // profile-completion percentage — the two count different things.
  const progress = onboardingProgress({
    account: accountRecord,
    profile: cleanerProfile,
    payoutState: summary.payoutState,
    availabilityCount: summary.availableWindowCount
  });
  const percent = progress.percent;
  setText("[data-cleaner-profile-progress]", `${percent}%`);
  // The bars are presentational; the percentage text stays the accessible value. Width is
  // set through CSSOM rather than a style attribute so `style-src 'self'` still holds.
  const progressTrack = document.querySelector("[data-cleaner-progress-track]");
  const progressFill = document.querySelector("[data-cleaner-progress-fill]");
  const phoneFill = document.querySelector("[data-cleaner-phone-fill]");
  if (progressTrack) progressTrack.setAttribute("aria-valuenow", String(percent));
  if (progressFill) progressFill.style.width = `${percent}%`;
  if (phoneFill) phoneFill.style.width = `${percent}%`;
  setText("[data-cleaner-phone-pct]", String(percent));

  const stateNode = document.querySelector("[data-cleaner-profile-state]");
  if (stateNode) {
    stateNode.textContent = applicationStatusLabel({ profile: cleanerProfile }, progress);
    stateNode.dataset.state = summary.profilePublished ? "live" : progress.remaining > 0 ? "action" : "";
  }

  setText("[data-cleaner-availability-count]", String(summary.availableWindowCount));
  setText("[data-cleaner-rating]", summary.reviewCount > 0 ? `${summary.averageRating.toFixed(1)} ★` : "—");
  setText("[data-cleaner-review-count]", summary.reviewCount > 0 ? `${summary.reviewCount} approved ${summary.reviewCount === 1 ? "review" : "reviews"} · view →` : "after your first cleans · view →");
  setText("[data-cleaner-completed-jobs]", String(summary.completedJobCount));
  setText("[data-cleaner-completed-value]", dashboardMoney(summary.completedJobValuePence));
  setText("[data-cleaner-committed-value]", dashboardMoney(summary.committedJobValuePence));

  const currentJobs = buckets.active.length + buckets.upcoming.length;
  setText("[data-cleaner-current-jobs]", String(currentJobs));
  setText("[data-cleaner-current-sub]", currentJobs === 0 ? "none assigned yet" : `${buckets.active.length} active · ${buckets.upcoming.length} upcoming`);
  // Homle dispatches by invitation; this is the count of real offers awaiting a
  // response, not an invented browse-jobs-in-your-area total.
  setText("[data-cleaner-jobs-available]", String(buckets.pending.length));

  setText("[data-cleaner-payout-state]", summary.payoutState === "ready" ? "Ready" : summary.payoutState === "action-required" ? "Action needed" : summary.payoutState === "not-started" ? "Not set up" : "Not connected");
  setText("[data-cleaner-payout-copy]", summary.payoutState === "ready" ? "Verified for eligible transfers" : summary.payoutState === "action-required" ? "Finish the secure payout form" : summary.payoutState === "not-started" ? "Complete secure payout setup" : "Payout service is not attached");

  const payoutLink = document.querySelector("[data-cleaner-overview-payout]");
  if (payoutLink) payoutLink.hidden = false;
  const publicProfile = document.querySelector("[data-cleaner-public-profile]");
  if (publicProfile) publicProfile.hidden = !summary.profilePublished;
  const pendingDot = document.querySelector("[data-cleaner-pending-dot]");
  if (pendingDot) pendingDot.hidden = buckets.pending.length === 0;

  renderSetupSteps(progress);
  renderAlerts(summary, buckets);
  renderMessages();
}

function renderNextAction(buckets, profile, payout, availability, capabilities) {
  const title = document.querySelector("[data-cleaner-next-title]");
  const copy = document.querySelector("[data-cleaner-next-copy]");
  const link = document.querySelector("[data-cleaner-next-link]");
  const pending = buckets.pending[0];
  const active = buckets.active[0];
  const upcoming = buckets.upcoming[0];
  if (pending) {
    title.textContent = "Review your next request";
    copy.textContent = `${formatBookingWindow(pending.scheduledStartAt, pending.scheduledEndAt)} · ${formatBookingMoney(pending.pricePence)} offered pay`;
    link.href = "#cleaner-pending-title";
    link.textContent = "Review request";
    return;
  }
  const booking = active || upcoming;
  if (booking?.activeJobAvailable) {
    title.textContent = active ? "Open your active clean" : "Prepare for your next clean";
    copy.textContent = `${booking.propertyName || "Cleaning property"} · ${formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt)}`;
    link.href = `/bookings/${booking.bookingId}`;
    link.textContent = active ? "Open active job" : "View job checklist";
    return;
  }
  if (!profile || profile.profileCompletionPercent < 100) {
    title.textContent = "Complete your Cleaner profile";
    copy.textContent = `${profile?.profileCompletionPercent || 0}% complete. Add only the real services, prices and working area Landlords need.`;
    link.href = "/cleaner/profile";
    link.textContent = "Continue profile";
    return;
  }
  if (!profile.isPublic) {
    title.textContent = "Publish your completed profile";
    copy.textContent = "Review the public details once, then make the profile available for matching.";
    link.href = "/cleaner/profile";
    link.textContent = "Review and publish";
    return;
  }
  if (!availability.some((window) => window.status === "available")) {
    title.textContent = "Add when you can clean";
    copy.textContent = "One exact future time lets Homle match suitable requests to you.";
    link.href = "/cleaner/availability";
    link.textContent = "Add availability";
    return;
  }
  if (payout && !payout.ready) {
    title.textContent = payout.status === "action-required" ? "Finish payout setup" : "Set up how you get paid";
    copy.textContent = "Use one secure Stripe form. Homle never receives your bank details.";
    link.href = "/cleaner/payouts";
    link.textContent = payout.status === "action-required" ? "Continue payout setup" : "Set up payouts";
    return;
  }
  if (!capabilities.matchingReady) {
    title.textContent = capabilities.notice.title;
    copy.textContent = capabilities.notice.copy;
    link.href = capabilities.notice.key === "postcode-geocoding" ? "/cleaner/profile" : "/cleaner/dashboard";
    link.textContent = capabilities.notice.key === "postcode-geocoding" ? "Review service area" : "Refresh matching status";
    return;
  }
  title.textContent = "You are ready for matching";
  copy.textContent = "Your public profile and future availability are ready. New suitable requests will appear here.";
  link.href = "/cleaner/availability";
  link.textContent = "Review availability";
}

async function loadOptionalPayoutStatus() {
  try { return (await requestJson("/api/marketplace/cleaner/payout-account")).payout || null; }
  catch (error) {
    if ([404, 503].includes(error.statusCode)) return null;
    throw error;
  }
}

async function refreshBookings() {
  const result = await requestJson("/api/marketplace/bookings?limit=50");
  bookings = Array.isArray(result.bookings) ? result.bookings : [];
  renderBookings();
}

async function reconcileDecision(bookingId, decision) {
  await refreshBookings();
  const booking = bookings.find((record) => record.bookingId === bookingId);
  const state = cleanerInvitationDecisionState(booking, decision);
  if (state === "recorded") {
    showFeedback(decision === "accept" ? "Request accepted. The server confirmed that this job is now in your dashboard." : "Request declined. The server confirmed that matching reopened for the Landlord.", "success");
    return true;
  }
  if (state === "pending") {
    showFeedback("Homle checked the current request and did not record that decision. You can review it and try once more.", "error");
    return false;
  }
  showFeedback("This invitation changed while Homle was checking it. Review the current dashboard before taking another action.", "error");
  return true;
}

async function respondToBooking(bookingId, decision, reason, button) {
  if (responding) return false;
  const currentInvitation = bookings.find((booking) => booking.bookingId === bookingId);
  if (!currentInvitation || !["open", "urgent"].includes(cleanerInvitationDeadlineState(currentInvitation).kind)) {
    if (decision === "decline" && declineDialog.open) declineDialog.close();
    expiredInvitationRefreshNeeded = true;
    updateInvitationDeadlines();
    await refreshExpiredInvitations();
    return false;
  }
  responding = true;
  const originalLabel = button.textContent;
  button.disabled = true;
  if (decision === "decline") declineCancel.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = decision === "accept" ? "Accepting…" : "Declining…";
  showFeedback("");
  try {
    const csrf = await recoverCsrf();
    if (!csrf) return false;
    const result = await requestJson(`/api/marketplace/bookings/${encodeURIComponent(bookingId)}/response`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ decision, reason }) });
    if (decision === "accept" && Object.hasOwn(result.booking || {}, "customerPricePence")) throw new Error("Homle withheld this response because private marketplace pricing was exposed.");
    try {
      await refreshBookings();
      showFeedback(decision === "accept" ? "Request accepted. Homle rechecked your availability and the confirmed job is now in your dashboard." : "Request declined. Matching has reopened for the Landlord.", "success");
    } catch {
      bookings = bookings.map((booking) => booking.bookingId === bookingId ? { ...booking, status: result.booking?.status || (decision === "accept" ? "confirmed" : "cancelled"), canRespond: false } : booking);
      renderBookings();
      showFeedback("Decision recorded. The dashboard refresh was delayed; refresh later to see the latest details. Do not answer this request again.", "success");
    }
    return true;
  } catch (error) {
    if (error.code === "payout-setup-required") {
      showPayoutSetupRequired(error.message);
      return false;
    }
    if (error.code === "payout-readiness-unavailable") {
      showFeedback(error.message, "error");
      return false;
    }
    if ((error.uncertain === true || error.statusCode === 409) && !browserOffline()) {
      try { return await reconcileDecision(bookingId, decision); }
      catch { showFeedback("Homle could not verify whether that decision completed. Refresh the dashboard to check its current status before trying again.", "error"); return false; }
    }
    showFeedback(error.uncertain === true ? `${error.message} Refresh the dashboard to verify before trying again.` : error.statusCode === 401 || error.statusCode === 403 ? "Your session expired or this request is no longer assigned to you. Sign in and refresh." : error.message, "error");
    return false;
  } finally {
    responding = false;
    button.disabled = false;
    if (decision === "decline") declineCancel.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = originalLabel;
  }
}

function acceptBooking(booking, button) {
  respondToBooking(booking.bookingId, "accept", "", button);
}

function openDecline(booking) {
  selectedDeclineBookingId = booking.bookingId;
  declineForm.reset();
  declineDialog.showModal();
}

declineForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const reason = new FormData(declineForm).get("reason")?.toString().trim() || "";
  const button = declineForm.querySelector('button[type="submit"]');
  const completed = await respondToBooking(selectedDeclineBookingId, "decline", reason, button);
  if (completed) {
    selectedDeclineBookingId = "";
    declineDialog.close();
  }
});

declineCancel.addEventListener("click", () => { if (!responding) declineDialog.close(); });
declineDialog.addEventListener("cancel", (event) => { if (responding) event.preventDefault(); });

async function loadDashboard() {
  if (loading) return;
  loading = true;
  showGate("Checking secure Cleaner access…", "Requests and jobs open only inside the assigned Cleaner account.");
  try {
    const accountResult = await requestJson("/api/marketplace/account");
    const account = accountResult.account;
    accountRecord = account;
    const access = dashboardWorkspaceAccess(account, "cleaner");
    if (!access.ready) return access.reason === "different-workspace"
      ? showGate(`Your ${access.label} workspace is active.`, "Cleaner jobs and professional controls remain in a separate private dashboard.", { kind: "authentication", workspaceDestination: access.destination, workspaceLabel: access.label })
      : showGate("This account has no Cleaner workspace.", "Sign in through Work as a Cleaner to create the separate professional workspace.", { kind: "authentication", allowSignIn: true });
    document.querySelector("[data-cleaner-name]").textContent = account.displayName || "Cleaner";
    renderAccountAvatar(account);
    gate.hidden = true;
    dashboard.hidden = false;
    dashboard.setAttribute("aria-busy", "true");

    const [bookingResult, profileResult, payoutResult, availabilityResult, healthResult] = await Promise.allSettled([
      requestJson("/api/marketplace/bookings?limit=50"),
      requestJson("/api/marketplace/cleaner/profile"),
      loadOptionalPayoutStatus(),
      requestJson("/api/marketplace/cleaner/availability"),
      requestJson("/api/health")
    ]);
    const failures = [bookingResult, profileResult, availabilityResult].filter((result) => result.status === "rejected");
    const authorizationFailure = failures.find((result) => [401, 403].includes(result.reason?.statusCode));
    if (authorizationFailure) throw authorizationFailure.reason;
    if (bookingResult.status === "fulfilled") bookings = Array.isArray(bookingResult.value.bookings) ? bookingResult.value.bookings : [];
    if (profileResult.status === "fulfilled") cleanerProfile = profileResult.value.profile && typeof profileResult.value.profile === "object" ? profileResult.value.profile : null;
    if (payoutResult.status === "fulfilled") payoutStatus = payoutResult.value;
    if (availabilityResult.status === "fulfilled") availabilityWindows = Array.isArray(availabilityResult.value.availability) ? availabilityResult.value.availability : [];
    marketplaceCapabilities = cleanerMarketplaceCapabilityState({
      checked: healthResult.status === "fulfilled",
      pricingReady: healthResult.status === "fulfilled" && healthResult.value?.marketplace?.matchingReady === true,
      geocodingReady: healthResult.status === "fulfilled" && healthResult.value?.marketplace?.geocodingReady === true
    });
    document.querySelector("[data-cleaner-payout-link]").hidden = payoutStatus == null;
    document.querySelector("[data-cleaner-profile-link]").textContent = cleanerProfile?.profileCompletionPercent === 100 ? "Edit profile" : "Complete your profile";
    renderAccountAvatar(account, cleanerProfile?.profilePhotoUrl);
    renderBookings();
    showFeedback(failures.length ? "Your Cleaner account is open, but some job or profile details could not be refreshed. Nothing was accepted, declined or changed. Try again to load the complete dashboard." : "", failures.length ? "error" : "info");
  } catch (error) {
    if (error.code === "browser-offline") showGate("You are offline.", "Reconnect to securely load your current requests and jobs. No decision was sent.", { kind: "offline", allowRetry: true });
    else if (error.statusCode === 401) showGate("Sign in as a Cleaner to open this dashboard.", "Requests and jobs are private to the assigned Cleaner account.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showGate("This account cannot open the Cleaner dashboard.", "Use a Cleaner account selected during onboarding.", { kind: "authentication", allowSignIn: true });
    else if ([404, 503].includes(error.statusCode)) showGate("Cleaner accounts are not connected yet.", "The dashboard is ready but remains closed until Homle’s protected marketplace database and HTTPS runtime pass staging.", { kind: "unavailable", allowRetry: true });
    else showGate("The Cleaner dashboard is temporarily unavailable.", "No request was accepted or declined. Check the connection and try again.", { kind: "error", allowRetry: true });
  } finally {
    dashboard.removeAttribute("aria-busy");
    loading = false;
  }
}

retry.addEventListener("click", loadDashboard);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("online", () => {
  updateNetworkStatus();
  if (!gate.hidden && gate.dataset.kind === "offline") loadDashboard();
  else if (expiredInvitationRefreshNeeded) refreshExpiredInvitations();
});
window.addEventListener("homle:notification-updated", () => {
  if (document.visibilityState === "visible") void loadDashboard();
});
window.addEventListener("pagehide", () => window.clearTimeout(invitationDeadlineTimer));
updateNetworkStatus();
loadDashboard();
