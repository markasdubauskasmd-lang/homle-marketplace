import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";
import { renderCleanerNav } from "./cleaner-sidebar.js?v=20260729-6";
import { storedCsrf } from "./session-csrf.js?v=20260718-1";

const gate = document.querySelector("[data-profile-gate]");
const gateTitle = document.querySelector("[data-profile-gate-title]");
const gateCopy = document.querySelector("[data-profile-gate-copy]");
const signIn = document.querySelector("[data-profile-sign-in]");
const retry = document.querySelector("[data-profile-retry]");
const view = document.querySelector("[data-profile]");
const offline = document.querySelector("[data-profile-offline]");
const feedback = document.querySelector("[data-profile-feedback]");

let loading = false;

const serviceLabels = Object.freeze({
  "regular-domestic": "Domestic",
  "deep-clean": "Deep cleaning",
  "end-of-tenancy": "End of tenancy",
  "holiday-let": "Holiday lets",
  "office-cleaning": "Office cleaning",
  "airbnb-turnover": "Airbnb",
  "commercial-cleaning": "Commercial",
  "carpet-cleaning": "Carpet cleaning",
  "oven-cleaning": "Oven cleaning",
  "window-cleaning": "Window cleaning"
});

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

async function requestJson(path, options = {}) {
  if (browserOffline()) throw Object.assign(new Error("You are offline."), { code: "browser-offline" });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(path, { ...options, headers: { accept: "application/json", ...(options.headers || {}) }, credentials: "same-origin", cache: "no-store", signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw Object.assign(new Error(body.error || "Homle could not load your profile preview."), { statusCode: response.status, code: body.code });
  return body;
}

function chips(selector, values, emptyLabel, classForIndex = null) {
  const host = document.querySelector(selector);
  if (!host) return;
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  host.replaceChildren(...(items.length
    ? items.map((value, index) => element("span", `hc-pp-chip${classForIndex?.(index) || ""}`, String(value)))
    : [element("span", "hc-pp-none", emptyLabel)]));
}

function publicDisplayName(value) {
  const parts = String(value || "Cleaner").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Cleaner";
  return `${parts[0]} ${parts.at(-1).charAt(0).toUpperCase()}.`;
}

function serviceLabel(value) {
  const code = String(value?.serviceCode || value?.code || value || "").trim();
  if (!code) return "";
  if (serviceLabels[code]) return serviceLabels[code];
  return code.split(/[-_]/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function experienceBand(value) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1) return "New";
  if (value < 3) return "1–3 yrs";
  if (value < 5) return "3–5 yrs";
  if (value < 10) return "5–10 yrs";
  return "10+ yrs";
}

// Only states backed by the Cleaner profile response are presented as verified.
// Insurance, references, training and right-to-work are never inferred here.
function renderBadges(profile) {
  const host = document.querySelector("[data-profile-badges]");
  if (!host) return;
  const badges = [];
  if (profile?.identityCheckStatus === "verified") badges.push(["✓ Identity verified", true]);
  if (profile?.backgroundCheckStatus === "verified") badges.push(["✓ Background check", true]);
  if (profile?.profileCompletionPercent === 100) badges.push(["✓ Profile complete", true]);
  if (profile?.isPublic === true) badges.push(["✓ Visible to clients", true]);
  if (!badges.length) badges.push(["Verification pending with the Homle team", false]);
  host.replaceChildren(...badges.map(([label, verified]) => element("span", `hc-pp-badge${verified ? "" : " hc-pp-badge-pending"}`, label)));
}

function renderChecklist(profile) {
  const host = document.querySelector("[data-profile-checklist]");
  if (!host) return;
  const percent = Math.max(0, Math.min(100, Number(profile?.profileCompletionPercent) || 0));
  setText("[data-profile-strength]", `${percent}%`);
  const progress = document.querySelector("[data-profile-strength-bar]");
  if (progress) progress.style.width = `${percent}%`;
  const equipment = [...(Array.isArray(profile?.equipmentSupplied) ? profile.equipmentSupplied : []), ...(Array.isArray(profile?.productsSupplied) ? profile.productsSupplied : [])];
  const rows = [
    ["Profile photo added", Boolean(profile?.profilePhotoUrl), true],
    ["Biography added", String(profile?.biography || "").trim().length >= 40, false],
    ["Specialisms selected", Array.isArray(profile?.services) && profile.services.length > 0, true],
    ["Work area added", Array.isArray(profile?.serviceAreas) && profile.serviceAreas.length > 0, false],
    ["Equipment added", equipment.length > 0, false],
    ["Visible to clients", profile?.isPublic === true, false]
  ];
  host.replaceChildren(...rows.map(([label, done, important]) => {
    const row = element("div", "hc-profile-check-row");
    const mark = element("span", `hc-profile-check-mark${done ? " is-done" : important ? " is-attention" : ""}`, done ? "✓" : important ? "!" : "•");
    row.append(mark, element("span", "", label));
    return row;
  }));
}

function renderReviews(profile) {
  const host = document.querySelector("[data-profile-reviews]");
  if (!host) return;
  const count = Number(profile?.reviewCount) || 0;
  const rating = Number(profile?.averageRating) || 0;
  host.textContent = count > 0
    ? `${count} verified ${count === 1 ? "review" : "reviews"} · ${rating.toFixed(1)} average rating`
    : "No reviews yet — new to Homle. Verified reviews appear after completed bookings.";
}

// Held so the publish switch can send the whole profile back. The endpoint
// replaces the record, so posting only `isPublic` would blank everything else.
let currentProfile = null;

function renderProfile(account, profile) {
  currentProfile = profile;
  const name = account.displayName || "Cleaner";
  setText("[data-profile-name]", publicDisplayName(name));
  const avatar = document.querySelector("[data-profile-avatar]");
  if (avatar) avatar.textContent = name.trim().charAt(0).toUpperCase() || "C";

  const areas = Array.isArray(profile?.serviceAreas) ? profile.serviceAreas.map((area) => area.outwardPostcode || area.outwardCode || area.label || area).filter(Boolean) : [];
  const radius = Number.isFinite(profile?.travelRadiusKm) ? `travels up to ${profile.travelRadiusKm} km` : "travel radius not set";
  const languages = Array.isArray(profile?.languages) ? profile.languages.filter(Boolean) : [];
  const language = languages.length ? ` · speaks ${languages.slice(0, 2).join(" & ")}` : "";
  setText("[data-profile-location]", `${areas.length ? areas[0] : "Coverage not set"} · ${radius}${language}`);

  const reviewCount = Number(profile?.reviewCount) || 0;
  const completed = Number(profile?.completedJobCount) || 0;
  setText("[data-profile-standing]", profile?.isPublic === true ? "Live on Homle" : "New to Homle");
  setText("[data-profile-experience]", experienceBand(profile?.yearsExperience));
  setText("[data-profile-jobs]", completed > 0 ? String(completed) : "New");
  setText("[data-profile-rating]", reviewCount > 0 && Number.isFinite(profile?.averageRating) ? `${Number(profile.averageRating).toFixed(1)} ★` : "—");

  const equipment = [...(Array.isArray(profile?.equipmentSupplied) ? profile.equipmentSupplied : []), ...(Array.isArray(profile?.productsSupplied) ? profile.productsSupplied : [])];
  setText("[data-profile-equipment]", equipment.length ? "Brings own equipment" : "Not supplied");
  setText("[data-profile-about]", profile?.biography || profile?.introduction || "You have not added an introduction yet.");
  setText("[data-profile-live-state]", profile?.isPublic === true ? "Visible to clients" : "Goes live on approval");

  chips("[data-profile-services]", (Array.isArray(profile?.services) ? profile.services : []).map(serviceLabel), "No specialisms selected yet.");
  chips("[data-profile-skills]", [], "No extra skills recorded yet.");
  chips("[data-profile-training]", [], "No training badges earned yet.");
  chips("[data-profile-areas]", areas, "No coverage areas added yet.", (index) => index === 0 ? " is-primary" : "");
  setText("[data-profile-training-count]", "· 0 earned");
  renderVisibility(profile);
  renderBadges(profile);
  renderChecklist(profile);
  renderReviews(profile);
}

// Publishing is what puts a Cleaner in front of customers, and until now this
// control was decorative: marked aria-readonly, with nothing listening. A
// Cleaner could complete everything and still never appear in the directory,
// which is why it was empty.
let publishing = false;

function renderVisibility(profile) {
  const visibility = document.querySelector("[data-profile-visibility]");
  if (!visibility) return;
  const isPublic = profile?.isPublic === true;
  const complete = Number(profile?.profileCompletionPercent) === 100;
  visibility.dataset.on = String(isPublic);
  visibility.setAttribute("aria-checked", String(isPublic));
  // A switch that cannot move must say so rather than silently ignoring a tap.
  // Below 100% the server refuses to publish, so the honest state is disabled
  // with the reason attached, not an enabled control that fails on use.
  const usable = complete || isPublic;
  visibility.setAttribute("role", "switch");
  visibility.setAttribute("tabindex", usable && !publishing ? "0" : "-1");
  visibility.setAttribute("aria-disabled", String(!usable || publishing));
  visibility.removeAttribute("aria-readonly");
  visibility.setAttribute("aria-label", isPublic
    ? "Visible to clients. Turn off to pause new offers."
    : complete
      ? "Hidden from clients. Turn on to appear in search and receive offers."
      : "Hidden from clients. Finish every profile section to publish.");
  if (!visibility.dataset.publishBound) {
    visibility.dataset.publishBound = "true";
    visibility.addEventListener("click", () => togglePublished());
    visibility.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      togglePublished();
    });
  }
}

