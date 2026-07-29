import { notificationActionPath, notificationPresentation } from "./notification-inbox-model.js";
import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-11";
import { createRequestJson } from "./request-json.js";

const list = document.querySelector("[data-cleaner-notification-list]");
const empty = document.querySelector("[data-cleaner-notification-empty]");
const unread = document.querySelector("[data-cleaner-notification-unread]");
const markAll = document.querySelector("[data-cleaner-notification-read-all]");
const loadMore = document.querySelector("[data-cleaner-notification-more]");
const emailDetail = document.querySelector("[data-cleaner-notification-email]");

const state = {
  notifications: [],
  unreadCount: 0,
  nextCursor: null,
  inboxCutoff: new Date().toISOString(),
  loading: false,
  requestJson: null,
  showFeedback: null
};

const mutationJson = createRequestJson({
  failureMessage: "Your notifications could not be updated.",
  timeoutMs: 30_000,
  timeoutMessage: "Updating took longer than expected. Check the list before trying again.",
  requireResultOk: true
});

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function saveCsrf(value) {
  try { sessionStorage.setItem("tideway_csrf", value); } catch {}
}

async function csrfToken() {
  const stored = storedCsrf();
  if (stored) return stored;
  const result = await mutationJson("/api/marketplace/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!result.csrfToken) throw new Error("Your secure session could not be refreshed.");
  saveCsrf(result.csrfToken);
  return result.csrfToken;
}

function compactTime(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "Recent";
  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 60 * 60 * 1000) return `${Math.max(1, Math.floor(elapsed / 60_000))}m`;
  if (elapsed >= 0 && elapsed < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(elapsed / 3_600_000))}h`;
  if (elapsed >= 0 && elapsed < 7 * 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(elapsed / 86_400_000))}d`;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date);
}

function notificationTone(item) {
  const eventType = String(item?.eventType || "").toLowerCase();
  if (/(declined|expired|failed|cancelled|dispute|action-required)/.test(eventType)) return "is-alert";
  if (/(reminder|review|pending|requested|invitation)/.test(eventType)) return "is-warning";
  if (/(confirmed|accepted|verified|completed|resolved|paid)/.test(eventType)) return "is-success";
  return "is-neutral";
}

function markOneRead(item) {
  if (item.readAt) return;
  const csrf = storedCsrf();
  if (!csrf) return;
  fetch(`/api/marketplace/notifications/${encodeURIComponent(item.notificationId)}/read`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    keepalive: true,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf
    },
    body: "{}"
  }).catch(() => {});
}

function renderNotification(item) {
  const row = element("article", `hc-notification-row${item.readAt ? "" : " is-unread"}`);
  const dot = element("span", `hc-notification-dot ${notificationTone(item)}`);
  dot.setAttribute("aria-hidden", "true");

  const body = element("div", "hc-notification-copy");
  const presentation = notificationPresentation(item.eventType);
  const path = notificationActionPath(item.eventType, item.bookingId, item.payload);
  const title = element(path ? "a" : "strong", "hc-notification-title", presentation.title);
  if (path) {
    title.href = path;
    title.addEventListener("click", () => markOneRead(item));
  }
  body.append(title, element("p", "", presentation.description));

  const time = element("time", "", compactTime(item.createdAt));
  time.dateTime = item.createdAt || "";
  row.append(dot, body, time);
  return row;
}

function render() {
  list.replaceChildren(...state.notifications.map(renderNotification));
  empty.hidden = state.notifications.length !== 0;
  unread.textContent = state.unreadCount > 0
    ? `${state.unreadCount} unread`
    : "All read";
  markAll.disabled = state.unreadCount === 0 || state.loading;
  loadMore.hidden = !state.nextCursor;
  loadMore.disabled = state.loading;
}

function appendPage(result, reset) {
  if (reset) state.notifications = [];
  const known = new Set(state.notifications.map((item) => item.notificationId));
  for (const item of Array.isArray(result.notifications) ? result.notifications : []) {
    if (!known.has(item.notificationId)) state.notifications.push(item);
  }
  state.unreadCount = Number.isSafeInteger(result.unreadCount) ? result.unreadCount : 0;
  state.nextCursor = result.hasMore === true ? result.nextCursor : null;
  render();
}

async function loadNotifications(reset = true) {
  if (state.loading || !state.requestJson) return;
  state.loading = true;
  if (reset) state.inboxCutoff = new Date().toISOString();
  loadMore.textContent = reset ? "Load earlier notifications" : "Loading…";
  render();

  try {
    const query = new URLSearchParams({ limit: "30" });
    if (!reset && state.nextCursor) {
      query.set("beforeCreatedAt", state.nextCursor.beforeCreatedAt);
      query.set("beforeNotificationId", state.nextCursor.beforeNotificationId);
    }
    const result = await state.requestJson(`/api/marketplace/notifications?${query}`);
    appendPage(result, reset);
    state.showFeedback("");
  } catch (error) {
    state.showFeedback(
      error.code === "browser-offline"
        ? "You are offline. Existing notifications remain visible."
        : "Notifications could not be loaded. Check the connection and try again.",
      "error"
    );
  } finally {
    state.loading = false;
    loadMore.textContent = "Load earlier notifications";
    render();
  }
}

markAll.addEventListener("click", async () => {
  if (state.loading || state.unreadCount === 0) return;
  state.loading = true;
  markAll.textContent = "Marking…";
  render();
  try {
    const csrf = await csrfToken();
    await mutationJson("/api/marketplace/notifications/read-all", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ cutoffCreatedAt: state.inboxCutoff })
    });
    const readAt = new Date().toISOString();
    state.notifications = state.notifications.map((item) => item.readAt ? item : { ...item, readAt });
    state.unreadCount = 0;
    state.showFeedback("All notifications shown here are marked as read.", "success");
    window.dispatchEvent(new CustomEvent("homle:notification-updated"));
  } catch (error) {
    state.showFeedback(
      error.status === 401 || error.statusCode === 401
        ? "Your session expired. Sign in again to continue."
        : error.message || "Notifications could not be marked as read.",
      "error"
    );
  } finally {
    state.loading = false;
    markAll.textContent = "Mark all as read";
    render();
  }
});

loadMore.addEventListener("click", () => loadNotifications(false));
window.addEventListener("homle:notification-updated", () => {
  if (!state.loading) void loadNotifications(true);
});

createCleanerPage("cleaner-notifications", async ({ account, showFeedback, requestJson }) => {
  state.requestJson = requestJson;
  state.showFeedback = showFeedback;
  emailDetail.textContent = account.email || "No email connected";
  await loadNotifications(true);
});
