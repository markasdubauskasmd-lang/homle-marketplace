import {
  notificationActionPath,
  notificationDayGroup,
  notificationGroups,
  notificationPresentation,
  notificationTone,
  notificationWorkspace
} from "./notification-inbox-model.js?v=20260830-1";
import { createRequestJson } from "./request-json.js";
import { renderWorkspaceShell } from "./workspace-shell.js?v=20260830-1";

// The old Cleaner Messages tab pointed at this generic Updates page with a query
// string. Keep that bookmark working while giving Messages its own private inbox.
if (new URLSearchParams(location.search).get("view") === "messages") {
  location.replace("/cleaner/messages");
}

const gate = document.querySelector("[data-notification-gate]");
const gateTitle = document.querySelector("[data-notification-gate-title]");
const gateCopy = document.querySelector("[data-notification-gate-copy]");
const signIn = document.querySelector("[data-notification-sign-in]");
const retry = document.querySelector("[data-notification-retry]");
const skeleton = document.querySelector("[data-notification-skeleton]");
const content = document.querySelector("[data-notification-content]");
const list = document.querySelector("[data-notification-list]");
const empty = document.querySelector("[data-notification-empty]");
const emptyLink = document.querySelector("[data-empty-workspace-link]");
const feedback = document.querySelector("[data-notification-feedback]");
const unread = document.querySelector("[data-unread-count]");
const markAll = document.querySelector("[data-mark-all-read]");
const loadMore = document.querySelector("[data-load-more]");

let notifications = [];
let unreadCount = 0;
let nextCursor = null;
let loading = false;
let inboxCutoff = new Date().toISOString();

function csrfToken() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

const requestJson = createRequestJson({ failureMessage: "Your updates could not be loaded." });

function showGate(title, message, options = {}) {
  gate.hidden = false;
  content.hidden = true;
  skeleton.hidden = options.loading !== true;
  gateTitle.textContent = title;
  gateCopy.textContent = message;
  signIn.hidden = options.signIn !== true;
  retry.hidden = options.retry !== true;
}

function showFeedback(message, kind = "error") {
  feedback.textContent = message;
  feedback.dataset.kind = kind;
  feedback.hidden = !message;
}

/* ── Time ──────────────────────────────────────────────────────────────────
 *
 * Two facts, not one. The relative phrase is what a reader actually wants from
 * an inbox — "20 minutes ago" answers "is this still happening?" — and the exact
 * time stays available on hover and to a screen reader, because "2 days ago" is
 * useless when you are checking which visit an update belonged to.
 */
const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
const exact = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayAndClock = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function formattedTime(value, now = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { text: "Recently", title: "", iso: "" };
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const group = notificationDayGroup(value, now);
  let text;
  if (group.key === "today") {
    if (seconds > -60) text = "Just now";
    else if (seconds > -3600) text = relative.format(Math.round(seconds / 60), "minute");
    else text = `${relative.format(Math.round(seconds / 3600), "hour")} · ${clock.format(date)}`;
  } else if (group.key === "yesterday") text = `Yesterday, ${clock.format(date)}`;
  else text = dayAndClock.format(date);
  return { text, title: exact.format(date), iso: date.toISOString() };
}

