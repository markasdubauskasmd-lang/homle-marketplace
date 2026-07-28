/*
 * Shared bootstrap for the secondary Cleaner workspace pages.
 *
 * Each page has the same shape: verify the account, confirm the Cleaner workspace
 * through the existing role boundary, then render. This carries the gate, the offline
 * banner and a bounded JSON reader so those behave identically everywhere and are not
 * re-implemented four times with four sets of bugs.
 *
 * It deliberately does not carry any mutating call. Accept, decline and job completion
 * stay in the modules that already own them.
 */

import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";

export function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

export function browserOffline() {
  return typeof navigator === "object" && navigator !== null && navigator.onLine === false;
}

export function money(pence) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format((Number(pence) || 0) / 100);
}

export async function requestJson(path) {
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
  if (!response.ok || body.ok === false) throw Object.assign(new Error(body.error || "Homle could not load this page."), { statusCode: response.status, code: body.code });
  return body;
}

/**
 * Wires the standard gate for a page whose hooks are named `data-<key>-*`.
 * `render(context)` runs only once a Cleaner workspace is confirmed.
 */
export function createCleanerPage(key, render) {
  const gate = document.querySelector(`[data-${key}-gate]`);
  const view = document.querySelector(`[data-${key}]`);
  const offline = document.querySelector(`[data-${key}-offline]`);
  const feedback = document.querySelector(`[data-${key}-feedback]`);
  const signIn = document.querySelector(`[data-${key}-sign-in]`);
  const retry = document.querySelector(`[data-${key}-retry]`);
  let loading = false;

  function updateNetworkStatus() {
    if (offline) offline.hidden = !browserOffline();
  }

  function showFeedback(message, kind = "info") {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.className = `hc-feedback${message && kind === "error" ? " hc-feedback-error" : ""}`;
  }

  function showGate(title, copy, { allowSignIn = false, allowRetry = false } = {}) {
    setText(`[data-${key}-gate-title]`, title);
    setText(`[data-${key}-gate-copy]`, copy);
    if (signIn) signIn.hidden = !allowSignIn;
    if (retry) retry.hidden = !allowRetry;
    if (gate) gate.hidden = false;
    if (view) view.hidden = true;
  }

  async function load() {
    if (loading) return;
    loading = true;
    showGate("Checking secure Cleaner access…", "This page opens only inside the assigned Cleaner account.");
    try {
      const accountResult = await requestJson("/api/marketplace/account");
      const account = accountResult.account;
      const access = dashboardWorkspaceAccess(account, "cleaner");
      if (!access.ready) return showGate("This account has no Cleaner workspace.", "Sign in through Work as a Cleaner to open the professional workspace.", { allowSignIn: true });
      renderAccountAvatar(account);
      setText("[data-account-name]", account.displayName || "Cleaner");
      if (gate) gate.hidden = true;
      if (view) view.hidden = false;
      const payoutLink = document.querySelector("[data-cleaner-payout-link]");
      if (payoutLink) payoutLink.hidden = false;
      await render({ account, showFeedback, requestJson });
      showFeedback("");
    } catch (error) {
      if (error.code === "browser-offline") showGate("You are offline.", "Reconnect to load this page.", { allowRetry: true });
      else if (error.statusCode === 401) showGate("Sign in as a Cleaner to open this page.", "This workspace is private to the assigned Cleaner account.", { allowSignIn: true });
      else if (error.statusCode === 403) showGate("This account cannot open the Cleaner workspace.", "Use a Cleaner account selected during onboarding.", { allowSignIn: true });
      else showGate("This page is temporarily unavailable.", "Nothing was changed. Check the connection and try again.", { allowRetry: true });
    } finally {
      loading = false;
    }
  }

  retry?.addEventListener("click", load);
  window.addEventListener("offline", updateNetworkStatus);
  window.addEventListener("online", () => {
    updateNetworkStatus();
    if (gate && !gate.hidden) load();
  });
  const yearNode = document.querySelector("[data-year]");
  if (yearNode) yearNode.textContent = String(new Date().getFullYear());
  updateNetworkStatus();
  load();
}
