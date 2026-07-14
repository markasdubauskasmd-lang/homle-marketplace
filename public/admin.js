const state = { records: [], kind: "all", status: "all", config: {} };

const leadList = document.querySelector("#lead-list");
const errorBox = document.querySelector("#admin-error");
const refreshButton = document.querySelector("#refresh-records");
const adminAuth = document.querySelector("#admin-auth");
const adminContent = document.querySelector("#admin-content");
const adminKeyField = document.querySelector("#admin-key");
let adminKey = sessionStorage.getItem("tidewayAdminKey") || "";
const statusLabels = {
  new: "New", contacted: "Contacted", quoted: "Quoted", booked: "Booked", completed: "Completed", lost: "Lost",
  screening: "Screening", approved: "Approved", paused: "Paused", rejected: "Rejected"
};
const statusesByKind = {
  request: ["new", "contacted", "quoted", "booked", "completed", "lost"],
  cleaner: ["new", "contacted", "screening", "approved", "paused", "rejected"]
};
const allowedLeadStatuses = {
  request: {
    new: ["new", "contacted", "lost"],
    contacted: ["contacted", "quoted", "lost"],
    quoted: ["quoted", "lost"],
    booked: ["booked", "lost"],
    completed: ["completed"],
    lost: ["lost"]
  },
  cleaner: {
    new: ["new", "contacted", "screening", "rejected"],
    contacted: ["contacted", "screening", "rejected"],
    screening: ["screening", "approved", "rejected"],
    approved: ["approved", "paused"],
    paused: ["paused", "approved", "rejected"],
    rejected: ["rejected"]
  }
};

function adminHeaders(extra = {}) {
  return { ...extra, ...(adminKey ? { "X-Admin-Key": adminKey } : {}) };
}

function showAuth() {
  adminContent.hidden = true;
  adminAuth.hidden = false;
  document.querySelector("#admin-auth-error").hidden = !adminKey;
  adminKeyField.focus();
}

function showContent() {
  adminAuth.hidden = true;
  adminContent.hidden = false;
  document.querySelector("#admin-auth-error").hidden = true;
}

function populateConfig(config = {}) {
  state.config = config;
  const form = document.querySelector("#business-config-form");
  Object.entries(config).forEach(([name, value]) => {
    const field = form.elements.namedItem(name);
    if (field?.type === "checkbox") field.checked = value === true;
    else if (field && value !== undefined && value !== null) field.value = value;
  });
}

function proposalField(labelText, name, type = "number", value = "") {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText));
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.required = true;
  if (type === "number") { input.min = "0"; input.step = name === "estimatedHours" ? "0.5" : "0.01"; }
  if (type === "date") {
    const now = new Date();
    input.min = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10);
  }
  input.value = value || "";
  label.append(input);
  return label;
}

function showProposalForm(record, match, target) {
  target.replaceChildren();
  const form = document.createElement("form");
  form.className = "proposal-form";
  const reviewedScanHours = record.briefs?.[0]?.status === "reviewed" && Number.isFinite(record.briefs[0].scopeEstimateHours) ? record.briefs[0].scopeEstimateHours : 0;
  const preferredAvailability = match.availabilitySlots?.find((slot) => slot.availableDate === record.preferredDate) || match.availabilitySlots?.[0] || null;
  form.append(
    proposalField("Proposed date", "proposedDate", "date", preferredAvailability?.availableDate || record.preferredDate),
    proposalField("Exact start time", "proposedStartTime", "time", preferredAvailability?.startTime || (record.preferredTimeWindow?.startsWith("Afternoon") ? "13:00" : record.preferredTimeWindow?.startsWith("Evening") ? "17:00" : "09:00")),
    proposalField("Estimated hours", "estimatedHours", "number", Math.max(Number(state.config.minimumHours) || 0, reviewedScanHours)),
    proposalField("Customer rate per hour (£)", "customerRate", "number", state.config.customerHourlyRate),
    proposalField("Cleaner pay per hour (£)", "cleanerRate", "number", state.config.cleanerHourlyPay),
    proposalField("Additional job costs (£)", "otherCosts", "number", "0")
  );
  const noteLabel = document.createElement("label");
  noteLabel.append(document.createTextNode("Internal proposal note"));
  const note = document.createElement("textarea");
  note.name = "note";
  note.rows = 2;
  noteLabel.append(note);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "button button-small";
  submit.textContent = `Save draft with ${match.fullName}`;
  form.append(noteLabel, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      body.requestId = record.id;
      body.cleanerId = match.id;
      const response = await fetch("/api/admin/proposals", { method: "POST", headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }), body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "Proposal could not be saved.");
      target.replaceChildren();
      const success = document.createElement("div");
      success.className = "success-panel";
      addText(success, "strong", "Draft proposal saved.");
      addText(success, "span", `${money.format(result.proposal.customerTotal)} customer total · ${money.format(result.proposal.cleanerPay)} cleaner pay · ${money.format(result.proposal.contribution)} contribution (${result.proposal.marginPercent.toFixed(1)}%).`);
      target.append(success);
    } catch (error) {
      showAdminError(error.message);
    } finally {
      submit.disabled = false;
    }
  });
  target.append(form);
}

function renderReadiness(readiness) {
  document.querySelector("#readiness-score").textContent = `${readiness.completed}/${readiness.total}`;
  document.querySelectorAll("#readiness-list [data-check]").forEach((item) => {
    const complete = Boolean(readiness.checks[item.dataset.check]);
    item.classList.toggle("ready", complete);
    item.querySelector("span").textContent = complete ? "✓" : "○";
  });
}

async function loadConfig() {
  try {
    const response = await fetch("/api/admin/config", { headers: adminHeaders({ "Accept": "application/json" }) });
    const result = await response.json();
    if (response.status === 401) { showAuth(); return; }
    if (!response.ok || !result.ok) throw new Error(result.error || "Launch settings could not be loaded.");
    populateConfig(result.config);
    syncQuoteDefaults(result.config);
    renderReadiness(result.readiness);
    updateQuoteCalculator();
  } catch (error) {
    showAdminError(error.message);
  }
}

function showAdminError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.focus();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function addText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text || "—";
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function addDetail(grid, label, value) {
  if (!value) return;
  const item = document.createElement("div");
  addText(item, "span", label);
  addText(item, "strong", value);
  grid.append(item);
}

function updateStats() {
  const requests = state.records.filter((record) => record.kind === "request");
  const cleaners = state.records.filter((record) => record.kind === "cleaner");
  document.querySelector("#request-count").textContent = requests.length;
  document.querySelector("#cleaner-count").textContent = cleaners.length;
  document.querySelector("#booked-count").textContent = requests.filter((record) => record.status === "booked" || record.status === "completed").length;
  const today = new Date().toISOString().slice(0, 10);
  const closedStatuses = new Set(["completed", "lost", "rejected"]);
  document.querySelector("#attention-count").textContent = state.records.filter((record) => !closedStatuses.has(record.status) && (record.status === "new" || (record.nextActionAt && record.nextActionAt <= today))).length;
  document.querySelector("#new-request-count").textContent = `${requests.filter((record) => record.status === "new").length} new to review`;
  document.querySelector("#new-cleaner-count").textContent = `${cleaners.filter((record) => record.status === "new").length} new to review`;
}

