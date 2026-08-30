/*
 * Renders the Homle workspace shell — one implementation, for every signed-in
 * page that is not the composed Landlord dashboard.
 *
 * Load it as the FIRST module script on the page. Module scripts run in document
 * order, so its sidebar, top bar and tab bar are in the document before
 * account-menu.js and the page's own module query for them. It reads its
 * configuration from `data-workspace-*` attributes on <body>, so a page declares
 * what it is rather than building its own header.
 *
 * The navigation is drawn from the signed-in account, never hard-coded. The
 * audit found /cleaner/payouts telling a Landlord that their account was a
 * Cleaner, purely because its header was static markup that had never been
 * asked who was reading it.
 */

import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { bindAccountSignOut, readSignedInAccount } from "./account-menu.js?v=20260830-1";
import { unreadBadge, workspaceShell } from "./workspace-shell-model.js";

/* The four sidebar glyphs and the bell, lifted from the approved composition's
   own markup. Described as data and built with DOM calls rather than assigned as
   markup: this module renders a page that also renders account content, and the
   simplest way to keep an innerHTML assignment out of it is not to have one. */
const svgNamespace = "http://www.w3.org/2000/svg";
const icons = Object.freeze({
  home: [["path", { d: "M4 10.8 12 4l8 6.8V20h-5.2v-5.2h-5.6V20H4z" }]],
  calendar: [["rect", { x: "4", y: "6", width: "16", height: "14", rx: "2.5" }], ["path", { d: "M4 10.5h16M8.5 4v4M15.5 4v4" }]],
  message: [["rect", { x: "3.5", y: "5", width: "17", height: "12.5", rx: "3" }], ["path", { d: "M8 21l3.2-3.5" }]],
  person: [["circle", { cx: "12", cy: "8", r: "3.4" }], ["path", { d: "M5.2 20c1.4-3.1 3.9-4.7 6.8-4.7s5.4 1.6 6.8 4.7" }]],
  bell: [["path", { d: "M6.5 16v-5.5a5.5 5.5 0 0 1 11 0V16l1.5 2.5H5z" }], ["path", { d: "M10 20.5a2 2 0 0 0 4 0" }]],
  place: [["path", { d: "M4 10.5 12 4.5l8 6V20H4z" }], ["circle", { cx: "12", cy: "12.5", r: "1.6" }], ["path", { d: "M12 14.5V17" }]],
  scan: [["path", { d: "M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5" }], ["path", { d: "M4 12h16" }]]
});

