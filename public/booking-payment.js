import { bookingIdFromSearch, formatPaymentAmount, paymentPresentation, paymentRetryStorageKey } from "./booking-payment-model.js";

const stripeScriptUrl = "https://js.stripe.com/clover/stripe.js";
const bookingId = bookingIdFromSearch(location.search);
const state = document.querySelector("[data-payment-state]");
const stateTitle = document.querySelector("[data-payment-state-title]");
const stateCopy = document.querySelector("[data-payment-state-copy]");
const signIn = document.querySelector("[data-payment-sign-in]");
const retry = document.querySelector("[data-payment-retry]");
const card = document.querySelector("[data-payment-card]");
const prepare = document.querySelector("[data-payment-prepare]");
const form = document.querySelector("[data-payment-form]");
const submit = document.querySelector("[data-payment-submit]");
const feedback = document.querySelector("[data-payment-feedback]");
const statusRefresh = document.querySelector("[data-payment-status-refresh]");
const completion = document.querySelector("[data-payment-complete]");
const networkStatus = document.querySelector("[data-payment-network]");
let stripe;
let elements;
let loading = false;
let stripeLoadPromise = null;
let frozenAmountPence = null;

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function saveCsrf(token) {
  try {
    sessionStorage.setItem("tideway_csrf", token);
    return sessionStorage.getItem("tideway_csrf") === token;
  } catch { return false; }
}

function browserOffline() {
  return navigator.onLine === false;
}

function updateNetworkStatus() {
  networkStatus.hidden = !browserOffline();
}

function showState(title, copy, { kind = "info", allowSignIn = false, allowRetry = false } = {}) {
  state.dataset.kind = kind;
  state.hidden = false;
  stateTitle.textContent = title;
  stateCopy.textContent = copy;
  signIn.hidden = !allowSignIn;
  retry.hidden = !allowRetry;
  card.hidden = true;
}

function showFeedback(message) {
  feedback.textContent = message;
  feedback.hidden = !message;
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const mutation = String(rest.method || "GET").toUpperCase() !== "GET";
  if (browserOffline()) throw Object.assign(new Error(mutation ? "You are offline. No payment action was sent; reconnect before continuing." : "You are offline. Reconnect to check the payment status."), { code: "browser-offline", uncertain: false });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, signal: controller.signal, headers: { Accept: "application/json", ...headers } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || result.message || "The secure payment step could not be completed."), { statusCode: response.status, code: result.code, uncertain: false });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error(mutation ? "The connection took too long. A secure payment step may have been prepared; check its status before trying again." : "The payment status took too long to load. Check the connection and try again."), { code: "request-timeout", uncertain: mutation });
    if (browserOffline()) throw Object.assign(new Error(mutation ? "The connection was lost. A secure payment step may have been prepared; reconnect and check its status before trying again." : "The connection was lost. Reconnect to check the payment status."), { code: "browser-offline", uncertain: mutation });
    throw error;
  } finally { window.clearTimeout(timer); }
}

async function recoverCsrf() {
  const current = storedCsrf();
  if (current) return current;
  try {
    const result = await requestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!result.csrfToken || !saveCsrf(result.csrfToken)) throw new Error("The secure editing token could not be stored in this browser.");
    return result.csrfToken;
  } catch (error) {
    showFeedback(error.code === "browser-offline" ? "You are offline. No payment action was sent. Reconnect, then try again." : "Your secure session could not be recovered. Sign in again before payment.");
    return "";
  }
}

function randomRetryKey() {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure browser randomness is unavailable. Use a current browser over HTTPS.");
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function retryKey() {
  const key = paymentRetryStorageKey(bookingId);
  try {
    const existing = sessionStorage.getItem(key) || "";
    if (/^[A-Za-z0-9_-]{32,128}$/.test(existing)) return existing;
    const created = randomRetryKey();
    sessionStorage.setItem(key, created);
    return created;
  } catch (error) {
    if (error?.message?.includes("randomness")) throw error;
    throw new Error("Private retry storage is unavailable. Allow session storage and sign in again.");
  }
}

function verifyFrozenAmount(payment) {
  if (!payment) return;
  const amount = payment.amountPence;
  if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000) throw Object.assign(new Error("The exact frozen booking total is unavailable. Homle did not open payment details."), { code: "payment-amount-unavailable" });
  if (frozenAmountPence == null) frozenAmountPence = amount;
  else if (frozenAmountPence !== amount) throw Object.assign(new Error("The booking total changed during this payment session. Homle stopped the payment step for review."), { code: "payment-amount-mismatch" });
}

function destroyPaymentElement() {
  try { elements?.getElement?.("payment")?.destroy?.(); } catch {}
  elements = null;
}

function clearRetryKey() {
  try { sessionStorage.removeItem(paymentRetryStorageKey(bookingId)); } catch {}
}

