import { notificationUnreadBadge } from "./notification-inbox-model.js";

// The Cleaner workspace deliberately keeps its frozen notification client. The
// Landlord dashboard owns this copy so a Landlord session ending cannot leave a
// native EventSource retrying a private endpoint indefinitely in the background.
const links = [...document.querySelectorAll("[data-notification-link]")];
let pending = null;
let lastLoadedAt = 0;
let lastResponseStatus = 0;
let stream = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

function render(value) {
  const badge = notificationUnreadBadge(value);
  for (const link of links) {
    const count = link.querySelector("[data-notification-count]");
    if (!count) continue;
    const label = link.dataset.notificationLabel || "Notifications";
    count.textContent = badge.label;
    count.hidden = !badge.visible;
    link.setAttribute("aria-label", badge.visible ? `${label}, ${badge.count} unread` : label);
  }
}

async function refresh(force = false) {
  if (!links.length || pending || (!force && Date.now() - lastLoadedAt < 30_000)) return pending;
  pending = fetch("/api/marketplace/notifications?limit=1", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
    .then(async (response) => {
      lastResponseStatus = response.status;
      if (!response.ok) return null;
      const result = await response.json();
      return result?.ok === true && Number.isSafeInteger(result.unreadCount) ? result.unreadCount : null;
    })
    .then((count) => { if (count !== null) render(count); return count; })
    .catch(() => { lastResponseStatus = 0; return null; })
    .finally(() => { lastLoadedAt = Date.now(); pending = null; });
  return pending;
}

function closeStream() {
  stream?.close();
  stream = null;
}

function cancelReconnect() {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer !== null || document.visibilityState !== "visible" || !navigator.onLine) return;
  const delay = Math.min(60_000, 2 ** Math.min(reconnectAttempt, 6) * 1_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void start();
  }, delay);
}

function openStream() {
  if (stream || typeof EventSource !== "function" || !links.length) return;
  stream = new EventSource("/api/marketplace/notifications/events", { withCredentials: true });
  stream.addEventListener("notification-ready", () => {
    reconnectAttempt = 0;
    void refresh(true);
  });
  stream.addEventListener("notification-updated", async () => {
    await refresh(true);
    dispatchEvent(new Event("homle:notification-updated"));
  });
  stream.onerror = () => {
    // EventSource otherwise retries 401/403 responses forever. Close the native
    // retry loop and re-check the bounded account read before opening a new one.
    closeStream();
    reconnectAttempt += 1;
    scheduleReconnect();
  };
}

async function start() {
  cancelReconnect();
  const count = await refresh(true);
  if (count !== null) {
    reconnectAttempt = 0;
    openStream();
    return;
  }
  // An ended session is terminal until the page is signed in or shown again.
  // Transient network/provider failures get a deliberate, capped retry instead.
  if (lastResponseStatus !== 401 && lastResponseStatus !== 403) {
    reconnectAttempt += 1;
    scheduleReconnect();
  }
}

function stop() {
  cancelReconnect();
  closeStream();
}

render(0);
void start();
addEventListener("pageshow", (event) => { if (event.persisted) void start(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void start();
  else stop();
});
addEventListener("online", () => { void start(); });
addEventListener("offline", stop);
addEventListener("pagehide", stop);

