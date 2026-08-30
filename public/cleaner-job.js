import { bookingSummaryMoneyBoundary, bookingSummaryPriceLabel, bookingSummaryStatusLabels, cleanerInvitationDeadlineState, formatBookingMoment, formatBookingMoney, formatInvitationTimeRemaining } from "./booking-summary-model.js?v=20260723-3";
import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";
import { renderCleanerNav } from "./cleaner-sidebar.js?v=20260830-1";

const gate = document.querySelector("[data-job-gate]");
const gateTitle = document.querySelector("[data-job-gate-title]");
const gateCopy = document.querySelector("[data-job-gate-copy]");
const signIn = document.querySelector("[data-job-sign-in]");
const dashboardLink = document.querySelector("[data-job-dashboard-link]");
const retry = document.querySelector("[data-job-retry]");
const view = document.querySelector("[data-job]");
const offline = document.querySelector("[data-job-offline]");
const feedback = document.querySelector("[data-job-feedback]");

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });
const dayNumFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });

const bookingId = (location.pathname.match(/\/cleaner\/jobs\/([0-9a-f-]{36})/i) || [])[1] || "";
let loading = false;

function browserOffline() {
  return typeof navigator === "object" && navigator !== null && navigator.onLine === false;
}

function updateNetworkStatus() {
  offline.hidden = !browserOffline();
}

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function showFeedback(message, kind = "info") {
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.className = `hc-feedback${message && kind === "error" ? " hc-feedback-error" : ""}`;
}

function showGate(title, copy, { allowSignIn = false, allowRetry = false, allowDashboard = false } = {}) {
  gateTitle.textContent = title;
  gateCopy.textContent = copy;
  signIn.hidden = !allowSignIn;
  retry.hidden = !allowRetry;
  dashboardLink.hidden = !allowDashboard;
  gate.hidden = false;
  view.hidden = true;
}

