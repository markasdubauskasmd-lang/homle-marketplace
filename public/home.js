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

window.addEventListener("homle:account-ready", (event) => {
  signedInWorkspace = event.detail?.workspace || null;
  applyEntryMode(currentEntryMode);
});

applyEntryMode("concierge");
fetch("/api/health", { credentials: "omit", cache: "no-store", headers: { Accept: "application/json" } })
  .then(async (response) => response.ok ? response.json() : null)
  .then((health) => applyEntryMode(homeEntryMode(health)))
  .catch(() => {});
