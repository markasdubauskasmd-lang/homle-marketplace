import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";
import { renderCleanerNav } from "./cleaner-sidebar.js?v=20260729-5";

const gate = document.querySelector("[data-profile-gate]");
const gateTitle = document.querySelector("[data-profile-gate-title]");
const gateCopy = document.querySelector("[data-profile-gate-copy]");
const signIn = document.querySelector("[data-profile-sign-in]");
const retry = document.querySelector("[data-profile-retry]");
const view = document.querySelector("[data-profile]");
const offline = document.querySelector("[data-profile-offline]");
const feedback = document.querySelector("[data-profile-feedback]");

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
  if (!response.ok || body.ok === false) throw Object.assign(new Error(body.error || "Homle could not load your profile preview."), { statusCode: response.status, code: body.code });
  return body;
}

function chips(selector, values, emptyLabel) {
  const host = document.querySelector(selector);
  if (!host) return;
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  host.replaceChildren(...(items.length
    ? items.map((value) => element("span", "hc-pp-chip", String(value)))
    : [element("span", "hc-pp-none", emptyLabel)]));
}

// Only the two checks Homle actually records are shown as verified. The design's DBS,
// right-to-work, insurance and reference badges have no backing store in this codebase,
// so they are not rendered as ticks a client would read as verified.
function renderBadges(profile) {
  const host = document.querySelector("[data-profile-badges]");
  if (!host) return;
  const badges = [];
  if (profile?.identityCheckStatus === "verified") badges.push(["✓ Identity verified", true]);
  if (profile?.backgroundCheckStatus === "verified") badges.push(["✓ Background check", true]);
  if (!badges.length) badges.push(["Verification pending with the Homle team", false]);
  host.replaceChildren(...badges.map(([label, verified]) => element("span", `hc-pp-badge${verified ? "" : " hc-pp-badge-pending"}`, label)));
}

function renderChecklist(profile) {
  const host = document.querySelector("[data-profile-checklist]");
  if (!host) return;
  const percent = Number(profile?.profileCompletionPercent) || 0;
  const rows = [
    ["Profile complete", percent === 100],
    ["Services and pricing", Array.isArray(profile?.services) && profile.services.length > 0],
    ["Coverage area", Array.isArray(profile?.serviceAreas) && profile.serviceAreas.length > 0],
    ["Published for matching", profile?.isPublic === true]
  ];
  host.replaceChildren(...rows.map(([label, done]) => {
    const line = element("div", "hc-bar-row");
    const track = element("div", "hc-bar-track");
    const fill = element("div", "hc-bar-fill");
    fill.style.width = done ? "100%" : "0%";
    if (done) fill.style.background = "var(--hc-green)";
    track.append(fill);
    line.append(element("span", "hc-bar-label", done ? "✓" : "•"), track, element("span", "hc-bar-count", ""));
    const wrap = element("div");
    wrap.append(element("div", "hc-pp-stat-label", label), line);
    return wrap;
  }));
}

function renderProfile(account, profile) {
  const name = account.displayName || "Cleaner";
  setText("[data-profile-name]", name);
  const avatar = document.querySelector("[data-profile-avatar]");
  if (avatar) avatar.textContent = name.trim().charAt(0).toUpperCase() || "C";

  const areas = Array.isArray(profile?.serviceAreas) ? profile.serviceAreas.map((area) => area.outwardCode || area.label || area).filter(Boolean) : [];
  const radius = Number.isFinite(profile?.travelRadiusKm) ? `travels up to ${profile.travelRadiusKm} km` : "travel radius not set";
  setText("[data-profile-location]", `${areas.length ? areas.slice(0, 3).join(", ") : "Coverage not set"} · ${radius}`);

  const reviewCount = Number(profile?.reviewCount) || 0;
  const completed = Number(profile?.completedJobCount) || 0;
  setText("[data-profile-standing]", profile?.isPublic === true ? "Live on Homle" : "Not published yet");
  setText("[data-profile-experience]", Number.isFinite(profile?.yearsExperience) ? `${profile.yearsExperience} ${profile.yearsExperience === 1 ? "yr" : "yrs"}` : "—");
  setText("[data-profile-jobs]", completed > 0 ? String(completed) : "New");
  setText("[data-profile-rating]", reviewCount > 0 && Number.isFinite(profile?.averageRating) ? `${Number(profile.averageRating).toFixed(1)} ★` : "—");

  const equipment = [...(Array.isArray(profile?.equipmentSupplied) ? profile.equipmentSupplied : []), ...(Array.isArray(profile?.productsSupplied) ? profile.productsSupplied : [])];
  setText("[data-profile-equipment]", equipment.length ? equipment.slice(0, 3).join(", ") : "Not supplied");
  setText("[data-profile-about]", profile?.biography || profile?.introduction || "You have not added an introduction yet.");
  setText("[data-profile-live-state]", profile?.isPublic === true ? "Visible in the Cleaner directory" : "Publish the completed profile when you are ready");

  chips("[data-profile-services]", (Array.isArray(profile?.services) ? profile.services : []).map((service) => service.serviceCode || service.code || service), "No services selected yet.");
  chips("[data-profile-languages]", profile?.languages, "No languages added yet.");
  chips("[data-profile-areas]", areas, "No coverage areas added yet.");
  renderBadges(profile);
  renderChecklist(profile);
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
const yearNode = document.querySelector("[data-year]");
if (yearNode) yearNode.textContent = String(new Date().getFullYear());
updateNetworkStatus();
loadProfile();