async function togglePublished() {
  const visibility = document.querySelector("[data-profile-visibility]");
  if (!visibility || publishing) return;
  if (visibility.getAttribute("aria-disabled") === "true") {
    showFeedback("Finish every section of your profile before publishing it.", "error");
    return;
  }
  const next = visibility.getAttribute("aria-checked") !== "true";
  publishing = true;
  renderVisibility({ ...currentProfile, isPublic: currentProfile?.isPublic === true });
  showFeedback(next ? "Publishing your profile…" : "Hiding your profile…");
  try {
    // The whole profile is sent back because the endpoint replaces it. Sending
    // only isPublic would blank every other field.
    const result = await requestJson("/api/marketplace/cleaner/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": storedCsrf() },
      body: JSON.stringify({ ...currentProfile, isPublic: next })
    });
    currentProfile = result.profile || { ...currentProfile, isPublic: next };
    showFeedback(next
      ? "Your profile is live. Clients can find you and you can receive job offers."
      : "Your profile is hidden. You will not receive new offers; work you have already accepted is unchanged.");
  } catch (error) {
    showFeedback(error?.code === "browser-offline"
      ? "You are offline, so your profile visibility was not changed."
      : error?.message || "Your profile visibility could not be changed. Try again.", "error");
  } finally {
    publishing = false;
    renderVisibility(currentProfile);
  }
}