function renderPayment(payment) {
  verifyFrozenAmount(payment);
  const view = paymentPresentation(payment);
  const formattedAmount = payment ? formatPaymentAmount(payment.amountPence) : "Amount unavailable";
  state.hidden = true;
  card.hidden = false;
  document.querySelector("[data-payment-amount]").textContent = formattedAmount;
  document.querySelector("[data-payment-reference]").textContent = `Booking ${bookingId.toUpperCase()}`;
  document.querySelector("[data-payment-status]").textContent = payment ? String(payment.status).replaceAll("-", " ") : "not started";
  document.querySelector("[data-payment-message-title]").textContent = view.title;
  document.querySelector("[data-payment-message-copy]").textContent = view.copy;
  prepare.hidden = !["prepare", "continue", "retry"].includes(view.action);
  prepare.textContent = view.action === "retry" ? "Try payment details again" : "Enter secure payment details";
  submit.textContent = formattedAmount === "Amount unavailable" ? "Authorize booking total" : `Authorize ${formattedAmount}`;
  form.hidden = true;
  statusRefresh.hidden = !["waiting", "complete", "blocked"].includes(view.action);
  completion.hidden = view.action !== "complete";
  completion.href = `/bookings/${encodeURIComponent(bookingId)}`;
  completion.textContent = ["authorized", "captured"].includes(payment?.status) ? "Open confirmed booking" : "Open booking record";
  if (!["continue", "retry"].includes(view.action)) destroyPaymentElement();
  if (view.action === "complete") clearRetryKey();
  showFeedback("");
}

async function loadStripe() {
  if (globalThis.Stripe) return globalThis.Stripe;
  if (stripeLoadPromise) return stripeLoadPromise;
  stripeLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = stripeScriptUrl;
    script.async = true;
    const timer = window.setTimeout(() => { script.remove(); reject(new Error("The secure payment form took too long to load. No card details were submitted; check the connection and try again.")); }, 20_000);
    script.addEventListener("load", () => { window.clearTimeout(timer); resolve(globalThis.Stripe); }, { once: true });
    script.addEventListener("error", () => { window.clearTimeout(timer); reject(new Error("The secure payment form could not load. No card details were submitted; check your connection and try again.")); }, { once: true });
    document.head.append(script);
  }).then((Stripe) => {
    if (typeof Stripe !== "function") throw new Error("The secure payment form is unavailable.");
    return Stripe;
  }).catch((error) => { stripeLoadPromise = null; throw error; });
  return stripeLoadPromise;
}

async function openPaymentForm(payment) {
  renderPayment(payment);
  if (!payment?.requiresCustomerAction || !payment.clientSecret) return false;
  const configuration = await requestJson("/api/marketplace/payments/config");
  if (configuration.payment?.testMode !== true || !/^pk_test_[A-Za-z0-9_]{16,200}$/.test(configuration.payment?.publishableKey || "")) throw new Error("Test payment configuration is unavailable.");
  const Stripe = await loadStripe();
  stripe = Stripe(configuration.payment.publishableKey);
  destroyPaymentElement();
  elements = stripe.elements({ clientSecret: payment.clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#d7182a", colorText: "#141114", borderRadius: "10px", fontFamily: "Inter, system-ui, sans-serif" } } });
  elements.create("payment", { layout: "accordion" }).mount("[data-payment-element]");
  prepare.hidden = true;
  statusRefresh.hidden = true;
  form.hidden = false;
  submit.focus();
  return true;
}

async function preparePayment() {
  if (loading) return;
  const csrf = await recoverCsrf();
  if (!csrf) return;
  loading = true;
  prepare.disabled = true;
  prepare.setAttribute("aria-busy", "true");
  showFeedback("");
  try {
    const authorization = await requestJson(`/api/marketplace/bookings/${bookingId}/payment`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ idempotencyKey: retryKey() }) });
    await openPaymentForm(authorization.payment);
  } catch (error) {
    if (error.uncertain === true && !browserOffline()) {
      try {
        const recovered = await readPaymentStatus();
        if (recovered && recovered.status !== "not-started") {
          await openPaymentForm(recovered);
          showFeedback("The existing secure payment step was recovered. Homle did not create a duplicate.");
          return;
        }
      } catch {}
      prepare.hidden = true;
      statusRefresh.hidden = false;
      showFeedback("Homle could not verify whether the payment step was prepared. Wait a moment and refresh its status before trying again.");
    } else if (["payment-amount-unavailable", "payment-amount-mismatch"].includes(error.code)) {
      showState("Booking total needs review", error.message, { kind: "error" });
    } else {
      showFeedback(error.message || "The secure payment form could not be prepared.");
      prepare.hidden = false;
    }
  } finally {
    loading = false;
    prepare.disabled = false;
    prepare.removeAttribute("aria-busy");
  }
}

async function readPaymentStatus() {
  const result = await requestJson(`/api/marketplace/bookings/${bookingId}/payment`);
  verifyFrozenAmount(result.payment);
  return result.payment;
}

