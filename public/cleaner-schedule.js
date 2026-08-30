import { bookingSummaryBuckets, bookingSummaryStatusLabels, formatBookingMoney } from "./booking-summary-model.js?v=20260723-3";
import { activeJobMessagingOpen } from "./active-job-model.js?v=20260728-1";
import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";
import { renderCleanerNav } from "./cleaner-sidebar.js?v=20260830-1";
import { loadOnboardingForm, saveOnboardingForm } from "./cleaner-onboarding-client.js?v=20260805-2";

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
const timeOffForm = document.querySelector("[data-schedule-time-off-form]");
const timeOffStatus = document.querySelector("[data-schedule-time-off-status]");
const activitySchedule = view?.closest(".hc-activity-schedule");
const dashboardShell = document.querySelector("[data-cleaner-dashboard]");
const mainInner = document.querySelector(".hc-main-inner");
const upcomingSection = document.querySelector(".hc-upcoming");
const timeOffSection = document.querySelector(".hc-schedule-time-off");

// The schedule belongs to Activity even when the live job feed is unavailable.
// Keep it outside the guarded dashboard payload so the page never collapses to
// a connection error with no useful calendar.
if (activitySchedule && dashboardShell && mainInner) {
  mainInner.insertBefore(activitySchedule, dashboardShell);
  mainInner.dataset.activityScheduleReady = "true";
}
if (upcomingSection && timeOffSection?.parentNode) timeOffSection.parentNode.insertBefore(upcomingSection, timeOffSection);

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });
const dayNumFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
const rangeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
const londonKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const bookingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let bookings = [];
let weekOffset = 0;
let loading = false;
let savedAvailabilityData = {};
let previewMode = false;

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

async function requestJson(path, options = {}) {
  if (browserOffline()) throw Object.assign(new Error("You are offline."), { code: "browser-offline" });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(path, { ...options, headers: { accept: "application/json", ...(options.headers || {}) }, credentials: "same-origin", cache: "no-store", signal: controller.signal });
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
  if (booking.preview) return "preview";
  if (booking.status === "pending-cleaner-acceptance") return "pending";
  return ["cancelled", "expired", "completed"].includes(booking.status) ? "closed" : "confirmed";
}

function previewDate(dayIndex, hour, durationHours) {
  const start = weekDays(dayIndex > 6 ? 1 : 0)[dayIndex % 7];
  start.setUTCHours(hour, 0, 0, 0);
  return {
    scheduledStartAt: start.toISOString(),
    scheduledEndAt: new Date(start.getTime() + durationHours * 3_600_000).toISOString()
  };
}

