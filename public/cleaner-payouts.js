const state = document.querySelector("[data-payout-state]");
const title = document.querySelector("[data-payout-title]");
const copy = document.querySelector("[data-payout-copy]");
const action = document.querySelector("[data-payout-action]");
const retry = document.querySelector("[data-payout-retry]");
const signIn = document.querySelector("[data-payout-sign-in]");
let loading = false;

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

function csrfToken() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function show(kind, heading, message, { allowAction = false, allowRetry = false, allowSignIn = false } = {}) {
  state.dataset.kind = kind;
  state.querySelector(".cleaner-payout-mark").textContent = kind === "ready" ? "✓" : kind === "error" ? "!" : "→";
  title.textContent = heading;
  copy.textContent = message;
  action.hidden = !allowAction;
  retry.hidden = !allowRetry;
  signIn.hidden = !allowSignIn;
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers: { Accept: "application/json", ...headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || "Payout setup could not be verified."), { statusCode: response.status, code: result.code });
  return result;
}

function renderPayout(payout) {
  if (payout?.ready) return show("ready", "Payouts are ready", "Tideway can use this verified destination after an approved completed job. Your bank details remain with Stripe.");
  if (payout?.status === "action-required") {
    const remaining = Number.isInteger(payout.remainingRequirements) && payout.remainingRequirements > 0 ? ` Stripe still needs ${payout.remainingRequirements} ${payout.remainingRequirements === 1 ? "item" : "items"}.` : "";
    return show("action", "Finish your payout setup", `Continue the secure Stripe form so future Cleaner earnings can be paid.${remaining}`, { allowAction: true });
  }
  show("action", "Set up payouts", "One secure Stripe form prepares your account for future Cleaner earnings.", { allowAction: true });
}

async function requestOnboarding() {
  if (loading) return;
  loading = true;
  const csrf = csrfToken();
  if (!csrf) { loading = false; return show("error", "Sign in again", "Your secure editing token is missing.", { allowSignIn: true }); }
  action.disabled = true;
  action.setAttribute("aria-busy", "true");
  show("loading", "Opening secure Stripe setup…", "You will leave Tideway briefly to provide payout details directly to Stripe.");
  try {
    const result = await requestJson("/api/marketplace/cleaner/payout-account/onboarding", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" });
    const destination = new URL(result.payout?.onboardingUrl || "");
    if (destination.protocol !== "https:" || destination.origin !== "https://connect.stripe.com") throw new Error("Tideway refused an unsafe payout setup destination.");
    window.location.assign(destination.toString());
  } catch (error) {
    if (error.statusCode === 401) show("error", "Sign in again", "Your Cleaner session expired before payout setup started.", { allowSignIn: true });
    else show("error", "Stripe setup could not open", error.message, { allowAction: true, allowRetry: true });
  } finally {
    loading = false;
    action.disabled = false;
    action.removeAttribute("aria-busy");
  }
}

async function loadStatus({ refreshStatus = false, resume = false } = {}) {
  if (loading) return;
  if (resume) return requestOnboarding();
  loading = true;
  show("loading", refreshStatus ? "Checking what Stripe received…" : "Checking your payout setup…", "This usually takes a moment.");
  try {
    const csrf = csrfToken();
    if (refreshStatus && !csrf) throw Object.assign(new Error("Sign in again before continuing payout setup."), { statusCode: 401 });
    const result = await requestJson(refreshStatus ? "/api/marketplace/cleaner/payout-account/refresh" : "/api/marketplace/cleaner/payout-account", refreshStatus ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" } : {});
    renderPayout(result.payout);
    history.replaceState(null, "", "/cleaner/payouts");
  } catch (error) {
    if (error.statusCode === 401) show("error", "Sign in as a Cleaner", "Payout setup is private to your Cleaner account.", { allowSignIn: true });
    else if (error.statusCode === 403) show("error", "Cleaner access required", "Open this page from the Cleaner account selected during onboarding.", { allowSignIn: true });
    else if ([404, 503].includes(error.statusCode)) show("error", "Payout setup is not connected yet", "Tideway has kept this closed until the protected test payment service passes staging.");
    else show("error", "Payout setup could not be verified", error.message, { allowRetry: true });
  } finally { loading = false; }
}

action.addEventListener("click", requestOnboarding);
retry.addEventListener("click", () => loadStatus());
const query = new URLSearchParams(location.search);
loadStatus({ refreshStatus: query.get("returned") === "1", resume: query.get("resume") === "1" });