async function refreshStatus({ manual = false } = {}) {
  if (loading) return null;
  loading = true;
  statusRefresh.disabled = true;
  statusRefresh.textContent = "Refreshing…";
  try {
    const payment = await readPaymentStatus();
    renderPayment(payment);
    if (manual) showFeedback("Payment status checked securely. No new payment action was sent.");
    return payment;
  } catch (error) {
    showFeedback(error.message || "The payment status could not be refreshed. No payment action was sent.");
    return null;
  } finally {
    loading = false;
    statusRefresh.disabled = false;
    statusRefresh.textContent = "Refresh payment status";
  }
}

async function confirmStripePayment() {
  let timer;
  try {
    return await Promise.race([
      stripe.confirmPayment({ elements, redirect: "if_required" }),
      new Promise((_, reject) => { timer = window.setTimeout(() => reject(Object.assign(new Error("Stripe took too long to confirm the authorization. Its result is uncertain; do not submit again until Homle checks the signed status."), { code: "payment-confirmation-timeout", uncertain: true })), 60_000); })
    ]);
  } finally { window.clearTimeout(timer); }
}

async function confirmPayment(event) {
  event.preventDefault();
  if (loading || !stripe || !elements) return;
  if (browserOffline()) return showFeedback("You are offline. No payment details were submitted; reconnect before authorizing this booking.");
  loading = true;
  submit.disabled = true;
  submit.setAttribute("aria-busy", "true");
  showFeedback("");
  try {
    const result = await confirmStripePayment();
    if (result.error) throw new Error(result.error.message || "Payment details could not be authorized.");
    form.hidden = true;
    statusRefresh.hidden = false;
    document.querySelector("[data-payment-message-title]").textContent = "Authorization submitted";
    document.querySelector("[data-payment-message-copy]").textContent = "Homle is waiting for the signed provider confirmation. Do not submit another payment.";
    for (const delay of [0, 700, 1400, 2800]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const payment = await readPaymentStatus();
      renderPayment(payment);
      if (!["creating", "requires-customer-action", "processing"].includes(payment?.status)) break;
      prepare.hidden = true;
      form.hidden = true;
      statusRefresh.hidden = false;
      document.querySelector("[data-payment-message-title]").textContent = "Authorization is being verified";
      document.querySelector("[data-payment-message-copy]").textContent = "Homle is waiting for the signed payment update. Do not submit another payment.";
    }
  } catch (error) {
    if (error.uncertain === true || browserOffline()) {
      form.hidden = true;
      prepare.hidden = true;
      statusRefresh.hidden = false;
      document.querySelector("[data-payment-message-title]").textContent = "Authorization status needs checking";
      document.querySelector("[data-payment-message-copy]").textContent = "The secure provider result is uncertain. Do not submit again; refresh the signed payment status first.";
      showFeedback(browserOffline() ? "The connection was lost during authorization. Its result is uncertain; reconnect and refresh the signed status before taking another action." : error.message);
    } else showFeedback(error.message || "Payment details could not be authorized.");
  } finally {
    loading = false;
    submit.disabled = false;
    submit.removeAttribute("aria-busy");
  }
}

async function load() {
  document.querySelector("[data-year]").textContent = new Date().getFullYear();
  if (!bookingId) return showState("Open a valid booking payment link", "This address does not contain a valid private booking reference. No payment was attempted.", { kind: "error" });
  if (loading) return;
  loading = true;
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (account?.selectedRole !== "landlord" || !account?.roles?.includes("landlord")) return showState("Use the booking Landlord account", "Cleaner and unrelated accounts cannot view or authorize this payment.", { kind: "authentication", allowSignIn: true });
    renderPayment(await readPaymentStatus());
  } catch (error) {
    if (error.code === "browser-offline") showState("You are offline", "Reconnect to check the exact frozen total and signed payment status. No payment was attempted.", { kind: "offline", allowRetry: true });
    else if (["payment-amount-unavailable", "payment-amount-mismatch"].includes(error.code)) showState("Booking total needs review", error.message, { kind: "error" });
    else if (error.statusCode === 401) showState("Sign in as the booking Landlord", "Payment status is private to the verified Landlord account.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showState("This account cannot access the payment", "Use the Landlord account that owns this booking.", { kind: "authentication", allowSignIn: true });
    else if ([404, 503].includes(error.statusCode)) showState("Secure account payments are not connected yet", "The checkout is prepared but remains closed until Homle's database, test payment account and HTTPS runtime pass staging.", { kind: "unavailable", allowRetry: true });
    else showState("Payment status could not be checked", "No payment was attempted. Check your connection and try again.", { kind: "error", allowRetry: true });
  } finally { loading = false; }
}

prepare.addEventListener("click", preparePayment);
form.addEventListener("submit", confirmPayment);
statusRefresh.addEventListener("click", () => { void refreshStatus({ manual: true }); });
retry.addEventListener("click", load);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("online", () => {
  updateNetworkStatus();
  if (!state.hidden && state.dataset.kind === "offline") load();
});
updateNetworkStatus();
load();
