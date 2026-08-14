/*
 * Renders the design's ONBOARDING sidebar group.
 *
 * Shared so all nine Cleaner pages show the same fourteen entries in the same order with
 * the same completion marks. Previously only the dashboard filled this group, which left
 * it empty everywhere else.
 *
 * The ACCOUNT group is rendered here too, so every Cleaner page exposes the same destinations
 * while future screenshot-led pages can be connected at one stable URL apiece.
 */

import { accountNav, onboardingIcons, onboardingNav } from "./cleaner-onboarding-steps.js?v=20260807-2";

function configureCleanerShell() {
  const nav = document.querySelector(".hc-side .hc-nav");
  if (!nav) return;
  const side = nav.closest(".hc-side");
  const onboardingGroup = nav.querySelector("[data-onboarding-group]");
  const accountGroup = nav.querySelector("[data-account-group]");
  const primaryItems = [...nav.children].filter((child) => child.matches(".hc-nav-item, .hc-nav-cta"));
  const onboardingShell = document.body.dataset.cleanerShell === "onboarding";

  if (!onboardingShell) {
    onboardingGroup?.remove();
    const onboardingEntry = primaryItems.find((item) => item.getAttribute("href") === "/cleaner/onboarding");
    const scheduleEntry = primaryItems.find((item) => item.getAttribute("href") === "/cleaner/schedule");
    const reviewsEntry = primaryItems.find((item) => item.getAttribute("href") === "/cleaner/reviews");
    onboardingEntry?.remove();
    scheduleEntry?.remove();
    reviewsEntry?.remove();
    primaryItems
      .filter((item) => item.matches(".hc-nav-cta"))
      .forEach((item) => item.remove());
    return;
  }

  if (side) {
    side.dataset.previewSidebar = "";
    side.classList.remove("is-preview-expanded");
  }
  const brandMark = side?.querySelector(".hc-brand-mark");
  if (brandMark) {
    const logo = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    logo.classList.add("hc-brand-logo");
    logo.setAttribute("viewBox", "0 0 64 64");
    logo.setAttribute("aria-hidden", "true");
    logo.setAttribute("focusable", "false");
    const roof = document.createElementNS("http://www.w3.org/2000/svg", "path");
    roof.setAttribute("d", "M9 27 32 7l23 20");
    roof.setAttribute("fill", "none");
    roof.setAttribute("stroke", "currentColor");
    roof.setAttribute("stroke-width", "7");
    roof.setAttribute("stroke-linecap", "round");
    roof.setAttribute("stroke-linejoin", "round");
    const left = document.createElementNS("http://www.w3.org/2000/svg", "path");
    left.setAttribute("d", "M17 29 28 19v18c0 5 3 8 8 8-5 0-8 3-8 8v4H17V29Z");
    left.setAttribute("fill", "currentColor");
    const right = document.createElementNS("http://www.w3.org/2000/svg", "path");
    right.setAttribute("d", "m36 19 11 10v28H36V43c0-4-3-7-8-7 5 0 8-3 8-8v-9Z");
    right.setAttribute("fill", "currentColor");
    logo.append(roof, left, right);
    brandMark.replaceChildren(logo);
  }
  if (side && !side.querySelector(".hc-home-return")) {
    const home = document.createElement("a");
    home.className = "hc-home-return";
    home.href = "https://homlle.com/";
    home.setAttribute("aria-label", "Return to Homlle.com");
    home.title = "Return to Homlle.com";
    const homeIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    homeIcon.setAttribute("width", "19");
    homeIcon.setAttribute("height", "19");
    homeIcon.setAttribute("viewBox", "0 0 24 24");
    homeIcon.setAttribute("aria-hidden", "true");
    const homePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    homePath.setAttribute("d", "M10 5H5v14h5M14 8l4 4-4 4M18 12H9");
    homePath.setAttribute("fill", "none");
    homePath.setAttribute("stroke", "currentColor");
    homePath.setAttribute("stroke-width", "1.7");
    homePath.setAttribute("stroke-linecap", "round");
    homePath.setAttribute("stroke-linejoin", "round");
    homeIcon.append(homePath);
    const homeLabel = document.createElement("span");
    homeLabel.textContent = "Return to Homlle.com";
    home.append(homeIcon, homeLabel);
    side.append(home);
  }

  primaryItems.forEach((item) => item.remove());
  accountGroup?.remove();
  const role = document.querySelector(".hc-brand-role");
  if (role) role.textContent = "ONBOARDING";
  if (onboardingGroup) {
    const onboardingList = document.createElement("div");
    onboardingList.className = onboardingGroup.className;
    onboardingList.dataset.onboardingGroup = "";
    onboardingList.setAttribute("aria-label", "Onboarding steps");
    [...onboardingGroup.children]
      .filter((child) => !child.matches(".hc-nav-group-summary"))
      .forEach((child) => onboardingList.append(child));
    onboardingGroup.replaceWith(onboardingList);
  }
}