async function addActivity(record, form) {
  const note = form.querySelector("textarea").value.trim();
  const nextActionAt = form.querySelector('input[type="date"]').value;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/activity", {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }),
      body: JSON.stringify({ id: record.id, kind: record.kind, note, nextActionAt })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Follow-up could not be saved.");
    await loadRecords();
  } catch (error) {
    showAdminError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function findMatches(record, results, button) {
  button.disabled = true;
  results.replaceChildren();
  addText(results, "span", "Checking approved cleaners…", "match-loading");
  try {
    const response = await fetch(`/api/admin/matches?requestId=${encodeURIComponent(record.id)}`, { headers: adminHeaders({ "Accept": "application/json" }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Matches could not be loaded.");
    results.replaceChildren();
    if (!result.matches.length) {
      if (result.pilotCoverage && !result.pilotCoverage.covered) {
        addText(results, "strong", "Request is outside the configured pilot area.");
        addText(results, "span", `${result.pilotCoverage.outwardCode || "This postcode"} is not included in ${result.pilotCoverage.allowedCodes.join(", ") || "the pilot postcode list"}. Do not promise coverage.`);
      } else {
        addText(results, "strong", "No approved service matches yet.");
        addText(results, "span", "Approve suitable cleaner applications first, then check coverage manually.");
      }
      return;
    }
    for (const match of result.matches) {
      const item = document.createElement("article");
      item.className = "match-result";
      const heading = document.createElement("div");
      addText(heading, "strong", match.fullName);
      addText(heading, "span", `${match.score}/100 · ${match.coverage}`);
      item.append(heading);
      addText(item, "span", `${match.travelAreas} · ${match.availability}`);
      addText(item, "span", `Confirmed windows: ${match.availabilitySlots.map((slot) => `${slot.availableDate} ${slot.startTime}-${slot.endTime}`).join(", ")}`);
      addText(item, "span", match.services.join(", "));
      addText(item, "span", `${match.email} · ${match.phone}`);
      const proposalTarget = document.createElement("div");
      proposalTarget.className = "proposal-target";
      const prepareButton = document.createElement("button");
      prepareButton.type = "button";
      prepareButton.className = "button button-small button-outline";
      prepareButton.textContent = "Prepare draft proposal";
      prepareButton.addEventListener("click", () => showProposalForm(record, match, proposalTarget));
      item.append(prepareButton, proposalTarget);
      results.append(item);
    }
  } catch (error) {
    results.replaceChildren();
    addText(results, "strong", error.message);
  } finally {
    button.disabled = false;
  }
}

async function changeProposalStatus(proposal, select, noteField) {
  const previous = proposal.status;
  select.disabled = true;
  try {
    const response = await fetch("/api/admin/proposals/status", { method: "PATCH", headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }), body: JSON.stringify({ proposalId: proposal.id, status: select.value, note: noteField?.value || "" }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Proposal status could not be saved.");
    proposal.status = result.status;
    proposal.statusNote = result.note || "";
    await loadRecords();
  } catch (error) {
    select.value = previous;
    showAdminError(error.message);
  } finally {
    select.disabled = false;
  }
}

async function copyDraft(text, button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied — nothing was sent";
  } catch {
    button.textContent = "Copy unavailable — select the text";
  }
  window.setTimeout(() => { button.textContent = original; }, 2400);
}

function draftSection(title, draft) {
  const section = document.createElement("section");
  section.className = "draft-section";
  addText(section, "h4", title);
  addText(section, "span", `Subject: ${draft.subject}`, "draft-subject");
  const textarea = document.createElement("textarea");
  textarea.readOnly = true;
  textarea.rows = 14;
  textarea.value = draft.body;
  textarea.setAttribute("aria-label", `${title} body`);
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "button button-small button-outline";
  copyButton.textContent = `Copy ${title.toLowerCase()} — does not send`;
  copyButton.addEventListener("click", () => copyDraft(`${draft.subject}\n\n${draft.body}`, copyButton));
  section.append(textarea, copyButton);
  return section;
}

async function loadProposalDrafts(proposal, target, button) {
  button.disabled = true;
  target.replaceChildren();
  addText(target, "span", "Preparing review-only drafts…");
  try {
    const response = await fetch(`/api/admin/proposal-drafts?proposalId=${encodeURIComponent(proposal.id)}`, { headers: adminHeaders({ "Accept": "application/json" }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Drafts could not be prepared.");
    target.replaceChildren();
    const safety = document.createElement("div");
    safety.className = result.sendAllowed ? "draft-safety draft-ready" : "draft-safety draft-blocked";
    addText(safety, "strong", result.sendAllowed ? "Internally ready for your review" : "Review only — not ready to use");
    addText(safety, "span", "Tideway does not send these messages automatically.");
    if (result.warnings.length) {
      const list = document.createElement("ul");
      result.warnings.forEach((warning) => addText(list, "li", warning));
      safety.append(list);
    }
    target.append(safety, draftSection("Customer quote draft", result.customer), draftSection("Cleaner opportunity draft", result.cleaner));
  } catch (error) {
    target.replaceChildren();
    addText(target, "strong", error.message);
  } finally {
    button.disabled = false;
  }
}

function bookingConfirmation(labelText, name) {
  const label = document.createElement("label");
  label.className = "confirmation-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.required = true;
  label.append(input, document.createTextNode(labelText));
  return label;
}

function bookingDetailField(labelText, name, options = {}) {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText));
  const input = options.multiline ? document.createElement("textarea") : document.createElement("input");
  input.name = name;
  input.required = options.required !== false;
  input.maxLength = options.maxLength || (options.multiline ? 1000 : 500);
  if (options.type) input.type = options.type;
  if (options.autocomplete) input.autocomplete = options.autocomplete;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.value) input.value = options.value;
  if (options.multiline) input.rows = 2;
  label.append(input);
  return label;
}

function appendBookingForm(record, proposal, target) {
  if (record.booking) {
    addText(target, "strong", `Booking ${record.booking.id} is already recorded.`, "manual-heading");
    return;
  }
  if (record.status !== "quoted") {
    addText(target, "strong", "Move this request through Contacted to Quoted before recording the booking.", "manual-heading");
    return;
  }
  const form = document.createElement("form");
  form.className = "booking-confirmation-form";
  addText(form, "strong", "Record the four remaining manual confirmations");
  addText(form, "span", "Capture the final visit pack after both sides accept. This does not send a booking or take payment. Never enter alarm codes, key-safe codes or card details here.");
  form.append(
    bookingDetailField("Full service address", "serviceAddress", { autocomplete: "street-address", placeholder: "Building, street and locality" }),
    bookingDetailField("Service postcode", "servicePostcode", { autocomplete: "postal-code", value: record.postcode }),
    bookingDetailField("Named access contact", "accessContactName", { autocomplete: "name" }),
    bookingDetailField("Access contact phone", "accessContactPhone", { type: "tel", autocomplete: "tel" }),
    bookingDetailField("Access instructions", "accessInstructions", { multiline: true, placeholder: "Where to meet or who will provide access — no door or alarm codes" }),
    bookingDetailField("Parking or arrival notes", "parkingNotes", { multiline: true, required: false, maxLength: 500 }),
    bookingDetailField("Products and equipment", "productsAndEquipment", { multiline: true, placeholder: "Who supplies products, vacuum, mop and any site-specific equipment" }),
    bookingDetailField("Emergency and issue instructions", "emergencyInstructions", { multiline: true, placeholder: "Who to call and when work must stop" }),
    bookingConfirmation("Exact address and named access contact confirmed securely", "addressAndAccessConfirmed"),
    bookingConfirmation("Final checklist, exclusions, products and equipment confirmed", "finalChecklistConfirmed"),
    bookingConfirmation("Payment authorisation confirmed externally; no card details stored here", "paymentAuthorisationConfirmed"),
    bookingConfirmation("Emergency and issue-reporting instructions shared", "emergencyInstructionsConfirmed")
  );
  const note = document.createElement("textarea");
  note.name = "internalNote";
  note.maxLength = 1000;
  note.rows = 2;
  note.placeholder = "Optional internal confirmation note — never enter card details";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "button button-small button-light";
  submit.textContent = "Record confirmed booking";
  form.append(note, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    const data = new FormData(form);
    const body = { proposalId: proposal.id, internalNote: data.get("internalNote") || "" };
    ["serviceAddress", "servicePostcode", "accessContactName", "accessContactPhone", "accessInstructions", "parkingNotes", "productsAndEquipment", "emergencyInstructions"].forEach((name) => { body[name] = data.get(name) || ""; });
    ["addressAndAccessConfirmed", "finalChecklistConfirmed", "paymentAuthorisationConfirmed", "emergencyInstructionsConfirmed"].forEach((name) => { body[name] = data.has(name); });
    try {
      const response = await fetch("/api/admin/bookings", { method: "POST", headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }), body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Booking could not be recorded.");
      await loadRecords();
    } catch (error) {
      showAdminError(error.message);
      submit.disabled = false;
    }
  });
  target.append(form);
}

async function loadBookingAudit(record, proposal, target, button) {
  button.disabled = true;
  target.replaceChildren();
  addText(target, "span", "Checking booking safeguards…");
  try {
    const response = await fetch(`/api/admin/booking-audit?proposalId=${encodeURIComponent(proposal.id)}`, { headers: adminHeaders({ "Accept": "application/json" }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Booking audit could not be prepared.");
    target.replaceChildren();
    const heading = document.createElement("div");
    heading.className = result.automatedReady ? "booking-audit-heading audit-pass" : "booking-audit-heading audit-blocked";
    addText(heading, "strong", result.automatedReady ? "Automated booking checks passed" : "Booking remains blocked");
    addText(heading, "span", "This audit never confirms or sends a booking automatically.");
    const checkLabels = { launchReady: "Seven launch checks complete", customerAccepted: "Customer accepted through the private quote", cleanerAccepted: "Cleaner accepted through the private opportunity", customerAcceptedBeforeExpiry: "Customer accepted before the frozen deadline", cleanerAcceptedBeforeExpiry: "Cleaner accepted before the frozen deadline", cleanerApproved: "Cleaner approved", cleanerScreened: "Cleaner screening checklist complete", pilotAreaCovered: "Customer postcode inside configured pilot area", serviceApproved: "Cleaner approved for service", availabilityCovered: "Visit fits an active confirmed availability window", costModelCurrent: "Proposal uses the current founder-confirmed cost assumptions", profitable: "Positive job contribution", marginFloorMet: "Founder margin floor met", minimumHoursMet: "Founder minimum hours met", briefReviewed: "Required room scan reviewed", scanHoursCovered: "Proposal covers reviewed scan hours", scopeCaptured: "Site scope recorded", accessCaptured: "Access arrangements recorded", hazardsCaptured: "Hazards recorded", scheduleConflictFree: "Cleaner has no overlapping accepted job" };
    const checks = document.createElement("ul");
    checks.className = "booking-checks";
    Object.entries(result.checks).forEach(([key, passed]) => addText(checks, "li", `${passed ? "✓" : "○"} ${checkLabels[key]}`));
    const manualHeading = document.createElement("strong");
    manualHeading.textContent = "Manual confirmations still required";
    manualHeading.className = "manual-heading";
    const manual = document.createElement("ol");
    result.manualChecklist.forEach((item) => addText(manual, "li", item));
    target.append(heading, checks, manualHeading, manual);
    if (result.automatedReady) appendBookingForm(record, proposal, target);
  } catch (error) {
    target.replaceChildren();
    addText(target, "strong", error.message);
  } finally {
    button.disabled = false;
  }
}

function numberField(labelText, name, value = "0") {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText));
  const input = document.createElement("input");
  input.type = "number";
  input.name = name;
  input.min = "0";
  input.step = name === "actualHours" ? "0.25" : "0.01";
  input.required = true;
  input.value = value;
  label.append(input);
  return label;
}

function buildBookingPackPanel(record) {
  const booking = record.booking;
  const panel = document.createElement("details");
  panel.className = "booking-audit";
  const summary = document.createElement("summary");
  summary.textContent = "Private confirmed-booking packs";
  panel.append(summary);
  addText(panel, "strong", `${booking.id} · ${booking.proposedDate} · ${booking.proposedStartTime}–${booking.proposedEndTime}`);
  addText(panel, "span", `${booking.details?.serviceAddress || "Address unavailable"}, ${booking.details?.servicePostcode || ""}`);
  addText(panel, "span", "These links contain visit details. Share each link only with its named recipient and never paste it into public notes.");
  const progress = document.createElement("ol");
  const progressSteps = [
    ["Cleaner arrival", booking.jobProgress?.cleanerArrivedAt],
    ["Cleaner completion", booking.jobProgress?.cleanerCompletedAt],
    ["Customer completion acknowledgement", booking.jobProgress?.customerCompletedAt]
  ];
  progressSteps.forEach(([label, timestamp]) => addText(progress, "li", timestamp ? `✓ ${label} · ${formatDate(timestamp)}` : `○ ${label} · awaiting`));
  panel.append(progress);
  for (const view of [
    { label: "Customer booking confirmation", path: "booking-confirmation", token: booking.customerViewToken },
    { label: "Cleaner assignment pack", path: "assignment", token: booking.cleanerViewToken }
  ]) {
    if (!view.token) continue;
    const section = document.createElement("div");
    section.className = "quote-review-link";
    addText(section, "strong", view.label);
    const url = `${location.origin}/${view.path}#${view.token}`;
    const field = document.createElement("input");
    field.type = "text";
    field.readOnly = true;
    field.value = url;
    field.setAttribute("aria-label", `${view.label} for ${booking.id}`);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "button button-small button-outline";
    copy.textContent = "Copy private link — does not send";
    copy.addEventListener("click", () => copyDraft(url, copy));
    section.append(field, copy);
    panel.append(section);
  }
  if (booking.changeRequests?.length) {
    const heading = document.createElement("h4");
    heading.textContent = `Booking change and issue queue · ${booking.changeRequests.length}`;
    panel.append(heading);
    for (const change of booking.changeRequests) {
      const item = document.createElement("section");
      item.className = `quote-review-link${change.type === "safety-issue" ? " draft-blocked" : ""}`;
      addText(item, "strong", `${change.type.replaceAll("-", " ")} · ${change.audience} · ${change.status}`);
      addText(item, "span", change.type === "reschedule" ? `${change.proposedDate} at ${change.proposedStartTime} · ${change.message}` : change.message);
      if (change.resolutionNote) addText(item, "span", `Tideway response: ${change.resolutionNote}`);
      const allowed = change.status === "open" ? ["reviewing", "closed"] : change.status === "reviewing" ? ["open", "closed"] : [];
      if (allowed.length) {
        const form = document.createElement("form");
        form.className = "brief-review-form";
        const select = document.createElement("select");
        select.name = "status";
        allowed.forEach((status) => {
          const option = document.createElement("option");
          option.value = status;
          option.textContent = status === "reviewing" ? "Mark under review" : status === "open" ? "Return to open" : "Close with response";
          select.append(option);
        });
        const note = document.createElement("textarea");
        note.name = "note";
        note.rows = 2;
        note.maxLength = 1000;
        note.placeholder = "Required when closing: explain what was agreed or the next safe route";
        const button = document.createElement("button");
        button.type = "submit";
        button.className = "button button-small";
        button.textContent = "Save queue status";
        form.append(select, note, button);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          button.disabled = true;
          try {
            const response = await fetch("/api/admin/booking-change-requests/status", { method: "PATCH", headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }), body: JSON.stringify({ changeRequestId: change.id, status: select.value, note: note.value.trim() }) });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || "Queue status could not be saved.");
            await loadRecords();
          } catch (error) {
            showAdminError(error.message);
            button.disabled = false;
          }
        });
        item.append(form);
      }
      panel.append(item);
    }
  }
  return panel;
}

