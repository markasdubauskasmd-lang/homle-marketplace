/*
 * Renders the design's ONBOARDING sidebar group.
 *
 * Shared so all nine Cleaner pages show the same fourteen entries in the same order with
 * the same completion marks. Previously only the dashboard filled this group, which left
 * it empty everywhere else.
 *
 * The ACCOUNT group stays as static markup in each page: the Messages entry carries the
 * notification hooks that the inbox tests assert against, and those assertions are worth
 * keeping literal.
 */

import { onboardingIcons, onboardingNav } from "./cleaner-onboarding-steps.js?v=20260728-2";

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
