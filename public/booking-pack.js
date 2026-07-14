const token = location.hash.slice(1);
if (token) history.replaceState(null, "", location.pathname);

const loading = document.querySelector("#pack-loading");
const errorState = document.querySelector("#pack-error");
const content = document.querySelector("#pack-content");
const changeForm = document.querySelector("#booking-change-form");
const changeType = changeForm.querySelector('select[name="type"]');
const rescheduleFields = changeForm.querySelector("[data-reschedule-fields]");
let currentRequests = [];
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "long" });

function setText(selector, value) {
  document.querySelector(selector).textContent = value || "—";
}

function showError(message) {
  loading.hidden = true;
  content.hidden = true;
  errorState.hidden = false;
  setText("[data-error-message]", message);
}

const changeTypeLabels = {
  reschedule: "Reschedule request",
  "cancel-request": "Cancellation request",
  "access-change": "Access change",
  "scope-change": "Scope change",
  "safety-issue": "Safety issue",
  other: "Other issue"
};

function renderChangeHistory(requests) {
  currentRequests = requests || [];
  const section = document.querySelector("[data-change-history-section]");
  const list = document.querySelector("[data-change-history]");
  list.replaceChildren();
  if (!currentRequests.length) {
    section.hidden = true;
    return;
  }
  for (const request of currentRequests) {
    const item = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = `${changeTypeLabels[request.type] || "Request"} · ${request.status}`;
    const detail = document.createElement("span");
    detail.textContent = request.type === "reschedule" ? `${request.proposedDate} at ${request.proposedStartTime} · ${request.message}` : request.message;
    item.append(heading, document.createTextNode(" — "), detail);
    if (request.resolutionNote) {
      const resolution = document.createElement("small");
      resolution.textContent = ` Tideway response: ${request.resolutionNote}`;
      item.append(resolution);
    }
    list.append(item);
  }
  section.hidden = false;
}

function renderBooking(booking) {
  loading.hidden = true;
  errorState.hidden = true;
  content.hidden = false;
  const cleanerView = booking.audience === "cleaner";
  setText("[data-audience-label]", cleanerView ? "Confirmed cleaner assignment pack" : "Confirmed customer booking");
  setText("[data-pack-heading]", cleanerView ? "Your cleaning assignment" : "Your cleaning booking");
  setText("[data-greeting]", `Hello ${cleanerView ? booking.cleanerName : booking.customerName}. These are the visit details recorded by Tideway.`);
  setText("[data-booking-id]", booking.bookingId);
  setText("[data-service]", booking.service);
  setText("[data-proposed-date]", date.format(new Date(`${booking.proposedDate}T12:00:00`)));
  setText("[data-proposed-time]", `${booking.proposedStartTime}–${booking.proposedEndTime}`);
  setText("[data-estimated-hours]", `${booking.estimatedHours} hours`);
  setText("[data-site-size]", booking.siteSize);
  setText("[data-service-address]", booking.serviceAddress);
  setText("[data-service-postcode]", booking.servicePostcode);
  setText("[data-access-instructions]", booking.accessInstructions);
  setText("[data-parking-notes]", booking.parkingNotes || "No special parking notes recorded");
  setText("[data-products]", booking.productsAndEquipment);
  setText("[data-emergency]", booking.emergencyInstructions);
  setText("[data-business-name]", booking.legalBusinessName);
  setText("[data-support]", [booking.supportEmail, booking.supportPhone].filter(Boolean).join(" · "));
  renderChangeHistory(booking.changeRequests);

  if (booking.checklist?.length) {
    const list = document.querySelector("[data-checklist]");
    booking.checklist.forEach((task) => {
      const item = document.createElement("li");
      item.textContent = task;
      list.append(item);
    });
    document.querySelector("[data-checklist-section]").hidden = false;
  }

  if (cleanerView) {
    document.querySelector("[data-cleaner-pay-row]").hidden = false;
    document.querySelector("[data-cleaner-contact]").hidden = false;
    document.querySelector("[data-cleaner-hazards-row]").hidden = false;
    setText("[data-cleaner-pay]", `${money.format(booking.cleanerPay)} total · ${money.format(booking.cleanerRate)} per hour`);
    setText("[data-access-contact]", `${booking.accessContactName} · ${booking.accessContactPhone}`);
    setText("[data-hazards]", booking.hazards);
  } else {
    document.querySelector("[data-customer-total-row]").hidden = false;
    document.querySelector("[data-customer-rules]").hidden = false;
    setText("[data-customer-total]", money.format(booking.customerTotal));
    setText("[data-cancellation]", booking.cancellationPolicy);
    setText("[data-payment]", booking.paymentTiming);
  }
}

function syncRescheduleFields() {
  const active = changeType.value === "reschedule";
  rescheduleFields.hidden = !active;
  rescheduleFields.querySelectorAll("input").forEach((input) => { input.required = active; });
}

changeType.addEventListener("change", syncRescheduleFields);
const dateInput = changeForm.elements.proposedDate;
const now = new Date();
dateInput.min = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10);

changeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const summary = changeForm.querySelector(".error-summary");
  const success = changeForm.querySelector(".success-panel");
  const submit = changeForm.querySelector('button[type="submit"]');
  summary.hidden = true;
  success.hidden = true;
  if (!changeForm.checkValidity()) {
    changeForm.reportValidity();
    summary.textContent = "Complete the request type, explanation and any reschedule date/time.";
    summary.hidden = false;
    summary.focus();
    return;
  }
  const data = new FormData(changeForm);
  const body = Object.fromEntries(data.entries());
  submit.disabled = true;
  try {
    const response = await fetch("/api/booking-change-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Booking-Token": token },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "The request could not be recorded.");
    success.querySelector("[data-change-reference]").textContent = result.reference;
    success.hidden = false;
    success.focus();
    renderChangeHistory([{ id: result.reference, type: body.type, message: body.message, proposedDate: body.proposedDate || "", proposedStartTime: body.proposedStartTime || "", status: result.status, createdAt: new Date().toISOString() }, ...currentRequests]);
    changeForm.reset();
    syncRescheduleFields();
  } catch (error) {
    summary.textContent = error.message;
    summary.hidden = false;
    summary.focus();
  } finally {
    submit.disabled = false;
  }
});

async function loadBooking() {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return showError("This private link is incomplete or invalid.");
  try {
    const response = await fetch("/api/booking-pack", { headers: { "Accept": "application/json", "X-Booking-Token": token } });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "This booking pack could not be loaded.");
    renderBooking(result.booking);
  } catch (error) {
    showError(error.message);
  }
}

loadBooking();
