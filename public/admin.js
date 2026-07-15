const state = { records: [], kind: "all", status: "all", action: "all", config: {}, dispatchSummary: {}, launchFunnel: null, mediaRetention: null, dataIntegrity: null };
const scanReviewWorkspace = globalThis.TidewayScanReviewWorkspace;
const scopeTimeWorksheet = globalThis.TidewayScopeTimeBreakdown;
const scanReviewDraft = globalThis.TidewayScanReviewDraft;
const readinessNavigator = globalThis.TidewayReadinessNavigator;
const scanReviewDraftControls = new WeakMap();

const leadList = document.querySelector("#lead-list");
const dispatchQueueList = document.querySelector("#dispatch-queue-list");
const errorBox = document.querySelector("#admin-error");
const refreshButton = document.querySelector("#refresh-records");
const adminAuth = document.querySelector("#admin-auth");
const adminContent = document.querySelector("#admin-content");
const adminKeyField = document.querySelector("#admin-key");
let adminKey = sessionStorage.getItem("tidewayAdminKey") || "";
let nextReadinessRequirement = null;
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
    proposalField("Exact start time", "proposedStartTime", "time", preferredAvailability?.suggestedStartTime || preferredAvailability?.startTime || (record.preferredTimeWindow?.startsWith("Afternoon") ? "13:00" : record.preferredTimeWindow?.startsWith("Evening") ? "17:00" : "09:00")),
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
  const navigation = readinessNavigator.navigationModel(readiness);
  document.querySelector("#readiness-score").textContent = `${readiness.completed}/${readiness.total}`;
  document.querySelectorAll("#readiness-list [data-check]").forEach((item) => {
    const complete = Boolean(readiness.checks[item.dataset.check]);
    const area = navigation.areas.find((entry) => entry.key === item.dataset.check);
    item.classList.toggle("ready", complete);
    item.querySelector(":scope > span").textContent = complete ? "✓" : "○";
    const missing = readiness.missing?.[item.dataset.check] || [];
    item.querySelector("[data-missing]").textContent = complete ? "All recorded requirements complete" : `Missing: ${missing.join(", ") || "verified founder evidence"}`;
    const areaButton = item.querySelector("[data-readiness-action]");
    areaButton.hidden = complete || !area?.target;
    areaButton.onclick = area?.target ? () => focusReadinessRequirement(area.target) : null;
    if (area?.target) areaButton.setAttribute("aria-label", `Review ${area.target.label}`);
  });
  const guidance = document.querySelector("#readiness-next");
  guidance.classList.toggle("readiness-next-complete", readiness.ready);
  guidance.textContent = readiness.next
    ? `Next required decision — ${readiness.next.label}: ${readiness.next.missing.join(", ")}. Do not guess or use placeholder claims.`
    : "All seven recorded readiness areas are complete. Public launch, outreach and payment still require the founder's explicit approval.";
  const continueButton = document.querySelector("#readiness-continue");
  nextReadinessRequirement = navigation.nextTarget;
  continueButton.hidden = !nextReadinessRequirement;
  continueButton.textContent = readiness.next ? `Continue ${readiness.next.label.toLowerCase()} setup` : "Continue launch setup";
}

function focusReadinessRequirement(target) {
  if (!target) return;
  const setup = document.querySelector(".setup-details");
  const form = document.querySelector("#business-config-form");
  const field = form.elements.namedItem(target.fieldName);
  if (!field || typeof field.focus !== "function") return;
  setup.open = true;
  document.querySelectorAll(".readiness-field-focus").forEach((item) => item.classList.remove("readiness-field-focus"));
  const label = field.closest("label");
  if (label) label.classList.add("readiness-field-focus");
  requestAnimationFrame(() => {
    (label || field).scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus({ preventScroll: true });
  });
}

document.querySelector("#readiness-continue").addEventListener("click", () => {
  focusReadinessRequirement(nextReadinessRequirement);
});

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

function mediaStateLabel(item) {
  if (item.state === "eligible") return "Eligible after policy period";
  if (item.state === "scheduled") return `Scheduled after ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }).format(new Date(item.deleteAfter))}`;
  if (item.state === "purged") return `Media deleted ${formatDate(item.purgedAt)}`;
  if (item.state === "decision-required") return "Retention period not set";
  return "Active request — retained";
}

function renderMediaRetention(audit) {
  state.mediaRetention = audit;
  const summary = document.querySelector("#media-retention-summary");
  const list = document.querySelector("#media-retention-list");
  summary.replaceChildren();
  for (const [value, label] of [[audit.summary.availableMedia, "available files"], [audit.summary.bytes ? `${(audit.summary.bytes / 1048576).toFixed(2)} MB` : "0 MB", "private storage"], [audit.summary.eligible, "eligible scans"], [audit.summary.purged, "audited deletions"]]) {
    const item = document.createElement("div");
    addText(item, "strong", String(value));
    addText(item, "span", label);
    summary.append(item);
  }
  list.replaceChildren();
  if (!audit.items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    addText(empty, "strong", "No room media has been stored.");
    addText(empty, "span", "Submitted room photos and videos will appear here for lifecycle review.");
    list.append(empty);
    return;
  }
  for (const item of audit.items) {
    const card = document.createElement("article");
    card.className = `media-retention-item media-state-${item.state}`;
    const heading = document.createElement("div");
    const copy = document.createElement("div");
    addText(copy, "strong", item.briefId);
    addText(copy, "span", `${item.mediaCount} recorded file${item.mediaCount === 1 ? "" : "s"} · ${item.availableCount} available · ${item.missingCount} unavailable`);
    addText(heading, "span", mediaStateLabel(item), "status-pill");
    card.append(copy, heading);
    if (item.state === "eligible") {
      const details = document.createElement("details");
      const detailsSummary = document.createElement("summary");
      detailsSummary.textContent = "Prepare audited media deletion";
      const form = document.createElement("form");
      form.className = "media-purge-form";
      const referenceLabel = document.createElement("label");
      referenceLabel.append(document.createTextNode(`Type ${item.briefId} exactly`));
      const reference = document.createElement("input");
      reference.name = "typedReference";
      reference.required = true;
      reference.autocomplete = "off";
      referenceLabel.append(reference);
      const reasonLabel = document.createElement("label");
      reasonLabel.append(document.createTextNode("Deletion reason"));
      const reason = document.createElement("textarea");
      reason.name = "reason";
      reason.required = true;
      reason.minLength = 20;
      reason.maxLength = 500;
      reason.rows = 2;
      reason.placeholder = "Explain why the recorded retention schedule permits deletion";
      reasonLabel.append(reason);
      const backupLabel = document.createElement("label");
      backupLabel.className = "checkbox";
      const backup = document.createElement("input");
      backup.type = "checkbox";
      backup.name = "backupConfirmed";
      backup.required = true;
      const backupText = document.createElement("span");
      backupText.textContent = "I created and verified a current private backup before this irreversible media deletion.";
      backupLabel.append(backup, backupText);
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "button button-small danger-button";
      submit.textContent = "Delete eligible media only";
      form.append(referenceLabel, reasonLabel, backupLabel, submit);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          const response = await fetch("/api/admin/media-retention/purge", { method: "POST", headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }), body: JSON.stringify({ briefId: item.briefId, typedReference: reference.value.trim(), reason: reason.value.trim(), backupConfirmed: backup.checked }) });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || "Private media could not be deleted.");
          await Promise.all([loadMediaRetention(), loadRecords()]);
        } catch (error) {
          showAdminError(error.message);
          submit.disabled = false;
        }
      });
      details.append(detailsSummary, form);
      card.append(details);
    }
    list.append(card);
  }
}

async function loadMediaRetention() {
  try {
    const response = await fetch("/api/admin/media-retention", { headers: adminHeaders({ "Accept": "application/json" }) });
    const result = await response.json();
    if (response.status === 401) { showAuth(); return; }
    if (!response.ok || !result.ok) throw new Error(result.error || "Private media audit could not be loaded.");
    renderMediaRetention(result.audit);
  } catch (error) {
    showAdminError(error.message);
  }
}

function renderDataIntegrity(audit) {
  state.dataIntegrity = audit;
  const panel = document.querySelector("#data-integrity");
  const status = document.querySelector("#data-integrity-status");
  const message = document.querySelector("#data-integrity-message");
  const issueList = document.querySelector("#data-integrity-issues");
  const fileCount = audit.files.length;
  const recordCount = audit.files.reduce((total, file) => total + Number(file.records || 0), 0);
  panel.classList.remove("data-integrity-checking", "data-integrity-healthy", "data-integrity-degraded");
  panel.classList.add(audit.healthy ? "data-integrity-healthy" : "data-integrity-degraded");
  status.textContent = audit.healthy ? "Healthy — writes allowed" : "Degraded — writes stopped";
  message.textContent = audit.healthy
    ? "Every readable private record and its required booking links passed the latest check."
    : "Tideway found a damaged or disconnected private record. No new changes will be written until recovery is verified.";
  document.querySelector("#integrity-file-count").textContent = String(fileCount);
  document.querySelector("#integrity-record-count").textContent = String(recordCount);
  document.querySelector("#integrity-issue-count").textContent = String(audit.issueCount);
  document.querySelector("#integrity-checked-at").textContent = audit.checkedAt ? formatDate(audit.checkedAt) : "Not checked";
  issueList.replaceChildren();
  if (audit.healthy) {
    const healthy = document.createElement("div");
    healthy.className = "integrity-result integrity-result-healthy";
    addText(healthy, "strong", "All private record checks passed.");
    addText(healthy, "span", "No files were changed. Tideway will repeat this check before every new write.");
    issueList.append(healthy);
    return;
  }
  for (const issue of audit.issues) {
    const item = document.createElement("div");
    item.className = "integrity-result integrity-result-issue";
    addText(item, "strong", `${issue.file}${issue.line ? ` · line ${issue.line}` : ""}`);
    addText(item, "span", issue.message);
    item.dataset.issueCode = issue.code;
    issueList.append(item);
  }
  if (audit.truncated) {
    const notice = document.createElement("p");
    notice.textContent = `Showing the first ${audit.reportedIssueCount} of ${audit.issueCount} issues. Preserve the files and use a verified backup before recovery.`;
    issueList.append(notice);
  }
}