async function loadProfile() {
  if (loading) return;
  loading = true;
  showGate("Checking secure Cleaner access…", "Your profile preview opens only inside the assigned Cleaner account.");
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
    const payoutLink = document.querySelector("[data-cleaner-payout-link]");
    if (payoutLink) payoutLink.hidden = false;
    renderProfile(account, profile);
    renderAccountAvatar(account, profile?.profilePhotoUrl);
    showFeedback(profile ? "" : "Your Cleaner profile has not been created yet. Complete it to see the client-facing preview.", profile ? "info" : "error");
  } catch (error) {
    if (error.code === "browser-offline") showGate("You are offline.", "Reconnect to load your profile preview.", { allowRetry: true });
    else if (error.statusCode === 401) showGate("Sign in as a Cleaner to preview your profile.", "The preview is private to the assigned Cleaner account.", { allowSignIn: true });
    else if (error.statusCode === 403) showGate("This account cannot open the Cleaner profile preview.", "Use a Cleaner account selected during onboarding.", { allowSignIn: true });
    else showGate("The profile preview is temporarily unavailable.", "Nothing was changed. Check the connection and try again.", { allowRetry: true });
  } finally {
    loading = false;
  }
}

retry.addEventListener("click", loadProfile);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("online", () => {
  updateNetworkStatus();
  if (!gate.hidden) loadProfile();
});
updateNetworkStatus();
loadProfile();
