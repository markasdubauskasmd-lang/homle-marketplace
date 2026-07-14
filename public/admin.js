const state = { records: [], kind: "all", status: "all" };

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
  const form = document.querySelector("#business-config-form");
  Object.entries(config).forEach(([name, value]) => {
    const field = form.elements.namedItem(name);
    if (field && value !== undefined && value !== null) field.value = value;
  });
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
  for (const status of statusesByKind[record.kind]) {
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
    addDetail(details, "Frequency", record.frequency);
    addDetail(details, "Preferred date", record.preferredDate);
    addDetail(details, "Organisation", record.organisation);
    addDetail(details, "Details", record.details);
  } else {
    addDetail(details, "Work areas", record.travelAreas);
    addDetail(details, "Experience", record.experience);
    addDetail(details, "Availability", record.availability);
    addDetail(details, "Transport", record.transport);
    addDetail(details, "Notes", record.notes);
  }
  card.append(details);

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