function previewBookings() {
  return [
    {
      bookingId: "preview-deep-clean",
      preview: true,
      participantRole: "cleaner",
      status: "confirmed",
      cleaningType: "Deep clean",
      locationLabel: "Battersea, SW11",
      propertyArea: "SW11",
      pricePence: 6800,
      taskCount: 8,
      imageLabels: ["Kitchen", "Living room", "Bathroom"],
      ...previewDate(5, 8, 3)
    },
    {
      bookingId: "preview-regular-clean",
      preview: true,
      participantRole: "cleaner",
      status: "confirmed",
      cleaningType: "Regular home clean",
      locationLabel: "Clapham, SW4",
      propertyArea: "SW4",
      pricePence: 4800,
      taskCount: 6,
      imageLabels: ["Kitchen", "Bedroom", "Hallway"],
      ...previewDate(8, 12, 2)
    }
  ];
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
      const card = element(booking.preview ? "div" : "a", "hc-week-job");
      if (!booking.preview) card.href = `/cleaner/jobs/${booking.bookingId}`;
      card.dataset.state = state;
      card.append(
        element("div", "hc-week-job-time", booking.scheduledStartAt ? timeFormat.format(new Date(booking.scheduledStartAt)) : "—"),
        element("div", "hc-week-job-title", booking.cleaningType || "Cleaning"),
        element("div", "hc-week-job-meta", booking.preview ? `${formatBookingMoney(booking.pricePence)} · example` : `${formatBookingMoney(booking.pricePence)} · ${state === "pending" ? "awaiting reply" : bookingSummaryStatusLabels[booking.status] || "Confirmed"}`)
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
    .filter((booking) => !booking.preview && booking.scheduledStartAt && keys.has(londonKey(booking.scheduledStartAt)) && scheduleState(booking) === "confirmed")
    .reduce((total, booking) => total + (Number.isFinite(booking.pricePence) ? booking.pricePence : 0), 0);
}

function weekHours(offsetWeeks) {
  const keys = new Set(weekDays(offsetWeeks).map((date) => londonKey(date.toISOString())));
  const minutes = bookings
    .filter((booking) => !booking.preview && booking.scheduledStartAt && keys.has(londonKey(booking.scheduledStartAt)) && scheduleState(booking) === "confirmed")
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

function bookingPhotoUrls(booking) {
  return [booking.images, booking.photos, booking.propertyPhotos]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .map((value) => typeof value === "string" ? value : value?.url)
    .filter((value) => typeof value === "string" && value.length > 0)
    .slice(0, 3);
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function roomIllustration(label, index) {
  const palettes = [
    ["#f6d7c8", "#de5a45", "#8f4738"],
    ["#d9e8df", "#4b8d79", "#2d5e55"],
    ["#eadfc9", "#d5a64f", "#7e6330"]
  ];
  const [background, accent, ink] = palettes[index % palettes.length];
  const svg = svgNode("svg", { viewBox: "0 0 180 112", role: "img", "aria-label": `${label} image preview` });
  const title = svgNode("title");
  title.textContent = `${label} image preview`;
  svg.append(
    title,
    svgNode("rect", { width: 180, height: 112, rx: 12, fill: background }),
    svgNode("path", { d: "M0 82 L180 70 L180 112 L0 112 Z", fill: "#fff8ed", opacity: ".92" }),
    svgNode("rect", { x: 112, y: 17, width: 45, height: 38, rx: 4, fill: "#fffdf8", stroke: ink, "stroke-width": 2 }),
    svgNode("path", { d: "M134.5 18 V54 M113 36 H156", fill: "none", stroke: ink, "stroke-width": 1.4, opacity: ".55" }),
    svgNode("path", { d: "M24 73 Q24 60 38 60 H84 Q97 60 97 73 V88 H24 Z", fill: accent }),
    svgNode("path", { d: "M31 87 V96 M90 87 V96", fill: "none", stroke: ink, "stroke-width": 4, "stroke-linecap": "round" }),
    svgNode("path", { d: "M59 25 L63 35 L73 39 L63 43 L59 53 L55 43 L45 39 L55 35 Z", fill: "#ffffff", opacity: ".85" })
  );
  return svg;
}

function renderJobImages(booking) {
  const gallery = element("div", "hc-activity-job-images");
  const urls = bookingPhotoUrls(booking);
  const labels = Array.isArray(booking.imageLabels) && booking.imageLabels.length ? booking.imageLabels : ["Property", "Room", "Clean details"];
  for (let index = 0; index < 3; index += 1) {
    const frame = element("div", "hc-activity-job-image");
    if (urls[index]) {
      const image = document.createElement("img");
      image.src = urls[index];
      image.alt = `${labels[index] || "Property"} for this clean`;
      image.loading = "lazy";
      frame.append(image);
    } else {
      frame.append(roomIllustration(labels[index] || "Property", index));
    }
    frame.append(element("span", "hc-activity-job-image-label", labels[index] || "Property"));
    gallery.append(frame);
  }
  return gallery;
}

function clientDisplayName(booking) {
  const name = typeof booking?.counterpartyName === "string" ? booking.counterpartyName.trim() : "";
  return name || "client";
}

function renderBookingActions(booking) {
  const actions = element("div", "hc-activity-job-actions");
  if (booking.preview) {
    const messagePreview = element("span", "hc-message-client-link is-preview", "Message client");
    messagePreview.setAttribute("aria-disabled", "true");
    messagePreview.title = "Messaging opens when a real clean is confirmed.";
    actions.append(messagePreview);
    return actions;
  }

  const bookingId = String(booking.bookingId || "").toLowerCase();
  if (bookingIdPattern.test(bookingId) && activeJobMessagingOpen(booking.status)) {
    const clientName = clientDisplayName(booking);
    const messageLink = element("a", "hc-message-client-link", `Message ${clientName}`);
    messageLink.href = `/cleaner/messages?bookingId=${encodeURIComponent(bookingId)}`;
    messageLink.setAttribute("aria-label", `Message ${clientName} about this clean`);
    actions.append(messageLink);
  }

  const jobLink = element("a", "hc-job-link", "View job →");
  jobLink.href = `/cleaner/jobs/${bookingId}`;
  actions.append(jobLink);
  return actions;
}

function renderUpcoming() {
  const buckets = bookingSummaryBuckets(bookings, "cleaner");
  const upcoming = [...buckets.active, ...buckets.upcoming];
  upcomingEmpty.hidden = upcoming.length > 0;
  upcomingList.replaceChildren(...upcoming.map((booking) => {
    const row = element("article", "hc-activity-job-card");
    row.dataset.preview = booking.preview ? "true" : "false";
    const date = element("div", "hc-upcoming-date");
    const start = booking.scheduledStartAt ? new Date(booking.scheduledStartAt) : null;
    const valid = start && Number.isFinite(start.getTime());
    date.append(
      element("span", "hc-upcoming-day", valid ? dayFormat.format(start).toUpperCase() : "TBC"),
      element("span", "hc-upcoming-dnum", valid ? dayNumFormat.format(start) : "—")
    );
    const body = element("div", "hc-activity-job-body");
    const heading = element("div", "hc-activity-job-heading");
    const headingCopy = element("div", "hc-activity-job-heading-copy");
    headingCopy.append(
      element("span", "hc-activity-job-status", booking.preview ? "Example layout" : bookingSummaryStatusLabels[booking.status] || "Confirmed"),
      element("h3", "hc-activity-job-title", booking.cleaningType || "Cleaning")
    );
    heading.append(headingCopy, element("strong", "hc-activity-job-price", formatBookingMoney(booking.pricePence)));
    const details = element("dl", "hc-activity-job-details");
    for (const [label, value] of [
      ["Location", booking.locationLabel || booking.propertyArea || "Area shared after selection"],
      ["Date", valid ? `${rangeFormat.format(start)} at ${timeFormat.format(start)}` : "To be confirmed"],
      ["Clean", booking.cleaningType || "Cleaning"],
      ["Work", `${Number(booking.taskCount) || 0} ${Number(booking.taskCount) === 1 ? "task" : "tasks"}`]
    ]) {
      const item = element("div", "hc-activity-job-detail");
      item.append(element("dt", "", label), element("dd", "", value));
      details.append(item);
    }
    const footer = element("div", "hc-activity-job-footer");
    footer.append(date, element("p", "hc-activity-job-privacy", booking.preview ? "Preview only — this is not a confirmed booking." : "Only the working area is shown here. Open the job for private access details."));
    footer.append(renderBookingActions(booking));
    body.append(heading, details, footer);
    row.append(renderJobImages(booking), body);
    return row;
  }));
}

function renderAll() {
  const buckets = bookingSummaryBuckets(bookings.filter((booking) => !booking.preview), "cleaner");
  renderWeek();
  renderUpcoming();
  document.querySelector("[data-week-value]").textContent = money(weekValuePence(weekOffset));
  document.querySelector("[data-next-week-value]").textContent = money(weekValuePence(weekOffset + 1));
  document.querySelector("[data-week-hours]").textContent = String(weekHours(weekOffset));
  document.querySelector("[data-week-confirmed]").textContent = String(buckets.active.length + buckets.upcoming.length);
  document.querySelector("[data-week-pending]").textContent = String(buckets.pending.length);
}

async function saveTimeOff(event) {
  event.preventDefault();
  if (!(timeOffForm instanceof HTMLFormElement) || !timeOffForm.reportValidity()) return;
  const submit = timeOffForm.querySelector('button[type="submit"]');
  if (submit instanceof HTMLButtonElement) submit.disabled = true;
  if (timeOffStatus) timeOffStatus.textContent = "Saving your holiday settings securely…";
  const preservedAvailability = { ...savedAvailabilityData };
  delete preservedAvailability.holidayMode;
  delete preservedAvailability.unavailableDate;
  try {
    const saved = await saveOnboardingForm(requestJson, "availability", timeOffForm, { extra: preservedAvailability });
    savedAvailabilityData = saved?.data || {};
    if (timeOffStatus) timeOffStatus.textContent = "Holiday mode and unavailable date saved.";
    showFeedback("Your time-off settings have been saved.");
  } catch (error) {
    if (timeOffStatus) timeOffStatus.textContent = "Your holiday settings were not saved. Try again.";
    showFeedback(error.message || "Your time-off settings could not be saved.", "error");
  } finally {
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  }
}

function setTimeOffConnected(connected) {
  for (const control of timeOffForm?.querySelectorAll("input, button") || []) control.disabled = !connected;
}

function showPreviewSchedule(message) {
  previewMode = true;
  bookings = previewBookings();
  gate.hidden = true;
  view.hidden = false;
  view.dataset.preview = "true";
  setTimeOffConnected(false);
  if (timeOffStatus) timeOffStatus.textContent = "Time-off controls will activate when live Cleaner jobs are connected.";
  renderAll();
  showFeedback(message || "Preview mode: these example cleans show how selected work will appear. They are not bookings.");
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

    const [bookingResult, availabilitySection] = await Promise.all([
      requestJson("/api/marketplace/bookings?limit=50"),
      loadOnboardingForm(requestJson, "availability", timeOffForm).catch(() => null)
    ]);
    const liveBookings = Array.isArray(bookingResult.bookings) ? bookingResult.bookings : [];
    previewMode = liveBookings.length === 0;
    bookings = previewMode ? previewBookings() : liveBookings;
    view.dataset.preview = previewMode ? "true" : "false";
    setTimeOffConnected(true);
    savedAvailabilityData = availabilitySection?.data || {};
    if (timeOffStatus) timeOffStatus.textContent = availabilitySection
      ? "Holiday mode and unavailable dates are saved separately from confirmed jobs."
      : "Saved holiday settings could not be loaded. Refresh before making changes.";
    const payoutLink = document.querySelector("[data-cleaner-payout-link]");
    if (payoutLink) payoutLink.hidden = false;
    renderAll();
    showFeedback(previewMode ? "No work has been selected yet. The clearly labelled examples below show how future cleans will appear." : "");
  } catch (error) {
    if (error.code === "browser-offline") showGate("You are offline.", "Reconnect to load your current schedule.", { allowRetry: true });
    else if (error.statusCode === 401) showGate("Sign in as a Cleaner to open your schedule.", "Jobs are private to the assigned Cleaner account.", { allowSignIn: true });
    else if (error.statusCode === 403) showGate("This account cannot open the Cleaner schedule.", "Use a Cleaner account selected during onboarding.", { allowSignIn: true });
    else showPreviewSchedule("Live jobs are not connected yet. The examples below preview the Activity schedule; no work has been accepted or changed.");
  } finally {
    loading = false;
  }
}

document.querySelector("[data-week-prev]").addEventListener("click", () => { weekOffset -= 1; renderAll(); });
document.querySelector("[data-week-next]").addEventListener("click", () => { weekOffset += 1; renderAll(); });
timeOffForm?.addEventListener("submit", saveTimeOff);
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
