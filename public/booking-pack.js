const token = location.hash.slice(1);
if (token) history.replaceState(null, "", location.pathname);

const loading = document.querySelector("#pack-loading");
const errorState = document.querySelector("#pack-error");
const content = document.querySelector("#pack-content");
const changeForm = document.querySelector("#booking-change-form");
const changeType = changeForm.querySelector('select[name="type"]');
const rescheduleFields = changeForm.querySelector("[data-reschedule-fields]");
let currentRequests = [];
let currentProgress = {};
let currentAudience = "";
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

const jobEventDefinitions = {
  "cleaner-arrived": {
    title: "Record arrival and safe start",
    checks: [
      ["addressConfirmed", "I am at the confirmed service address."],
      ["safeToStart", "I have checked the immediate conditions and it is safe to start."],
      ["scopeAccessible", "The agreed scope is accessible or all differences have been reported."]
    ],
    button: "Record arrival — does not use location tracking"
  },
  "cleaner-completed": {
    title: "Record cleaner completion",
    checks: [
      ["checklistCompleted", "I completed the agreed checklist or explained every exception."],
      ["siteSecured", "I left the site secured according to the access instructions."],
      ["issuesDisclosed", "I reported every known issue, damage or incomplete item to Tideway."]
    ],
    button: "Record cleaner completion"
  },
  "customer-completed": {
    title: "Acknowledge service completion",
    checks: [
      ["serviceReceived", "The cleaning visit took place."],
      ["completionDetailsAccurate", "The completion details shown by Tideway are accurate to my knowledge."]
    ],
    button: "Acknowledge completion"
  }
};

function eventForm(type) {
  const definition = jobEventDefinitions[type];
  const form = document.createElement("form");
  form.className = "quote-decision";
  const heading = document.createElement("h3");
  heading.textContent = definition.title;
  const guidance = document.createElement("p");
  guidance.textContent = "This records a timestamped operational event. It does not collect payment.";
  form.append(heading, guidance);
  for (const [name, text] of definition.checks) {
    const label = document.createElement("label");
    label.className = "checkbox";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.required = true;
    label.append(input, document.createElement("span"));
    label.lastElementChild.textContent = text;
    form.append(label);
  }
  const noteLabel = document.createElement("label");
  noteLabel.append(document.createTextNode("Optional operational note"));
  const note = document.createElement("textarea");
  note.name = "note";
  note.rows = 3;
  note.maxLength = 1000;
  note.placeholder = "Do not include security codes, card details or identity documents";
  noteLabel.append(note);
  const error = document.createElement("div");
  error.className = "error-summary";
  error.setAttribute("role", "alert");
  error.tabIndex = -1;
  error.hidden = true;
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "button";
  submit.textContent = definition.button;
  form.append(noteLabel, error, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (!form.checkValidity()) {
      form.reportValidity();
      error.textContent = "Complete every confirmation before recording this event.";
      error.hidden = false;
      error.focus();
      return;
    }
    const data = new FormData(form);
    const body = { type, note: data.get("note") || "" };
    definition.checks.forEach(([name]) => { body[name] = data.has(name); });
    submit.disabled = true;
    try {
      const response = await fetch("/api/job-events", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Booking-Token": token }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "The job event could not be recorded.");
      if (type === "cleaner-arrived") currentProgress.cleanerArrivedAt = result.recordedAt;
      if (type === "cleaner-completed") currentProgress.cleanerCompletedAt = result.recordedAt;
      if (type === "customer-completed") currentProgress.customerCompletedAt = result.recordedAt;
      currentProgress.readyForOutcome = Boolean(currentProgress.cleanerArrivedAt && currentProgress.cleanerCompletedAt && currentProgress.customerCompletedAt);
      renderJobProgress(currentProgress, currentAudience);
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
      error.focus();
      submit.disabled = false;
    }
  });
  return form;
}

