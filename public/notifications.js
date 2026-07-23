import { readSignedInAccount } from "./account-menu.js?v=20260718-3";
import { notificationActionPath, notificationPresentation, notificationWorkspace } from "./notification-inbox-model.js";

const gate = document.querySelector("[data-notification-gate]");
const gateTitle = document.querySelector("[data-notification-gate-title]");
const gateCopy = document.querySelector("[data-notification-gate-copy]");
const signIn = document.querySelector("[data-notification-sign-in]");
const retry = document.querySelector("[data-notification-retry]");
const content = document.querySelector("[data-notification-content]");
const list = document.querySelector("[data-notification-list]");
const empty = document.querySelector("[data-notification-empty]");
const feedback = document.querySelector("[data-notification-feedback]");
const unread = document.querySelector("[data-unread-count]");
const markAll = document.querySelector("[data-mark-all-read]");
const loadMore = document.querySelector("[data-load-more]");
const workspaceLinks = [...document.querySelectorAll("[data-workspace-link], [data-empty-workspace-link]")];
const workspaceNavigations = [...document.querySelectorAll("[data-workspace-nav]")];
const workspaceBrand = document.querySelector("[data-workspace-brand]");
const workspacePill = document.querySelector("[data-workspace-pill]");
const workspaceHeading = document.querySelector("[data-workspace-heading]");
const workspaceHeader = document.querySelector("[data-workspace-header]");

let notifications = [];
let unreadCount = 0;
let nextCursor = null;
let loading = false;
let inboxCutoff = new Date().toISOString();

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

function csrfToken() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || "Your updates could not be loaded."), { status: response.status });
  return result;
}

function showGate(title, message, options = {}) {
  gate.hidden = false;
  content.hidden = true;
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

function showWorkspace(account) {
  const workspace = notificationWorkspace(account);
  for (const link of workspaceLinks) link.href = workspace.path;
  for (const navigation of workspaceNavigations) navigation.hidden = navigation.dataset.workspaceNav !== workspace.role;
  if (workspaceBrand) {
    workspaceBrand.href = "/";
    workspaceBrand.setAttribute("aria-label", "Homle home");
  }
  if (workspacePill) workspacePill.textContent = workspace.label;
  if (workspaceHeading) workspaceHeading.textContent = `${workspace.label} updates`;
  document.body.classList.toggle("cleaner-workspace-page", workspace.role === "cleaner");
  document.body.classList.toggle("landlord-dashboard-page", workspace.role === "landlord");
  workspaceHeader?.classList.toggle("cleaner-site-header", workspace.role === "cleaner");
}

function formattedTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recently";
  const sameDay = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat("en-GB", sameDay ? { hour: "2-digit", minute: "2-digit" } : { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function postRead(notificationId) {
  const csrf = csrfToken();
  if (!csrf) return;
  fetch(`/api/marketplace/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "POST", credentials: "same-origin", cache: "no-store", keepalive: true,
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}"
  }).catch(() => {});
}

function renderItem(item) {
  const article = document.createElement("article");
  article.className = `notification-card${item.readAt ? "" : " notification-card-unread"}`;
  const marker = document.createElement("span");
  marker.className = "notification-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = item.readAt ? "✓" : "•";
  const body = document.createElement("div");
  const presentation = notificationPresentation(item.eventType);
  const heading = document.createElement("h2");
  heading.textContent = presentation.title;
  const description = document.createElement("p");
  description.textContent = presentation.description;
  const time = document.createElement("time");
  time.dateTime = item.createdAt;
  time.textContent = formattedTime(item.createdAt);
  body.append(heading, description, time);
  article.append(marker, body);
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

function render() {
  list.replaceChildren(...notifications.map(renderItem));
  unread.textContent = `${unreadCount} unread`;
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
    showGate("Checking your private updates…", "Only updates for your signed-in account can appear here.");
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
    const [accountResult, notificationResult] = await Promise.all([
      initial ? readSignedInAccount() : Promise.resolve(null),
      requestJson(`/api/marketplace/notifications?${query}`)
    ]);
    if (initial) {
      notifications = [];
      showWorkspace(accountResult.account);
    }
    appendPage(notificationResult);
    gate.hidden = true;
    content.hidden = false;
    showFeedback("");
  } catch (error) {
    if (initial) {
      const unauthenticated = error.status === 401 || error.status === 403;
      showGate(unauthenticated ? "Sign in to see your updates." : "Updates are temporarily unavailable.", unauthenticated ? "Homle keeps booking updates private to the account involved." : "Your bookings are safe. Check your connection and try again.", { signIn: unauthenticated, retry: !unauthenticated });
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
load(true);
