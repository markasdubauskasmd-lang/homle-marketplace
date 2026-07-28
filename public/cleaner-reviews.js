import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";
import { renderCleanerNav } from "./cleaner-sidebar.js?v=20260728-4";

const gate = document.querySelector("[data-reviews-gate]");
const gateTitle = document.querySelector("[data-reviews-gate-title]");
const gateCopy = document.querySelector("[data-reviews-gate-copy]");
const signIn = document.querySelector("[data-reviews-sign-in]");
const retry = document.querySelector("[data-reviews-retry]");
const view = document.querySelector("[data-reviews]");
const offline = document.querySelector("[data-reviews-offline]");
const feedback = document.querySelector("[data-reviews-feedback]");
const list = document.querySelector("[data-reviews-list]");
const empty = document.querySelector("[data-reviews-empty]");
const bars = document.querySelector("[data-reviews-bars]");

const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });

let loading = false;

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

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
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

async function requestJson(path) {
  if (browserOffline()) throw Object.assign(new Error("You are offline."), { code: "browser-offline" });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(path, { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw Object.assign(new Error(body.error || "Homle could not load your reviews."), { statusCode: response.status, code: body.code });
  return body;
}

function starText(rating) {
  const whole = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return "★".repeat(whole) + "☆".repeat(5 - whole);
}

function reviewDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : "Date unavailable";
}

// The public review projection deliberately carries no Landlord identity, so reviews are
// attributed to a verified client rather than inventing a name or area for the card.
function renderReviews(reviews) {
  empty.hidden = reviews.length > 0;
  list.replaceChildren(...reviews.map((review) => {
    const card = element("article", "hc-rev");
    const head = element("div", "hc-rev-head");
    head.append(element("div", "hc-rev-avatar", "C"));
    const who = element("div", "hc-rev-who");
    who.append(
      element("div", "hc-rev-name", "Verified client"),
      element("div", "hc-rev-meta", `Completed job · ${reviewDate(review.createdAt)}`)
    );
    head.append(who, element("span", "hc-rev-stars", starText(review.rating)));
    card.append(head);
    if (review.writtenReview) card.append(element("p", "hc-rev-body", review.writtenReview));
    if (review.cleanerResponse) {
      const response = element("div", "hc-rev-response");
      response.append(element("span", "hc-rev-response-label", "Your response"), document.createTextNode(review.cleanerResponse));
      card.append(response);
    }
    return card;
  }));
}

function renderBreakdown(reviews) {
  const counts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((review) => Math.round(Number(review.rating) || 0) === star).length
  }));
  const highest = Math.max(1, ...counts.map((row) => row.count));
  bars.replaceChildren(...counts.map((row) => {
    const line = element("div", "hc-bar-row");
    const track = element("div", "hc-bar-track");
    const fill = element("div", "hc-bar-fill");
    // Width through CSSOM, not a style attribute, so `style-src 'self'` still holds.
    fill.style.width = `${Math.round(row.count / highest * 100)}%`;
    track.append(fill);
    line.append(element("span", "hc-bar-label", `${row.star}★`), track, element("span", "hc-bar-count", String(row.count)));
    return line;
  }));
}

async function loadReviews() {
  if (loading) return;
  loading = true;
  showGate("Checking secure Cleaner access…", "Your reviews open only inside the assigned Cleaner account.");
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

    const profileResult = await requestJson("/api/marketplace/cleaner/profile");
    const profile = profileResult.profile && typeof profileResult.profile === "object" ? profileResult.profile : null;
    const reviewCount = Number(profile?.reviewCount) || 0;

    setText("[data-reviews-overall]", reviewCount > 0 && Number.isFinite(profile?.averageRating) ? `${Number(profile.averageRating).toFixed(1)} ★` : "—");
    setText("[data-reviews-count]", reviewCount > 0 ? `${reviewCount} approved ${reviewCount === 1 ? "review" : "reviews"}` : "No approved reviews yet");
    setText("[data-reviews-completed]", String(Number(profile?.completedJobCount) || 0));
    setText("[data-reviews-public]", profile?.isPublic === true ? "Live" : "Not published");
    // Pending moderation is intentionally private until approved; the count is not exposed
    // to the Cleaner by the API, so this states the rule rather than guessing a number.
    setText("[data-reviews-pending]", "Private");

    let reviews = [];
    const payoutLink = document.querySelector("[data-cleaner-payout-link]");
    if (payoutLink) payoutLink.hidden = false;

    if (profile?.cleanerId && reviewCount > 0) {
      try {
        const reviewResult = await requestJson(`/api/marketplace/cleaners/${encodeURIComponent(profile.cleanerId)}/reviews`);
        reviews = Array.isArray(reviewResult.reviews) ? reviewResult.reviews : Array.isArray(reviewResult.cleaner?.reviews) ? reviewResult.cleaner.reviews : [];
      } catch {
        showFeedback("Your rating loaded, but the individual reviews could not be fetched. Nothing was changed.", "error");
      }
    }
    renderReviews(reviews);
    renderBreakdown(reviews);
  } catch (error) {
    if (error.code === "browser-offline") showGate("You are offline.", "Reconnect to load your reviews.", { allowRetry: true });
    else if (error.statusCode === 401) showGate("Sign in as a Cleaner to see your reviews.", "Ratings are private to the assigned Cleaner account.", { allowSignIn: true });
    else if (error.statusCode === 403) showGate("This account cannot open Cleaner reviews.", "Use a Cleaner account selected during onboarding.", { allowSignIn: true });
    else showGate("Reviews are temporarily unavailable.", "Nothing was changed. Check the connection and try again.", { allowRetry: true });
  } finally {
    loading = false;
  }
}

retry.addEventListener("click", loadReviews);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("online", () => {
  updateNetworkStatus();
  if (!gate.hidden) loadReviews();
});
const yearNode = document.querySelector("[data-year]");
if (yearNode) yearNode.textContent = String(new Date().getFullYear());
updateNetworkStatus();
loadReviews();