function buildJobOutcome(record) {
  const panel = document.createElement("div");
  panel.className = "job-outcome";
  if (record.outcome) {
    const performance = !record.outcome.profitable ? "Loss-making" : record.outcome.metTargetMargin ? "Margin target met" : "Positive, below margin target";
    panel.classList.add(!record.outcome.profitable ? "job-loss" : record.outcome.metTargetMargin ? "job-profitable" : "job-below-target");
    addText(panel, "strong", `${performance} · ${record.outcome.id}`);
    addText(panel, "span", `${record.outcome.actualHours} actual hours · ${money.format(record.outcome.customerCollected)} collected · ${money.format(record.outcome.cleanerPaid)} cleaner pay`);
    addText(panel, "span", `${money.format(record.outcome.refundAmount)} refunds · ${money.format(record.outcome.totalDirectCosts ?? record.outcome.otherCosts ?? 0)} total direct costs · ${money.format(record.outcome.contribution)} contribution (${record.outcome.marginPercent.toFixed(1)}%)`);
    addText(panel, "span", `${money.format(record.outcome.paymentFees || 0)} payment fees · ${money.format(record.outcome.travelCosts || 0)} travel · ${money.format(record.outcome.suppliesCosts || 0)} supplies · ${money.format(record.outcome.otherCosts || 0)} other actual costs`);
    if (record.outcome.targetMarginPercent > 0) addText(panel, "span", `Founder margin floor at completion: ${record.outcome.targetMarginPercent.toFixed(1)}%`);
    return panel;
  }
  addText(panel, "strong", `Confirmed booking ${record.booking.id}`);
  addText(panel, "span", "Record actual figures only after the job and external money movements are complete. This form never charges or pays anyone.");
  if (!record.booking.jobProgress?.readyForOutcome) {
    addText(panel, "span", "Blocked: cleaner arrival, cleaner completion and customer completion acknowledgement must all be recorded through the private booking packs.");
    return panel;
  }
  if (record.booking.changeRequests?.some((change) => ["open", "reviewing"].includes(change.status))) {
    addText(panel, "span", "Blocked: resolve every open booking change or safety request before final job economics.");
    return panel;
  }
  const form = document.createElement("form");
  form.className = "job-outcome-form";
  form.append(
    numberField("Actual hours", "actualHours", String(record.proposals?.[0]?.estimatedHours || "")),
    numberField("Customer collected (£)", "customerCollected", String(record.booking.plannedCustomerTotal || "")),
    numberField("Cleaner paid (£)", "cleanerPaid", String(record.booking.plannedCleanerPay || "")),
    numberField("Payment fees (£)", "paymentFees", String(record.booking.plannedPaymentFees || "")),
    numberField("Travel costs (£)", "travelCosts", String(record.booking.plannedTravelCosts || "")),
    numberField("Supplies costs (£)", "suppliesCosts", String(record.booking.plannedSuppliesCosts || "")),
    numberField("Other actual costs (£)", "otherCosts", String(record.booking.plannedAdditionalCosts || "")),
    numberField("Refunds (£)", "refundAmount")
  );
  const note = document.createElement("textarea");
  note.name = "internalNote";
  note.rows = 2;
  note.maxLength = 1000;
  note.placeholder = "Optional internal completion note";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "button button-small";
  submit.textContent = "Record completed job — no money moves";
  form.append(note, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    const body = Object.fromEntries(new FormData(form).entries());
    body.bookingId = record.booking.id;
    try {
      const response = await fetch("/api/admin/job-outcomes", { method: "POST", headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }), body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Completed job could not be recorded.");
      await loadRecords();
    } catch (error) {
      showAdminError(error.message);
      submit.disabled = false;
    }
  });
  panel.append(form);
  return panel;
}