async function loadDataIntegrity() {
  const refresh = document.querySelector("#refresh-data-integrity");
  refresh.disabled = true;
  try {
    const response = await fetch("/api/admin/data-integrity", { headers: adminHeaders({ "Accept": "application/json" }) });
    const result = await response.json();
    if (response.status === 401) { showAuth(); return; }
    if (!response.ok || !result.ok) throw new Error(result.error || "Private data integrity could not be checked.");
    showContent();
    renderDataIntegrity(result.audit);
  } catch (error) {
    showAdminError(error.message);
  } finally {
    refresh.disabled = false;
  }
}

function showAdminError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.focus();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(value));
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
  document.querySelector("#attention-count").textContent = state.records.filter((record) => record.dispatchActions?.some((action) => ["urgent", "high"].includes(action.severity))).length;
  document.querySelector("#attention-detail").textContent = `${state.dispatchSummary.urgent || 0} urgent · ${state.dispatchSummary.high || 0} high priority`;
  document.querySelector("#new-request-count").textContent = `${requests.filter((record) => record.status === "new").length} new to review`;
  document.querySelector("#new-cleaner-count").textContent = `${cleaners.filter((record) => record.status === "new").length} new to review`;
}

function renderScanReviewWorkspace() {
  const target = document.querySelector("#scan-review-summary");
  const progress = document.querySelector("#scan-review-progress");
  const summary = scanReviewWorkspace.scanReviewSummary(state.records);
  const nextRecord = scanReviewWorkspace.nextScanRecord(state.records);
  progress.textContent = `${summary.reviewed}/${summary.submitted}`;
  target.replaceChildren();

  const copy = document.createElement("div");
  copy.className = "scan-review-summary-copy";
  if (!summary.submitted) {
    addText(copy, "strong", "No room scans have been submitted yet.");
    addText(copy, "span", "A customer scan will appear here after its photos or video, spoken notes and concise checklist are submitted.");
    target.append(copy);
    return;
  }
  if (!nextRecord) {
    addText(copy, "strong", "No submitted scope is awaiting Tideway review.");
    addText(copy, "span", `${summary.reviewed} reviewed Â· ${summary.revisionRequested} returned for customer revision.`);
    target.append(copy);
    return;
  }

  const brief = nextRecord.briefs[0];
  addText(copy, "strong", `Next: ${brief.id} Â· ${brief.checklist.length} tasks Â· ${brief.photos.length} visuals`);
  addText(copy, "span", `${summary.awaiting} submitted scope${summary.awaiting === 1 ? "" : "s"} awaiting evidence review. Private media remains unloaded until you choose to open it.`);
  addText(copy, "small", "Approval stays blocked until every evidence item is complete; this action only opens the private record.");
  const open = document.createElement("button");
  open.type = "button";
  open.className = "button button-small";
  open.textContent = "Review next submitted scan";
  open.addEventListener("click", () => showDispatchRecord(nextRecord.id, { group: "scan" }));
  target.append(copy, open);
}

function renderLaunchFunnel() {
  const target = document.querySelector("#launch-funnel-stages");
  const bottleneck = document.querySelector("#launch-bottleneck");
  const funnel = state.launchFunnel;
  target.replaceChildren();
  if (!funnel?.stages?.length) {
    const unavailable = document.createElement("div");
    unavailable.className = "runway-loading";
    unavailable.textContent = "Launch-runway evidence is unavailable. Refresh the control desk.";
    target.append(unavailable);
    return;
  }
  document.querySelector("#runway-cleaner-count").textContent = funnel.dispatchReadyCleaners;
  funnel.stages.forEach((stage, index) => {
    const item = document.createElement("article");
    item.className = `funnel-stage${stage.count > 0 ? " funnel-stage-reached" : ""}`;
    const step = document.createElement("span");
    step.textContent = String(index + 1);
    step.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    addText(copy, "strong", stage.label);
    addText(copy, "small", stage.detail);
    const count = document.createElement("b");
    count.textContent = String(stage.count);
    count.setAttribute("aria-label", `${stage.count} ${stage.label.toLowerCase()}`);
    item.append(step, copy, count);
    target.append(item);
  });
  bottleneck.replaceChildren();
  bottleneck.className = `launch-bottleneck${funnel.goal?.achieved ? " launch-bottleneck-complete" : ""}`;
  addText(bottleneck, "span", funnel.goal?.achieved ? "Milestone recorded" : "Current bottleneck");
  addText(bottleneck, "strong", funnel.bottleneck?.title || "Review launch evidence");
  addText(bottleneck, "p", funnel.bottleneck?.detail || "Check the underlying records before acting.");
  if (funnel.parallelAction) {
    const parallel = document.createElement("div");
    parallel.className = "launch-parallel-action";
    addText(parallel, "span", "Safe work in parallel");
    addText(parallel, "strong", funnel.parallelAction.title);
    addText(parallel, "p", `${funnel.parallelAction.detail} Use the founder-action queue below; this does not bypass the launch gate.`);
    bottleneck.append(parallel);
  }
  if (funnel.goal?.achieved) addText(bottleneck, "small", `${funnel.goal.profitableBookings} profitable target-met booking${funnel.goal.profitableBookings === 1 ? "" : "s"} · ${money.format(funnel.goal.customerReceipts)} recorded receipts · ${money.format(funnel.goal.contribution)} contribution`);
}

function actionMatchesFilter(record) {
  if (state.action === "all") return true;
  const actions = record.dispatchActions || [];
  if (state.action === "needs-action") return actions.some((action) => ["urgent", "high"].includes(action.severity));
  if (state.action === "urgent") return actions.some((action) => action.severity === "urgent");
  if (["schedule", "scan", "supply", "profit"].includes(state.action)) return actions.some((action) => action.group === state.action);
  if (state.action === "rematching") return actions.some((action) => action.group === "rematching");
  if (state.action === "booking") return actions.some((action) => ["booking", "safety"].includes(action.group));
  return true;
}

function showDispatchRecord(recordId, action = null) {
  state.kind = "all";
  state.status = "all";
  state.action = "all";
  document.querySelectorAll("[role=tab]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.kind === "all")));
  document.querySelector("#status-filter").value = "all";
  document.querySelector("#action-filter").value = "all";
  renderRecords();
  requestAnimationFrame(() => {
    const card = document.querySelector(`#record-${recordId}`);
    if (!card) return;
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    if (action?.group === "scan") {
      const brief = card.querySelector(".brief-summary");
      if (brief) {
        brief.open = true;
        const summary = brief.querySelector("summary");
        if (summary) {
          summary.tabIndex = -1;
          summary.focus({ preventScroll: true });
        }
      }
    }
  });
}

function renderDispatchQueue() {
  const severityWeight = { urgent: 3, high: 2, monitor: 1 };
  const entries = state.records.flatMap((record) => (record.dispatchActions || []).map((action) => ({ record, action })))
    .sort((left, right) => (severityWeight[right.action.severity] || 0) - (severityWeight[left.action.severity] || 0) || right.record.createdAt.localeCompare(left.record.createdAt));
  dispatchQueueList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "dispatch-empty";
    addText(empty, "strong", "No founder actions are queued.");
    addText(empty, "span", "Approaching dates, new scans, rematching needs, booking checks and safety reports will appear here automatically.");
    dispatchQueueList.append(empty);
    return;
  }
  for (const { record, action } of entries) {
    const item = document.createElement("article");
    item.className = `dispatch-item dispatch-${action.severity}`;
    const copy = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "dispatch-meta";
    addText(meta, "span", action.severity === "urgent" ? "Urgent" : action.severity === "high" ? "Founder action" : "Monitoring", `dispatch-severity dispatch-severity-${action.severity}`);
    addText(meta, "span", `${record.kind === "request" ? "Customer request" : "Cleaner application"} · ${record.id}`);
    copy.append(meta);
    addText(copy, "strong", action.title);
    addText(copy, "span", action.detail);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-small button-outline";
    button.textContent = action.group === "scan" ? "Open scan review" : action.group === "supply" ? "Open cleaner record" : "Open record";
    button.addEventListener("click", () => showDispatchRecord(record.id, action));
    item.append(copy, button);
    dispatchQueueList.append(item);
  }
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
      } else if (result.matchGate?.reason === "reviewed-room-scan-required") {
        addText(results, "strong", "Review the room scan before matching.");
        addText(results, "span", "Tideway needs the reviewed cleaning-time estimate before it can prove that a cleaner window is long enough.");
      } else if (result.matchGate?.reason === "customer-scope-confirmation-required") {
        addText(results, "strong", "Customer scope confirmation is required before matching.");
        addText(results, "span", "The customer must confirm that the final concise checklist includes every task they want quoted.");
      } else if (result.matchGate?.reason === "price-sensitive-scope-review-required") {
        addText(results, "strong", "Confirm the price-sensitive scan items before matching.");
        addText(results, "span", "Every detected extra must be included in the reviewed cleaning-time estimate before Tideway can suggest a cleaner window.");
      } else if (result.matchGate?.reason === "no-cleaner-travel-coverage") {
        addText(results, "strong", "No available cleaner covers this postcode yet.");
        addText(results, "span", "Do not promise the job. Reconfirm a screened cleaner's outward postcode districts or postcode areas before preparing an offer.");
      } else if (result.matchGate?.reason === "no-schedulable-window") {
        addText(results, "strong", "No confirmed window fits this request yet.");
        addText(results, "span", `${result.matchGate.requiredHours} reviewed hours must fit${result.request.preferredDate ? ` on ${result.request.preferredDate}` : " a future date"}${result.request.preferredTimeWindow && result.request.preferredTimeWindow !== "Flexible" ? ` with a ${result.request.preferredTimeWindow.toLowerCase()} arrival` : ""}. Do not promise a different time without customer approval.`);
      } else {
        addText(results, "strong", "No approved service matches yet.");
        addText(results, "span", "A fully screened cleaner must have the right service, coverage and a confirmed window that holds the reviewed duration.");
      }
      return;
    }
    if (result.matchGate?.confirmedExtras?.length) addText(results, "span", `Reviewed extras included in the time estimate: ${result.matchGate.confirmedExtras.join(", ")}.`, "scope-signal-summary");
    addText(results, "span", "All suggested visits and confirmed availability windows use UK local time (Europe/London).", "match-timezone");
    for (const match of result.matches) {
      const item = document.createElement("article");
      item.className = "match-result";
      const heading = document.createElement("div");
      addText(heading, "strong", match.fullName);
      addText(heading, "span", `${match.score}/100 · ${match.coverage}`);
      item.append(heading);
      addText(item, "span", `${match.travelAreas} · ${match.availability}`);
      addText(item, "strong", match.scheduleFit);
      addText(item, "span", `Schedulable visits: ${match.availabilitySlots.map((slot) => `${slot.availableDate} ${slot.suggestedStartTime}-${slot.suggestedEndTime} inside confirmed ${slot.startTime}-${slot.endTime}${slot.capacityAdjusted ? " (after existing held capacity)" : ""}`).join(", ")}`);
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

function addLocalAuditPreview(container, label, path) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-small button-outline";
  button.textContent = label;
  button.addEventListener("click", () => window.open(path, "_blank", "noopener,noreferrer"));
  container.append(button);
}