function positionOnboardingIndicator(host, item, immediate = false) {
  const indicator = host.querySelector("[data-preview-liquid-indicator]");
  if (!indicator || !item) return;
  const mobile = window.matchMedia("(max-width: 900px)").matches;
  const style = window.getComputedStyle(indicator);
  const baseOffset = Number.parseFloat(mobile ? style.left : style.top) || 0;
  const position = mobile
    ? item.offsetLeft + (item.offsetWidth / 2) - (indicator.offsetWidth / 2) - baseOffset
    : item.offsetTop + (item.offsetHeight / 2) - (indicator.offsetHeight / 2) - baseOffset;
  if (immediate) indicator.classList.add("is-immediate");
  indicator.style.setProperty(mobile ? "--liquid-x" : "--liquid-y", `${position}px`);
  indicator.style.setProperty(mobile ? "--liquid-y" : "--liquid-x", "0px");
  if (immediate) requestAnimationFrame(() => requestAnimationFrame(() => indicator.classList.remove("is-immediate")));
}

function connectOnboardingMotion(host) {
  const current = host.querySelector('[aria-current="page"]');
  requestAnimationFrame(() => positionOnboardingIndicator(host, current, true));
  if (host.dataset.motionReady) return;
  host.dataset.motionReady = "true";
  window.addEventListener("resize", () => positionOnboardingIndicator(host, host.querySelector('[aria-current="page"]'), true));
  host.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-preview-page]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const destination = new URL(link.href, location.href);
    if (destination.origin !== location.origin || destination.pathname === location.pathname) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    event.preventDefault();
    host.querySelectorAll('[aria-current="page"], .is-preview-open').forEach((item) => {
      item.removeAttribute("aria-current");
      item.classList.remove("is-preview-open");
    });
    link.setAttribute("aria-current", "page");
    link.classList.add("is-preview-open");
    positionOnboardingIndicator(host, link);
    window.setTimeout(() => location.assign(destination.href), 620);
  });
}

function icon(name) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", onboardingIcons[name] || onboardingIcons.folder);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.7");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "17");
  svg.setAttribute("height", "17");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.append(path);
  return svg;
}

/**
 * @param {{steps: Array<{key: string, done: boolean, tracked: boolean}>}|null} progress
 *   Completion state. When absent the entries render without marks rather than guessing.
 */
export function renderCleanerNav(progress = null) {
  const host = document.querySelector("[data-onboarding-nav]");
  if (!host) return;
  const byKey = new Map((progress?.steps || []).map((step) => [step.key, step]));
  const current = location.pathname;

  const indicator = document.createElement("span");
  indicator.className = "hc-preview-liquid-indicator";
  indicator.dataset.previewLiquidIndicator = "";
  indicator.setAttribute("aria-hidden", "true");
  const items = onboardingNav.map((entry) => {
    const step = entry.step ? byKey.get(entry.step) : null;
    const item = document.createElement(entry.href ? "a" : "span");
    item.className = "hc-nav-item hc-nav-sub";
    item.dataset.previewPage = entry.step || entry.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    item.dataset.navLabel = entry.label;
    item.setAttribute("aria-label", entry.label);
    if (entry.href) {
      item.href = entry.href;
      item.title = entry.label;
      if (entry.href === current) {
        item.setAttribute("aria-current", "page");
        item.classList.add("is-preview-open");
      }
    } else {
      item.setAttribute("aria-disabled", "true");
      item.title = "This step is not open yet.";
    }
    const label = document.createElement("span");
    label.className = "hc-nav-label";
    label.textContent = entry.label;
    item.append(icon(entry.icon), label);

    if (step?.done) {
      const tick = document.createElement("span");
      tick.className = "hc-nav-tick";
      tick.textContent = "✓";
      item.append(tick);
    } else if (!step || step.tracked === false) {
      // Nothing records this entry, so it carries the design's outstanding dot.
      const dot = document.createElement("span");
      dot.className = "hc-nav-dot";
      item.append(dot);
    }
    return item;
  });
  host.replaceChildren(indicator, ...items);
  connectOnboardingMotion(host);
}

export function renderCleanerAccountNav() {
  const host = document.querySelector("[data-account-nav]");
  if (!host) return;
  const current = location.pathname;

  host.replaceChildren(...accountNav.map((entry) => {
    const item = document.createElement(entry.action === "logout" ? "button" : "a");
    item.className = "hc-nav-item hc-account-nav-item";

    if (entry.action === "logout") {
      item.type = "button";
      item.dataset.accountSignOut = "";
      item.dataset.signOutDestination = "/login?intent=work";
    } else {
      item.href = entry.href;
      if (new URL(entry.href, location.origin).pathname === current) item.setAttribute("aria-current", "page");
      if (entry.awaitingDesign) {
        item.dataset.accountPagePending = "";
        item.title = "Page design to follow.";
      }
      if (entry.notificationHook) {
        item.dataset.notificationLink = "";
        item.dataset.notificationLabel = entry.label;
      }
    }

    const label = document.createElement("span");
    label.className = "hc-nav-label";
    label.textContent = entry.label;
    item.append(icon(entry.icon), label);

    if (entry.notificationHook) {
      const count = document.createElement("span");
      count.className = "notification-nav-count";
      count.dataset.notificationCount = "";
      count.hidden = true;
      item.append(count);
    }

    return item;
  }));
}

// Module scripts run after the page markup is parsed and before the later account/notification
// controllers, so their event listeners see these shared buttons and hooks on first load.
configureCleanerShell();
renderCleanerAccountNav();