async function changeStatus(record, select) {
  const previous = record.status;
  select.disabled = true;
  try {
    const response = await fetch("/api/admin/status", {
      method: "PATCH",
      headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }),
      body: JSON.stringify({ id: record.id, kind: record.kind, status: select.value })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Status could not be saved.");
    record.status = result.status;
    updateStats();
    renderRecords();
  } catch (error) {
    select.value = previous;
    showAdminError(error.message);
  } finally {
    select.disabled = false;
  }
}

async function loadBriefPhotos(brief, target, button) {
  button.disabled = true;
  target.replaceChildren();
  try {
    for (const photo of brief.photos || []) {
      const response = await fetch(`/api/admin/job-brief-image?briefId=${encodeURIComponent(brief.id)}&imageId=${encodeURIComponent(photo.id)}`, { headers: adminHeaders({ "Accept": "image/*" }) });
      if (!response.ok) throw new Error("A private brief photo could not be loaded.");
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = URL.createObjectURL(await response.blob());
      image.alt = `${photo.area} visual reference`;
      image.loading = "lazy";
      const caption = document.createElement("figcaption");
      const area = document.createElement("strong");
      area.textContent = photo.area;
      const note = document.createElement("span");
      note.textContent = photo.note || "No room note recorded";
      caption.append(area, note);
      figure.append(image, caption);
      target.append(figure);
    }
    button.remove();
  } catch (error) {
    addText(target, "strong", error.message);
    button.disabled = false;
  }
}

async function changeBriefStatus(brief, form) {
  const select = form.elements.status;
  const note = form.elements.note;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/job-briefs/status", {
      method: "PATCH",
      headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }),
      body: JSON.stringify({ briefId: brief.id, status: select.value, note: note.value.trim(), scopeEstimateHours: form.elements.scopeEstimateHours.value, scopeConfidence: form.elements.scopeConfidence.value })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Job brief review could not be saved.");
    await loadRecords();
  } catch (error) {
    showAdminError(error.message);
    button.disabled = false;
  }
}

const cleanerScreeningLabels = {
  identityChecked: "Identity checked through the approved secure process",
  rightToWorkChecked: "Right-to-work evidence reviewed where applicable",
  referencesChecked: "References completed and outcome recorded",
  serviceSkillsChecked: "Cleaning skills assessed for the selected services",
  availabilityCoverageChecked: "Availability, travel area and transport confirmed",
  engagementTermsChecked: "Engagement model, responsibilities, pay and insurance position checked",
  safeguardingDecisionChecked: "Safeguarding and DBS requirement decision recorded"
};

async function saveCleanerScreening(record, form) {
  const button = form.querySelector("button");
  button.disabled = true;
  const body = { cleanerId: record.id, note: form.querySelector("textarea").value.trim() };
  Object.keys(cleanerScreeningLabels).forEach((key) => { body[key] = form.elements[key].checked; });
  try {
    const response = await fetch("/api/admin/cleaner-screening", {
      method: "PUT",
      headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }),
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Cleaner screening could not be saved.");
    await loadRecords();
  } catch (error) {
    showAdminError(error.message);
    button.disabled = false;
  }
}