function draftSection(title, draft) {
  const section = document.createElement("section");
  section.className = `draft-section${draft.handoffReady ? " draft-handoff-ready" : ""}`;
  addText(section, "h4", title);
  addText(section, "span", `Recipient: ${[draft.recipient.email, draft.recipient.phone].filter(Boolean).join(" · ")}`, "draft-recipient");
  addText(section, "span", `Subject: ${draft.subject}`, "draft-subject");
  const privateUrl = draft.privateUrl || "";
  const handoffBody = draft.handoffReady ? `${draft.body}\n\nOpen your private Tideway review:\n${privateUrl}\n\nKeep this private link confidential.` : draft.body;
  addText(section, "span", draft.handoffReady ? "Complete copy-only handoff: the correct private link is included below." : "Review text only: the private link is withheld until this offer is recorded as sent.", "draft-link-state");
  const textarea = document.createElement("textarea");
  textarea.readOnly = true;
  textarea.rows = 14;
  textarea.value = handoffBody;
  textarea.setAttribute("aria-label", `${title} body`);
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "button button-small button-outline";
  copyButton.textContent = draft.handoffReady ? "Copy complete private handoff — does not send" : "Copy review text only — does not send";
  copyButton.addEventListener("click", () => copyDraft(`${draft.subject}\n\n${handoffBody}`, copyButton));
  section.append(textarea, copyButton);
  return section;
}

