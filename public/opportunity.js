const token = location.hash.slice(1);
if (token) history.replaceState(null, "", "/opportunity");

const loading = document.querySelector("#opportunity-loading");
const errorState = document.querySelector("#opportunity-error");
const content = document.querySelector("#opportunity-content");
const form = document.querySelector("#opportunity-decision");
const locked = document.querySelector("#opportunity-locked");
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

function renderOpportunity(opportunity) {
  loading.hidden = true;
  errorState.hidden = true;
  content.hidden = false;
  setText("[data-cleaner-name]", opportunity.cleanerName);
  setText("[data-reference]", opportunity.reference);
  setText("[data-service]", opportunity.service);
  setText("[data-area]", opportunity.area);
  setText("[data-site-size]", opportunity.siteSize);
  setText("[data-hazards]", opportunity.hazards);
  setText("[data-proposed-date]", date.format(new Date(`${opportunity.proposedDate}T12:00:00`)));
  setText("[data-proposed-time]", `${opportunity.proposedStartTime}–${opportunity.proposedEndTime}`);
  setText("[data-estimated-hours]", `${opportunity.estimatedHours} hours`);
  const expiryRow = document.querySelector("[data-expiry-row]");
  expiryRow.hidden = !opportunity.offerExpiresAt;
  if (opportunity.offerExpiresAt) setText("[data-offer-expires]", dateTime.format(new Date(opportunity.offerExpiresAt)));
  setText("[data-cleaner-rate]", `${money.format(opportunity.cleanerRate)} per hour`);
  setText("[data-cleaner-pay]", money.format(opportunity.cleanerPay));
  setText("[data-cleaner-model]", opportunity.cleanerModel);
  setText("[data-business-name]", opportunity.legalBusinessName);
  setText("[data-support]", [opportunity.supportEmail, opportunity.supportPhone].filter(Boolean).join(" · "));

  if (opportunity.checklist?.length) {
    const list = document.querySelector("[data-checklist]");
    opportunity.checklist.forEach((task) => {
      const item = document.createElement("li");
      item.textContent = task;
      list.append(item);
    });
    setText("[data-photo-note]", opportunity.photoCount === 1
      ? "One private photo reference is held by Tideway and is not exposed through this link."
      : opportunity.photoCount > 1
        ? `${opportunity.photoCount} private photo references are held by Tideway and are not exposed through this link.`
        : "No private photo references are attached.");
    document.querySelector("[data-checklist-section]").hidden = false;
  }

  if (opportunity.decision || !opportunity.decisionAllowed) {
    form.hidden = true;
    locked.hidden = false;
    if (opportunity.decision?.status === "accepted") {
      locked.innerHTML = "<strong>Opportunity accepted.</strong><span>Tideway recorded your decision. This is not yet a confirmed assignment.</span>";
    } else if (opportunity.decision?.status === "declined") {
      locked.innerHTML = "<strong>Opportunity declined.</strong><span>Tideway recorded your decision and no assignment was made.</span>";
    } else if (opportunity.expired) {
      locked.innerHTML = "<strong>This opportunity has expired.</strong><span>Tideway must recheck availability and issue a new controlled opportunity.</span>";
    } else if (opportunity.status === "ready") {
      locked.innerHTML = "<strong>Preview only.</strong><span>Tideway has not yet recorded this opportunity as sent, so no decision can be submitted.</span>";
    } else {
      locked.innerHTML = "<strong>This opportunity is closed.</strong><span>Contact Tideway if you need help.</span>";
    }
  }
}

async function loadOpportunity() {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return showError("This private link is incomplete or invalid.");
  try {
    const response = await fetch("/api/opportunity", { headers: { "Accept": "application/json", "X-Opportunity-Token": token } });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "This opportunity could not be loaded.");
    renderOpportunity(result.opportunity);
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
    summary.textContent = "Complete the name and all three confirmations before accepting.";
    summary.hidden = false;
    summary.focus();
    return;
  }
  const data = new FormData(form);
  const body = {
    decision,
    typedName: data.get("typedName") || "",
    scopeConfirmed: data.has("scopeConfirmed"),
    payConfirmed: data.has("payConfirmed"),
    availabilityConfirmed: data.has("availabilityConfirmed"),
    reason: data.get("reason") || ""
  };
  form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try {
    const response = await fetch("/api/opportunity/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Opportunity-Token": token },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Your decision could not be recorded.");
    form.hidden = true;
    locked.hidden = false;
    locked.innerHTML = result.status === "accepted"
      ? "<strong>Opportunity accepted.</strong><span>Tideway recorded your decision. This is not yet a confirmed assignment.</span>"
      : "<strong>Opportunity declined.</strong><span>Tideway recorded your decision and no assignment was made.</span>";
    locked.focus();
  } catch (error) {
    summary.textContent = error.message;
    summary.hidden = false;
    summary.focus();
    form.querySelectorAll("button").forEach((button) => { button.disabled = false; });
  }
});

loadOpportunity();