function buildCleanerScreening(record) {
  const screening = record.screening || {};
  const panel = document.createElement("details");
  panel.className = `cleaner-screening${screening.complete ? " screening-complete" : ""}`;
  panel.open = record.status === "screening" && !screening.complete;
  const summary = document.createElement("summary");
  summary.textContent = `Cleaner screening · ${screening.completed || 0}/${screening.total || 7} checks`;
  const guidance = document.createElement("p");
  guidance.textContent = "Record confirmations only. Do not paste identity documents, document numbers, bank details or special-category information here.";
  panel.append(summary, guidance);
  if (record.status === "approved" && screening.complete) {
    const completed = document.createElement("ul");
    Object.values(cleanerScreeningLabels).forEach((label) => addText(completed, "li", `✓ ${label}`));
    panel.append(completed);
    if (screening.note) addText(panel, "span", `Internal note: ${screening.note}`, "screening-note");
    return panel;
  }
  const form = document.createElement("form");
  form.className = "screening-form";
  Object.entries(cleanerScreeningLabels).forEach(([key, labelText]) => {
    const label = document.createElement("label");
    label.className = "screening-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = key;
    input.checked = screening[key] === true;
    label.append(input, document.createTextNode(labelText));
    form.append(label);
  });
  const note = document.createElement("textarea");
  note.rows = 2;
  note.maxLength = 1000;
  note.placeholder = "Optional internal screening note — no document numbers or copies";
  note.value = screening.note || "";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "button button-small";
  save.textContent = "Save screening checklist";
  form.append(note, save);
  form.addEventListener("submit", (event) => { event.preventDefault(); saveCleanerScreening(record, form); });
  panel.append(form);
  return panel;
}

async function saveCleanerAvailability(record, form) {
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    body.cleanerId = record.id;
    const response = await fetch("/api/admin/cleaner-availability", {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }),
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Cleaner availability could not be saved.");
    await loadRecords();
  } catch (error) {
    showAdminError(error.message);
    button.disabled = false;
  }
}

async function withdrawCleanerAvailability(record, slot, form) {
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/cleaner-availability", {
      method: "PATCH",
      headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }),
      body: JSON.stringify({ cleanerId: record.id, slotId: slot.id, note: form.elements.note.value.trim() })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Cleaner availability could not be withdrawn.");
    await loadRecords();
  } catch (error) {
    showAdminError(error.message);
    button.disabled = false;
  }
}

function availabilityField(labelText, name, type) {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText));
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.required = true;
  if (type === "date") {
    const now = new Date();
    input.min = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10);
  }
  label.append(input);
  return label;
}

function buildCleanerAvailability(record) {
  const slots = record.cleanerAvailability || [];
  const panel = document.createElement("details");
  panel.className = `cleaner-availability${slots.length ? " availability-confirmed" : ""}`;
  const summary = document.createElement("summary");
  summary.textContent = `Confirmed availability · ${slots.length} active window${slots.length === 1 ? "" : "s"}`;
  const guidance = document.createElement("p");
  guidance.textContent = "Record only a window the cleaner has explicitly confirmed. A proposal must fit fully inside an active window, and withdrawal immediately closes affected decisions and bookings.";
  panel.append(summary, guidance);

  if (slots.length) {
    const list = document.createElement("div");
    list.className = "availability-list";
    for (const slot of slots) {
      const item = document.createElement("section");
      item.className = "availability-item";
      addText(item, "strong", `${slot.availableDate} · ${slot.startTime}-${slot.endTime}`);
      addText(item, "span", `Confirmation note: ${slot.confirmationNote}`);
      const withdrawForm = document.createElement("form");
      withdrawForm.className = "availability-withdraw-form";
      const note = document.createElement("input");
      note.name = "note";
      note.required = true;
      note.minLength = 10;
      note.maxLength = 500;
      note.placeholder = "Why this window is no longer confirmed";
      note.setAttribute("aria-label", `Withdrawal note for ${slot.availableDate} ${slot.startTime}-${slot.endTime}`);
      const withdraw = document.createElement("button");
      withdraw.type = "submit";
      withdraw.className = "button button-small button-outline";
      withdraw.textContent = "Withdraw window";
      withdrawForm.append(note, withdraw);
      withdrawForm.addEventListener("submit", (event) => { event.preventDefault(); withdrawCleanerAvailability(record, slot, withdrawForm); });
      item.append(withdrawForm);
      list.append(item);
    }
    panel.append(list);
  }

  if (record.status === "approved" && record.screening?.complete) {
    const form = document.createElement("form");
    form.className = "availability-form";
    form.append(
      availabilityField("Available date", "availableDate", "date"),
      availabilityField("Start time", "startTime", "time"),
      availabilityField("End time", "endTime", "time")
    );
    const noteLabel = document.createElement("label");
    noteLabel.append(document.createTextNode("Confirmation note"));
    const note = document.createElement("input");
    note.name = "confirmationNote";
    note.required = true;
    note.minLength = 10;
    note.maxLength = 500;
    note.placeholder = "How and when the cleaner confirmed this window";
    noteLabel.append(note);
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "button button-small";
    save.textContent = "Add confirmed window";
    form.append(noteLabel, save);
    form.addEventListener("submit", (event) => { event.preventDefault(); saveCleanerAvailability(record, form); });
    panel.append(form);
  } else {
    addText(panel, "span", "Availability windows can be added after all screening checks pass and the cleaner is approved.", "screening-note");
  }
  return panel;
}

