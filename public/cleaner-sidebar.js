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

  host.replaceChildren(...onboardingNav.map((entry) => {
    const step = entry.step ? byKey.get(entry.step) : null;
    const item = document.createElement(entry.href ? "a" : "span");
    item.className = "hc-nav-item hc-nav-sub";
    if (entry.href) {
      item.href = entry.href;
      if (entry.href === current) item.setAttribute("aria-current", "page");
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
  }));
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
