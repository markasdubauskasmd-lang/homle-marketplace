/*
 * The Cleaner workspace sidebar — built here, once, for all nineteen pages.
 *
 * It used to be static markup copied into each of those nineteen HTML files,
 * and the copies had drifted into TWELVE different shapes: different icons,
 * different labels, a brand mark that was a link on one page and a plain div on
 * the next, and one page pointing its Notifications entry at the LANDLORD inbox
 * (which redirects a Cleaner straight back).
 *
 * Almost none of that drift reached the screen, which is the worse half of the
 * problem: `configureCleanerShell` pruned the primary list on load and
 * `renderCleanerAccountNav` replaced the whole Account group wholesale, so
 * nineteen files disagreed about a navigation the runtime then overwrote.
 * Editing one of them looked like it worked and changed nothing.
 *
 * There are two shells, and the page declares which by `data-cleaner-shell`:
 *
 *   workspace  — brand, five destinations, the Account group          (15 pages)
 *   onboarding — brand linked to the introduction, the fourteen steps, and a
 *                way back to the public site                           (4 pages)
 *
 * The pages now carry `<div class="hc">` with their main content and nothing
 * else; the aside is inserted before it here.
 */

import { accountNav, onboardingIcons, onboardingNav, workspaceNav } from "./cleaner-onboarding-steps.js?v=20260830-1";

const svgNamespace = "http://www.w3.org/2000/svg";

