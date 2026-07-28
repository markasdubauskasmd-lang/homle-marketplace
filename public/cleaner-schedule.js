import { bookingSummaryBuckets, bookingSummaryStatusLabels, formatBookingMoney } from "./booking-summary-model.js?v=20260723-3";
import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";
import { renderCleanerNav } from "./cleaner-sidebar.js?v=20260728-6";

const gate = document.querySelector("[data-schedule-gate]");
const gateTitle = document.querySelector("[data-schedule-gate-title]");
const gateCopy = document.querySelector("[data-schedule-gate-copy]");
const signIn = document.querySelector("[data-schedule-sign-in]");
const retry = document.querySelector("[data-schedule-retry]");
const view = document.querySelector("[data-schedule]");
const offline = document.querySelector("[data-schedule-offline]");
const feedback = document.querySelector("[data-schedule-feedback]");
const grid = document.querySelector("[data-week-grid]");
const upcomingList = document.querySelector("[data-upcoming-list]");
const upcomingEmpty = document.querySelector("[data-upcoming-empty]");
const weekLabel = document.querySelector("[data-week-label]");

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });
const dayNumFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
const rangeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
const londonKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

let bookings = [];
let weekOffset = 0;
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

function showFeedback(message, kind = "info") {
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.className = `hc-feedback${message && kind === "error" ? " hc-feedback-error" : ""}`;
}

function showGate(title, copy, { allowSignIn = false, allowRetry = false } = {}) {
  gateTitle.textContent = title;
  gateCopy.textContent = copy;
  signIn.hidden = !allowSignIn;
  retry.hidden = !allowRetry;
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
  if (!response.ok || body.ok === false) throw Object.assign(new Error(body.error || "Homle could not load your schedule."), { statusCode: response.status, code: body.code });
  return body;
}

// London-local calendar key, so a job just before midnight lands on the right column
// through British Summer Time rather than drifting on the UTC date.
function londonKey(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? londonKeyFormat.format(date) : "";
}

function londonMonday(offsetWeeks) {
  const now = new Date();
  const key = londonKey(now.toISOString());
  const [year, month, day] = key.split("-").map(Number);
  // Midday anchor keeps the arithmetic clear of DST transition hours.
  const anchor = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - weekday + offsetWeeks * 7);
  return anchor;
}

function weekDays(offsetWeeks) {
  const monday = londonMonday(offsetWeeks);
  return Array.from({ length: 7 }, (unused, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return date;
  });
}

function scheduleState(booking) {
  if (booking.status === "pending-cleaner-acceptance") return "pending";
  return ["cancelled", "expired", "completed"].includes(booking.status) ? "closed" : "confirmed";
}

function jobsForDay(date) {
  const key = londonKey(date.toISOString());
  return bookings
    .filter((booking) => booking.scheduledStartAt && londonKey(booking.scheduledStartAt) === key && scheduleState(booking) !== "closed")
    .sort((a, b) => new Date(a.scheduledStartAt) - new Date(b.scheduledStartAt));
}

function renderWeek() {
  const days = weekDays(weekOffset);
  const todayKey = londonKey(new Date().toISOString());
  weekLabel.textContent = `${rangeFormat.format(days[0])} – ${rangeFormat.format(days[6])}`;

  grid.replaceChildren(...days.map((date) => {
    const key = londonKey(date.toISOString());
    const column = element("div", "hc-week-col");
    const head = element("div", "hc-week-head");
    head.append(document.createTextNode(`${dayFormat.format(date).toUpperCase()} ${dayNumFormat.format(date)}`));
    if (key === todayKey) {
      head.dataset.today = "true";
      head.append(element("span", "hc-week-today", "TODAY"));
    }
    const body = element("div", "hc-week-body");
    for (const booking of jobsForDay(date)) {
      const state = scheduleState(booking);
      const card = element("a", "hc-week-job");
      card.href = `/cleaner/jobs/${booking.bookingId}`;
      card.dataset.state = state;
      card.append(
        element("div", "hc-week-job-time", booking.scheduledStartAt ? timeFormat.format(new Date(booking.scheduledStartAt)) : "—"),
        element("div", "hc-week-job-title", booking.cleaningType || "Cleaning"),
        element("div", "hc-week-job-meta", `${formatBookingMoney(booking.pricePence)} · ${state === "pending" ? "awaiting reply" : bookingSummaryStatusLabels[booking.status] || "Confirmed"}`)
      );
      body.append(card);
    }
    column.append(head, body);
    return column;
  }));
}

function weekValuePence(offsetWeeks) {
  const keys = new Set(weekDays(offsetWeeks).map((date) => londonKey(date.toISOString())));
  return bookings
    .filter((booking) => booking.scheduledStartAt && keys.has(londonKey(booking.scheduledStartAt)) && scheduleState(booking) === "confirmed")
    .reduce((total, booking) => total + (Number.isFinite(booking.pricePence) ? booking.pricePence : 0), 0);
}

