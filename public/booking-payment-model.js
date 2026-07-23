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
  return `tideway_payment_retry_${bookingId.toLowerCase()}`;
}