function renderJobProgress(progress = {}, audience) {
  currentProgress = { ...progress };
  currentAudience = audience;
  const list = document.querySelector("[data-job-progress]");
  const actions = document.querySelector("[data-job-actions]");
  list.replaceChildren();
  actions.replaceChildren();
  const steps = [
    ["Cleaner arrival and safe-start check", progress.cleanerArrivedAt],
    ["Cleaner completion", progress.cleanerCompletedAt],
    ["Customer completion acknowledgement", progress.customerCompletedAt]
  ];
  steps.forEach(([label, timestamp]) => {
    const item = document.createElement("li");
    item.textContent = timestamp ? `✓ ${label} · ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp))}` : `○ ${label} · awaiting`;
    list.append(item);
  });
  if (audience === "cleaner") {
    if (!progress.cleanerArrivedAt) actions.append(eventForm("cleaner-arrived"));
    else if (!progress.cleanerCompletedAt) actions.append(eventForm("cleaner-completed"));
    else actions.textContent = "Cleaner completion has been recorded. The customer can now acknowledge that the visit took place.";
  } else if (!progress.cleanerCompletedAt) {
    actions.textContent = "Customer acknowledgement opens after the cleaner records completion.";
  } else if (!progress.customerCompletedAt) {
    actions.append(eventForm("customer-completed"));
  } else {
    actions.textContent = "Completion has been acknowledged. Tideway can now review final job economics after all open change or safety requests are closed.";
  }
}

async function renderRoomPhotos(photos = []) {
  const section = document.querySelector("[data-room-scan-section]");
  const target = document.querySelector("[data-room-photos]");
  target.replaceChildren();
  if (!photos.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  await Promise.all(photos.map(async (photo) => {
    const figure = document.createElement("figure");
    let visual = null;
    const caption = document.createElement("figcaption");
    const area = document.createElement("strong");
    area.textContent = photo.area;
    const note = document.createElement("span");
    note.textContent = photo.note;
    caption.append(area, note);
    figure.append(caption);
    target.append(figure);
    try {
      const response = await fetch(`/api/booking-photo?imageId=${encodeURIComponent(photo.id)}`, { headers: { "Accept": "image/*,video/*", "X-Booking-Token": token } });
      if (!response.ok) throw new Error("Room media unavailable");
      const blob = await response.blob();
      const isVideo = photo.kind === "video" || blob.type.startsWith("video/");
      visual = document.createElement(isVideo ? "video" : "img");
      visual.src = URL.createObjectURL(blob);
      if (isVideo) { visual.controls = true; visual.preload = "metadata"; visual.setAttribute("aria-label", `${photo.area} short video reference`); }
      else { visual.alt = `${photo.area} room-scan reference`; visual.loading = "lazy"; }
      figure.prepend(visual);
    } catch {
      visual?.remove();
      const unavailable = document.createElement("span");
      unavailable.className = "room-photo-unavailable";
      unavailable.textContent = "Private room media could not be loaded.";
      figure.prepend(unavailable);
    }
  }));
}

async function renderBooking(booking) {
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
  renderJobProgress(booking.jobProgress, booking.audience);
  await renderRoomPhotos(booking.roomPhotos);

  if (booking.checklist?.length) {
    const list = document.querySelector("[data-checklist]");
    booking.checklist.forEach((task) => {
      const item = document.createElement("li");
      item.textContent = task;
      list.append(item);
    });
    document.querySelector("[data-checklist-section]").hidden = false;
  }
  if (booking.confirmedExtras?.length) {
    const extras = document.querySelector("[data-confirmed-extras]");
    const list = document.querySelector("[data-confirmed-extras-list]");
    booking.confirmedExtras.forEach((signal) => {
      const item = document.createElement("li");
      item.textContent = signal.label;
      list.append(item);
    });
    extras.hidden = false;
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
    await renderBooking(result.booking);
  } catch (error) {
    showError(error.message);
  }
}

loadBooking();