function buildCard(record) {
  const card = document.createElement("article");
  card.className = `lead-card lead-${record.kind}`;

  const heading = document.createElement("div");
  heading.className = "lead-card-heading";
  const title = document.createElement("div");
  addText(title, "span", record.kind === "request" ? "Customer request" : "Cleaner application", "lead-kind");
  addText(title, "h3", record.kind === "request" ? record.contactName : record.fullName);
  addText(title, "small", `${record.id} · ${formatDate(record.createdAt)}`);
  heading.append(title);

  const statusLabel = document.createElement("label");
  statusLabel.className = "card-status";
  statusLabel.append(document.createTextNode("Status"));
  const statusSelect = document.createElement("select");
  statusSelect.setAttribute("aria-label", `Status for ${record.id}`);
  for (const status of allowedLeadStatuses[record.kind]?.[record.status] || [record.status]) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = statusLabels[status];
    option.selected = status === record.status;
    statusSelect.append(option);
  }
  statusSelect.addEventListener("change", () => changeStatus(record, statusSelect));
  statusLabel.append(statusSelect);
  heading.append(statusLabel);
  card.append(heading);

  const details = document.createElement("div");
  details.className = "lead-details";
  addDetail(details, "Email", record.email);
  addDetail(details, "Phone", record.phone);
    addDetail(details, "Postcode", record.postcode);
    if (record.pilotCoverage) {
      addDetail(details, "Pilot coverage", record.pilotCoverage.covered
        ? `${record.pilotCoverage.outwardCode} is inside the configured pilot`
        : record.pilotCoverage.configured
          ? `${record.pilotCoverage.outwardCode || "Postcode"} is outside the configured pilot`
          : "Pilot postcodes not configured");
    }
  if (record.kind === "request") {
    addDetail(details, "Customer", record.customerType);
    addDetail(details, "Property", record.propertyType);
    addDetail(details, "Service", record.service);
    addDetail(details, "Site scope", record.siteSize);
    addDetail(details, "Access", record.accessNotes);
    addDetail(details, "Hazards", record.hazards);
    addDetail(details, "Frequency", record.frequency);
    addDetail(details, "Preferred date", record.preferredDate);
    addDetail(details, "Preferred arrival", record.preferredTimeWindow);
    addDetail(details, "Organisation", record.organisation);
    addDetail(details, "Details", record.details);
  } else {
    addDetail(details, "Work areas", record.travelAreas);
    addDetail(details, "Experience", record.experience);
    addDetail(details, "Availability", record.availability);
    addDetail(details, "Transport", record.transport);
    addDetail(details, "Services", Array.isArray(record.services) ? record.services.join(", ") : "");
    addDetail(details, "Notes", record.notes);
  }
  card.append(details);

  if (record.kind === "cleaner") card.append(buildCleanerScreening(record), buildCleanerAvailability(record));

  if (record.kind === "request" && record.briefs?.length) {
    const brief = record.briefs[0];
    const briefStatusLabels = {
      "landlord-draft": "Awaiting Tideway review",
      reviewed: "Reviewed and approved",
      "needs-revision": "Revision requested"
    };
    const briefSummary = document.createElement("details");
    briefSummary.className = "brief-summary";
    const summary = document.createElement("summary");
    summary.textContent = `Room scan · ${brief.checklist.length} tasks · ${brief.photos.length} photos`;
    addText(briefSummary, "strong", `${brief.id} · ${briefStatusLabels[brief.status] || brief.status}`);
    const tasks = document.createElement("ul");
    brief.checklist.forEach((task) => addText(tasks, "li", task));
    briefSummary.append(summary, tasks);
    if (brief.photos.length) {
      const loadPhotos = document.createElement("button");
      loadPhotos.type = "button";
      loadPhotos.className = "button button-small button-outline";
      loadPhotos.textContent = "Load private photo previews";
      const photoGrid = document.createElement("div");
      photoGrid.className = "admin-brief-photos";
      loadPhotos.addEventListener("click", () => loadBriefPhotos(brief, photoGrid, loadPhotos));
      briefSummary.append(loadPhotos, photoGrid);
    }
    if (brief.status === "landlord-draft") {
      const reviewForm = document.createElement("form");
      reviewForm.className = "brief-review-form";
      const statusLabel = document.createElement("label");
      statusLabel.append(document.createTextNode("Review decision"));
      const statusSelect = document.createElement("select");
      statusSelect.name = "status";
      statusSelect.setAttribute("aria-label", `Review decision for ${brief.id}`);
      for (const [value, label] of [["reviewed", "Approve checklist"], ["needs-revision", "Request a new brief"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        statusSelect.append(option);
      }
      statusLabel.append(statusSelect);
      const hoursLabel = document.createElement("label");
      hoursLabel.append(document.createTextNode("Reviewed cleaning hours"));
      const hours = document.createElement("input");
      hours.name = "scopeEstimateHours";
      hours.type = "number";
      hours.min = "0.5";
      hours.max = "24";
      hours.step = "0.25";
      hours.required = true;
      hoursLabel.append(hours);
      const confidenceLabel = document.createElement("label");
      confidenceLabel.append(document.createTextNode("Scope confidence"));
      const confidence = document.createElement("select");
      confidence.name = "scopeConfidence";
      for (const [value, label] of [["", "Choose confidence"], ["high", "High · scope is clear"], ["medium", "Medium · allow contingency"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        confidence.append(option);
      }
      confidence.required = true;
      confidenceLabel.append(confidence);
      const noteLabel = document.createElement("label");
      noteLabel.className = "brief-review-note-field";
      noteLabel.append(document.createTextNode("Internal review note"));
      const note = document.createElement("textarea");
      note.name = "note";
      note.rows = 2;
      note.maxLength = 1000;
      note.minLength = 10;
      note.required = true;
      note.placeholder = "Explain the time estimate or what the customer must correct";
      noteLabel.append(note);
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "button button-small";
      save.textContent = "Save review decision";
      const syncEstimateFields = () => {
        const approving = statusSelect.value === "reviewed";
        hours.disabled = !approving;
        hours.required = approving;
        confidence.disabled = !approving;
        confidence.required = approving;
      };
      statusSelect.addEventListener("change", syncEstimateFields);
      reviewForm.append(statusLabel, hoursLabel, confidenceLabel, noteLabel, save);
      syncEstimateFields();
      reviewForm.addEventListener("submit", (event) => { event.preventDefault(); changeBriefStatus(brief, reviewForm); });
      briefSummary.append(reviewForm);
    } else {
      if (brief.status === "reviewed") addText(briefSummary, "span", `Reviewed scope: ${brief.scopeEstimateHours} hours · ${brief.scopeConfidence} confidence`, "brief-review-note");
      if (brief.reviewNote) addText(briefSummary, "span", `Review note: ${brief.reviewNote}`, "brief-review-note");
    }
    card.append(briefSummary);
  }

  if (record.kind === "request" && record.proposals?.length) {
    const proposal = record.proposals[0];
    const proposalSummary = document.createElement("div");
    proposalSummary.className = "proposal-summary";
    const proposalDisplayLabels = { draft: "Draft proposal", ready: "Ready proposal", sent: "Sent proposal", accepted: "Customer accepted proposal", declined: "Customer declined proposal", cancelled: "Cancelled proposal" };
    addText(proposalSummary, "strong", `${proposalDisplayLabels[proposal.status] || "Proposal"} · ${proposal.cleanerName}`);
    addText(proposalSummary, "span", `${proposal.proposedDate} · ${proposal.proposedStartTime}–${proposal.proposedEndTime} · ${proposal.estimatedHours} hours · ${money.format(proposal.customerTotal)} customer total`);
    addText(proposalSummary, "span", `${money.format(proposal.cleanerPay)} cleaner pay · ${money.format(proposal.contribution)} contribution · ${proposal.marginPercent.toFixed(1)}% margin`);
    addText(proposalSummary, "span", `${money.format(proposal.nonCleanerCosts ?? proposal.otherCosts ?? 0)} planned non-cleaner costs: ${money.format(proposal.paymentFees || 0)} payment fees · ${money.format(proposal.travelCosts || 0)} travel · ${money.format(proposal.suppliesCosts || 0)} supplies · ${money.format(proposal.riskContingency || 0)} risk · ${money.format(proposal.otherCosts || 0)} additional`);
    const proposalStatusLabel = document.createElement("label");
    proposalStatusLabel.append(document.createTextNode("Internal proposal status"));
    const proposalStatus = document.createElement("select");
    proposalStatus.setAttribute("aria-label", `Proposal status for ${proposal.id}`);
    const proposalStatusOptions = {
      draft: "Draft",
      ready: "Ready to send — internally approved",
      sent: "Sent manually",
      accepted: "Accepted by customer",
      declined: "Declined by customer",
      cancelled: "Cancelled"
    };
    const allowedByCurrent = {
      draft: ["draft", "ready", "cancelled"],
      ready: ["ready", "draft", "sent", "cancelled"],
      sent: ["sent", "cancelled"],
      accepted: ["accepted", "cancelled"], declined: ["declined"], cancelled: ["cancelled"]
    };
    for (const status of allowedByCurrent[proposal.status] || [proposal.status]) {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = proposalStatusOptions[status] || status;
      option.selected = status === proposal.status;
      proposalStatus.append(option);
    }
    proposalStatusLabel.append(proposalStatus);
    const withdrawalNoteLabel = document.createElement("label");
    withdrawalNoteLabel.append(document.createTextNode("Withdrawal reason â€” required before cancelling"));
    const withdrawalNote = document.createElement("textarea");
    withdrawalNote.rows = 2;
    withdrawalNote.maxLength = 500;
    withdrawalNote.placeholder = "Record why this pre-booking proposal is being withdrawn (at least 10 characters).";
    withdrawalNote.setAttribute("aria-label", `Withdrawal reason for ${proposal.id}`);
    withdrawalNoteLabel.append(withdrawalNote);
    const hasCancellationControl = (allowedByCurrent[proposal.status] || []).includes("cancelled") && proposal.status !== "cancelled";
    withdrawalNoteLabel.hidden = !hasCancellationControl;
    proposalStatus.addEventListener("change", () => {
      withdrawalNoteLabel.hidden = proposalStatus.value !== "cancelled";
      changeProposalStatus(proposal, proposalStatus, withdrawalNote);
    });
    if (proposal.status === "cancelled" && proposal.statusNote) addText(proposalSummary, "span", `Withdrawal reason: ${proposal.statusNote}`);
    const quoteLink = document.createElement("div");
    quoteLink.className = "quote-review-link";
    if (proposal.reviewToken && ["ready", "sent", "accepted", "declined"].includes(proposal.status)) {
      addText(quoteLink, "strong", "Private customer approval link");
      addText(quoteLink, "span", proposal.status === "ready" ? "Preview only until you record the proposal as sent." : "Share only with the named customer. The link records their decision; it does not take payment.");
      const reviewUrl = `${location.origin}/quote#${proposal.reviewToken}`;
      const linkField = document.createElement("input");
      linkField.type = "text";
      linkField.readOnly = true;
      linkField.value = reviewUrl;
      linkField.setAttribute("aria-label", `Private quote link for ${proposal.id}`);
      const copyLink = document.createElement("button");
      copyLink.type = "button";
      copyLink.className = "button button-small button-outline";
      copyLink.textContent = "Copy private link — does not send";
      copyLink.addEventListener("click", () => copyDraft(reviewUrl, copyLink));
      quoteLink.append(linkField, copyLink);
    }
    const cleanerLink = document.createElement("div");
    cleanerLink.className = "quote-review-link cleaner-review-link";
    if (proposal.cleanerReviewToken && ["ready", "sent", "accepted", "declined"].includes(proposal.status)) {
      const cleanerDecision = proposal.cleanerDecision?.status;
      addText(cleanerLink, "strong", cleanerDecision === "accepted" ? "Cleaner accepted this opportunity" : cleanerDecision === "declined" ? "Cleaner declined this opportunity" : "Private cleaner opportunity link");
      addText(cleanerLink, "span", proposal.status === "ready" ? "Preview only until you record the proposal as sent." : cleanerDecision ? `Decision recorded ${formatDate(proposal.cleanerDecision.updatedAt)}. The link is now read-only.` : "Share only with the proposed cleaner. It records their own decision and does not confirm an assignment.");
      const opportunityUrl = `${location.origin}/opportunity#${proposal.cleanerReviewToken}`;
      const opportunityField = document.createElement("input");
      opportunityField.type = "text";
      opportunityField.readOnly = true;
      opportunityField.value = opportunityUrl;
      opportunityField.setAttribute("aria-label", `Private cleaner opportunity link for ${proposal.id}`);
      const copyOpportunity = document.createElement("button");
      copyOpportunity.type = "button";
      copyOpportunity.className = "button button-small button-outline";
      copyOpportunity.textContent = "Copy cleaner link — does not send";
      copyOpportunity.addEventListener("click", () => copyDraft(opportunityUrl, copyOpportunity));
      cleanerLink.append(opportunityField, copyOpportunity);
    }
    const draftDetails = document.createElement("details");
    draftDetails.className = "message-drafts";
    const draftSummary = document.createElement("summary");
    draftSummary.textContent = "Review unsent customer and cleaner drafts";
    const loadDraftButton = document.createElement("button");
    loadDraftButton.type = "button";
    loadDraftButton.className = "button button-small button-light";
    loadDraftButton.textContent = "Prepare review-only drafts";
    const draftTarget = document.createElement("div");
    draftTarget.className = "draft-target";
    loadDraftButton.addEventListener("click", () => loadProposalDrafts(proposal, draftTarget, loadDraftButton));
    draftDetails.append(draftSummary, loadDraftButton, draftTarget);
    const bookingDetails = document.createElement("details");
    bookingDetails.className = "booking-audit";
    const bookingSummary = document.createElement("summary");
    bookingSummary.textContent = "Review booking gate";
    const auditButton = document.createElement("button");
    auditButton.type = "button";
    auditButton.className = "button button-small button-light";
    auditButton.textContent = "Run booking audit";
    const auditTarget = document.createElement("div");
    auditTarget.className = "booking-audit-target";
    auditButton.addEventListener("click", () => loadBookingAudit(record, proposal, auditTarget, auditButton));
    bookingDetails.append(bookingSummary, auditButton, auditTarget);
    proposalSummary.append(proposalStatusLabel, withdrawalNoteLabel, quoteLink, cleanerLink, draftDetails, bookingDetails);
    card.append(proposalSummary);
  }

  if (record.kind === "request" && record.booking) card.append(buildBookingPackPanel(record), buildJobOutcome(record));

  if (record.nextActionAt || record.activities?.length) {
    const activitySummary = document.createElement("div");
    activitySummary.className = "activity-summary";
    if (record.nextActionAt) addText(activitySummary, "span", `Next action: ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(`${record.nextActionAt}T12:00:00`))}`, "next-action");
    const latestNote = record.activities?.find((activity) => activity.note);
    if (latestNote) addText(activitySummary, "span", `Latest note: ${latestNote.note}`);
    card.append(activitySummary);
  }

  const followup = document.createElement("details");
  followup.className = "lead-followup";
  const summary = document.createElement("summary");
  summary.textContent = "Add note or next action";
  followup.append(summary);
  const followupForm = document.createElement("form");
  const noteLabel = document.createElement("label");
  noteLabel.append(document.createTextNode("Internal note"));
  const noteInput = document.createElement("textarea");
  noteInput.rows = 2;
  noteInput.maxLength = 1000;
  noteInput.placeholder = "What happened, what was agreed, or what needs doing next";
  noteLabel.append(noteInput);
  const dateLabel = document.createElement("label");
  dateLabel.append(document.createTextNode("Next-action date"));
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateLabel.append(dateInput);
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "button button-small";
  saveButton.textContent = "Save follow-up";
  followupForm.append(noteLabel, dateLabel, saveButton);
  followupForm.addEventListener("submit", (event) => { event.preventDefault(); addActivity(record, followupForm); });
  followup.append(followupForm);
  card.append(followup);

  if (record.kind === "request") {
    const matchDetails = document.createElement("details");
    matchDetails.className = "lead-matches";
    const matchSummary = document.createElement("summary");
    matchSummary.textContent = "Find approved cleaner matches";
    const matchButton = document.createElement("button");
    matchButton.type = "button";
    matchButton.className = "button button-small button-outline";
    matchButton.textContent = "Check matches";
    const matchResults = document.createElement("div");
    matchResults.className = "match-results";
    matchButton.addEventListener("click", () => findMatches(record, matchResults, matchButton));
    matchDetails.append(matchSummary, matchButton, matchResults);
    card.append(matchDetails);
  }
  return card;
}

function renderRecords() {
  const filtered = state.records.filter((record) => (state.kind === "all" || record.kind === state.kind) && (state.status === "all" || record.status === state.status));
  leadList.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    addText(empty, "strong", state.records.length ? "No leads match this filter." : "No pilot leads yet.");
    addText(empty, "span", state.records.length ? "Try another lead type or status." : "Customer requests and cleaner applications will appear here automatically.");
    leadList.append(empty);
    return;
  }
  filtered.forEach((record) => leadList.append(buildCard(record)));
}

async function loadRecords() {
  refreshButton.disabled = true;
  errorBox.hidden = true;
  try {
    const response = await fetch("/api/admin/records", { headers: adminHeaders({ "Accept": "application/json" }) });
    const result = await response.json();
    if (response.status === 401) {
      showAuth();
      return;
    }
    if (!response.ok || !result.ok) throw new Error(result.error || "Leads could not be loaded.");
    showContent();
    state.records = result.records;
    updateStats();
    renderRecords();
  } catch (error) {
    showAdminError(error.message);
    leadList.innerHTML = '<div class="empty-state"><strong>Control desk unavailable.</strong><span>Check that the Tideway server is running locally.</span></div>';
  } finally {
    refreshButton.disabled = false;
  }
}

document.querySelectorAll("[role=tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[role=tab]").forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
    state.kind = tab.dataset.kind;
    renderRecords();
  });
});

