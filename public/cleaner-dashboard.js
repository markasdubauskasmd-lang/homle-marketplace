import { bookingSummaryBuckets, bookingSummaryPrimaryAction, bookingSummaryPriceLabel, bookingSummaryStatusLabels, formatBookingMoney, formatBookingWindow } from "./booking-summary-model.js";

const gate = document.querySelector("[data-cleaner-dashboard-gate]");
const dashboard = document.querySelector("[data-cleaner-dashboard]");
const retry = document.querySelector("[data-cleaner-retry]");
const signIn = document.querySelector("[data-cleaner-sign-in]");
const feedback = document.querySelector("[data-cleaner-dashboard-feedback]");
const declineDialog = document.querySelector("[data-decline-dialog]");
const declineForm = document.querySelector("[data-decline-form]");
let bookings = [];
let selectedDeclineBookingId = "";
let loading = false;
let responding = false;

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function showGate(title, copy, { kind = "info", allowSignIn = false, allowRetry = false } = {}) {
  gate.hidden = false;
  gate.dataset.kind = kind;
  document.querySelector("[data-cleaner-gate-title]").textContent = title;
  document.querySelector("[data-cleaner-gate-copy]").textContent = copy;
  signIn.hidden = !allowSignIn;
  retry.hidden = !allowRetry;
  dashboard.hidden = true;
}

function showFeedback(message, kind = "info") {
  feedback.hidden = !message;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
  feedback.focus?.();
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers: { Accept: "application/json", ...headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || "The Cleaner dashboard could not be updated."), { statusCode: response.status, code: result.code });
  return result;
}

function bookingFacts(booking) {
  const facts = element("dl", "booking-summary-facts");
  const values = [
    ["When", formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt)],
    ["Area", booking.propertyArea || "Shared after confirmation"],
    [bookingSummaryPriceLabel("cleaner"), formatBookingMoney(booking.pricePence)],
    ["Checklist", `${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`]
  ];
  for (const [label, value] of values) {
    const wrapper = element("div");
    wrapper.append(element("dt", "", label), element("dd", "", value));
    facts.append(wrapper);
  }
  return facts;
}

function bookingCard(booking, pending = false) {
  const card = element("article", "booking-summary-card");
  const heading = element("div", "booking-summary-heading");
  const title = element("div");
  title.append(element("span", "booking-status-pill", bookingSummaryStatusLabels[booking.status] || "Booking"), element("h3", "", booking.cleaningType || "Cleaning"), element("p", "", `${booking.propertyName || "Cleaning property"} · ${booking.counterpartyName || "Landlord"}`));
  heading.append(title, element("strong", "booking-summary-price", formatBookingMoney(booking.pricePence)));
  card.append(heading, bookingFacts(booking));
  if (pending) {
    const deadline = element("p", "booking-response-deadline", booking.responseDeadline ? `Respond by ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(booking.responseDeadline))}` : "Response window unavailable");
    const actions = element("div", "booking-summary-actions");
    const accept = element("button", "button", "Accept request");
    accept.type = "button";
    const decline = element("button", "button button-outline", "Decline");
    decline.type = "button";
    accept.addEventListener("click", () => acceptBooking(booking, accept));
    decline.addEventListener("click", () => openDecline(booking));
    actions.append(accept, decline);
    card.append(deadline, actions);
  } else {
    const action = bookingSummaryPrimaryAction(booking, "cleaner");
    if (action.kind === "active-job") {
      const link = element("a", "button", action.label);
      link.href = `/bookings/${booking.bookingId}`;
      card.append(link);
    }
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
}

async function refreshBookings() {
  const result = await requestJson("/api/marketplace/bookings?limit=50");
  bookings = Array.isArray(result.bookings) ? result.bookings : [];
  renderBookings();
}

async function respondToBooking(bookingId, decision, reason, button) {
  if (responding) return;
  const csrf = storedCsrf();
  if (!csrf) return showFeedback("Your secure editing token is missing. Sign in again before answering this request.", "error");
  responding = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  showFeedback("");
  try {
    const result = await requestJson(`/api/marketplace/bookings/${bookingId}/response`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ decision, reason }) });
    if (decision === "accept" && Object.hasOwn(result.booking || {}, "customerPricePence")) throw new Error("Tideway withheld this response because private marketplace pricing was exposed.");
    await refreshBookings();
    showFeedback(decision === "accept" ? "Request accepted. Tideway rechecked your availability and the confirmed job is now in your dashboard." : "Request declined. Matching has reopened for the Landlord.", "success");
  } catch (error) {
    showFeedback(error.statusCode === 409 ? error.message : error.statusCode === 401 || error.statusCode === 403 ? "Your session expired or this request is no longer assigned to you. Sign in and refresh." : error.message, "error");
  } finally {
    responding = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function acceptBooking(booking, button) {
  const message = `Accept this cleaning request for ${formatBookingMoney(booking.pricePence)} on ${formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt)}? Tideway will recheck your availability before confirming.`;
  if (globalThis.confirm(message)) respondToBooking(booking.bookingId, "accept", "", button);
}

function openDecline(booking) {
  selectedDeclineBookingId = booking.bookingId;
  declineForm.reset();
  declineDialog.showModal();
}

declineForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const reason = new FormData(declineForm).get("reason")?.toString().trim() || "";
  const button = declineForm.querySelector('button[type="submit"]');
  declineDialog.close();
  respondToBooking(selectedDeclineBookingId, "decline", reason, button);
});

document.querySelector("[data-decline-cancel]").addEventListener("click", () => declineDialog.close());

async function loadDashboard() {
  if (loading) return;
  loading = true;
  showGate("Checking secure Cleaner access…", "Requests and jobs open only inside the assigned Cleaner account.");
  try {
    const [accountResult, bookingResult] = await Promise.all([requestJson("/api/marketplace/account"), requestJson("/api/marketplace/bookings?limit=50")]);
    const account = accountResult.account;
    if (account?.selectedRole !== "cleaner" || !account?.roles?.includes("cleaner")) return showGate("This is not a Cleaner account.", "Use the Cleaner workspace selected during onboarding.", { kind: "authentication", allowSignIn: true });
    bookings = Array.isArray(bookingResult.bookings) ? bookingResult.bookings : [];
    document.querySelector("[data-cleaner-name]").textContent = account.displayName || "Cleaner";
    renderBookings();
    showFeedback("");
    gate.hidden = true;
    dashboard.hidden = false;
  } catch (error) {
    if (error.statusCode === 401) showGate("Sign in as a Cleaner to open this dashboard.", "Requests and jobs are private to the assigned Cleaner account.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showGate("This account cannot open the Cleaner dashboard.", "Use a Cleaner account selected during onboarding.", { kind: "authentication", allowSignIn: true });
    else if ([404, 503].includes(error.statusCode)) showGate("Cleaner accounts are not connected yet.", "The dashboard is ready but remains closed until Tideway’s protected marketplace database and HTTPS runtime pass staging.", { kind: "unavailable", allowRetry: true });
    else showGate("The Cleaner dashboard is temporarily unavailable.", "No request was accepted or declined. Check the connection and try again.", { kind: "error", allowRetry: true });
  } finally { loading = false; }
}

retry.addEventListener("click", loadDashboard);
loadDashboard();
