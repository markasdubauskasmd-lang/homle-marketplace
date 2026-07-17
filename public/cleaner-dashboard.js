import { bookingSummaryBuckets, bookingSummaryPrimaryAction, bookingSummaryPriceLabel, bookingSummaryStatusLabels, cleanerInvitationDecisionState, formatBookingMoney, formatBookingWindow } from "./booking-summary-model.js?v=20260717-2";

const gate = document.querySelector("[data-cleaner-dashboard-gate]");
const dashboard = document.querySelector("[data-cleaner-dashboard]");
const retry = document.querySelector("[data-cleaner-retry]");
const signIn = document.querySelector("[data-cleaner-sign-in]");
const feedback = document.querySelector("[data-cleaner-dashboard-feedback]");
const declineDialog = document.querySelector("[data-decline-dialog]");
const declineForm = document.querySelector("[data-decline-form]");
const declineCancel = document.querySelector("[data-decline-cancel]");
const networkStatus = document.querySelector("[data-cleaner-network-status]");
let bookings = [];
let selectedDeclineBookingId = "";
let loading = false;
let responding = false;
let payoutStatus = null;
let availabilityWindows = [];
let cleanerProfile = null;

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

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

function requestScanPreview(booking, pending = false, onReady = () => {}) {
  const details = element("details", "cleaner-request-scan");
  details.append(element("summary", "", pending ? "Approved room checklist" : "View private room scan"));
  const body = element("div", "cleaner-request-scan-body");
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

function bookingCard(booking, pending = false) {
  const card = element("article", "booking-summary-card");
  const heading = element("div", "booking-summary-heading");
  const title = element("div");
  title.append(element("span", "booking-status-pill", bookingSummaryStatusLabels[booking.status] || "Booking"), element("h3", "", booking.cleaningType || "Cleaning"), element("p", "", `${booking.propertyName || "Cleaning property"} · ${booking.counterpartyName || "Landlord"}`));
  const pay = element("div", "booking-summary-price");
  pay.append(element("small", "", bookingSummaryPriceLabel("cleaner")), element("strong", "", formatBookingMoney(booking.pricePence)));
  heading.append(title, pay);
  card.append(heading, bookingFacts(booking));
  if (pending) {
    const deadline = element("p", "booking-response-deadline", booking.responseDeadline ? `Respond by ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(booking.responseDeadline))}` : "Response window unavailable");
    const actions = element("div", "booking-summary-actions");
    const accept = element("button", "button", "Loading checklist…");
    accept.type = "button";
    accept.disabled = true;
    const decline = element("button", "button button-outline", "Decline");
    decline.type = "button";
    accept.addEventListener("click", () => acceptBooking(booking, accept));
    decline.addEventListener("click", () => openDecline(booking));
    actions.append(accept, decline);
    const scopeBoundary = element("p", "booking-accept-boundary", "Acceptance unlocks after the exact room checklist loads. Then one tap confirms this time, scope and pay; Homle rechecks overlaps before confirming.");
    if (booking.cleaningRequestId) card.append(requestScanPreview(booking, true, ({ taskCount, roomCount }) => {
      accept.disabled = false;
      accept.textContent = `Accept ${formatBookingMoney(booking.pricePence)} job`;
      scopeBoundary.textContent = `${taskCount} approved ${taskCount === 1 ? "task" : "tasks"} across ${roomCount} ${roomCount === 1 ? "room" : "rooms"}. One tap confirms this exact time, scope and pay; Homle rechecks overlaps before confirming.`;
    }));
    else scopeBoundary.textContent = "The exact room checklist is unavailable. Do not accept this request; refresh the dashboard to verify its status.";
    card.append(deadline, scopeBoundary, actions);
  } else {
    const action = bookingSummaryPrimaryAction(booking, "cleaner");
    if (action.kind === "active-job") {
      const link = element("a", "button", action.label);
      link.href = `/bookings/${booking.bookingId}`;
      card.append(link);
    }
    if (booking.cleaningRequestId && !["cancelled", "expired"].includes(booking.status)) card.append(requestScanPreview(booking));
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
  renderNextAction(buckets, cleanerProfile, payoutStatus, availabilityWindows);
}

function renderNextAction(buckets, profile, payout, availability) {
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
  const csrf = await recoverCsrf();
  if (!csrf) return false;
  responding = true;
  const originalLabel = button.textContent;
  button.disabled = true;
  if (decision === "decline") declineCancel.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = decision === "accept" ? "Accepting…" : "Declining…";
  showFeedback("");
  try {
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
    const [accountResult, bookingResult, profileResult, payoutResult, availabilityResult] = await Promise.all([requestJson("/api/marketplace/account"), requestJson("/api/marketplace/bookings?limit=50"), requestJson("/api/marketplace/cleaner/profile"), loadOptionalPayoutStatus(), requestJson("/api/marketplace/cleaner/availability")]);
    const account = accountResult.account;
    if (account?.selectedRole !== "cleaner" || !account?.roles?.includes("cleaner")) return showGate("This is not a Cleaner account.", "Use the Cleaner workspace selected during onboarding.", { kind: "authentication", allowSignIn: true });
    bookings = Array.isArray(bookingResult.bookings) ? bookingResult.bookings : [];
    cleanerProfile = profileResult.profile && typeof profileResult.profile === "object" ? profileResult.profile : null;
    payoutStatus = payoutResult;
    availabilityWindows = Array.isArray(availabilityResult.availability) ? availabilityResult.availability : [];
    document.querySelector("[data-cleaner-payout-link]").hidden = payoutStatus == null;
    document.querySelector("[data-cleaner-profile-link]").textContent = cleanerProfile?.profileCompletionPercent === 100 ? "Edit profile" : "Complete your profile";
    document.querySelector("[data-cleaner-name]").textContent = account.displayName || "Cleaner";
    renderBookings();
    showFeedback("");
    gate.hidden = true;
    dashboard.hidden = false;
  } catch (error) {
    if (error.code === "browser-offline") showGate("You are offline.", "Reconnect to securely load your current requests and jobs. No decision was sent.", { kind: "offline", allowRetry: true });
    else if (error.statusCode === 401) showGate("Sign in as a Cleaner to open this dashboard.", "Requests and jobs are private to the assigned Cleaner account.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showGate("This account cannot open the Cleaner dashboard.", "Use a Cleaner account selected during onboarding.", { kind: "authentication", allowSignIn: true });
    else if ([404, 503].includes(error.statusCode)) showGate("Cleaner accounts are not connected yet.", "The dashboard is ready but remains closed until Homle’s protected marketplace database and HTTPS runtime pass staging.", { kind: "unavailable", allowRetry: true });
    else showGate("The Cleaner dashboard is temporarily unavailable.", "No request was accepted or declined. Check the connection and try again.", { kind: "error", allowRetry: true });
  } finally { loading = false; }
}

retry.addEventListener("click", loadDashboard);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("online", () => {
  updateNetworkStatus();
  if (!gate.hidden && gate.dataset.kind === "offline") loadDashboard();
});
updateNetworkStatus();
loadDashboard();