document.querySelector("#status-filter").addEventListener("change", (event) => {
  state.status = event.target.value;
  renderRecords();
});

refreshButton.addEventListener("click", loadRecords);

document.querySelector("#admin-auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminKey = adminKeyField.value;
  sessionStorage.setItem("tidewayAdminKey", adminKey);
  await Promise.all([loadRecords(), loadConfig()]);
});

document.querySelector("#business-config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const resultPanel = document.querySelector("#config-result");
  button.disabled = true;
  resultPanel.hidden = true;
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    const response = await fetch("/api/admin/config", { method: "PUT", headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }), body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "Launch details could not be saved.");
    state.config = result.config;
    syncQuoteDefaults(result.config);
    renderReadiness(result.readiness);
    updateQuoteCalculator();
    resultPanel.hidden = false;
    resultPanel.focus();
  } catch (error) {
    showAdminError(error.message);
  } finally {
    button.disabled = false;
  }
});

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const quoteFields = ["#quote-hours", "#quote-customer-rate", "#quote-cleaner-rate", "#quote-costs"].map((selector) => document.querySelector(selector));

function syncQuoteDefaults(config = {}) {
  const defaults = [config.minimumHours, config.customerHourlyRate, config.cleanerHourlyPay, 0];
  quoteFields.forEach((field, index) => {
    if (!field.value && Number(defaults[index]) > 0) field.value = String(defaults[index]);
  });
}

