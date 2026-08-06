import { storedCsrf } from "./session-csrf.js";

const stripeScriptUrl = "https://js.stripe.com/clover/stripe.js";
const state = document.querySelector("[data-sandbox-state]");
const stateTitle = document.querySelector("[data-sandbox-state-title]");
const stateCopy = document.querySelector("[data-sandbox-state-copy]");
const signIn = document.querySelector("[data-sandbox-sign-in]");
const retry = document.querySelector("[data-sandbox-retry]");
const card = document.querySelector("[data-sandbox-card]");
const form = document.querySelector("[data-sandbox-form]");
const feedback = document.querySelector("[data-sandbox-feedback]");
const submit = document.querySelector("[data-sandbox-submit]");
const complete = document.querySelector("[data-sandbox-complete]");
let stripe;
let elements;
let loading = false;

function saveCsrf(token) {
  try { sessionStorage.setItem("tideway_csrf", token); return sessionStorage.getItem("tideway_csrf") === token; } catch { return false; }
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers: { Accept: "application/json", ...headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || result.message || "Stripe test checkout could not be prepared."), { statusCode: response.status, code: result.code });
  return result;
}

async function csrfToken() {
  const saved = storedCsrf();
  if (saved) return saved;
  const result = await requestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!result.csrfToken || !saveCsrf(result.csrfToken)) throw new Error("The secure editing token could not be stored in this browser.");
  return result.csrfToken;
}

function retryKey() {
  const storageKey = "homle_stripe_sandbox_retry";
  try {
    const saved = sessionStorage.getItem(storageKey) || "";
    if (/^[A-Za-z0-9_-]{32,128}$/.test(saved)) return saved;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const created = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    sessionStorage.setItem(storageKey, created);
    return created;
  } catch { throw new Error("Secure retry storage is unavailable. Allow session storage and try again."); }
}

async function loadStripe() {
  if (globalThis.Stripe) return globalThis.Stripe;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = stripeScriptUrl;
    script.async = true;
    script.addEventListener("load", () => resolve(globalThis.Stripe), { once: true });
    script.addEventListener("error", () => reject(new Error("The Stripe test form could not load.")), { once: true });
    document.head.append(script);
  });
}

function showError(error) {
  state.dataset.kind = "error";
  state.hidden = false;
  stateTitle.textContent = error.statusCode === 401 ? "Sign in to test Stripe" : "Stripe test checkout could not open";
  stateCopy.textContent = error.message;
  signIn.hidden = error.statusCode !== 401;
  retry.hidden = error.statusCode === 401;
  card.hidden = true;
}

async function start() {
  if (loading) return;
  loading = true;
  retry.disabled = true;
  try {
    state.dataset.kind = "checking";
    stateTitle.textContent = "Preparing Stripe test checkout…";
    stateCopy.textContent = "Checking your authenticated Landlord session and protected test configuration.";
    state.hidden = false;
    const [configuration, csrf] = await Promise.all([requestJson("/api/marketplace/payments/config"), csrfToken()]);
    if (configuration.payment?.testMode !== true || !/^pk_test_[A-Za-z0-9_]{16,200}$/.test(configuration.payment?.publishableKey || "")) throw new Error("Stripe test keys are unavailable.");
    const prepared = await requestJson("/api/marketplace/payments/sandbox-checkout", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ idempotencyKey: retryKey() }) });
    if (prepared.payment?.testMode !== true || prepared.payment?.amountPence !== 30 || !prepared.payment?.clientSecret) throw new Error("Stripe returned an incomplete test checkout.");
    const Stripe = await loadStripe();
    if (typeof Stripe !== "function") throw new Error("The Stripe test form is unavailable.");
    stripe = Stripe(configuration.payment.publishableKey);
    elements = stripe.elements({ clientSecret: prepared.payment.clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#d7182a", colorText: "#141114", borderRadius: "10px", fontFamily: "Inter, system-ui, sans-serif" } } });
    elements.create("payment", { layout: "accordion" }).mount("[data-sandbox-element]");
    state.hidden = true;
    card.hidden = false;
    form.hidden = false;
    submit.focus();
  } catch (error) { showError(error); }
  finally { loading = false; retry.disabled = false; }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loading || !stripe || !elements) return;
  loading = true;
  submit.disabled = true;
  submit.textContent = "Completing Stripe test…";
  feedback.hidden = true;
  try {
    const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (result.error) throw new Error(result.error.message || "Stripe could not complete the test payment.");
    if (result.paymentIntent?.status !== "succeeded") throw new Error("Stripe is still processing the test payment. Check the Stripe test dashboard before trying again.");
    try { sessionStorage.removeItem("homle_stripe_sandbox_retry"); } catch {}
    form.hidden = true;
    complete.hidden = false;
  } catch (error) {
    feedback.textContent = error.message;
    feedback.hidden = false;
  } finally {
    loading = false;
    submit.disabled = false;
    submit.textContent = "Complete £0.30 Stripe test";
  }
});

retry.addEventListener("click", start);
start();
