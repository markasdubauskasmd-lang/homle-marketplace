import { notificationUnreadBadge } from "./notification-inbox-model.js";
import { storedCsrf } from "./session-csrf.js";

// The Cleaner workspace deliberately keeps its frozen notification client. The
// Landlord dashboard owns this copy so a Landlord session ending cannot leave a
// native EventSource retrying a private endpoint indefinitely in the background.
const links = [...document.querySelectorAll("[data-notification-link]")];
let pending = null;
let lastLoadedAt = 0;
let lastResponseStatus = 0;
let streamController = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

function accessReady() {
  return links.some((link) => !link.hidden);
}

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
  streamController?.abort();
  streamController = null;
}

function cancelReconnect() {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  if (!accessReady() || reconnectTimer !== null || document.visibilityState !== "visible" || !navigator.onLine) return;
  const delay = Math.min(60_000, 2 ** Math.min(reconnectAttempt, 6) * 1_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void start();
  }, delay);
}

function parseEventBlock(block) {
  let eventName = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") eventName = value;
    if (field === "data") data.push(value);
  }
  return { eventName, data: data.join("\n") };
}

async function consumeStream(response, signal) {
  if (!response.ok) throw Object.assign(new Error("The private notification stream could not be opened."), { statusCode: response.status });
  if (!String(response.headers.get("content-type") || "").startsWith("text/event-stream") || !response.body?.getReader) throw new Error("Live notification updates are unavailable in this browser.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
    if (buffer.length > 65_536) throw new Error("The private notification stream sent an invalid response.");
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const event = parseEventBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (event.eventName === "notification-ready") {
        reconnectAttempt = 0;
        void refresh(true);
      } else if (event.eventName === "notification-updated") {
        await refresh(true);
        dispatchEvent(new Event("homle:notification-updated"));
      }
    }
  }
}

async function openStream() {
  if (!accessReady() || streamController || !links.length) return;
  const csrf = storedCsrf();
  if (!csrf) return;
  const controller = new AbortController();
  streamController = controller;
  try {
    // EventSource cannot attach the CSRF header and Chrome can omit Origin from
    // its same-origin GET. A streamed POST preserves real-time delivery while
    // proving both exact origin and the current Landlord session to the server.
    const response = await fetch("/api/marketplace/notifications/events", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "text/event-stream", "X-CSRF-Token": csrf },
      signal: controller.signal
    });
    await consumeStream(response, controller.signal);
    if (!controller.signal.aborted) scheduleReconnect();
  } catch (error) {
    if (controller.signal.aborted) return;
    lastResponseStatus = Number(error?.statusCode) || 0;
    reconnectAttempt += 1;
    if (lastResponseStatus !== 401 && lastResponseStatus !== 403) scheduleReconnect();
  } finally {
    if (streamController === controller) streamController = null;
  }
}

async function start() {
  // The link is revealed only after the Landlord bootstrap authorises this
  // account. A module-load request would race that boundary and turn every
  // signed-out visit into a needless private 401.
  if (!accessReady()) {
    stop();
    return;
  }
  cancelReconnect();
  const count = await refresh(true);
  if (count !== null) {
    void openStream();
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
if (accessReady()) void start();
addEventListener("homle:landlord-session-ready", () => { void start(); });
addEventListener("pageshow", (event) => { if (event.persisted) void start(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void start();
  else stop();
});
addEventListener("online", () => { void start(); });
addEventListener("offline", stop);
addEventListener("pagehide", stop);
