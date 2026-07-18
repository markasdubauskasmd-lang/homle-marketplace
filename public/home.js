import { homeEntryMode, homeEntryPresentation } from "./home-entry-model.js";

const menuButton = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
let signedInWorkspace = null;
let currentEntryMode = "concierge";

if (menuButton && mainNav) {
  menuButton.addEventListener("click", () => {
    const open = mainNav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });

  mainNav.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    mainNav.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  });
}

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

function applyEntryMode(mode) {
  currentEntryMode = mode;
  const presentation = homeEntryPresentation(mode);
  document.querySelectorAll("[data-book-entry]").forEach((link) => {
    link.href = signedInWorkspace?.role === "landlord" ? "/landlord/dashboard?start=booking" : presentation.bookingPath;
    link.textContent = signedInWorkspace?.role === "landlord" ? "Book a clean" : presentation.bookingLabel;
  });
  document.querySelectorAll("[data-cleaner-entry]").forEach((link) => {
    link.href = signedInWorkspace?.role === "cleaner" ? "/cleaner/dashboard" : presentation.cleanerPath;
    if (signedInWorkspace?.role === "cleaner") link.textContent = "Open Cleaner dashboard";
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
