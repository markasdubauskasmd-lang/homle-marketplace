import { notificationUnreadBadge } from "./notification-inbox-model.js";

const links = [...document.querySelectorAll("[data-notification-link]")];
let pending = null;
let lastLoadedAt = 0;
let stream = null;

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
      if (!response.ok) return null;
      const result = await response.json();
      return result?.ok === true && Number.isSafeInteger(result.unreadCount) ? result.unreadCount : null;
    })
    .then((count) => { if (count !== null) render(count); return count; })
    .catch(() => null)
    .finally(() => { lastLoadedAt = Date.now(); pending = null; });
  return pending;
}

function closeStream() {
  stream?.close();
  stream = null;
}

function openStream() {
  if (stream || typeof EventSource !== "function" || !links.length) return;
  stream = new EventSource("/api/marketplace/notifications/events", { withCredentials: true });
  stream.addEventListener("notification-ready", () => { void refresh(true); });
  stream.addEventListener("notification-updated", async () => {
    await refresh(true);
    dispatchEvent(new Event("homle:notification-updated"));
  });
}

async function start() {
  if (await refresh(true) !== null) openStream();
}

render(0);
void start();
addEventListener("pageshow", (event) => { if (event.persisted) void start(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
addEventListener("online", () => { if (!stream) void start(); });
addEventListener("pagehide", closeStream);
