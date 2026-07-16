import { notificationUnreadBadge } from "./notification-inbox-model.js";

const links = [...document.querySelectorAll("[data-notification-link]")];
let pending = null;
let lastLoadedAt = 0;

function render(value) {
  const badge = notificationUnreadBadge(value);
  for (const link of links) {
    const count = link.querySelector("[data-notification-count]");
    if (!count) continue;
    count.textContent = badge.label;
    count.hidden = !badge.visible;
    link.setAttribute("aria-label", badge.visible ? `Updates, ${badge.count} unread` : "Updates");
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
    .then((count) => { if (count !== null) render(count); })
    .catch(() => {})
    .finally(() => { lastLoadedAt = Date.now(); pending = null; });
  return pending;
}

render(0);
refresh(true);
addEventListener("pageshow", (event) => { if (event.persisted) refresh(true); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