function svg(name) {
  const element = document.createElementNS(svgNamespace, "svg");
  element.setAttribute("viewBox", "0 0 24 24");
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", "currentColor");
  element.setAttribute("stroke-width", "1.8");
  element.setAttribute("stroke-linejoin", "round");
  element.setAttribute("aria-hidden", "true");
  for (const [tag, attributes] of icons[name] || []) {
    const shape = document.createElementNS(svgNamespace, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    element.append(shape);
  }
  return element;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function brandMark(href, label) {
  const link = element("a", "hw-brand");
  link.href = href;
  link.setAttribute("aria-label", "Homle workspace home");
  const image = element("img");
  image.src = "/homle-logo.png";
  image.alt = "";
  image.width = 38;
  image.height = 38;
  const copy = element("span");
  copy.append(element("strong", "", "Homle"), element("small", "", label));
  link.append(image, copy);
  return link;
}

function navigationLinks(shell) {
  return shell.navigation.map((item) => {
    const link = element("a");
    link.href = item.href;
    if (item.current) link.setAttribute("aria-current", "page");
    link.append(svg(item.icon), element("span", "", item.label));
    return link;
  });
}

function bell(shell) {
  const link = element("a", "hw-bell");
  link.href = shell.notificationsHref;
  link.dataset.notificationLink = "";
  link.setAttribute("aria-label", "Updates");
  const count = element("span", "hw-bell-count");
  count.dataset.notificationCount = "";
  count.hidden = true;
  link.append(svg("bell"), element("span", "", "Updates"), count);
  return link;
}

function sidebar(shell) {
  const header = element("header", "hw-sidebar");
  const inner = element("div", "hw-sidebar-inner");
  inner.append(brandMark(shell.home, shell.label));

  if (shell.showNavigation) {
    const nav = element("nav", "hw-nav");
    nav.setAttribute("aria-label", `${shell.label} navigation`);
    nav.append(...navigationLinks(shell));
    inner.append(nav);
  }

  const account = element("a", "hw-sidebar-account");
  account.href = shell.navigation.at(-1)?.href || "/onboarding";
  const avatar = element("span", "hw-avatar");
  avatar.dataset.accountAvatar = "";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "H";
  const copy = element("span");
  const name = element("strong", "", "Your account");
  name.dataset.accountName = "";
  const status = element("small");
  status.append(element("span", "hw-status-dot"), document.createTextNode("Signed in securely"));
  status.firstChild.setAttribute("aria-hidden", "true");
  copy.append(name, status);
  account.append(avatar, copy);
  inner.append(account);

  header.append(inner);
  return header;
}

function topbar(shell, config) {
  const section = element("section", "hw-topbar");

  const mobileBrand = element("a", "hw-mobile-brand");
  mobileBrand.href = shell.home;
  mobileBrand.setAttribute("aria-label", "Homle workspace home");
  const mark = element("img");
  mark.src = "/homle-logo.png";
  mark.alt = "";
  mark.width = 38;
  mark.height = 38;
  mobileBrand.append(mark);

  const copy = element("div", "hw-topbar-copy");
  const eyebrow = element("p", "hw-eyebrow");
  eyebrow.append(element("span", "", "●"), document.createTextNode(config.eyebrow));
  eyebrow.firstChild.setAttribute("aria-hidden", "true");
  const heading = element("h1", "", config.title);
  heading.tabIndex = -1;
  heading.dataset.workspaceHeading = "";
  copy.append(eyebrow, heading);
  if (config.subtitle) copy.append(element("p", "", config.subtitle));

  const actions = element("div", "hw-topbar-actions");
  // The page that IS the inbox does not need a shortcut to itself.
  if (!config.hideBell) actions.append(bell(shell));

  const menu = element("details", "account-menu");
  menu.dataset.accountMenu = "";
  menu.hidden = true;
  const summary = element("summary");
  summary.setAttribute("aria-label", "Open your Homle account menu");
  const summaryAvatar = element("span", "hw-avatar account-avatar");
  summaryAvatar.dataset.accountAvatar = "";
  summaryAvatar.setAttribute("aria-hidden", "true");
  summaryAvatar.textContent = "H";
  summary.append(summaryAvatar);
  const panel = element("div", "account-menu-panel");
  const panelName = element("strong", "", "Your account");
  panelName.dataset.accountName = "";
  const panelEmail = element("small");
  panelEmail.dataset.accountEmail = "";
  const workspaceLink = element("a", "", "Open workspace");
  workspaceLink.href = shell.home;
  workspaceLink.dataset.accountDashboard = "";
  const signOut = element("button", "account-sign-out", "Sign out");
  signOut.type = "button";
  signOut.dataset.accountSignOut = "";
  signOut.dataset.signOutDestination = shell.signOutDestination;
  const signOutStatus = element("small", "account-menu-status");
  signOutStatus.dataset.accountSignOutStatus = "";
  signOutStatus.setAttribute("role", "status");
  signOutStatus.setAttribute("aria-live", "polite");
  signOutStatus.hidden = true;
  panel.append(panelName, panelEmail, workspaceLink, signOut, signOutStatus);
  menu.append(summary, panel);
  actions.append(menu);

  section.append(mobileBrand, copy, actions);
  return section;
}

function mobileNav(shell) {
  if (!shell.showNavigation) return null;
  const nav = element("nav", "hw-mobile-nav");
  nav.setAttribute("aria-label", `${shell.label} navigation`);
  for (const item of shell.phoneNavigation) {
    const link = element("a", item.action ? "hw-mobile-action" : "");
    link.href = item.href;
    if (item.current) link.setAttribute("aria-current", "page");
    if (item.action) {
      // The raised centre control is an icon with no visible label, as the
      // composition draws it, so the label has to reach a screen reader another
      // way. The glyph sits in its own span because the circle is the span.
      link.setAttribute("aria-label", item.label);
      const mark = element("span");
      mark.setAttribute("aria-hidden", "true");
      mark.append(svg(item.icon));
      link.append(mark);
    } else {
      link.append(svg(item.icon), element("span", "", item.label));
    }
    nav.append(link);
  }
  return nav;
}

/**
 * Puts the shell into the page and returns the account it was built from.
 *
 * The chrome is rendered only once an account resolves. A signed-out visitor
 * gets no navigation at all rather than a bar of destinations that will refuse
 * them, and the page's own gate states what happened.
 */
export async function renderWorkspaceShell(config = {}) {
  const main = document.querySelector("[data-workspace-main]");
  if (!main) return null;
  main.classList.add("hw-main");

  let account = null;
  try {
    account = (await readSignedInAccount())?.account || null;
  } catch {
    account = null;
  }

  const shell = workspaceShell(account, { active: config.active });
  const bar = topbar(shell, {
    eyebrow: config.eyebrow || `Private ${shell.label.toLowerCase()} workspace`,
    title: typeof config.title === "function" ? config.title(shell) : config.title || "",
    subtitle: config.subtitle || "",
    hideBell: config.hideBell === true || !shell.showNavigation
  });
  main.prepend(bar);

  if (shell.showNavigation) {
    document.body.prepend(sidebar(shell));
    const tabs = mobileNav(shell);
    if (tabs) document.body.append(tabs);
  }

  // Only when there is an account: renderAccountAvatar also reveals the menu,
  // and a signed-out visitor should not be shown an account control at all.
  if (account) renderAccountAvatar(account);
  for (const button of document.querySelectorAll("[data-account-sign-out]")) bindAccountSignOut(button);

  return Object.freeze({ account, shell });
}

/** Sets the unread pill on whichever bells the page rendered. */
export function setWorkspaceUnread(count) {
  const badge = unreadBadge(count);
  for (const node of document.querySelectorAll("[data-notification-count]")) {
    node.textContent = badge.text;
    node.hidden = !badge.visible;
    if (badge.visible) node.setAttribute("aria-label", badge.label);
    else node.removeAttribute("aria-label");
  }
}