function postRead(notificationId) {
  const csrf = csrfToken();
  if (!csrf) return;
  fetch(`/api/marketplace/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "POST", credentials: "same-origin", cache: "no-store", keepalive: true,
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}"
  }).catch(() => {});
}

/* The glyphs. Chosen by tone, which is chosen by event type — never by anything
   in the payload, so no stored text can decide how an update presents itself.
   Described as data and built with DOM calls: this module renders account
   content, so it assigns no raw markup anywhere — there is nothing for an
   injected string to hide in, and the inbox test asserts that stays true. */
const svgNamespace = "http://www.w3.org/2000/svg";
const dot = (cx, cy) => ["circle", { cx, cy, r: ".9", fill: "currentColor", stroke: "none" }];
const glyphShapes = Object.freeze({
  action: [["circle", { cx: "12", cy: "12", r: "8.4" }], ["path", { d: "M12 7.6v5l3 1.7" }]],
  alert: [["path", { d: "M12 4.6 21 19.4H3z" }], ["path", { d: "M12 10v4" }], dot("12", "16.9")],
  success: [["circle", { cx: "12", cy: "12", r: "8.4" }], ["path", { d: "m8.4 12.2 2.6 2.6 4.6-5" }]],
  journey: [["path", { d: "M4 17h2.2a2.2 2.2 0 0 0 4.4 0h3.2a2.2 2.2 0 0 0 4.4 0H20" }], ["path", { d: "M3.6 17V9.4h9.2V17M12.8 11.6h3.4L20 14.6V17" }]],
  progress: [["path", { d: "M4.2 12a7.8 7.8 0 1 1 2.6 5.8" }], ["path", { d: "M4 13.4V17.6h4.2" }]],
  message: [["rect", { x: "3.5", y: "5", width: "17", height: "12.5", rx: "3" }], ["path", { d: "M8 21l3.2-3.5" }]],
  neutral: [["circle", { cx: "12", cy: "12", r: "8.4" }], ["path", { d: "M12 8.2v4.4" }], dot("12", "15.9")]
});

function glyph(name) {
  const element = document.createElementNS(svgNamespace, "svg");
  element.setAttribute("viewBox", "0 0 24 24");
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
  for (const [tag, attributes] of glyphShapes[name] || glyphShapes.neutral) {
    const shape = document.createElementNS(svgNamespace, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    element.append(shape);
  }
  return element;
}

function renderItem(item, now) {
  const article = document.createElement("article");
  const tone = notificationTone(item.eventType);
  article.className = `notification-card${item.readAt ? "" : " notification-card-unread"}`;
  article.dataset.tone = tone.tone;

  const marker = document.createElement("span");
  marker.className = "notification-marker";
  marker.append(glyph(tone.glyph));

  const presentation = notificationPresentation(item.eventType);
  const heading = document.createElement("h2");
  heading.className = "notification-title";
  heading.textContent = presentation.title;
  const description = document.createElement("p");
  description.textContent = presentation.description;

  const meta = document.createElement("div");
  meta.className = "notification-meta";
  const stamp = formattedTime(item.createdAt, now);
  const time = document.createElement("time");
  time.dateTime = stamp.iso || item.createdAt;
  if (stamp.title) time.title = stamp.title;
  time.textContent = stamp.text;
  meta.append(time);
  if (!item.readAt) {
    const tag = document.createElement("span");
    tag.className = "notification-unread-tag";
    tag.textContent = "New";
    meta.append(tag);
  }

  article.append(marker, heading, description, meta);

  const path = notificationActionPath(item.eventType, item.bookingId, item.payload);
  if (path) {
    const link = document.createElement("a");
    link.className = "button button-outline notification-action";
    link.href = path;
    link.textContent = presentation.action;
    if (!item.readAt) link.addEventListener("click", () => postRead(item.notificationId));
    article.append(link);
  }
  return article;
}

function renderGroup(group, now) {
  const section = document.createElement("section");
  section.className = "notification-group";
  const label = document.createElement("h2");
  label.className = "notification-group-label";
  label.textContent = group.label;
  const items = document.createElement("div");
  items.className = "notification-group-items";
  items.append(...group.items.map((item) => renderItem(item, now)));
  section.append(label, items);
  return section;
}

function render() {
  const now = new Date();
  list.replaceChildren(...notificationGroups(notifications, now).map((group) => renderGroup(group, now)));
  unread.textContent = unreadCount === 1 ? "1 unread" : `${unreadCount} unread`;
  markAll.disabled = unreadCount === 0;
  empty.hidden = notifications.length !== 0;
  loadMore.hidden = !nextCursor;
  loadMore.disabled = loading;
}

function appendPage(result) {
  const known = new Set(notifications.map((item) => item.notificationId));
  for (const item of Array.isArray(result.notifications) ? result.notifications : []) if (!known.has(item.notificationId)) notifications.push(item);
  unreadCount = Number.isSafeInteger(result.unreadCount) ? result.unreadCount : 0;
  nextCursor = result.hasMore === true ? result.nextCursor : null;
  render();
}

async function load(initial = true) {
  if (loading) return;
  loading = true;
  retry.disabled = true;
  if (initial) {
    inboxCutoff = new Date().toISOString();
    showGate("Checking your private updates…", "Only updates for your signed-in account can appear here.", { loading: true });
  } else {
    loadMore.textContent = "Loading…";
    loadMore.disabled = true;
  }
  try {
    const query = new URLSearchParams({ limit: "30" });
    if (!initial && nextCursor) {
      query.set("beforeCreatedAt", nextCursor.beforeCreatedAt);
      query.set("beforeNotificationId", nextCursor.beforeNotificationId);
    }
    const notificationResult = await requestJson(`/api/marketplace/notifications?${query}`);
    if (initial) notifications = [];
    appendPage(notificationResult);
    gate.hidden = true;
    skeleton.hidden = true;
    content.hidden = false;
    showFeedback("");
  } catch (error) {
    if (initial) {
      const unauthenticated = error.status === 401 || error.status === 403;
      skeleton.hidden = true;
      showGate(
        unauthenticated ? "Sign in to see your updates." : "Updates are temporarily unavailable.",
        unauthenticated ? "Homle keeps booking updates private to the account involved." : "Your bookings are safe. Check your connection and try again.",
        { signIn: unauthenticated, retry: !unauthenticated }
      );
    } else showFeedback("Earlier updates could not be loaded. Check your connection and try again.");
  } finally {
    loading = false;
    retry.disabled = false;
    loadMore.textContent = "Load earlier updates";
    if (!content.hidden) render();
  }
}

markAll.addEventListener("click", async () => {
  const csrf = csrfToken();
  if (!csrf) return showFeedback("Your secure editing token is missing. Sign in again before changing updates.");
  markAll.disabled = true;
  markAll.textContent = "Marking read…";
  try {
    await requestJson("/api/marketplace/notifications/read-all", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ cutoffCreatedAt: inboxCutoff }) });
    await load(true);
    showFeedback("All updates shown here are marked as read.", "success");
  } catch (error) {
    showFeedback(error.status === 401 || error.status === 403 ? "Your session expired. Sign in again to continue." : "Updates could not be marked as read. Please try again.");
  } finally {
    markAll.textContent = "Mark all read";
    markAll.disabled = unreadCount === 0;
  }
});

retry.addEventListener("click", () => load(true));
loadMore.addEventListener("click", () => load(false));
addEventListener("online", () => { if (!content.hidden) showFeedback("You are back online. You can retry any failed action.", "success"); });
addEventListener("offline", () => { if (!content.hidden) showFeedback("You are offline. Existing updates remain visible; new updates need a connection."); });

// Cleaners have their own inbox. This is the single statement of that rule: the
// page used to redirect here AND carry a whole unreachable Cleaner navigation,
// plus Cleaner branches in a function that ran only after the redirect.
const shell = await renderWorkspaceShell({
  active: "account",
  title: "Updates",
  subtitle: "Booking requests, arrival, cleaning progress and messages — in one place.",
  hideBell: true
});
if (shell?.shell.role === "cleaner") location.replace("/cleaner/notifications");
else {
  // The empty state's action is the account's own workspace. It used to default
  // to /login, so a signed-in Landlord with a quiet inbox was offered sign-in as
  // the primary action on the page.
  if (emptyLink && shell?.shell.home) emptyLink.href = shell.shell.home;
  const workspace = notificationWorkspace(shell?.account);
  if (signIn) signIn.href = workspace.role ? workspace.path : "/login?intent=book";
  await load(true);
}