function weekHours(offsetWeeks) {
  const keys = new Set(weekDays(offsetWeeks).map((date) => londonKey(date.toISOString())));
  const minutes = bookings
    .filter((booking) => booking.scheduledStartAt && keys.has(londonKey(booking.scheduledStartAt)) && scheduleState(booking) === "confirmed")
    .reduce((total, booking) => {
      const start = new Date(booking.scheduledStartAt);
      const end = new Date(booking.scheduledEndAt);
      return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) ? total + (end - start) / 60000 : total;
    }, 0);
  return Math.round(minutes / 60 * 10) / 10;
}

function money(pence) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

function renderUpcoming() {
  const buckets = bookingSummaryBuckets(bookings, "cleaner");
  const upcoming = [...buckets.active, ...buckets.upcoming];
  upcomingEmpty.hidden = upcoming.length > 0;
  upcomingList.replaceChildren(...upcoming.map((booking) => {
    const row = element("div", "hc-upcoming-row");
    const date = element("div", "hc-upcoming-date");
    const start = booking.scheduledStartAt ? new Date(booking.scheduledStartAt) : null;
    const valid = start && Number.isFinite(start.getTime());
    date.append(
      element("span", "hc-upcoming-day", valid ? dayFormat.format(start).toUpperCase() : "TBC"),
      element("span", "hc-upcoming-dnum", valid ? dayNumFormat.format(start) : "—")
    );
    const body = element("div", "hc-upcoming-body");
    body.append(
      element("div", "hc-upcoming-title", booking.cleaningType || "Cleaning"),
      element("div", "hc-upcoming-meta", `${valid ? timeFormat.format(start) : "Time to be confirmed"} · ${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`)
    );
    const chip = element("span", "hc-chip", bookingSummaryStatusLabels[booking.status] || "Confirmed");
    const pay = element("span", "hc-upcoming-pay", formatBookingMoney(booking.pricePence));
    const link = element("a", "hc-job-link", "View →");
    link.href = `/cleaner/jobs/${booking.bookingId}`;
    row.append(date, body, chip, pay, link);
    return row;
  }));
}

function renderAll() {
  const buckets = bookingSummaryBuckets(bookings, "cleaner");
  renderWeek();
  renderUpcoming();
  document.querySelector("[data-week-value]").textContent = money(weekValuePence(weekOffset));
  document.querySelector("[data-next-week-value]").textContent = money(weekValuePence(weekOffset + 1));
  document.querySelector("[data-week-hours]").textContent = String(weekHours(weekOffset));
  document.querySelector("[data-week-confirmed]").textContent = String(buckets.active.length + buckets.upcoming.length);
  document.querySelector("[data-week-pending]").textContent = String(buckets.pending.length);
}

async function loadSchedule() {
  if (loading) return;
  loading = true;
  showGate("Checking secure Cleaner access…", "Your schedule opens only inside the assigned Cleaner account.");
  try {
    const accountResult = await requestJson("/api/marketplace/account");
    const account = accountResult.account;
    const access = dashboardWorkspaceAccess(account, "cleaner");
    if (!access.ready) return showGate("This account has no Cleaner workspace.", "Sign in through Work as a Cleaner to open the professional workspace.", { allowSignIn: true });
    renderAccountAvatar(account);
    const nameNode = document.querySelector("[data-account-name]");
    if (nameNode) nameNode.textContent = account.displayName || "Cleaner";
    renderCleanerNav(null);
    gate.hidden = true;
    view.hidden = false;

    const bookingResult = await requestJson("/api/marketplace/bookings?limit=50");
    bookings = Array.isArray(bookingResult.bookings) ? bookingResult.bookings : [];
    const payoutLink = document.querySelector("[data-cleaner-payout-link]");
    if (payoutLink) payoutLink.hidden = false;
    renderAll();
    showFeedback("");
  } catch (error) {
    if (error.code === "browser-offline") showGate("You are offline.", "Reconnect to load your current schedule.", { allowRetry: true });
    else if (error.statusCode === 401) showGate("Sign in as a Cleaner to open your schedule.", "Jobs are private to the assigned Cleaner account.", { allowSignIn: true });
    else if (error.statusCode === 403) showGate("This account cannot open the Cleaner schedule.", "Use a Cleaner account selected during onboarding.", { allowSignIn: true });
    else showGate("Your schedule is temporarily unavailable.", "Nothing was changed. Check the connection and try again.", { allowRetry: true });
  } finally {
    loading = false;
  }
}

document.querySelector("[data-week-prev]").addEventListener("click", () => { weekOffset -= 1; renderAll(); });
document.querySelector("[data-week-next]").addEventListener("click", () => { weekOffset += 1; renderAll(); });
retry.addEventListener("click", loadSchedule);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("online", () => {
  updateNetworkStatus();
  if (!gate.hidden) loadSchedule();
});
const yearNode = document.querySelector("[data-year]");
if (yearNode) yearNode.textContent = String(new Date().getFullYear());
updateNetworkStatus();
loadSchedule();
