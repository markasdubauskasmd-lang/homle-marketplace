/*
 * Cleaner earnings and payout setup.
 *
 * This page used to bootstrap itself: it read the payout endpoint directly and
 * drew a Cleaner header regardless of who was reading. Signed in as a Landlord
 * it stated that the account was a Cleaner, offered "Jobs" and "Open Cleaner
 * dashboard", and only failed once the API refused — after the page had already
 * told the reader something untrue about their own account.
 *
 * It now goes through createCleanerPage, the same bootstrap its eighteen
 * siblings use, which confirms the Cleaner workspace boundary BEFORE any of the
 * workspace is revealed and renders the shared sidebar and gate.
 */

import { createCleanerPage } from "./cleaner-page.js?v=20260729-11";

const state = document.querySelector("[data-payout-state]");
const mark = document.querySelector(".cleaner-payout-mark");
const title = document.querySelector("[data-payout-title]");
const copy = document.querySelector("[data-payout-copy]");
const action = document.querySelector("[data-payout-action]");
const refresh = document.querySelector("[data-payout-refresh]");
let busy = false;
let reload = null;

function csrfToken() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function show(kind, heading, message, { allowAction = false, allowRefresh = false } = {}) {
  state.dataset.kind = kind;
  mark.textContent = kind === "ready" ? "✓" : kind === "error" ? "!" : kind === "loading" ? "…" : "→";
  title.textContent = heading;
  copy.textContent = message;
  action.hidden = !allowAction;
  refresh.hidden = !allowRefresh;
}

function renderPayout(payout) {
  if (payout?.ready) return show("ready", "Payouts are ready", "Homle can use this verified destination after an approved completed job. Your bank details remain with Stripe.", { allowRefresh: true });
  if (payout?.status === "action-required") {
    const remaining = Number.isInteger(payout.remainingRequirements) && payout.remainingRequirements > 0
      ? ` Stripe still needs ${payout.remainingRequirements} ${payout.remainingRequirements === 1 ? "item" : "items"}.`
      : "";
    return show("action", "Finish your payout setup", `Continue the secure Stripe form so future Cleaner earnings can be paid.${remaining}`, { allowAction: true, allowRefresh: true });
  }
  show("action", "Set up payouts", "One secure Stripe form prepares your account for future Cleaner earnings.", { allowAction: true });
}

async function requestOnboarding(requestJson, showFeedback) {
  if (busy) return;
  busy = true;
  const csrf = csrfToken();
  if (!csrf) {
    busy = false;
    return show("error", "Sign in again", "Your secure editing token is missing. Sign in again before starting payout setup.", { allowRefresh: true });
  }
  action.disabled = true;
  action.setAttribute("aria-busy", "true");
  show("loading", "Opening secure Stripe setup…", "You will leave Homle briefly to provide payout details directly to Stripe.");
  try {
    const result = await requestJson("/api/marketplace/cleaner/payout-account/onboarding", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" });
    const destination = new URL(result.payout?.onboardingUrl || "");
    // Homle never renders a payout form itself, so anything but Stripe Connect
    // here is a redirect the reader must not follow.
    if (destination.protocol !== "https:" || destination.origin !== "https://connect.stripe.com") throw new Error("Homle refused an unsafe payout setup destination.");
    window.location.assign(destination.toString());
  } catch (error) {
    showFeedback(error.message, "error");
    show("error", "Stripe setup could not open", error.message, { allowAction: true, allowRefresh: true });
  } finally {
    busy = false;
    action.disabled = false;
    action.removeAttribute("aria-busy");
  }
}

async function loadStatus(requestJson, showFeedback, { refreshStatus = false } = {}) {
  if (busy) return;
  busy = true;
  show("loading", refreshStatus ? "Checking what Stripe received…" : "Checking your payout setup…", "This usually takes a moment.");
  try {
    const csrf = csrfToken();
    if (refreshStatus && !csrf) throw Object.assign(new Error("Sign in again before continuing payout setup."), { statusCode: 401 });
    const result = await requestJson(
      refreshStatus ? "/api/marketplace/cleaner/payout-account/refresh" : "/api/marketplace/cleaner/payout-account",
      refreshStatus ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" } : {}
    );
    renderPayout(result.payout);
    showFeedback("");
  } catch (error) {
    // 401/403 are the workspace boundary, and createCleanerPage owns the gate
    // for those — rethrowing keeps one statement of "you cannot open this".
    if (error.statusCode === 401 || error.statusCode === 403) throw error;
    if ([404, 503].includes(error.statusCode)) show("error", "Payout setup is not connected yet", "Homle has kept this closed until the protected test payment service passes staging.");
    else show("error", "Payout setup could not be verified", error.message, { allowRefresh: true });
  } finally {
    busy = false;
  }
}

createCleanerPage("cleaner-payout", async ({ showFeedback, requestJson }) => {
  reload = () => loadStatus(requestJson, showFeedback, { refreshStatus: true });
  action.onclick = () => requestOnboarding(requestJson, showFeedback);
  refresh.onclick = () => reload();
  // Stripe returns to /cleaner/payouts?resume=1 after its hosted form. Resuming
  // means asking Stripe what it now holds, not opening the form again.
  const resume = new URLSearchParams(location.search).has("resume");
  if (resume) history.replaceState(null, "", "/cleaner/payouts");
  await loadStatus(requestJson, showFeedback, { refreshStatus: resume });
});