async function requestJson(path) {
  if (browserOffline()) throw Object.assign(new Error("You are offline."), { code: "browser-offline" });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(path, { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw Object.assign(new Error(body.error || "Homle could not load this job."), { statusCode: response.status, code: body.code });
  return body;
}

function renderHeader(booking) {
  const start = booking.scheduledStartAt ? new Date(booking.scheduledStartAt) : null;
  const end = booking.scheduledEndAt ? new Date(booking.scheduledEndAt) : null;
  const valid = start && Number.isFinite(start.getTime());
  setText("[data-job-day]", valid ? dayFormat.format(start).toUpperCase() : "TBC");
  setText("[data-job-dnum]", valid ? dayNumFormat.format(start) : "—");
  setText("[data-job-title]", booking.cleaningType || "Cleaning");
  setText("[data-job-addr]", `${booking.propertyArea || "Area shared after confirmation"} · ${booking.counterpartyName || "Landlord"}`);
  setText("[data-job-pay]", formatBookingMoney(booking.pricePence));
  setText("[data-job-pay-sub]", bookingSummaryPriceLabel("cleaner"));
  setText("[data-job-task-count]", String(booking.taskCount));

  const slot = valid
    ? end && Number.isFinite(end.getTime()) ? `${timeFormat.format(start)}–${timeFormat.format(end)}` : timeFormat.format(start)
    : "Time to be confirmed";
  const chips = document.querySelector("[data-job-chips]");
  chips.replaceChildren(
    element("span", "hc-jd-chip hc-jd-chip-slot", slot),
    element("span", "hc-jd-chip", `${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`),
    element("span", "hc-jd-chip", bookingSummaryStatusLabels[booking.status] || "Booking")
  );

  setText("[data-job-notes]", bookingSummaryMoneyBoundary(booking, "cleaner"));
  setText("[data-job-access-property]", booking.propertyName || "Shared after confirmation");
  setText("[data-job-access-area]", booking.propertyArea || "Shared after confirmation");

  const confirmed = !["pending-cleaner-acceptance", "cancelled", "expired"].includes(booking.status);
  setText("[data-job-access-entry]", confirmed ? "Open the live job screen for entry details" : "Shared after acceptance");
  setText("[data-job-access-boundary]", confirmed
    ? "Exact address, entry instructions and access codes stay on the protected live job screen for this booking."
    : "Exact codes and the full address unlock when you accept the job.");

  const client = booking.counterpartyName || "Landlord";
  setText("[data-job-client-initial]", client.trim().charAt(0).toUpperCase() || "L");
  setText("[data-job-client-name]", client);
  setText("[data-job-client-meta]", confirmed ? "Message them from the live job screen" : "Contact details stay private until you accept");

  const message = document.querySelector("[data-job-message]");
  message.hidden = !confirmed;
  if (confirmed) message.href = `/bookings/${booking.bookingId}`;

  const actions = document.querySelector("[data-job-actions]");
  actions.replaceChildren();
  if (booking.status === "pending-cleaner-acceptance") {
    const state = cleanerInvitationDeadlineState(booking);
    // The vetted accept/decline flow — CSRF recovery, idempotent retry, uncertain-write
    // reconciliation, deadline locking and the payout-setup gate — lives in the dashboard
    // module. This page links into it rather than reimplementing a second decision path,
    // because a divergent copy could commit a Cleaner to a job twice.
    const respond = element("a", "hc-btn", ["open", "urgent"].includes(state.kind) ? "Respond on your dashboard ↗" : "Check status on your dashboard ↗");
    respond.href = "/cleaner/dashboard";
    actions.append(respond);
    const deadline = element("div", "hc-jd-note", ["open", "urgent"].includes(state.kind)
      ? `Respond within ${formatInvitationTimeRemaining(state.remainingMs)} · by ${formatBookingMoment(booking.responseDeadline)}`
      : state.kind === "expired" ? "This offer window has ended." : "This offer is no longer open for a response.");
    actions.append(deadline);
  } else if (["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review"].includes(booking.status)) {
    const live = element("a", "hc-job-accepted", "Accepted ✓ — open live job →");
    live.href = `/bookings/${booking.bookingId}`;
    actions.append(live);
  }
}

async function renderScan(booking) {
  const tasksHost = document.querySelector("[data-job-tasks]");
  const photosHost = document.querySelector("[data-job-photos]");
  const photosNote = document.querySelector("[data-job-photos-note]");
  if (!booking.cleaningRequestId) {
    tasksHost.replaceChildren(element("p", "hc-jd-note", "The approved room checklist is not available for this job."));
    photosNote.textContent = "No client photos are attached to this request.";
    return;
  }
  let result;
  try {
    result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(booking.cleaningRequestId)}/scan`);
  } catch {
    tasksHost.replaceChildren(element("p", "hc-jd-note", "The room checklist could not be loaded. Refresh before relying on this scope."));
    photosNote.textContent = "Client photos could not be loaded.";
    return;
  }

  const tasks = Array.isArray(result.scan?.tasks) ? result.scan.tasks : [];
  const rooms = new Map();
  for (const task of tasks) {
    const room = String(task.roomName || "Room");
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(String(task.description || ""));
  }
  tasksHost.replaceChildren(...[...rooms.entries()].map(([room, items]) => {
    const block = document.createDocumentFragment();
    block.append(element("div", "hc-jd-room", room));
    const list = element("ul", "hc-jd-tasks");
    for (const item of items.filter(Boolean)) {
      const row = element("li", "hc-jd-task");
      row.append(element("span", "hc-jd-task-box"), element("span", "hc-jd-task-text", item));
      list.append(row);
    }
    block.append(list);
    return block;
  }));
  if (!rooms.size) tasksHost.replaceChildren(element("p", "hc-jd-note", "No approved tasks are recorded on this request yet. Do not rely on this scope until the checklist loads."));

  const photos = Array.isArray(result.scan?.photos) ? result.scan.photos : [];
  photosNote.textContent = photos.length
    ? "Taken by the client in the Homle app. Each photo opens through a short-lived private link and is never cached."
    : "No client photos are attached to this request.";
  // The access endpoint returns JSON holding a short-lived signed URL, not image bytes,
  // and the storage origin is outside this page's img-src. Photos therefore open in a
  // separate tab through that signed link, matching the dashboard's private viewer.
  photosHost.replaceChildren(...photos.map((photo) => {
    const wrap = element("div", "hc-jd-photo");
    const open = element("button", "hc-btn-outline", "View private photo");
    open.type = "button";
    open.addEventListener("click", async () => {
      const privateWindow = window.open("about:blank", "_blank");
      if (privateWindow) privateWindow.opener = null;
      open.disabled = true;
      try {
        if (!privateWindow) throw new Error("Allow this site to open the private photo viewer, then try again.");
        const access = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(booking.cleaningRequestId)}/photos/${encodeURIComponent(photo.photoId)}/access`);
        const url = new URL(access.photo?.url || "");
        if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("The private photo link was unsafe.");
        privateWindow.location.replace(url.toString());
      } catch (error) {
        privateWindow?.close();
        showFeedback(error.message, "error");
      } finally {
        open.disabled = false;
      }
    });
    wrap.append(open, element("div", "hc-jd-photo-cap", photo.note || photo.roomName || "Client photo"));
    return wrap;
  }));
}