function updateQuoteCalculator() {
  const [hours, customerRate, cleanerRate, additionalCosts] = quoteFields.map((field) => Math.max(0, Number(field.value) || 0));
  const customerTotal = hours * customerRate;
  const cleanerPay = hours * cleanerRate;
  const paymentFeePercent = Math.max(0, Number(state.config.paymentFeePercent) || 0);
  const paymentFeeFixed = Math.max(0, Number(state.config.paymentFeeFixed) || 0);
  const travelCosts = Math.max(0, Number(state.config.travelCostPerJob) || 0);
  const suppliesCosts = Math.max(0, Number(state.config.suppliesCostPerJob) || 0);
  const riskContingencyPercent = Math.max(0, Number(state.config.riskContingencyPercent) || 0);
  const paymentFees = customerTotal * paymentFeePercent / 100 + paymentFeeFixed;
  const riskContingency = customerTotal * riskContingencyPercent / 100;
  const includedCosts = paymentFees + travelCosts + suppliesCosts + riskContingency + additionalCosts;
  const contribution = customerTotal - cleanerPay - includedCosts;
  const margin = customerTotal ? (contribution / customerTotal) * 100 : 0;
  document.querySelector("#quote-total").textContent = money.format(customerTotal);
  document.querySelector("#quote-pay").textContent = money.format(cleanerPay);
  document.querySelector("#quote-contribution").textContent = money.format(contribution);
  document.querySelector("#quote-margin").textContent = `${margin.toFixed(1)}%`;
  document.querySelector("#quote-included-costs").textContent = state.config.variableCostsConfirmed
    ? `${money.format(includedCosts)} · ${money.format(paymentFees)} fees · ${money.format(travelCosts)} travel · ${money.format(suppliesCosts)} supplies · ${money.format(riskContingency)} risk`
    : "Confirm cost assumptions";

  const guidance = document.querySelector("#quote-guidance");
  const minimumMargin = Math.max(0, Number(state.config.minimumContributionMarginPercent) || 0);
  const minimumHours = Math.max(0, Number(state.config.minimumHours) || 0);
  const variableCostRate = (paymentFeePercent + riskContingencyPercent) / 100;
  const targetFactor = minimumMargin > 0 && minimumMargin < 100 ? 1 - variableCostRate - (minimumMargin / 100) : 0;
  const fixedCosts = cleanerPay + additionalCosts + paymentFeeFixed + travelCosts + suppliesCosts;
  const requiredRate = hours > 0 && targetFactor > 0 ? Math.ceil(((fixedCosts / targetFactor) / hours) * 100) / 100 : 0;
  const requiredTotal = requiredRate * hours;
  document.querySelector("#quote-required-total").textContent = requiredTotal ? money.format(requiredTotal) : "Set margin floor";
  document.querySelector("#quote-required-rate").textContent = requiredRate ? `${money.format(requiredRate)}/hour` : "Set margin floor";
  guidance.className = "quote-guidance";
  if (!customerTotal) {
    guidance.textContent = "Enter the expected hours and rates before promising a price.";
  } else if (minimumHours > 0 && hours < minimumHours) {
    guidance.textContent = `The ${hours}-hour estimate is below the ${minimumHours}-hour minimum. Increase the scoped hours before preparing a proposal.`;
    guidance.classList.add("quote-danger");
  } else if (!state.config.variableCostsConfirmed) {
    guidance.textContent = "Review and confirm the payment, travel, supplies and risk assumptions before approving a quote.";
    guidance.classList.add("quote-danger");
  } else if (targetFactor <= 0) {
    guidance.textContent = "The margin floor and percentage-based costs leave no viable customer price. Reduce costs or revise the target before quoting.";
    guidance.classList.add("quote-danger");
  } else if (contribution <= 0) {
    guidance.textContent = "This quote loses money before overheads. Change the price, pay or scope before sending it.";
    guidance.classList.add("quote-danger");
  } else if (!minimumMargin) {
    guidance.textContent = "Set the founder-approved minimum contribution margin in launch details before approving a quote.";
    guidance.classList.add("quote-danger");
  } else if (margin < minimumMargin) {
    guidance.textContent = `This quote is below the ${minimumMargin.toFixed(1)}% contribution-margin floor. These inputs require at least ${money.format(requiredTotal)} total (${money.format(requiredRate)}/hour).`;
    guidance.classList.add("quote-danger");
  } else {
    guidance.textContent = `This quote meets the ${minimumMargin.toFixed(1)}% contribution-margin floor after the confirmed payment, travel, supplies, risk and additional job costs. The calculated minimum is ${money.format(requiredTotal)} total (${money.format(requiredRate)}/hour), before central admin, tax and unmodelled overheads.`;
    guidance.classList.add("quote-positive");
  }
}

quoteFields.forEach((field) => field.addEventListener("input", updateQuoteCalculator));
Promise.all([loadRecords(), loadConfig()]);
