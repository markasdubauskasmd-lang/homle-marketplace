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
let stripeLoadPromise = null;

function browserOffline() {
  return navigator.onLine === false;
}

function saveCsrf(token) {
  try { sessionStorage.setItem("tideway_csrf", token); return sessionStorage.getItem("tideway_csrf") === token; } catch { return false; }
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const mutation = String(rest.method || "GET").toUpperCase() !== "GET";
  if (browserOffline()) throw Object.assign(new Error("You are offline. Reconnect before opening the Stripe test."), { code: "browser-offline", uncertain: false });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, signal: controller.signal, headers: { Accept: "application/json", ...headers } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || result.message || "Stripe test checkout could not be prepared."), { statusCode: response.status, code: result.code, uncertain: false });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error(mutation ? "The connection took too long. A Stripe test may already have been prepared; retrying will safely recover the same test." : "The Stripe configuration took too long to load. Check the connection and try again."), { code: "request-timeout", uncertain: mutation });
    if (browserOffline()) throw Object.assign(new Error("The connection was lost. Reconnect before continuing the Stripe test."), { code: "browser-offline", uncertain: mutation });
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
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
  if (stripeLoadPromise) return stripeLoadPromise;
  stripeLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = stripeScriptUrl;
    script.async = true;
    const timer = window.setTimeout(() => {
      script.remove();
      reject(new Error("The Stripe test form took too long to load. Check the connection and try again."));
    }, 20_000);
    script.addEventListener("load", () => { window.clearTimeout(timer); resolve(globalThis.Stripe); }, { once: true });
    script.addEventListener("error", () => { window.clearTimeout(timer); reject(new Error("The Stripe test form could not load. Check the connection and try again.")); }, { once: true });
    document.head.append(script);
  }).then((Stripe) => {
    if (typeof Stripe !== "function") throw new Error("The Stripe test form is unavailable.");
    return Stripe;
  }).catch((error) => {
    stripeLoadPromise = null;
    throw error;
  });
  return stripeLoadPromise;
}

function showError(error) {
  state.dataset.kind = "error";
  state.hidden = false;
  stateTitle.textContent = error.statusCode === 401 ? "Sign in to test Stripe" : error.code === "browser-offline" ? "You are offline" : "Stripe test checkout could not open";
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

async function confirmStripeTest() {
  let timer;
  try {
    return await Promise.race([
      stripe.confirmPayment({ elements, redirect: "if_required" }),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(Object.assign(new Error("Stripe took too long to confirm the test. Its result may still be processing; check the Stripe test dashboard before trying again."), { code: "payment-confirmation-timeout", uncertain: true })), 60_000);
      })
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loading || !stripe || !elements) return;
  if (browserOffline()) {
    feedback.textContent = "You are offline. Reconnect before submitting the Stripe test.";
    feedback.hidden = false;
    return;
  }
  loading = true;
  submit.disabled = true;
  submit.textContent = "Completing Stripe test…";
  feedback.hidden = true;
  try {
    const result = await confirmStripeTest();
    if (result.error) throw new Error(result.error.message || "Stripe could not complete the test payment.");
    if (result.paymentIntent?.status !== "succeeded") throw new Error("Stripe is still processing the test payment. Check the Stripe test dashboard before trying again.");
    try { sessionStorage.removeItem("homle_stripe_sandbox_retry"); } catch {}
    form.hidden = true;
    complete.hidden = false;
  } catch (error) {
    feedback.textContent = error.uncertain === true
      ? `${error.message} Do not submit again until you have checked the Stripe test dashboard.`
      : error.message;
    feedback.hidden = false;
  } finally {
    loading = false;
    submit.disabled = false;
    submit.textContent = "Complete £0.30 Stripe test";
  }
});

retry.addEventListener("click", start);
window.addEventListener("offline", () => {
  if (!form.hidden) {
    feedback.textContent = "The connection was lost. Reconnect before submitting the Stripe test.";
    feedback.hidden = false;
  }
});
start();
