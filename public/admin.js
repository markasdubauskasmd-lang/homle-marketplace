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
    if (field && value !== undefined && value !== null) field.value = value;
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
  input.value = value || "";
  label.append(input);
  return label;
}

function showProposalForm(record, match, target) {
  target.replaceChildren();
  const form = document.createElement("form");
  form.className = "proposal-form";
  form.append(
    proposalField("Proposed date", "proposedDate", "date"),
    proposalField("Estimated hours", "estimatedHours"),
    proposalField("Customer rate per hour (£)", "customerRate", "number", state.config.customerHourlyRate),
    proposalField("Cleaner pay per hour (£)", "cleanerRate", "number", state.config.cleanerHourlyPay),
    proposalField("Other job costs (£)", "otherCosts", "number", "0")
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
    renderReadiness(result.readiness);
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
      addText(results, "strong", "No approved service matches yet.");
      addText(results, "span", "Approve suitable cleaner applications first, then check coverage manually.");
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

async function changeProposalStatus(proposal, select) {
  const previous = proposal.status;
  select.disabled = true;
  try {
    const response = await fetch("/api/admin/proposals/status", { method: "PATCH", headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }), body: JSON.stringify({ proposalId: proposal.id, status: select.value }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Proposal status could not be saved.");
    proposal.status = result.status;
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
  addText(form, "strong", "Record the five manual confirmations");
  addText(form, "span", "Internal record only. This does not send a booking or take payment.");
  form.append(
    bookingConfirmation("Exact address and named access contact confirmed securely", "addressAndAccessConfirmed"),
    bookingConfirmation("Final checklist, exclusions, products and equipment confirmed", "finalChecklistConfirmed"),
    bookingConfirmation("Payment authorisation confirmed externally; no card details stored here", "paymentAuthorisationConfirmed"),
    bookingConfirmation("Cleaner accepted the date, scope and proposed pay", "cleanerAcceptanceConfirmed"),
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
    ["addressAndAccessConfirmed", "finalChecklistConfirmed", "paymentAuthorisationConfirmed", "cleanerAcceptanceConfirmed", "emergencyInstructionsConfirmed"].forEach((name) => { body[name] = data.has(name); });
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
    const checkLabels = { launchReady: "Seven launch checks complete", proposalAccepted: "Proposal accepted by both sides", cleanerApproved: "Cleaner approved", serviceApproved: "Cleaner approved for service", profitable: "Positive job contribution", scopeCaptured: "Site scope recorded", accessCaptured: "Access arrangements recorded", hazardsCaptured: "Hazards recorded" };
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

function buildJobOutcome(record) {
  const panel = document.createElement("div");
  panel.className = "job-outcome";
  if (record.outcome) {
    panel.classList.add(record.outcome.profitable ? "job-profitable" : "job-loss");
    addText(panel, "strong", `${record.outcome.profitable ? "Profitable" : "Loss-making"} completed job · ${record.outcome.id}`);
    addText(panel, "span", `${record.outcome.actualHours} actual hours · ${money.format(record.outcome.customerCollected)} collected · ${money.format(record.outcome.cleanerPaid)} cleaner pay`);
    addText(panel, "span", `${money.format(record.outcome.refundAmount)} refunds · ${money.format(record.outcome.otherCosts)} other costs · ${money.format(record.outcome.contribution)} contribution (${record.outcome.marginPercent.toFixed(1)}%)`);
    return panel;
  }
  addText(panel, "strong", `Confirmed booking ${record.booking.id}`);
  addText(panel, "span", "Record actual figures only after the job and external money movements are complete. This form never charges or pays anyone.");
  const form = document.createElement("form");
  form.className = "job-outcome-form";
  form.append(
    numberField("Actual hours", "actualHours", String(record.proposals?.[0]?.estimatedHours || "")),
    numberField("Customer collected (£)", "customerCollected", String(record.booking.plannedCustomerTotal || "")),
    numberField("Cleaner paid (£)", "cleanerPaid", String(record.booking.plannedCleanerPay || "")),
    numberField("Other actual costs (£)", "otherCosts"),
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
  if (record.kind === "request") {
    addDetail(details, "Customer", record.customerType);
    addDetail(details, "Property", record.propertyType);
    addDetail(details, "Service", record.service);
    addDetail(details, "Site scope", record.siteSize);
    addDetail(details, "Access", record.accessNotes);
    addDetail(details, "Hazards", record.hazards);
    addDetail(details, "Frequency", record.frequency);
    addDetail(details, "Preferred date", record.preferredDate);
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

  if (record.kind === "request" && record.proposals?.length) {
    const proposal = record.proposals[0];
    const proposalSummary = document.createElement("div");
    proposalSummary.className = "proposal-summary";
    const proposalDisplayLabels = { draft: "Draft proposal", ready: "Ready proposal", sent: "Sent proposal", accepted: "Accepted proposal", declined: "Declined proposal", cancelled: "Cancelled proposal" };
    addText(proposalSummary, "strong", `${proposalDisplayLabels[proposal.status] || "Proposal"} · ${proposal.cleanerName}`);
    addText(proposalSummary, "span", `${proposal.proposedDate} · ${proposal.estimatedHours} hours · ${money.format(proposal.customerTotal)} customer total`);
    addText(proposalSummary, "span", `${money.format(proposal.cleanerPay)} cleaner pay · ${money.format(proposal.contribution)} contribution · ${proposal.marginPercent.toFixed(1)}% margin`);
    const proposalStatusLabel = document.createElement("label");
    proposalStatusLabel.append(document.createTextNode("Internal proposal status"));
    const proposalStatus = document.createElement("select");
    proposalStatus.setAttribute("aria-label", `Proposal status for ${proposal.id}`);
    const proposalStatusOptions = {
      draft: "Draft",
      ready: "Ready to send — internally approved",
      sent: "Sent manually",
      accepted: "Accepted by both sides",
      declined: "Declined",
      cancelled: "Cancelled"
    };
    const allowedByCurrent = {
      draft: ["draft", "ready", "cancelled"],
      ready: ["ready", "draft", "sent", "cancelled"],
      sent: ["sent", "accepted", "declined", "cancelled"],
      accepted: ["accepted"], declined: ["declined"], cancelled: ["cancelled"]
    };
    for (const status of allowedByCurrent[proposal.status] || [proposal.status]) {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = proposalStatusOptions[status] || status;
      option.selected = status === proposal.status;
      proposalStatus.append(option);
    }
    proposalStatus.addEventListener("change", () => changeProposalStatus(proposal, proposalStatus));
    proposalStatusLabel.append(proposalStatus);
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
    proposalSummary.append(proposalStatusLabel, draftDetails, bookingDetails);
    card.append(proposalSummary);
  }

  if (record.kind === "request" && record.booking) card.append(buildJobOutcome(record));

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
    renderReadiness(result.readiness);
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

function updateQuoteCalculator() {
  const [hours, customerRate, cleanerRate, costs] = quoteFields.map((field) => Math.max(0, Number(field.value) || 0));
  const customerTotal = hours * customerRate;
  const cleanerPay = hours * cleanerRate;
  const contribution = customerTotal - cleanerPay - costs;
  const margin = customerTotal ? (contribution / customerTotal) * 100 : 0;
  document.querySelector("#quote-total").textContent = money.format(customerTotal);
  document.querySelector("#quote-pay").textContent = money.format(cleanerPay);
  document.querySelector("#quote-contribution").textContent = money.format(contribution);
  document.querySelector("#quote-margin").textContent = `${margin.toFixed(1)}%`;

  const guidance = document.querySelector("#quote-guidance");
  guidance.className = "quote-guidance";
  if (!customerTotal) {
    guidance.textContent = "Enter the expected hours and rates before promising a price.";
  } else if (contribution <= 0) {
    guidance.textContent = "This quote loses money before overheads. Change the price, pay or scope before sending it.";
    guidance.classList.add("quote-danger");
  } else {
    guidance.textContent = "Positive contribution before insurance, admin, tax, refunds and other overheads. Check those costs separately.";
    guidance.classList.add("quote-positive");
  }
}

quoteFields.forEach((field) => field.addEventListener("input", updateQuoteCalculator));
Promise.all([loadRecords(), loadConfig()]);