async function loadRequestFollowupDraft(record, target, button) {
  button.disabled = true;
  target.replaceChildren();
  addText(target, "span", "Preparing a private, copy-only room-scan draft…");
  try {
    const response = await fetch(`/api/admin/request-followup-draft?requestId=${encodeURIComponent(record.id)}`, { headers: adminHeaders({ "Accept": "application/json" }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Room-scan follow-up could not be prepared.");
    target.replaceChildren();
    const safety = document.createElement("div");
    safety.className = result.handoffReady ? "draft-safety draft-ready" : "draft-safety draft-blocked";
    addText(safety, "strong", result.handoffReady ? "Copy-only private follow-up ready" : "Review draft only — private link withheld");
    addText(safety, "span", result.handoffReady
      ? "The verified public tracker link is included only in the copy below. Copying never sends or contacts the customer. Founder approval is still required before outreach."
      : "Tideway will not expose the private token through localhost or an unverified deployment. Verify the public HTTPS site before customer outreach.");
    if (result.warnings?.length) {
      const list = document.createElement("ul");
      result.warnings.forEach((warning) => addText(list, "li", warning));
      safety.append(list);
    }

    const section = document.createElement("section");
    section.className = `draft-section${result.handoffReady ? " draft-handoff-ready" : ""}`;
    addText(section, "h4", result.kind === "room-scan-revision" ? "Customer room-scan revision draft" : "Customer room-scan reminder draft");
    addText(section, "span", `Recipient: ${result.recipient.email}`, "draft-recipient");
    addText(section, "span", `Subject: ${result.subject}`, "draft-subject");
    const completeBody = result.handoffReady
      ? `${result.body}\n\nOpen your private Tideway request tracker:\n${result.privateUrl}`
      : result.body;
    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.rows = 14;
    textarea.value = completeBody;
    textarea.setAttribute("aria-label", "Customer room-scan follow-up body");
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "button button-small button-outline";
    copyButton.textContent = result.handoffReady ? "Copy complete private follow-up — does not send" : "Copy review text only — does not send";
    copyButton.addEventListener("click", () => copyDraft(`${result.subject}\n\n${completeBody}`, copyButton));
    section.append(textarea, copyButton);
    target.append(safety, section);
  } catch (error) {
    target.replaceChildren();
    addText(target, "strong", error.message);
  } finally {
    button.disabled = false;
  }
}

function buildRequestFollowupPanel(record) {
  if (record.kind !== "request" || record.booking || ["booked", "completed", "lost"].includes(record.status)) return null;
  const latestBrief = record.briefs?.[0] || null;
  if (latestBrief && latestBrief.status !== "needs-revision") return null;
  const panel = document.createElement("details");
  panel.className = "draft-panel scan-followup-panel";
  const summary = document.createElement("summary");
  summary.textContent = latestBrief ? "Prepare revised room-scan follow-up" : "Prepare room-scan follow-up";
  const guidance = document.createElement("p");
  guidance.textContent = "This prepares text for founder review only. It never sends a message, and a customer-ready private link is withheld until the deployed HTTPS site has matching verification evidence.";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-small button-outline";
  button.textContent = "Prepare copy-only draft";
  const target = document.createElement("div");
  target.className = "draft-target";
  button.addEventListener("click", () => loadRequestFollowupDraft(record, target, button));
  panel.append(summary, guidance, button, target);
  return panel;
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
    addText(safety, "strong", result.handoffReady ? "Copy-only dispatch pack ready" : result.sendAllowed ? "Internally ready for your review" : "Review only — not ready to use");
    addText(safety, "span", result.handoffReady ? "Each message below contains only that recipient's correct private link. Copying never sends it." : "Tideway does not send these messages automatically. Private links enter the pack only after the offer is recorded as sent.");
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

async function loadBookingDrafts(booking, target, button) {
  button.disabled = true;
  target.replaceChildren();
  addText(target, "span", "Preparing recipient-isolated booking handoffs…");
  try {
    const response = await fetch(`/api/admin/booking-drafts?bookingId=${encodeURIComponent(booking.id)}`, { headers: adminHeaders({ "Accept": "application/json" }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Booking handoffs could not be prepared.");
    target.replaceChildren();
    const safety = document.createElement("div");
    safety.className = result.handoffReady ? "draft-safety draft-ready" : "draft-safety draft-blocked";
    addText(safety, "strong", result.handoffReady ? "Copy-only confirmed-booking pack ready" : "Booking handoffs remain blocked");
    addText(safety, "span", result.handoffReady
      ? "Each complete message below contains only that recipient's frozen public booking-pack link. Copying never sends it."
      : "Do not assemble a link from this computer's local address. Resolve every warning before a recipient handoff.");
    if (result.warnings.length) {
      const list = document.createElement("ul");
      result.warnings.forEach((warning) => addText(list, "li", warning));
      safety.append(list);
    }
    target.append(safety, draftSection("Customer booking confirmation", result.customer), draftSection("Cleaner assignment confirmation", result.cleaner));
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
  addText(form, "span", "Capture the final visit pack after both sides accept. Tideway verifies a reference for an external payment step but never charges or refunds anyone. Never enter alarm codes, key-safe codes, card details, passwords or provider credentials here.");
  const paymentReferenceField = bookingDetailField("External payment evidence reference", "paymentEvidenceReference", { placeholder: "Provider transaction, authorisation or invoice reference only", maxLength: 100 });
  const paymentAmountField = bookingDetailField("Externally verified amount (£)", "paymentEvidenceAmount", { type: "number", value: String(proposal.customerTotal) });
  paymentAmountField.querySelector("input").min = "0.01";
  paymentAmountField.querySelector("input").step = "0.01";
  const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const paymentVerifiedField = bookingDetailField("Evidence verified at", "paymentEvidenceVerifiedAt", { type: "datetime-local", value: localNow });
  form.append(
    bookingDetailField("Full service address", "serviceAddress", { autocomplete: "street-address", placeholder: "Building, street and locality" }),
    bookingDetailField("Service postcode", "servicePostcode", { autocomplete: "postal-code", value: record.postcode }),
    bookingDetailField("Named access contact", "accessContactName", { autocomplete: "name" }),
    bookingDetailField("Access contact phone", "accessContactPhone", { type: "tel", autocomplete: "tel" }),
    bookingDetailField("Access instructions", "accessInstructions", { multiline: true, placeholder: "Where to meet or who will provide access — no door or alarm codes" }),
    bookingDetailField("Parking or arrival notes", "parkingNotes", { multiline: true, required: false, maxLength: 500 }),
    bookingDetailField("Products and equipment", "productsAndEquipment", { multiline: true, placeholder: "Who supplies products, vacuum, mop and any site-specific equipment" }),
    bookingDetailField("Emergency and issue instructions", "emergencyInstructions", { multiline: true, placeholder: "Who to call and when work must stop" }),
    paymentReferenceField,
    paymentAmountField,
    paymentVerifiedField,
    bookingConfirmation("Exact address and named access contact confirmed securely", "addressAndAccessConfirmed"),
    bookingConfirmation("Final checklist, exclusions, products and equipment confirmed", "finalChecklistConfirmed"),
    bookingConfirmation("I verified the external payment step, exact amount, reference and time after customer acceptance", "paymentAuthorisationConfirmed"),
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
    ["serviceAddress", "servicePostcode", "accessContactName", "accessContactPhone", "accessInstructions", "parkingNotes", "productsAndEquipment", "emergencyInstructions", "paymentEvidenceReference", "paymentEvidenceAmount"].forEach((name) => { body[name] = data.get(name) || ""; });
    body.paymentEvidenceVerifiedAt = data.get("paymentEvidenceVerifiedAt") ? new Date(data.get("paymentEvidenceVerifiedAt")).toISOString() : "";
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
    const checkLabels = { requestActive: "Customer request is still active", launchReady: "Seven launch checks complete", customerAccepted: "Customer accepted through the private quote", cleanerAccepted: "Cleaner accepted through the private opportunity", customerAcceptedBeforeExpiry: "Customer accepted before the frozen deadline", cleanerAcceptedBeforeExpiry: "Cleaner accepted before the frozen deadline", cleanerApproved: "Cleaner approved", cleanerScreened: "Cleaner screening checklist complete", pilotAreaCovered: "Customer postcode inside configured pilot area", serviceApproved: "Cleaner approved for service", frequencyCaptured: "Requested frequency captured with a one-visit booking rule", availabilityCovered: "Visit fits an active confirmed availability window", costModelCurrent: "Proposal uses the current founder-confirmed cost assumptions", profitable: "Positive job contribution", marginFloorMet: "Founder margin floor met", minimumHoursMet: "Founder minimum hours met", briefReviewed: "Required room scan reviewed", reviewEvidenceConfirmed: "Every room visual and note opened; concise checklist reconciled", customerScopeConfirmed: "Customer confirmed the final concise checklist", priceSensitiveScopeConfirmed: "Detected price-sensitive scan items included in reviewed hours", scanHoursCovered: "Proposal covers reviewed scan hours", scopeCaptured: "Site scope recorded", accessCaptured: "Access arrangements recorded", hazardsCaptured: "Hazards recorded", publicOriginFrozen: "Customer and cleaner handoffs share one frozen verified public host", scheduleConflictFree: "Cleaner has no overlapping accepted job" };
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
  addText(panel, "span", "Use the local previews only to audit each view. Copy recipient messages only from the isolated handoff pack below, and never paste a private link into public notes.");
  if (booking.paymentEvidence) {
    const payment = document.createElement("div");
    payment.className = "payment-evidence-summary";
    addText(payment, "strong", `External payment evidence · ${money.format(booking.paymentEvidence.amount)}`);
    addText(payment, "span", `${booking.paymentEvidence.providerName} · ${booking.paymentEvidence.status.replaceAll("-", " ")} · verified ${formatDate(booking.paymentEvidence.verifiedAt)}`);
    addText(payment, "span", `Reference ${booking.paymentEvidence.reference} · evidence only; Tideway did not move money`);
    panel.append(payment);
  }
  const progress = document.createElement("ol");
  const progressSteps = [
    ["Cleaner arrival", booking.jobProgress?.cleanerArrivedAt],
    ["Cleaner completion", booking.jobProgress?.cleanerCompletedAt],
    ["Customer completion acknowledgement", booking.jobProgress?.customerCompletedAt]
  ];
  progressSteps.forEach(([label, timestamp]) => addText(progress, "li", timestamp ? `✓ ${label} · ${formatDate(timestamp)}` : `○ ${label} · awaiting`));
  panel.append(progress);
  if (!booking.publicSiteUrl) addText(panel, "span", "Verified public booking-pack host is missing. Do not copy or assemble a local link; recover through a newly audited booking workflow.", "draft-blocked");
  for (const view of [
    { label: "Customer booking confirmation", path: "booking-confirmation", token: booking.customerViewToken },
    { label: "Cleaner assignment pack", path: "assignment", token: booking.cleanerViewToken }
  ]) {
    if (!view.token) continue;
    const section = document.createElement("div");
    section.className = "quote-review-link";
    addText(section, "strong", `${view.label} · local audit only`);
    addText(section, "span", "This opens the private view on this computer but does not provide a recipient handoff link.");
    addLocalAuditPreview(section, `Open local ${view.path === "assignment" ? "cleaner" : "customer"} booking preview`, `/${view.path}#${encodeURIComponent(view.token)}`);
    panel.append(section);
  }
  const handoffDetails = document.createElement("details");
  handoffDetails.className = "message-drafts";
  const handoffSummary = document.createElement("summary");
  handoffSummary.textContent = "Open recipient-isolated booking handoffs";
  const handoffButton = document.createElement("button");
  handoffButton.type = "button";
  handoffButton.className = "button button-small button-light";
  handoffButton.textContent = "Load copy-only booking handoffs";
  const handoffTarget = document.createElement("div");
  handoffTarget.className = "draft-target";
  handoffButton.addEventListener("click", () => loadBookingDrafts(booking, handoffTarget, handoffButton));
  handoffDetails.append(handoffSummary, handoffButton, handoffTarget);
  panel.append(handoffDetails);
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

const outcomeAdjustmentReasons = {
  "customer-refund": "Customer refund",
  "re-clean": "Re-clean cost",
  "complaint-resolution": "Complaint resolution",
  "damage-or-loss": "Damage or loss",
  "late-provider-cost": "Late provider cost",
  "record-correction": "Append-only record correction",
  other: "Other later adjustment"
};

function appendOutcomeAdjustmentDesk(record, panel) {
  const details = document.createElement("details");
  details.className = "outcome-adjustment-desk";
  const summary = document.createElement("summary");
  summary.textContent = `Later refunds, re-cleans and costs · ${record.outcome.adjustmentCount || 0} adjustments`;
  details.append(summary);
  addText(details, "p", "Record only work or money movements that already happened outside Tideway. This form never refunds, charges or pays anyone, and every entry is permanent.");
  if (record.outcome.adjustments?.length) {
    const history = document.createElement("ol");
    history.className = "outcome-adjustment-history";
    record.outcome.adjustments.forEach((adjustment) => {
      const item = document.createElement("li");
      addText(item, "strong", `${outcomeAdjustmentReasons[adjustment.reasonType] || "Adjustment"} · ${adjustment.sourceReference}`);
      addText(item, "span", `${formatDate(adjustment.createdAt)} · ${money.format(adjustment.additionalRefundAmount || 0)} refund · ${money.format(adjustment.additionalCleanerPaid || 0)} cleaner pay · ${money.format(adjustment.additionalLabourOnCosts || 0)} labour on-cost · ${money.format((adjustment.additionalPaymentFees || 0) + (adjustment.additionalTravelCosts || 0) + (adjustment.additionalSuppliesCosts || 0) + (adjustment.additionalOtherCosts || 0))} other direct costs`);
      if (adjustment.relatedChangeRequestId) addText(item, "span", `Related resolved issue: ${adjustment.relatedChangeRequestId}`);
      history.append(item);
    });
    details.append(history);
  }
  const form = document.createElement("form");
  form.className = "outcome-adjustment-form";
  const reasonLabel = document.createElement("label");
  reasonLabel.append(document.createTextNode("Reason"));
  const reason = document.createElement("select");
  reason.name = "reasonType";
  reason.required = true;
  reason.append(new Option("Choose one", ""));
  Object.entries(outcomeAdjustmentReasons).forEach(([value, label]) => reason.append(new Option(label, value)));
  reasonLabel.append(reason);
  const referenceLabel = document.createElement("label");
  referenceLabel.append(document.createTextNode("Unique external case or transaction reference"));
  const reference = document.createElement("input");
  reference.name = "sourceReference";
  reference.required = true;
  reference.minLength = 4;
  reference.maxLength = 80;
  reference.placeholder = "No card, bank or account credentials";
  referenceLabel.append(reference);
  const relatedLabel = document.createElement("label");
  relatedLabel.append(document.createTextNode("Related resolved issue (optional)"));
  const related = document.createElement("select");
  related.name = "relatedChangeRequestId";
  related.append(new Option("No linked issue", ""));
  (record.booking.changeRequests || []).filter((change) => change.status === "closed").forEach((change) => related.append(new Option(`${change.id} · ${change.type.replaceAll("-", " ")}`, change.id)));
  relatedLabel.append(related);
  const fields = [
    ["Additional work hours", "additionalHours"],
    ["Additional customer collected (£)", "additionalCustomerCollected"],
    ["Additional cleaner paid (£)", "additionalCleanerPaid"],
    ["Additional labour on-costs (£)", "additionalLabourOnCosts"],
    ["Additional payment fees (£)", "additionalPaymentFees"],
    ["Additional travel costs (£)", "additionalTravelCosts"],
    ["Additional supplies costs (£)", "additionalSuppliesCosts"],
    ["Additional other costs (£)", "additionalOtherCosts"],
    ["Additional refunds (£)", "additionalRefundAmount"]
  ];
  form.append(reasonLabel, referenceLabel, relatedLabel);
  fields.forEach(([label, name]) => {
    const field = numberField(label, name, "0");
    if (name === "additionalHours") field.querySelector("input").step = "0.25";
    form.append(field);
  });
  const noteLabel = document.createElement("label");
  noteLabel.className = "adjustment-note";
  noteLabel.append(document.createTextNode("Evidence note"));
  const note = document.createElement("textarea");
  note.name = "internalNote";
  note.required = true;
  note.minLength = 20;
  note.maxLength = 1000;
  note.rows = 3;
  note.placeholder = "Explain what happened, what evidence was checked and why these are the final additional amounts";
  noteLabel.append(note);
  const confirmationLabel = document.createElement("label");
  confirmationLabel.className = "checkbox adjustment-confirmation";
  const confirmation = document.createElement("input");
  confirmation.type = "checkbox";
  confirmation.name = "externalActionConfirmed";
  confirmation.required = true;
  const confirmationText = document.createElement("span");
  confirmationText.textContent = "I confirm any work or money movement already happened outside Tideway; this entry records evidence only.";
  confirmationLabel.append(confirmation, confirmationText);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "button button-small";
  submit.textContent = "Append adjustment — no money moves";
  form.append(noteLabel, confirmationLabel, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    const body = Object.fromEntries(new FormData(form).entries());
    body.bookingId = record.booking.id;
    body.externalActionConfirmed = confirmation.checked;
    try {
      const response = await fetch("/api/admin/job-outcome-adjustments", { method: "POST", headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }), body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "Later job adjustment could not be recorded.");
      await loadRecords();
    } catch (error) {
      showAdminError(error.message);
      submit.disabled = false;
    }
  });
  details.append(form);
  panel.append(details);
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
    addText(panel, "span", `${money.format(record.outcome.labourOnCosts || 0)} labour on-costs · ${money.format(record.outcome.paymentFees || 0)} payment fees · ${money.format(record.outcome.travelCosts || 0)} travel · ${money.format(record.outcome.suppliesCosts || 0)} supplies · ${money.format(record.outcome.otherCosts || 0)} other actual costs`);
    if (record.outcome.targetMarginPercent > 0) addText(panel, "span", `Founder margin floor at completion: ${record.outcome.targetMarginPercent.toFixed(1)}%`);
    if (record.outcome.settlementEvidence) {
      const evidence = document.createElement("div");
      evidence.className = "settlement-evidence-summary";
      addText(evidence, "strong", "External receipt and cleaner payout verified");
      addText(evidence, "span", `${record.outcome.settlementEvidence.providerName} · verified ${formatDate(record.outcome.settlementEvidence.verifiedAt)}`);
      addText(evidence, "span", `Customer receipt ${record.outcome.settlementEvidence.customerReceiptReference} · cleaner payout ${record.outcome.settlementEvidence.cleanerPayoutReference}`);
      addText(evidence, "span", "Private evidence only; Tideway did not collect or send this money.");
      panel.append(evidence);
    } else {
      addText(panel, "span", "Legacy outcome: external customer receipt and cleaner payout evidence were not recorded. It cannot satisfy the first profitable paid-booking milestone.", "settlement-evidence-warning");
    }
    if (record.outcome.adjusted) addText(panel, "span", `Original recorded contribution: ${money.format(record.outcome.original.contribution)} · revised by ${record.outcome.adjustmentCount} append-only adjustment${record.outcome.adjustmentCount === 1 ? "" : "s"}.`);
    appendOutcomeAdjustmentDesk(record, panel);
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
  const customerCollectedField = numberField("Customer collected (£)", "customerCollected", String(record.booking.plannedCustomerTotal || ""));
  const customerCollectedInput = customerCollectedField.querySelector("input");
  customerCollectedInput.min = String(record.booking.plannedCustomerTotal || 0);
  customerCollectedInput.max = String(record.booking.plannedCustomerTotal || 0);
  const cleanerPaidField = numberField("Cleaner paid (£)", "cleanerPaid", String(record.booking.plannedCleanerPay || ""));
  cleanerPaidField.querySelector("input").min = String(record.booking.plannedCleanerPay || 0);
  form.append(
    numberField("Actual hours", "actualHours", String(record.proposals?.[0]?.estimatedHours || "")),
    customerCollectedField,
    cleanerPaidField,
    numberField("Labour on-costs (£)", "labourOnCosts", String(record.booking.plannedLabourOnCosts ?? "")),
    numberField("Payment fees (£)", "paymentFees", String(record.booking.plannedPaymentFees || "")),
    numberField("Travel costs (£)", "travelCosts", String(record.booking.plannedTravelCosts || "")),
    numberField("Supplies costs (£)", "suppliesCosts", String(record.booking.plannedSuppliesCosts || "")),
    numberField("Other actual costs (£)", "otherCosts", String(record.booking.plannedAdditionalCosts || "")),
    numberField("Refunds (£)", "refundAmount")
  );
  const evidenceGuidance = document.createElement("div");
  evidenceGuidance.className = "settlement-guidance";
  addText(evidenceGuidance, "strong", "Private external settlement evidence");
  addText(evidenceGuidance, "span", "Enter provider references only after the customer receipt and cleaner payout have completed outside Tideway. Never enter card details, bank details, passwords or provider credentials.");
  const receiptReference = bookingDetailField("Customer receipt or capture reference", "customerReceiptReference", { placeholder: "Non-sensitive provider reference", maxLength: 100 });
  const payoutReference = bookingDetailField("Cleaner payout reference", "cleanerPayoutReference", { placeholder: "Non-sensitive payout reference", maxLength: 100 });
  const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const verifiedAt = bookingDetailField("Settlement verified at", "settlementVerifiedAt", { type: "datetime-local", value: localNow });
  const evidenceNote = bookingDetailField("Settlement evidence note", "settlementEvidenceNote", { multiline: true, placeholder: "Explain what was checked and where the two references came from", maxLength: 1000 });
  receiptReference.querySelector("input").minLength = 6;
  payoutReference.querySelector("input").minLength = 6;
  verifiedAt.querySelector("input").max = localNow;
  evidenceNote.querySelector("textarea").minLength = 20;
  evidenceNote.classList.add("settlement-note");
  const settlementConfirmation = bookingConfirmation("I confirm the customer receipt and cleaner payout already occurred outside Tideway, the amounts and references were checked, and this entry only records that evidence.", "settlementConfirmed");
  settlementConfirmation.classList.add("settlement-confirmation");
  form.append(evidenceGuidance, receiptReference, payoutReference, verifiedAt, evidenceNote, settlementConfirmation);
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
    body.settlementVerifiedAt = body.settlementVerifiedAt ? new Date(body.settlementVerifiedAt).toISOString() : "";
    body.settlementConfirmed = form.elements.settlementConfirmed.checked;
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
    const reviewProgress = document.createElement("p");
    reviewProgress.className = "visual-review-progress";
    target.append(reviewProgress);
    const updateReviewProgress = () => {
      const reviewChecks = [...target.querySelectorAll("[data-reviewed-visual-id]")];
      const reviewedCount = reviewChecks.filter((input) => input.checked).length;
      target.dataset.reviewComplete = String(reviewChecks.length > 0 && reviewedCount === reviewChecks.length);
      reviewProgress.textContent = `${reviewedCount} of ${reviewChecks.length} room visuals individually confirmed`;
      target.dispatchEvent(new CustomEvent("brief-visual-review-progress"));
    };
    for (const photo of brief.photos || []) {
      const response = await fetch(`/api/admin/job-brief-image?briefId=${encodeURIComponent(brief.id)}&imageId=${encodeURIComponent(photo.id)}`, { headers: adminHeaders({ "Accept": "image/*,video/*" }) });
      if (!response.ok) throw new Error("A private room visual could not be loaded.");
      const figure = document.createElement("figure");
      const blob = await response.blob();
      const isVideo = photo.kind === "video" || blob.type.startsWith("video/");
      const visual = document.createElement(isVideo ? "video" : "img");
      visual.src = URL.createObjectURL(blob);
      if (isVideo) { visual.controls = true; visual.preload = "metadata"; visual.setAttribute("aria-label", `${photo.area} short video reference`); }
      else { visual.alt = `${photo.area} visual reference`; visual.loading = "lazy"; }
      const caption = document.createElement("figcaption");
      const area = document.createElement("strong");
      area.textContent = photo.area;
      const note = document.createElement("span");
      note.textContent = photo.note || "No room note recorded";
      caption.append(area, note);
      const reviewLabel = document.createElement("label");
      reviewLabel.className = "checkbox visual-review-check";
      const reviewCheck = document.createElement("input");
      reviewCheck.type = "checkbox";
      reviewCheck.dataset.reviewedVisualId = photo.id;
      reviewCheck.value = photo.id;
      const reviewCopy = document.createElement("span");
      reviewCopy.textContent = "I reviewed this visual and its room note";
      reviewCheck.addEventListener("change", updateReviewProgress);
      reviewLabel.append(reviewCheck, reviewCopy);
      figure.append(visual, caption, reviewLabel);
      target.append(figure);
    }
    target.dataset.loaded = "true";
    updateReviewProgress();
    target.dispatchEvent(new CustomEvent("brief-visuals-loaded"));
    button.remove();
  } catch (error) {
    addText(target, "strong", error.message);
    button.disabled = false;
  }
}

function readReviewTimeBreakdown(brief, form) {
  return scopeTimeWorksheet.buildScopeTimeBreakdown({
    expectedAreas: scopeTimeWorksheet.scopeTimeAreas(brief),
    areaMinutes: [...form.querySelectorAll("[data-scope-time-area]")].map((input) => ({ area: input.dataset.scopeTimeArea, minutes: input.value })),
    overheadMinutes: form.elements.scopeOverheadMinutes?.value
  });
}

function reviewDraftContext(brief) {
  return {
    briefId: brief.id,
    areas: scopeTimeWorksheet.scopeTimeAreas(brief).map((area) => area.area),
    visualIds: (brief.photos || []).map((photo) => photo.id),
    signalCodes: (brief.scopeSignals || []).map((signal) => signal.code)
  };
}

function reviewDraftInput(form) {
  return {
    decision: form.elements.status.value,
    areaMinutes: [...form.querySelectorAll("[data-scope-time-area]")].map((input) => ({ area: input.dataset.scopeTimeArea, minutes: input.value })),
    overheadMinutes: form.elements.scopeOverheadMinutes?.value || "",
    confidence: form.elements.scopeConfidence.value,
    note: form.elements.note.value
  };
}

function enhanceScanReviewDraft(brief, form, syncEstimateFields) {
  if (!scanReviewDraft) return;
  const context = reviewDraftContext(brief);
  const status = document.createElement("div");
  status.className = "application-draft-status review-draft-status";
  status.setAttribute("role", "status");
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "Private review draft protection is on";
  const detail = document.createElement("span");
  detail.textContent = "Room timings, confidence and note stay in this tab for 30 minutes. Evidence confirmations are never restored.";
  copy.append(title, detail);
  const discard = document.createElement("button");
  discard.type = "button";
  discard.className = "text-button";
  discard.textContent = "Discard saved timings and note";
  discard.hidden = true;
  status.append(copy, discard);
  form.prepend(status);
  let saveTimer = null;
  let submitted = false;
  let restored = false;

  function hasContent() {
    const input = reviewDraftInput(form);
    return input.decision === "needs-revision" || input.areaMinutes.some((row) => row.minutes !== "") || input.overheadMinutes !== "" || input.confidence !== "" || input.note.trim() !== "";
  }

  function render() {
    discard.hidden = !hasContent();
    if (restored) {
      title.textContent = "Your manual review inputs were recovered";
      detail.textContent = "Re-open every visual and repeat every checklist and price-sensitive confirmation before approval.";
    } else {
      title.textContent = "Private review draft protection is on";
      detail.textContent = "Room timings, confidence and note stay in this tab for 30 minutes. Evidence confirmations are never restored.";
    }
  }

  function save() {
    clearTimeout(saveTimer);
    if (submitted) return;
    try { scanReviewDraft.saveScanReviewDraft(window.sessionStorage, context, reviewDraftInput(form)); } catch {}
    if (!hasContent()) restored = false;
    render();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
    render();
  }

  let draft = null;
  try { draft = scanReviewDraft.readScanReviewDraft(window.sessionStorage, context); } catch {}
  if (draft) {
    form.elements.status.value = draft.values.decision;
    draft.values.areaMinutes.forEach((row) => {
      const input = [...form.querySelectorAll("[data-scope-time-area]")].find((candidate) => candidate.dataset.scopeTimeArea === row.area);
      if (input) input.value = row.minutes;
    });
    form.elements.scopeOverheadMinutes.value = draft.values.overheadMinutes;
    form.elements.scopeConfidence.value = draft.values.confidence;
    form.elements.note.value = draft.values.note;
    restored = true;
  }

  form.addEventListener("input", scheduleSave);
  form.addEventListener("change", scheduleSave);
  discard.addEventListener("click", () => {
    clearTimeout(saveTimer);
    try { scanReviewDraft.clearScanReviewDraft(window.sessionStorage, context); } catch {}
    form.elements.status.value = "reviewed";
    form.querySelectorAll("[data-scope-time-area]").forEach((input) => { input.value = ""; });
    form.elements.scopeOverheadMinutes.value = "";
    form.elements.scopeConfidence.value = "";
    form.elements.note.value = "";
    restored = false;
    syncEstimateFields();
    render();
    form.querySelector("[data-scope-time-area]")?.focus();
  });
  scanReviewDraftControls.set(form, {
    complete() {
      clearTimeout(saveTimer);
      submitted = true;
      try { scanReviewDraft.clearScanReviewDraft(window.sessionStorage, context); } catch {}
      status.hidden = true;
    }
  });
  syncEstimateFields();
  render();
}

async function changeBriefStatus(brief, form) {
  const select = form.elements.status;
  const note = form.elements.note;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const timeEvidence = readReviewTimeBreakdown(brief, form);
    const response = await fetch("/api/admin/job-briefs/status", {
      method: "PATCH",
      headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }),
      body: JSON.stringify({ briefId: brief.id, status: select.value, note: note.value.trim(), scopeEstimateHours: form.elements.scopeEstimateHours.value, scopeTimeBreakdown: select.value === "reviewed" && timeEvidence.valid ? timeEvidence.breakdown : null, scopeConfidence: form.elements.scopeConfidence.value, scopeSignalConfirmations: [...form.querySelectorAll('input[name="scopeSignalConfirmation"]:checked')].map((input) => input.value), visualsReviewed: form.elements.visualsReviewed.checked, reviewedVisualIds: [...form.closest(".brief-summary").querySelectorAll("[data-reviewed-visual-id]:checked")].map((input) => input.value), checklistReviewed: form.elements.checklistReviewed.checked })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Job brief review could not be saved.");
    scanReviewDraftControls.get(form)?.complete();
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
  if (!record.profileStarter?.captured) {
    addText(panel, "p", "Professional profile incomplete: the Cleaner must finish it through their private tracker before all screening checks can be recorded as complete.", "screening-note");
  }
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

async function decideCleanerAvailabilityRequest(requestItem, form) {
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/cleaner-availability-requests", {
      method: "PATCH",
      headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }),
      body: JSON.stringify({ requestId: requestItem.id, decision: form.elements.decision.value, note: form.elements.note.value.trim() })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Cleaner availability request could not be decided.");
    await loadRecords();
  } catch (error) {
    showAdminError(error.message);
    button.disabled = false;
  }
}

function availabilityField(labelText, name, type, value = "") {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText));
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.required = true;
  input.value = value;
  if (type === "date") {
    const now = new Date();
    input.min = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10);
  }
  label.append(input);
  return label;
}

function buildCleanerAvailability(record) {
  const slots = record.cleanerAvailability || [];
  const requests = record.availabilityRequests || [];
  const panel = document.createElement("details");
  panel.className = `cleaner-availability${slots.length ? " availability-confirmed" : ""}`;
  const summary = document.createElement("summary");
  summary.textContent = `Availability · ${requests.length} pending · ${slots.length} confirmed`;
  const guidance = document.createElement("p");
  guidance.textContent = "A cleaner-submitted time stays pending until it is reviewed here. Only a confirmed window can be used for matching; withdrawal immediately closes affected decisions and bookings.";
  panel.append(summary, guidance);
  if (record.firstAvailableDate && record.firstAvailableStartTime && record.firstAvailableEndTime) {
    const applicationWindow = document.createElement("div");
    applicationWindow.className = "availability-item availability-request-item";
    addText(applicationWindow, "strong", `First window supplied with application · ${record.firstAvailableDate} · ${record.firstAvailableStartTime}-${record.firstAvailableEndTime}`);
    addText(applicationWindow, "span", "Unconfirmed — verify directly before recording it below. It is not available to matching.");
    panel.append(applicationWindow);
  }

  if (requests.length) {
    const requestList = document.createElement("div");
    requestList.className = "availability-list availability-request-list";
    for (const requestItem of requests) {
      const item = document.createElement("section");
      item.className = "availability-item availability-request-item";
      addText(item, "strong", `Cleaner submitted · ${requestItem.availableDate} · ${requestItem.startTime}-${requestItem.endTime}`);
      if (requestItem.note) addText(item, "span", `Cleaner note: ${requestItem.note}`);
      addText(item, "span", "Pending only — not available to matching.");
      const form = document.createElement("form");
      form.className = "availability-request-form";
      const decision = document.createElement("select");
      decision.name = "decision";
      decision.setAttribute("aria-label", `Decision for ${requestItem.availableDate} ${requestItem.startTime}-${requestItem.endTime}`);
      for (const [value, label] of [["confirmed", "Confirm exact window"], ["declined", "Decline request"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        decision.append(option);
      }
      const note = document.createElement("input");
      note.name = "note";
      note.required = true;
      note.minLength = 10;
      note.maxLength = 500;
      note.placeholder = "Verification or decline reason";
      note.setAttribute("aria-label", `Decision note for ${requestItem.availableDate}`);
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "button button-small";
      save.textContent = "Record decision";
      form.append(decision, note, save);
      form.addEventListener("submit", (event) => { event.preventDefault(); decideCleanerAvailabilityRequest(requestItem, form); });
      item.append(form);
      requestList.append(item);
    }
    panel.append(requestList);
  }

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
      availabilityField("Available date", "availableDate", "date", record.firstAvailableDate),
      availabilityField("Start time", "startTime", "time", record.firstAvailableStartTime),
      availabilityField("End time", "endTime", "time", record.firstAvailableEndTime)
    );
    const noteLabel = document.createElement("label");
    noteLabel.append(document.createTextNode("Confirmation note"));
    const note = document.createElement("input");
    note.name = "confirmationNote";
    note.required = true;
    note.minLength = 10;
    note.maxLength = 500;
    note.placeholder = "How and when this exact window was re-confirmed";
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
  card.id = `record-${record.id}`;
  if (record.dispatchActions?.some((action) => action.severity === "urgent")) card.classList.add("lead-urgent");

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

  if (record.dispatchActions?.length) {
    const actionPanel = document.createElement("div");
    actionPanel.className = "record-actions";
    for (const action of record.dispatchActions) {
      const item = document.createElement("div");
      item.className = `record-action record-action-${action.severity}`;
      addText(item, "strong", action.title);
      addText(item, "span", action.detail);
      actionPanel.append(item);
    }
    card.append(actionPanel);
  }

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
    addDetail(details, "Private profile introduction", record.professionalBio);
    addDetail(details, "Languages", Array.isArray(record.languages) ? record.languages.join(", ") : "");
    addDetail(details, "Equipment and products", record.profileStarter?.equipmentPlanLabel);
    addDetail(details, "Profile use", record.profileStarter?.captured ? "Applicant supplied · private and unverified" : "Incomplete · do not publish");
    addDetail(details, "Availability", record.availability);
    addDetail(details, "First exact window", record.firstAvailableDate && record.firstAvailableStartTime && record.firstAvailableEndTime ? `${record.firstAvailableDate} · ${record.firstAvailableStartTime}-${record.firstAvailableEndTime} · unconfirmed` : "Not supplied");
    addDetail(details, "Transport", record.transport);
    addDetail(details, "Services", Array.isArray(record.services) ? record.services.join(", ") : "");
    addDetail(details, "Notes", record.notes);
  }
  card.append(details);

  const requestFollowupPanel = buildRequestFollowupPanel(record);
  if (requestFollowupPanel) card.append(requestFollowupPanel);

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
    const videoCount = brief.photos.filter((photo) => photo.kind === "video").length;
    summary.textContent = `Room scan · ${brief.checklist.length} tasks · ${brief.photos.length} visuals${videoCount ? ` · ${videoCount} videos` : ""}`;
    addText(briefSummary, "strong", `${brief.id} · ${briefStatusLabels[brief.status] || brief.status}`);
    addText(briefSummary, "span", brief.cleanerPhotoSharingConsent === true ? "Customer authorised private room-media review by the selected cleaner before booking." : "Room photos and videos remain Tideway-only until a booking is confirmed.");
    addText(briefSummary, "span", brief.customerScopeConfirmed === true ? "Customer confirmed that the final concise checklist includes every task they want quoted." : "Customer scope-completeness confirmation is missing.", brief.customerScopeConfirmed === true ? "brief-review-note" : "scope-signal-summary");
    const tasks = document.createElement("ul");
    brief.checklist.forEach((task) => addText(tasks, "li", task));
    briefSummary.append(summary, tasks);
    if (brief.scopeSignals?.length) {
      const scopeSignalSummary = document.createElement("div");
      scopeSignalSummary.className = "scope-signal-summary";
      addText(scopeSignalSummary, "strong", "Price-sensitive scope detected");
      addText(scopeSignalSummary, "span", "Detected from the transcript, checklist or photo notes. This is a review warning, not an automatic price.");
      const signalList = document.createElement("ul");
      brief.scopeSignals.forEach((signal) => addText(signalList, "li", signal.label));
      scopeSignalSummary.append(signalList);
      briefSummary.append(scopeSignalSummary);
    }
    let photoGrid = null;
    if (brief.photos.length) {
      const loadPhotos = document.createElement("button");
      loadPhotos.type = "button";
      loadPhotos.className = "button button-small button-outline";
      loadPhotos.textContent = "Load private room visuals";
      photoGrid = document.createElement("div");
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
      for (const [value, label] of [["reviewed", "Approve reviewed scope"], ["needs-revision", "Request a new brief"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        statusSelect.append(option);
      }
      statusLabel.append(statusSelect);
      const timeFieldset = document.createElement("fieldset");
      timeFieldset.className = "scope-time-worksheet";
      const timeLegend = document.createElement("legend");
      timeLegend.textContent = "Room-by-room cleaning time";
      const timeHelp = document.createElement("p");
      timeHelp.textContent = "Enter your own reviewed minutes for every room. Tideway totals and rounds up to the next quarter-hour; it never estimates the rooms for you.";
      timeFieldset.append(timeLegend, timeHelp);
      scopeTimeWorksheet.scopeTimeAreas(brief).forEach((area) => {
        const label = document.createElement("label");
        label.className = "scope-time-row";
        const copy = document.createElement("span");
        copy.textContent = `${area.area} · ${area.taskCount} cleaning ${area.taskCount === 1 ? "task" : "tasks"} · ${area.visualCount} ${area.visualCount === 1 ? "visual" : "visuals"}`;
        const input = document.createElement("input");
        input.type = "number";
        input.min = "5";
        input.max = "720";
        input.step = "5";
        input.inputMode = "numeric";
        input.required = true;
        input.dataset.scopeTimeArea = area.area;
        input.setAttribute("aria-label", `${area.area} reviewed cleaning minutes`);
        const unit = document.createElement("small");
        unit.textContent = "minutes";
        label.append(copy, input, unit);
        timeFieldset.append(label);
      });
      const overheadLabel = document.createElement("label");
      overheadLabel.className = "scope-time-row";
      const overheadCopy = document.createElement("span");
      overheadCopy.textContent = "Visit preparation, packing and final quality check";
      const overhead = document.createElement("input");
      overhead.type = "number";
      overhead.name = "scopeOverheadMinutes";
      overhead.min = "0";
      overhead.max = "240";
      overhead.step = "5";
      overhead.inputMode = "numeric";
      overhead.required = true;
      const overheadUnit = document.createElement("small");
      overheadUnit.textContent = "minutes";
      overheadLabel.append(overheadCopy, overhead, overheadUnit);
      const timeSummary = document.createElement("div");
      timeSummary.className = "scope-time-total";
      timeSummary.setAttribute("role", "status");
      timeSummary.textContent = "Enter every room and the visit overhead to calculate reviewed hours.";
      timeFieldset.append(overheadLabel, timeSummary);
      const hoursLabel = document.createElement("label");
      hoursLabel.append(document.createTextNode("Calculated reviewed cleaning hours"));
      const hours = document.createElement("input");
      hours.name = "scopeEstimateHours";
      hours.type = "number";
      hours.min = "0.5";
      hours.max = "16";
      hours.step = "0.25";
      hours.required = true;
      hours.readOnly = true;
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
      const signalFieldset = document.createElement("fieldset");
      signalFieldset.className = "scope-signal-confirmations";
      const signalLegend = document.createElement("legend");
      signalLegend.textContent = "Price-sensitive scope included in reviewed hours";
      signalFieldset.append(signalLegend);
      if (brief.scopeSignals?.length) {
        brief.scopeSignals.forEach((signal) => {
          const label = document.createElement("label");
          label.className = "checkbox";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.name = "scopeSignalConfirmation";
          input.value = signal.code;
          const copy = document.createElement("span");
          copy.textContent = `${signal.label} is included in the reviewed hours`;
          label.append(input, copy);
          signalFieldset.append(label);
        });
      } else {
        addText(signalFieldset, "span", "No price-sensitive extras were detected in this scan.");
      }
      const evidenceFieldset = document.createElement("fieldset");
      evidenceFieldset.className = "scope-signal-confirmations";
      const evidenceLegend = document.createElement("legend");
      evidenceLegend.textContent = "Founder review evidence";
      evidenceFieldset.append(evidenceLegend);
      const visualEvidenceLabel = document.createElement("label");
      visualEvidenceLabel.className = "checkbox";
      const visualsReviewed = document.createElement("input");
      visualsReviewed.type = "checkbox";
      visualsReviewed.name = "visualsReviewed";
      visualsReviewed.disabled = true;
      const visualEvidenceCopy = document.createElement("span");
      visualEvidenceCopy.textContent = "I opened every private room visual and reviewed its room note";
      visualEvidenceLabel.append(visualsReviewed, visualEvidenceCopy);
      const checklistEvidenceLabel = document.createElement("label");
      checklistEvidenceLabel.className = "checkbox";
      const checklistReviewed = document.createElement("input");
      checklistReviewed.type = "checkbox";
      checklistReviewed.name = "checklistReviewed";
      const checklistEvidenceCopy = document.createElement("span");
      checklistEvidenceCopy.textContent = "I checked the concise checklist against the spoken notes, room notes and shown rooms";
      checklistEvidenceLabel.append(checklistReviewed, checklistEvidenceCopy);
      evidenceFieldset.append(visualEvidenceLabel, checklistEvidenceLabel);
      photoGrid?.addEventListener("brief-visuals-loaded", () => {
        syncEstimateFields();
      });
      photoGrid?.addEventListener("brief-visual-review-progress", () => {
        syncEstimateFields();
      });
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "button button-small";
      const readiness = document.createElement("div");
      readiness.className = "brief-review-readiness";
      readiness.setAttribute("role", "status");
      const readinessTitle = document.createElement("strong");
      const readinessHint = document.createElement("span");
      const readinessList = document.createElement("ul");
      readiness.append(readinessTitle, readinessHint, readinessList);
      save.textContent = "Complete evidence to approve";
      const syncEstimateFields = () => {
        const approving = statusSelect.value === "reviewed";
        timeFieldset.querySelectorAll("input").forEach((input) => { input.disabled = !approving; });
        const timeEvidence = readReviewTimeBreakdown(brief, reviewForm);
        hours.value = approving && timeEvidence.valid ? String(timeEvidence.breakdown.roundedHours) : "";
        timeSummary.textContent = timeEvidence.valid
          ? `${timeEvidence.breakdown.totalMinutes} reviewed minutes · ${timeEvidence.breakdown.roundedHours} hours after safe quarter-hour rounding.`
          : (timeEvidence.errors[0] || "Enter every room and the visit overhead to calculate reviewed hours.");
        timeSummary.classList.toggle("scope-time-total-ready", approving && timeEvidence.valid);
        hours.disabled = !approving;
        hours.required = approving;
        confidence.disabled = !approving;
        confidence.required = approving;
        signalFieldset.querySelectorAll("input").forEach((input) => {
          input.disabled = !approving;
          input.required = approving;
        });
        const everyVisualConfirmed = photoGrid?.dataset.reviewComplete === "true";
        visualsReviewed.disabled = !approving || !everyVisualConfirmed;
        if (!everyVisualConfirmed) visualsReviewed.checked = false;
        visualsReviewed.required = approving;
        checklistReviewed.disabled = !approving;
        checklistReviewed.required = approving;
        const result = scanReviewWorkspace.scanReviewReadiness({
          decision: statusSelect.value,
          customerScopeConfirmed: brief.customerScopeConfirmed === true,
          visualIds: brief.photos.map((photo) => photo.id),
          reviewedVisualIds: [...briefSummary.querySelectorAll("[data-reviewed-visual-id]:checked")].map((input) => input.value),
          visualsReviewed: visualsReviewed.checked,
          checklistReviewed: checklistReviewed.checked,
          scopeSignalCodes: (brief.scopeSignals || []).map((signal) => signal.code),
          confirmedScopeSignalCodes: [...reviewForm.querySelectorAll('input[name="scopeSignalConfirmation"]:checked')].map((input) => input.value),
          timeBreakdownValid: timeEvidence.valid,
          hours: hours.value,
          confidence: confidence.value,
          note: note.value
        });
        readinessTitle.textContent = result.ready ? "Review evidence complete" : `${result.completed} of ${result.total} review checks complete`;
        readinessHint.textContent = approving
          ? "No scope is approved automatically. Complete each item from the evidence you actually reviewed."
          : "A clear revision note is required; no estimate or visual approval will be recorded.";
        readinessList.replaceChildren();
        result.steps.forEach((step) => {
          const item = document.createElement("li");
          item.textContent = step.label;
          item.className = step.complete ? "review-ready" : "";
          readinessList.append(item);
        });
        save.disabled = !result.ready;
        save.textContent = result.ready ? (approving ? "Approve reviewed scope" : "Request revised scan") : (approving ? "Complete evidence to approve" : "Add a clear revision note");
      };
      statusSelect.addEventListener("change", syncEstimateFields);
      reviewForm.addEventListener("input", syncEstimateFields);
      reviewForm.addEventListener("change", syncEstimateFields);
      reviewForm.append(statusLabel, timeFieldset, hoursLabel, confidenceLabel, signalFieldset, evidenceFieldset, noteLabel, readiness, save);
      enhanceScanReviewDraft(brief, reviewForm, syncEstimateFields);
      reviewForm.addEventListener("submit", (event) => { event.preventDefault(); changeBriefStatus(brief, reviewForm); });
      briefSummary.append(reviewForm);
    } else {
      if (brief.status === "reviewed") {
        addText(briefSummary, "span", `Reviewed scope: ${brief.scopeEstimateHours} hours · ${brief.scopeConfidence} confidence`, "brief-review-note");
        if (brief.scopeTimeEvidenceConfirmed && brief.scopeTimeBreakdown?.areas?.length) {
          const timeEvidenceList = document.createElement("ul");
          timeEvidenceList.className = "scope-time-evidence-list";
          brief.scopeTimeBreakdown.areas.forEach((row) => addText(timeEvidenceList, "li", `${row.area}: ${row.minutes} minutes`));
          addText(timeEvidenceList, "li", `Preparation and quality check: ${brief.scopeTimeBreakdown.overheadMinutes} minutes`);
          briefSummary.append(timeEvidenceList);
        } else {
          addText(briefSummary, "span", "Room-by-room time evidence is missing; downstream use remains blocked.", "scope-signal-summary");
        }
        addText(briefSummary, "span", brief.reviewEvidenceConfirmed === true ? "Founder opened every room visual and note, then reconciled the concise checklist." : "Founder visual-and-checklist review evidence is missing; downstream use remains blocked.", brief.reviewEvidenceConfirmed === true ? "brief-review-note" : "scope-signal-summary");
        if (brief.scopeSignals?.length) addText(briefSummary, "span", `Confirmed inside reviewed hours: ${brief.scopeSignals.map((signal) => signal.label).join(", ")}`, "brief-review-note");
      }
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
    addText(proposalSummary, "span", `${money.format(proposal.nonCleanerCosts ?? proposal.otherCosts ?? 0)} planned non-cleaner costs: ${money.format(proposal.labourOnCosts || 0)} labour on-costs · ${money.format(proposal.paymentFees || 0)} payment fees · ${money.format(proposal.travelCosts || 0)} travel · ${money.format(proposal.suppliesCosts || 0)} supplies · ${money.format(proposal.riskContingency || 0)} risk · ${money.format(proposal.otherCosts || 0)} additional`);
    if (proposal.replacement) {
      const replacementAudit = document.createElement("div");
      replacementAudit.className = "replacement-audit";
      addText(replacementAudit, "strong", `Replacement for ${proposal.replacement.previousReference}`);
      addText(replacementAudit, "span", proposal.replacement.previousCustomerAccepted ? "The earlier customer acceptance remains recorded but cannot carry forward. A fresh customer decision is required." : "The earlier offer remains in the audit trail. A fresh customer decision is required.");
      if (proposal.replacement.changes?.length) {
        const changes = document.createElement("ul");
        proposal.replacement.changes.forEach((change) => addText(changes, "li", change.label));
        replacementAudit.append(changes);
      }
      proposalSummary.append(replacementAudit);
    }
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
      addText(quoteLink, "strong", "Local customer decision preview");
      addText(quoteLink, "span", proposal.status === "ready"
        ? "Preview on this computer only. No customer handoff link is shown until the offer is recorded as sent."
        : "Open locally for audit only. Use the recipient-isolated dispatch pack below for the verified public customer handoff.");
      addLocalAuditPreview(quoteLink, "Open local customer preview", `/quote#${encodeURIComponent(proposal.reviewToken)}`);
    }
    const cleanerLink = document.createElement("div");
    cleanerLink.className = "quote-review-link cleaner-review-link";
    if (proposal.cleanerReviewToken && ["ready", "sent", "accepted", "declined"].includes(proposal.status)) {
      const cleanerDecision = proposal.cleanerDecision?.status;
      addText(cleanerLink, "strong", cleanerDecision === "accepted" ? "Cleaner accepted this opportunity" : cleanerDecision === "declined" ? "Cleaner declined this opportunity" : "Local cleaner decision preview");
      addText(cleanerLink, "span", proposal.status === "ready"
        ? "Preview on this computer only. No cleaner handoff link is shown until the offer is recorded as sent."
        : cleanerDecision
          ? `Decision recorded ${formatDate(proposal.cleanerDecision.updatedAt)}. Open locally for audit only; the decision is read-only.`
          : "Open locally for audit only. Use the recipient-isolated dispatch pack below for the verified public cleaner handoff.");
      addLocalAuditPreview(cleanerLink, "Open local cleaner preview", `/opportunity#${encodeURIComponent(proposal.cleanerReviewToken)}`);
    }
    const draftDetails = document.createElement("details");
    draftDetails.className = "message-drafts";
    const draftSummary = document.createElement("summary");
    draftSummary.textContent = proposal.status === "ready" ? "Review messages before an approved send" : "Open the recipient-isolated dispatch pack";
    const loadDraftButton = document.createElement("button");
    loadDraftButton.type = "button";
    loadDraftButton.className = "button button-small button-light";
    loadDraftButton.textContent = proposal.status === "ready" ? "Prepare review-only drafts" : "Load controlled handoff status";
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
    if (record.nextActionAt) addText(activitySummary, "span", `Next action: ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }).format(new Date(`${record.nextActionAt}T12:00:00`))}`, "next-action");
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
  const filtered = state.records.filter((record) => (state.kind === "all" || record.kind === state.kind) && (state.status === "all" || record.status === state.status) && actionMatchesFilter(record));
  leadList.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    addText(empty, "strong", state.records.length ? "No leads match this filter." : "No pilot leads yet.");
    addText(empty, "span", state.records.length ? "Try another lead type, status or founder-action filter." : "Customer requests and cleaner applications will appear here automatically.");
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
    state.dispatchSummary = result.dispatchSummary || {};
    state.launchFunnel = result.launchFunnel || null;
    updateStats();
    renderLaunchFunnel();
    renderDispatchQueue();
    renderScanReviewWorkspace();
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

document.querySelector("#action-filter").addEventListener("change", (event) => {
  state.action = event.target.value;
  renderRecords();
});

refreshButton.addEventListener("click", loadRecords);
document.querySelector("#refresh-media-retention").addEventListener("click", loadMediaRetention);
document.querySelector("#refresh-data-integrity").addEventListener("click", loadDataIntegrity);

document.querySelector("#admin-auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminKey = adminKeyField.value;
  sessionStorage.setItem("tidewayAdminKey", adminKey);
  await Promise.all([loadRecords(), loadConfig(), loadMediaRetention(), loadDataIntegrity()]);
});

document.querySelector("#business-config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const resultPanel = document.querySelector("#config-result");
  const previewPanel = document.querySelector("#config-preview-result");
  button.disabled = true;
  resultPanel.hidden = true;
  previewPanel.hidden = true;
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

const configForm = document.querySelector("#business-config-form");
const configPreviewButton = document.querySelector("#config-preview-button");
const configPreviewPanel = document.querySelector("#config-preview-result");

function renderConfigPreview(result, valid) {
  const title = configPreviewPanel.querySelector("[data-config-preview-title]");
  const summary = configPreviewPanel.querySelector("[data-config-preview-summary]");
  const list = configPreviewPanel.querySelector("[data-config-preview-list]");
  const areaLabels = { identity: "Legal identity", contact: "Contact and public site", pilotArea: "Pilot area", economics: "Pricing and pay", insurance: "Insurance evidence", payments: "Payment readiness", operatingRules: "Operating rules" };
  configPreviewPanel.classList.toggle("config-preview-invalid", !valid);
  title.textContent = valid ? `${result.readiness.completed} of ${result.readiness.total} areas would be ready` : "Readiness rehearsal found invalid inputs";
  summary.textContent = valid
    ? (result.readiness.ready ? "All seven areas pass the current rules, but nothing has been saved or approved for launch." : "Nothing has been saved. Complete the items below before relying on these settings.")
    : "Nothing has been saved. Correct these validation errors before checking readiness again.";
  const entries = valid
    ? Object.entries(result.readiness.missing || {}).filter(([, missing]) => missing.length).map(([key, missing]) => `${areaLabels[key] || key}: ${missing.join(", ")}`)
    : (result.errors || []);
  list.replaceChildren(...entries.map((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    return item;
  }));
  configPreviewPanel.hidden = false;
  configPreviewPanel.focus();
}

configPreviewButton.addEventListener("click", async () => {
  configPreviewButton.disabled = true;
  document.querySelector("#config-result").hidden = true;
  try {
    const body = Object.fromEntries(new FormData(configForm).entries());
    const response = await fetch("/api/admin/config/preview", { method: "POST", headers: adminHeaders({ "Content-Type": "application/json", "Accept": "application/json" }), body: JSON.stringify(body) });
    const result = await response.json();
    if (response.status === 401) { showAuth(); return; }
    if (!result.readiness || (!response.ok && !Array.isArray(result.errors))) throw new Error(result.error || "Launch details could not be checked.");
    renderConfigPreview(result, response.ok && result.ok);
  } catch (error) {
    showAdminError(error.message);
  } finally {
    configPreviewButton.disabled = false;
  }
});

configForm.addEventListener("input", () => { configPreviewPanel.hidden = true; });
configForm.addEventListener("change", () => { configPreviewPanel.hidden = true; });

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
  const labourOnCostPercent = Math.max(0, Number(state.config.labourOnCostPercent) || 0);
  const paymentFeePercent = Math.max(0, Number(state.config.paymentFeePercent) || 0);
  const paymentFeeFixed = Math.max(0, Number(state.config.paymentFeeFixed) || 0);
  const travelCosts = Math.max(0, Number(state.config.travelCostPerJob) || 0);
  const suppliesCosts = Math.max(0, Number(state.config.suppliesCostPerJob) || 0);
  const riskContingencyPercent = Math.max(0, Number(state.config.riskContingencyPercent) || 0);
  const labourOnCosts = cleanerPay * labourOnCostPercent / 100;
  const paymentFees = customerTotal * paymentFeePercent / 100 + paymentFeeFixed;
  const riskContingency = customerTotal * riskContingencyPercent / 100;
  const includedCosts = labourOnCosts + paymentFees + travelCosts + suppliesCosts + riskContingency + additionalCosts;
  const contribution = customerTotal - cleanerPay - includedCosts;
  const margin = customerTotal ? (contribution / customerTotal) * 100 : 0;
  document.querySelector("#quote-total").textContent = money.format(customerTotal);
  document.querySelector("#quote-pay").textContent = money.format(cleanerPay);
  document.querySelector("#quote-contribution").textContent = money.format(contribution);
  document.querySelector("#quote-margin").textContent = `${margin.toFixed(1)}%`;
  document.querySelector("#quote-included-costs").textContent = state.config.variableCostsConfirmed
    ? `${money.format(includedCosts)} · ${money.format(labourOnCosts)} labour on-cost · ${money.format(paymentFees)} fees · ${money.format(travelCosts)} travel · ${money.format(suppliesCosts)} supplies · ${money.format(riskContingency)} risk`
    : "Confirm cost assumptions";

  const guidance = document.querySelector("#quote-guidance");
  const minimumMargin = Math.max(0, Number(state.config.minimumContributionMarginPercent) || 0);
  const minimumHours = Math.max(0, Number(state.config.minimumHours) || 0);
  const variableCostRate = (paymentFeePercent + riskContingencyPercent) / 100;
  const targetFactor = minimumMargin > 0 && minimumMargin < 100 ? 1 - variableCostRate - (minimumMargin / 100) : 0;
  const fixedCosts = cleanerPay + labourOnCosts + additionalCosts + paymentFeeFixed + travelCosts + suppliesCosts;
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
    guidance.textContent = "Review and confirm the labour on-cost, payment, travel, supplies and risk assumptions before approving a quote.";
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
    guidance.textContent = `This quote meets the ${minimumMargin.toFixed(1)}% contribution-margin floor after the confirmed labour on-cost, payment, travel, supplies, risk and additional job costs. The calculated minimum is ${money.format(requiredTotal)} total (${money.format(requiredRate)}/hour), before central admin, tax and unmodelled overheads.`;
    guidance.classList.add("quote-positive");
  }
}

quoteFields.forEach((field) => field.addEventListener("input", updateQuoteCalculator));
Promise.all([loadRecords(), loadConfig(), loadMediaRetention(), loadDataIntegrity()]);
