const bookingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function bookingIdFromSearch(search) {
  const value = new URLSearchParams(String(search || "")).get("bookingId") || "";
  return bookingIdPattern.test(value) ? value.toLowerCase() : "";
}

export function formatPaymentAmount(amountPence) {
  if (!Number.isInteger(amountPence) || amountPence < 1 || amountPence > 10_000_000) return "Amount unavailable";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amountPence / 100);
}

export function paymentPresentation(payment) {
  if (!payment) return { action: "blocked", title: "Exact booking total unavailable", copy: "Homle will not open payment details until the server confirms the frozen booking total." };
  const presentations = {
    "not-started": { action: "prepare", title: "Your agreed total is ready", copy: "Check the exact total above, then enter payment details securely when you are ready." },
    creating: { action: "continue", title: "Preparing secure payment", copy: "Continue to the protected payment form." },
    "requires-customer-action": { action: "continue", title: "Payment details needed", copy: "Complete the protected test payment form to authorize the booking total." },
    "authorization-failed": { action: "retry", title: "Payment was not authorized", copy: "Review the message and try the protected payment form again." },
    processing: { action: "waiting", title: "Authorization is being verified", copy: "Homle is waiting for the signed payment update. Do not submit another payment." },
    authorized: { action: "complete", title: "Payment authorized", copy: "The booking total is authorized but has not been captured. The confirmed booking is ready for the agreed journey time." },
    captured: { action: "complete", title: "Payment captured", copy: "The completed booking payment has been captured." },
    "partially-refunded": { action: "complete", title: "Payment partially refunded", copy: "A verified partial refund is recorded for this booking." },
    refunded: { action: "complete", title: "Payment refunded", copy: "The captured payment has been refunded." },
    cancelled: { action: "blocked", title: "Authorization cancelled", copy: "This authorization is closed. Contact Homle before taking another payment step." },
    disputed: { action: "blocked", title: "Payment disputed", copy: "This payment is under review. Do not submit another payment." }
  };
  return presentations[payment.status] || { action: "blocked", title: "Payment status needs review", copy: "Do not submit another payment until Homle reviews this booking." };
}

export function paymentRetryStorageKey(bookingId) {
  if (!bookingIdPattern.test(bookingId || "")) throw new TypeError("A valid booking reference is required.");
  return `homle_landlord_payment_retry_${bookingId.toLowerCase()}`;
}

// Pay at booking (M4). A card authorization lasts about a week, so payment
// opens five days before the clean; further out than that, the customer can
// save a card now and Homle places the hold when the window opens.
export const paymentWindowDays = 5;
const dayMs = 86_400_000;

export function paymentWindowOpensAt(scheduledStartAt) {
  const start = Date.parse(scheduledStartAt);
  return Number.isFinite(start) ? new Date(start - paymentWindowDays * dayMs) : null;
}

export function savedCardOffered(payment, scheduledStartAt, now = Date.now()) {
  const opens = paymentWindowOpensAt(scheduledStartAt);
  return payment?.status === "not-started" && opens !== null && opens.getTime() > now;
}

export function savedCardPresentation(card) {
  const states = {
    saved: { title: "Card saved for this booking", copy: "Homle will place the hold on this card when payment opens. You are not charged until the clean is complete.", canWithdraw: true },
    authorizing: { title: "Placing the hold now", copy: "Homle is placing the hold on your saved card. Nothing else is needed from you.", canWithdraw: false },
    authorized: { title: "Hold placed on your saved card", copy: "The booking total is authorized but not charged. It is captured only after the clean.", canWithdraw: false },
    "action-required": { title: "Your bank needs you to confirm", copy: "Your bank asked to confirm the hold in person. Use the payment step on this page to finish it.", canWithdraw: false }
  };
  return states[card?.status] || { title: "Save your card now", copy: "Nothing is charged today. Agree to the hold below, then enter your card in Stripe's secure form.", canWithdraw: false, offer: true };
}