function svgPath(d, { fill = "none", width = "1.7" } = {}) {
  const path = document.createElementNS(svgNamespace, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", fill);
  if (fill === "none") {
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", width);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  return path;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* The house mark, in the two forms the two shells use. */
function brandGlyph(onboarding) {
  const logo = document.createElementNS(svgNamespace, "svg");
  logo.setAttribute("aria-hidden", "true");
  logo.setAttribute("focusable", "false");
  if (onboarding) {
    logo.classList.add("hc-brand-logo");
    logo.setAttribute("viewBox", "0 0 64 64");
    logo.setAttribute("preserveAspectRatio", "none");
    logo.append(
      svgPath("M9 27 32 7l23 20", { width: "7" }),
      svgPath("M17 29 28 19v18c0 5 3 8 8 8-5 0-8 3-8 8v4H17V29Z", { fill: "currentColor" }),
      svgPath("m36 19 11 10v28H36V43c0-4-3-7-8-7 5 0 8-3 8-8v-9Z", { fill: "currentColor" })
    );
    return logo;
  }
  logo.setAttribute("width", "22");
  logo.setAttribute("height", "22");
  logo.setAttribute("viewBox", "0 0 24 24");
  logo.append(svgPath("M12 4 4.5 10.5V20h15v-9.5z", { width: "2" }), svgPath("M10 20v-5h4v5", { width: "2" }));
  return logo;
}

function brandBlock(onboarding) {
  const brand = element("div", "hc-brand");
  // On the onboarding shell the mark returns to the introduction. Three of the
  // four onboarding pages had it as a plain div, so it was a dead end there.
  const mark = element(onboarding ? "a" : "div", "hc-brand-mark");
  mark.setAttribute("aria-hidden", onboarding ? "false" : "true");
  if (onboarding) {
    mark.href = "/cleaner/introduction";
    mark.setAttribute("aria-label", "Open the Homle onboarding introduction");
  }
  mark.append(brandGlyph(onboarding));
  const copy = element("div");
  copy.append(element("div", "hc-brand-name", "Homle"), element("div", "hc-brand-role", onboarding ? "ONBOARDING" : "CLEANER"));
  brand.append(mark, copy);
  return brand;
}

function navItem(entry, current) {
  const item = element("a", "hc-nav-item");
  item.href = entry.href;
  if (entry.href === current) {
    item.classList.add("is-current");
    item.setAttribute("aria-current", "page");
  }
  if (entry.notificationHook) {
    item.dataset.notificationLink = "";
    item.dataset.notificationLabel = entry.label;
  }
  // Earnings stays hidden until a page confirms the account can reach payouts.
  if (entry.payoutGated) {
    item.dataset.cleanerPayoutLink = "";
    item.hidden = true;
  }
  item.append(icon(entry.icon), element("span", "hc-nav-label", entry.label));
  if (entry.pendingDot) {
    const dot = element("span", "hc-nav-dot");
    dot.dataset.cleanerPendingDot = "";
    dot.hidden = true;
    item.append(dot);
  }
  if (entry.notificationHook) {
    const count = element("span", "notification-nav-count");
    count.dataset.notificationCount = "";
    count.hidden = true;
    item.append(count);
  }
  return item;
}

function homeReturn() {
  const home = element("a", "hc-home-return");
  home.href = "https://homlle.com/";
  home.setAttribute("aria-label", "Return to Homlle.com");
  home.title = "Return to Homlle.com";
  const glyph = document.createElementNS(svgNamespace, "svg");
  glyph.setAttribute("width", "19");
  glyph.setAttribute("height", "19");
  glyph.setAttribute("viewBox", "0 0 24 24");
  glyph.setAttribute("aria-hidden", "true");
  glyph.append(svgPath("M10 5H5v14h5M14 8l4 4-4 4M18 12H9"));
  home.append(glyph, element("span", "", "Return to Homlle.com"));
  return home;
}

/**
 * Builds the sidebar and puts it in front of the page's `.hc` content.
 *
 * Returns early if a page still carries its own `<aside>`, so a page that has
 * not been migrated keeps working rather than getting two of them.
 */
export function renderCleanerShell() {
  const shell = document.querySelector(".hc");
  if (!shell || shell.querySelector(".hc-side")) return;
  const onboarding = document.body.dataset.cleanerShell === "onboarding";
  const current = location.pathname;

  const side = element("aside", "hc-side cleaner-site-header");
  if (onboarding) side.dataset.previewSidebar = "";
  side.append(brandBlock(onboarding));

  const nav = element("nav", "hc-nav");
  nav.setAttribute("aria-label", "Cleaner navigation");

  if (onboarding) {
    // The fourteen steps, filled by renderCleanerNav once progress is known.
    const steps = element("div", "hc-nav-group");
    steps.dataset.onboardingGroup = "";
    steps.setAttribute("aria-label", "Onboarding steps");
    const list = element("div");
    list.dataset.onboardingNav = "";
    steps.append(list);
    nav.append(steps);
  } else {
    for (const entry of workspaceNav) nav.append(navItem(entry, current));

    const account = element("details", "hc-nav-group");
    account.dataset.accountGroup = "";
    account.open = true;
    const summary = element("summary", "hc-nav-group-summary");
    summary.append(element("span", "hc-nav-group-label", "ACCOUNT"));
    const chevron = element("span", "hc-nav-chevron", "▾");
    chevron.setAttribute("aria-hidden", "true");
    summary.append(chevron);
    const list = element("div");
    list.dataset.accountNav = "";
    const status = element("small", "hc-account-nav-status");
    status.dataset.accountSignOutStatus = "";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    account.append(summary, list, status);
    nav.append(account);
  }

  side.append(nav);
  if (onboarding) side.append(homeReturn());
  shell.prepend(side);
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

const prefetchedOnboardingPages = new Set();

function prefetchOnboardingPage(link) {
  if (!link?.href) return;
  const destination = new URL(link.href, location.href);
  if (destination.origin !== location.origin || destination.pathname === location.pathname) return;
  const key = `${destination.pathname}${destination.search}`;
  if (prefetchedOnboardingPages.has(key)) return;
  prefetchedOnboardingPages.add(key);
  const preload = document.createElement("link");
  preload.rel = "prefetch";
  preload.as = "document";
  preload.href = destination.href;
  document.head.append(preload);
}

function connectOnboardingMotion(host) {
  // Look the active entry up when the frame runs, not before it is scheduled. A normal load
  // renders this rail twice - once at module load so the icons appear immediately, again once
  // progress data arrives - and the second render replaces every node. An element captured
  // beforehand is detached by the time the frame fires, which left the indicator unpositioned
  // and parked at the top of the rail while a lower step was the active one.
  const place = () => positionOnboardingIndicator(host, host.querySelector('[aria-current="page"]'), true);
  place();
  requestAnimationFrame(place);
  if (host.dataset.motionReady) return;
  host.dataset.motionReady = "true";
  const warmOnboardingPages = () => host.querySelectorAll("a[data-preview-page]").forEach(prefetchOnboardingPage);
  if ("requestIdleCallback" in window) window.requestIdleCallback(warmOnboardingPages, { timeout: 1800 });
  else window.setTimeout(warmOnboardingPages, 450);
  window.addEventListener("resize", () => positionOnboardingIndicator(host, host.querySelector('[aria-current="page"]'), true));
  host.addEventListener("pointerover", (event) => prefetchOnboardingPage(event.target.closest("a[data-preview-page]")));
  host.addEventListener("focusin", (event) => prefetchOnboardingPage(event.target.closest("a[data-preview-page]")));
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
    document.documentElement.classList.add("hc-onboarding-navigating");
    // Begin loading immediately. The cross-document View Transition keeps the
    // current page visible and carries the white selection surface to its new
    // icon while the destination document becomes ready.
    requestAnimationFrame(() => location.assign(destination.href));
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
// The shell has to exist before the two group renderers can fill it.
renderCleanerShell();
renderCleanerAccountNav();
// Paint the fourteen step icons straight away. Their completion marks need the account,
// profile, availability and onboarding reads, but the icons themselves do not, and waiting
// on four round trips is what left this rail empty while moving between tabs. cleaner-page.js
// calls this again with real progress once those reads land.
renderCleanerNav();