async function loadJob() {
  if (loading) return;
  loading = true;
  showGate("Loading this job…", "Job details open only for the invited or assigned Cleaner.");
  try {
    if (!bookingId) return showGate("That job link is not valid.", "Open the job from your dashboard or schedule.", { allowDashboard: true });
    const accountResult = await requestJson("/api/marketplace/account");
    const account = accountResult.account;
    const access = dashboardWorkspaceAccess(account, "cleaner");
    if (!access.ready) return showGate("This account has no Cleaner workspace.", "Sign in through Work as a Cleaner to open the professional workspace.", { allowSignIn: true });
    renderAccountAvatar(account);
    const nameNode = document.querySelector("[data-account-name]");
    if (nameNode) nameNode.textContent = account.displayName || "Cleaner";

    const bookingResult = await requestJson("/api/marketplace/bookings?limit=50");
    const bookings = Array.isArray(bookingResult.bookings) ? bookingResult.bookings : [];
    const booking = bookings.find((record) => record.bookingId === bookingId);
    if (!booking) return showGate("This job is not available to your account.", "It may have been withdrawn, expired or assigned to another Cleaner.", { allowDashboard: true });

    renderCleanerNav(null);

    gate.hidden = true;
    view.hidden = false;
    const payoutLink = document.querySelector("[data-cleaner-payout-link]");
    if (payoutLink) payoutLink.hidden = false;
    renderHeader(booking);
    await renderScan(booking);
    showFeedback("");
  } catch (error) {
    if (error.code === "browser-offline") showGate("You are offline.", "Reconnect to load this job. No decision was sent.", { allowRetry: true });
    else if (error.statusCode === 401) showGate("Sign in as a Cleaner to open this job.", "Job details are private to the assigned Cleaner account.", { allowSignIn: true });
    else if (error.statusCode === 403) showGate("This job is not assigned to your account.", "Open a job from your own dashboard or schedule.", { allowDashboard: true });
    else showGate("This job is temporarily unavailable.", "Nothing was accepted or declined. Check the connection and try again.", { allowRetry: true });
  } finally {
    loading = false;
  }
}

retry.addEventListener("click", loadJob);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("online", () => {
  updateNetworkStatus();
  if (!gate.hidden) loadJob();
});
const yearNode = document.querySelector("[data-year]");
if (yearNode) yearNode.textContent = String(new Date().getFullYear());
updateNetworkStatus();
loadJob();
