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
let stripe;
let elements;
let loading = false;

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
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
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers: { Accept: "application/json", ...headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || result.message || "The secure payment step could not be completed."), { statusCode: response.status, code: result.code });
  return result;
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

function renderPayment(payment) {
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
  showFeedback("");
}

async function loadStripe() {
  if (globalThis.Stripe) return globalThis.Stripe;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = stripeScriptUrl;
    script.async = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("The secure payment form could not load. Check your connection and try again.")), { once: true });
    document.head.append(script);
  });
  if (typeof globalThis.Stripe !== "function") throw new Error("The secure payment form is unavailable.");
  return globalThis.Stripe;
}

async function preparePayment() {
  if (loading) return;
  const csrf = storedCsrf();
  if (!csrf) return showState("Sign in again before payment", "Your secure editing token is missing. Tideway has not attempted a payment.", { kind: "authentication", allowSignIn: true });
  loading = true;
  prepare.disabled = true;
  prepare.setAttribute("aria-busy", "true");
  showFeedback("");
  try {
    const authorization = await requestJson(`/api/marketplace/bookings/${bookingId}/payment`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ idempotencyKey: retryKey() }) });
    const payment = authorization.payment;
    renderPayment(payment);
    if (!payment?.requiresCustomerAction || !payment.clientSecret) return;
    const configuration = await requestJson("/api/marketplace/payments/config");
    if (configuration.payment?.testMode !== true || !/^pk_test_[A-Za-z0-9_]{16,200}$/.test(configuration.payment?.publishableKey || "")) throw new Error("Test payment configuration is unavailable.");
    const Stripe = await loadStripe();
    stripe = Stripe(configuration.payment.publishableKey);
    elements = stripe.elements({ clientSecret: payment.clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#0e665b", colorText: "#102421", borderRadius: "10px", fontFamily: "Inter, system-ui, sans-serif" } } });
    elements.create("payment", { layout: "accordion" }).mount("[data-payment-element]");
    prepare.hidden = true;
    form.hidden = false;
    submit.focus();
  } catch (error) {
    showFeedback(error.message || "The secure payment form could not be prepared.");
    prepare.hidden = false;
  } finally {
    loading = false;
    prepare.disabled = false;
    prepare.removeAttribute("aria-busy");
  }
}

async function refreshStatus() {
  const result = await requestJson(`/api/marketplace/bookings/${bookingId}/payment`);
  renderPayment(result.payment);
  return result.payment;
}

async function confirmPayment(event) {
  event.preventDefault();
  if (loading || !stripe || !elements) return;
  loading = true;
  submit.disabled = true;
  submit.setAttribute("aria-busy", "true");
  showFeedback("");
  try {
    const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (result.error) throw new Error(result.error.message || "Payment details could not be authorized.");
    form.hidden = true;
    document.querySelector("[data-payment-message-title]").textContent = "Authorization submitted";
    document.querySelector("[data-payment-message-copy]").textContent = "Tideway is waiting for the signed provider confirmation. Do not submit another payment.";
    for (const delay of [0, 700, 1400, 2800]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const payment = await refreshStatus();
      if (!["creating", "requires-customer-action", "processing"].includes(payment?.status)) break;
    }
  } catch (error) {
    showFeedback(error.message || "Payment details could not be authorized.");
  } finally {
    loading = false;
    submit.disabled = false;
    submit.removeAttribute("aria-busy");
  }
}

async function load() {
  document.querySelector("[data-year]").textContent = new Date().getFullYear();
  if (!bookingId) return showState("Open a valid booking payment link", "This address does not contain a valid private booking reference. No payment was attempted.", { kind: "error" });
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (account?.selectedRole !== "landlord" || !account?.roles?.includes("landlord")) return showState("Use the booking Landlord account", "Cleaner and unrelated accounts cannot view or authorize this payment.", { kind: "authentication", allowSignIn: true });
    renderPayment((await requestJson(`/api/marketplace/bookings/${bookingId}/payment`)).payment);
  } catch (error) {
    if (error.statusCode === 401) showState("Sign in as the booking Landlord", "Payment status is private to the verified Landlord account.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showState("This account cannot access the payment", "Use the Landlord account that owns this booking.", { kind: "authentication", allowSignIn: true });
    else if ([404, 503].includes(error.statusCode)) showState("Secure account payments are not connected yet", "The checkout is prepared but remains closed until Tideway's database, test payment account and HTTPS runtime pass staging.", { kind: "unavailable", allowRetry: true });
    else showState("Payment status could not be checked", "No payment was attempted. Check your connection and try again.", { kind: "error", allowRetry: true });
  }
}

prepare.addEventListener("click", preparePayment);
form.addEventListener("submit", confirmPayment);
retry.addEventListener("click", load);
load();
