const token = location.hash.slice(1);
if (token) history.replaceState(null, "", "/quote");

const loading = document.querySelector("#quote-loading");
const errorState = document.querySelector("#quote-error");
const content = document.querySelector("#quote-content");
const form = document.querySelector("#quote-decision");
const locked = document.querySelector("#quote-locked");
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "long" });
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short" });

function setText(selector, value) {
  document.querySelector(selector).textContent = value || "—";
}

function showError(message) {
  loading.hidden = true;
  content.hidden = true;
  errorState.hidden = false;
  setText("[data-error-message]", message);
}

function renderQuote(quote) {
  loading.hidden = true;
  errorState.hidden = true;
  content.hidden = false;
  setText("[data-customer-name]", quote.customerName);
  setText("[data-reference]", quote.reference);
  setText("[data-service]", quote.service);
  setText("[data-postcode]", quote.postcode);
  setText("[data-site-size]", quote.siteSize);
  setText("[data-proposed-date]", date.format(new Date(`${quote.proposedDate}T12:00:00`)));
  setText("[data-proposed-time]", `${quote.proposedStartTime}–${quote.proposedEndTime}`);
  setText("[data-estimated-hours]", `${quote.estimatedHours} hours`);
  const expiryRow = document.querySelector("[data-expiry-row]");
  expiryRow.hidden = !quote.offerExpiresAt;
  if (quote.offerExpiresAt) setText("[data-offer-expires]", dateTime.format(new Date(quote.offerExpiresAt)));
  setText("[data-customer-total]", money.format(quote.customerTotal));
  setText("[data-cancellation]", quote.cancellationPolicy);
  setText("[data-payment]", quote.paymentTiming);
  setText("[data-business-name]", quote.legalBusinessName);
  setText("[data-support]", [quote.supportEmail, quote.supportPhone].filter(Boolean).join(" · "));

  if (quote.checklist?.length) {
    const list = document.querySelector("[data-checklist]");
    quote.checklist.forEach((task) => {
      const item = document.createElement("li");
      item.textContent = task;
      list.append(item);
    });
    document.querySelector("[data-checklist-section]").hidden = false;
  }

  if (quote.decision || !quote.decisionAllowed) {
    form.hidden = true;
    locked.hidden = false;
    if (quote.status === "cancelled") {
      locked.innerHTML = "<strong>This proposal was withdrawn before booking.</strong><span>No booking was created and no payment was taken through Tideway.</span>";
    } else if (quote.cleanerDeclined || quote.cleanerOfferClosed) {
      locked.innerHTML = "<strong>The proposed cleaner is no longer available.</strong><span>Tideway must review a replacement before another quote can be offered.</span>";
    } else if (quote.decision?.status === "accepted") {
      locked.innerHTML = "<strong>Quote accepted.</strong><span>Tideway recorded your decision. This is not yet a confirmed booking and no payment was taken.</span>";
    } else if (quote.decision?.status === "declined") {
      locked.innerHTML = "<strong>Quote declined.</strong><span>Tideway recorded your decision and no booking was made.</span>";
    } else if (quote.pricingChanged) {
      locked.innerHTML = "<strong>This quote needs recalculation.</strong><span>Tideway must apply the current confirmed cost assumptions and issue a new proposal before you can decide.</span>";
    } else if (quote.availabilityChanged) {
      locked.innerHTML = "<strong>Cleaner availability changed.</strong><span>Tideway must recheck availability and issue a newly controlled proposal before you can decide.</span>";
    } else if (quote.expired) {
      locked.innerHTML = "<strong>This quote has expired.</strong><span>Tideway must recheck availability, scope and pricing before issuing a new proposal.</span>";
    } else if (quote.status === "ready") {
      locked.innerHTML = "<strong>Preview only.</strong><span>Tideway has not yet recorded this quote as sent, so no decision can be submitted.</span>";
    } else {
      locked.innerHTML = "<strong>This quote is closed.</strong><span>Contact Tideway if you need help.</span>";
    }
  }
}

async function loadQuote() {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return showError("This private link is incomplete or invalid.");
  try {
    const response = await fetch("/api/quote", { headers: { "Accept": "application/json", "X-Quote-Token": token } });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "This quote could not be loaded.");
    renderQuote(result.quote);
  } catch (error) {
    showError(error.message);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const decision = event.submitter?.value;
  const summary = form.querySelector(".error-summary");
  summary.hidden = true;
  if (decision === "accepted" && !form.checkValidity()) {
    form.reportValidity();
    summary.textContent = "Complete the name and both confirmations before accepting.";
    summary.hidden = false;
    summary.focus();
    return;
  }
  const data = new FormData(form);
  const body = {
    decision,
    typedName: data.get("typedName") || "",
    scopeConfirmed: data.has("scopeConfirmed"),
    termsAccepted: data.has("termsAccepted"),
    reason: data.get("reason") || ""
  };
  form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try {
    const response = await fetch("/api/quote/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Quote-Token": token },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Your decision could not be recorded.");
    form.hidden = true;
    locked.hidden = false;
    locked.innerHTML = result.status === "accepted"
      ? "<strong>Quote accepted.</strong><span>Tideway recorded your decision. This is not yet a confirmed booking and no payment was taken.</span>"
      : "<strong>Quote declined.</strong><span>Tideway recorded your decision and no booking was made.</span>";
    locked.focus();
  } catch (error) {
    summary.textContent = error.message;
    summary.hidden = false;
    summary.focus();
    form.querySelectorAll("button").forEach((button) => { button.disabled = false; });
  }
});

loadQuote();
