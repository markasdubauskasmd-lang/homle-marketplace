import { homeEntryMode, homeEntryPresentation } from "./home-entry-model.js";

const menuButton = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");

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
  const presentation = homeEntryPresentation(mode);
  document.querySelectorAll("[data-book-entry]").forEach((link) => {
    link.href = presentation.bookingPath;
    link.textContent = presentation.bookingLabel;
  });
  document.querySelectorAll("[data-cleaner-entry]").forEach((link) => { link.href = presentation.cleanerPath; });
  document.querySelectorAll("[data-account-entry]").forEach((link) => { link.hidden = !presentation.accountAccess; });
  const step = document.querySelector("[data-book-step-copy]");
  const status = document.querySelector("[data-entry-status]");
  if (step) step.textContent = presentation.stepCopy;
  if (status) status.textContent = presentation.statusCopy;
}

applyEntryMode("concierge");
fetch("/api/health", { credentials: "omit", cache: "no-store", headers: { Accept: "application/json" } })
  .then(async (response) => response.ok ? response.json() : null)
  .then((health) => applyEntryMode(homeEntryMode(health)))
  .catch(() => {});
