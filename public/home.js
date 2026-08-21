import { homeEntryMode, homeEntryPresentation } from "./home-entry-model.js";

const menuButton = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
const signupMenu = document.querySelector("[data-signup-menu]");
let signedInWorkspace = null;
let currentEntryMode = "concierge";

if (menuButton && mainNav) {
  menuButton.addEventListener("click", () => {
    const open = mainNav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });

  mainNav.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    if (signupMenu) signupMenu.open = false;
    mainNav.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  });
}

if (signupMenu) {
  document.addEventListener("click", (event) => {
    if (!signupMenu.open || signupMenu.contains(event.target)) return;
    signupMenu.open = false;
  });
  signupMenu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    signupMenu.open = false;
    signupMenu.querySelector("summary")?.focus();
  });
}

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

function applyEntryMode(mode) {
  currentEntryMode = mode;
  const presentation = homeEntryPresentation(mode);
  document.querySelectorAll("[data-book-entry]").forEach((link) => {
    link.href = signedInWorkspace?.role === "landlord" ? "/landlord/book" : presentation.bookingPath;
    if (!link.hasAttribute("data-entry-label-fixed")) link.textContent = signedInWorkspace?.role === "landlord" ? "Book a clean" : presentation.bookingLabel;
  });
  document.querySelectorAll("[data-cleaner-entry]").forEach((link) => {
    link.href = presentation.cleanerPath;
  });
  document.querySelectorAll("[data-directory-entry]").forEach((link) => { link.href = presentation.directoryPath; });
  document.querySelectorAll("[data-account-entry]").forEach((link) => { link.hidden = Boolean(signedInWorkspace) || !presentation.accountAccess; });
  const step = document.querySelector("[data-book-step-copy]");
  const status = document.querySelector("[data-entry-status]");
  if (step) step.textContent = presentation.stepCopy;
  if (status) status.textContent = presentation.statusCopy;
}

function applySignedInLanding(workspace) {
  const signedIn = Boolean(workspace);
  const isLandlord = workspace?.role === "landlord";
  const dashboardHref = workspace?.href || "/onboarding";
  const workspaceLabel = workspace?.label || "Account";
  const manualEntry = document.querySelector("[data-home-manual-entry]");
  const manualLede = document.querySelector("[data-home-manual-lede]");
  const workspaceEntry = document.querySelector("[data-home-workspace-entry]");
  const joinEyebrow = document.querySelector("[data-home-join-eyebrow]");
  const joinLineOne = document.querySelector("[data-home-join-line-1]");
  const joinLineTwo = document.querySelector("[data-home-join-line-2]");

  document.querySelectorAll("[data-home-signed-out-only]").forEach((element) => {
    element.hidden = signedIn;
  });

  if (manualEntry) {
    manualEntry.href = signedIn
      ? (isLandlord ? "/landlord/dashboard#landlord-requests" : dashboardHref)
      : "/signup?intent=book";
    manualEntry.textContent = signedIn
      ? (isLandlord ? "Continue to manual request" : `Open ${workspaceLabel} dashboard`)
      : "Create account to book";
  }
  if (manualLede) {
    manualLede.textContent = isLandlord
      ? "Continue in your Landlord workspace, choose a property and add the cleaning details in five short steps. Review the live estimate before matching starts."
      : "Prefer typing? Sign in, then add the property, cleaning type, timing and room details in six short steps. Review the scope and price before matching starts.";
  }
  if (workspaceEntry) {
    workspaceEntry.href = signedIn ? dashboardHref : "/signup?intent=book";
    workspaceEntry.textContent = signedIn ? `Open ${workspaceLabel} dashboard` : "Create your Homle account";
  }
  if (joinEyebrow) joinEyebrow.textContent = signedIn ? `Verified ${workspaceLabel} account` : "Verified account · role-specific workspace";
  if (joinLineOne) joinLineOne.textContent = signedIn ? "Welcome" : "Quick";
  if (joinLineTwo) joinLineTwo.textContent = signedIn ? "back." : "sign up.";
}

window.addEventListener("homle:account-ready", (event) => {
  signedInWorkspace = event.detail?.workspace || null;
  applyEntryMode(currentEntryMode);
  applySignedInLanding(signedInWorkspace);
});

applySignedInLanding(null);
applyEntryMode("concierge");
fetch("/api/health", { credentials: "omit", cache: "no-store", headers: { Accept: "application/json" } })
  .then(async (response) => response.ok ? response.json() : null)
  .then((health) => applyEntryMode(homeEntryMode(health)))
  .catch(() => {});
