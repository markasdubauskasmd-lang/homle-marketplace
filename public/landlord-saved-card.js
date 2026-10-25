import { formatPaymentAmount, paymentWindowOpensAt, savedCardPresentation } from "./landlord-checkout-model.js";

// Pay at booking (M4). Mounted only when the server answers the saved-card
// route, which it does only while the platform worker that uses saved cards is
// running; otherwise this renders nothing and the ordinary payment step
// stands. Built with DOM nodes and textContent only.

const windowFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

export async function readSavedCard(requestJson, bookingId) {
  try {
    const result = await requestJson(`/api/marketplace/bookings/${bookingId}/saved-card`);
    return { available: true, card: result.savedCard ?? null };
  } catch {
    // Switched off, not ready, or unreachable: the ordinary payment step stands.
    return { available: false, card: null };
  }
}

export function mountSavedCard({ host, bookingId, card, amountPence, scheduledStartAt, requestJson, recoverCsrf, loadStripe }) {
  let current = card;
  let elements = null;
  let stripe = null;
  let busy = false;
  const amount = formatPaymentAmount(amountPence);
  const opens = paymentWindowOpensAt(scheduledStartAt);
  const section = node("section", "booking-payment-saved-card");
  section.dataset.savedCard = "";
  section.setAttribute("aria-labelledby", "saved-card-title");
  host.after(section);

  const title = node("strong", null);
  title.id = "saved-card-title";
  const copy = node("p");
  const consentLabel = node("label", "booking-payment-consent");
  const consent = node("input");
  consent.type = "checkbox";
  consent.dataset.savedCardConsent = "";
  const consentText = node("span", null,
    `I agree that Homle may place a hold of ${amount} on this card${opens ? ` on or after ${windowFormat.format(opens)}` : ""}, five days before my clean, without me being present. I am charged only after the clean is complete, and I can remove the card before then.`);
  consentLabel.append(consent, consentText);
  const start = node("button", "button", "Save card securely");
  start.type = "button";
  start.dataset.savedCardStart = "";
  const form = node("form", "booking-payment-form");
  form.hidden = true;
  form.noValidate = true;
  const element = node("div", "booking-payment-element");
  element.setAttribute("aria-label", "Secure card details");
  const submit = node("button", "button", "Save this card");
  submit.type = "submit";
  form.append(element, submit);
  const withdraw = node("button", "text-button", "Remove saved card");
  withdraw.type = "button";
  withdraw.dataset.savedCardWithdraw = "";
  const feedback = node("p", "booking-payment-saved-card-feedback");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  section.append(title, copy, consentLabel, start, form, withdraw, feedback);

  function render() {
    const view = savedCardPresentation(current);
    title.textContent = view.title;
    copy.textContent = view.copy;
    const offering = view.offer === true || current?.status === "requires-customer-action";
    consentLabel.hidden = !offering || !form.hidden;
    start.hidden = !offering || !form.hidden;
    start.disabled = !consent.checked || busy;
    withdraw.hidden = !view.canWithdraw;
  }

  async function post(path, body) {
    const csrf = await recoverCsrf();
    if (!csrf) throw new Error("Sign in again to continue. No card was saved.");
    return requestJson(path, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body || {}) });
  }

  consent.addEventListener("change", render);

  start.addEventListener("click", async () => {
    if (busy || !consent.checked) return;
    busy = true;
    render();
    feedback.textContent = "";
    try {
      const result = await post(`/api/marketplace/bookings/${bookingId}/saved-card`, { consent: true });
      current = result.savedCard;
      if (!current?.clientSecret) { render(); return; }
      const configuration = await requestJson("/api/marketplace/payments/config");
      if (configuration.payment?.testMode !== true || !/^pk_test_[A-Za-z0-9_]{16,200}$/.test(configuration.payment?.publishableKey || "")) throw new Error("Test payment configuration is unavailable.");
      const Stripe = await loadStripe();
      stripe = Stripe(configuration.payment.publishableKey);
      elements = stripe.elements({ clientSecret: current.clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#d7182a", colorText: "#141114", borderRadius: "10px", fontFamily: "Inter, system-ui, sans-serif" } } });
      elements.create("payment", { layout: "accordion" }).mount(element);
      form.hidden = false;
      submit.focus();
    } catch (error) {
      feedback.textContent = error.message || "The secure card form could not be opened. No card was saved.";
    } finally {
      busy = false;
      render();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !stripe || !elements) return;
    busy = true;
    submit.disabled = true;
    feedback.textContent = "";
    try {
      const result = await stripe.confirmSetup({ elements, redirect: "if_required" });
      if (result.error) throw new Error(result.error.message || "The card could not be saved.");
      // The server reads the outcome from Stripe; this request only asks it to look.
      const confirmed = await post(`/api/marketplace/bookings/${bookingId}/saved-card/confirm`);
      current = confirmed.savedCard;
      if (current?.status === "saved") {
        form.hidden = true;
        try { elements.getElement?.("payment")?.destroy?.(); } catch {}
        elements = null;
        feedback.textContent = "Card saved. Nothing has been charged.";
      } else feedback.textContent = "The card is not saved yet. Check the details and try again.";
    } catch (error) {
      feedback.textContent = error.message || "The card could not be saved.";
    } finally {
      busy = false;
      submit.disabled = false;
      render();
    }
  });

  withdraw.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    withdraw.disabled = true;
    try {
      const result = await post(`/api/marketplace/bookings/${bookingId}/saved-card/withdraw`);
      current = result.savedCard;
      consent.checked = false;
      feedback.textContent = "The saved card was removed. Nothing was charged.";
    } catch (error) {
      feedback.textContent = error.message || "The saved card could not be removed. Try again.";
    } finally {
      busy = false;
      withdraw.disabled = false;
      render();
    }
  });

  render();
  return section;
}
