const token = location.hash.slice(1);
if (token) history.replaceState(null, "", location.pathname);

const loading = document.querySelector("#status-loading");
const errorState = document.querySelector("#status-error");
const content = document.querySelector("#status-content");
const refresh = document.querySelector("[data-refresh]");
const withdrawal = document.querySelector("[data-withdrawal]");
const withdrawalForm = document.querySelector("[data-withdrawal-form]");
const withdrawalError = document.querySelector("[data-withdrawal-error]");
const scheduleChange = document.querySelector("[data-schedule-change]");
const scheduleForm = document.querySelector("[data-schedule-form]");
const scheduleError = document.querySelector("[data-schedule-error]");
const scheduleHistory = document.querySelector("[data-schedule-history]");
const ukDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" });

document.querySelectorAll("[data-year]").forEach((element) => { element.textContent = String(new Date().getFullYear()); });

function setText(selector, value) {
  document.querySelector(selector).textContent = value || "—";
}

function showError(message) {
  loading.hidden = true;
  content.hidden = true;
  refresh.hidden = true;
  errorState.hidden = false;
  setText("[data-error-message]", message);
}

function actionLink(label, href, primary = false) {
  const link = document.createElement("a");
  link.className = primary ? "button" : "button button-outline";
  link.href = href;
  link.textContent = label;
  return link;
}

function preferredDateLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "Flexible date";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "Flexible date" : ukDate.format(parsed);
}

function renderStatus(result) {
  loading.hidden = true;
  errorState.hidden = true;
  content.hidden = false;
  refresh.hidden = false;
  setText("[data-headline]", result.current.headline);
  setText("[data-next-action]", result.current.nextAction);
  setText("[data-reference]", result.request.reference);
  setText("[data-service]", result.request.service);
  setText("[data-frequency]", result.request.frequency || "One-off");
  setText("[data-property]", `${result.request.propertyType} · ${result.request.siteSize}`);
  setText("[data-area]", result.request.outwardCode);
  setText("[data-preferred-date]", preferredDateLabel(result.request.preferredDate));
  setText("[data-preferred-time]", result.request.preferredTimeWindow || "Flexible");
  withdrawal.hidden = result.withdrawal?.allowed !== true;
  scheduleChange.hidden = result.scheduleChange?.allowed !== true;
  if (result.scheduleChange?.allowed) {
    scheduleForm.elements.preferredDate.min = result.scheduleChange.minimumDate || "";
    if (!scheduleForm.matches(":focus-within")) {
      scheduleForm.elements.preferredDate.value = result.request.preferredDate || "";
      scheduleForm.elements.preferredTimeWindow.value = result.request.preferredTimeWindow || "Flexible";
    }
    if (result.scheduleChange.required) scheduleChange.open = true;
  }
  const changes = result.scheduleChange?.history || [];
  scheduleHistory.replaceChildren();
  if (changes.length) {
    const title = document.createElement("strong");
    title.textContent = "Recorded timing changes";
    const list = document.createElement("ul");
    for (const change of changes) {
      const item = document.createElement("li");
      item.textContent = `${preferredDateLabel(change.preferredDate)} · ${change.preferredTimeWindow} · ${change.reason}`;
      list.append(item);
    }
    scheduleHistory.append(title, list);
    scheduleHistory.hidden = false;
  } else {
    scheduleHistory.hidden = true;
  }

  const timeline = document.querySelector("[data-timeline]");
  timeline.replaceChildren();
  for (const step of result.steps) {
    const item = document.createElement("li");
    item.className = `request-step request-step-${step.state}`;
    const marker = document.createElement("span");
    marker.textContent = step.state === "complete" ? "✓" : step.state === "action" ? "!" : "•";
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = step.label;
    const detail = document.createElement("small");
    detail.textContent = step.detail;
    copy.append(title, detail);
    item.append(marker, copy);
    timeline.append(item);
  }

  const scanSection = document.querySelector("[data-scan-summary]");
  if (result.roomScan) {
    const reviewed = result.roomScan.status === "reviewed";
    setText("[data-scan-detail]", reviewed
      ? `${result.roomScan.photoCount} photos · ${result.roomScan.taskCount} cleaner tasks · ${result.roomScan.reviewedHours} reviewed hours · ${result.roomScan.confidence} confidence`
      : `${result.roomScan.photoCount} photos · ${result.roomScan.taskCount} cleaner tasks · ${result.roomScan.status}`);
    const confirmedExtras = document.querySelector("[data-confirmed-extras]");
    confirmedExtras.hidden = !result.roomScan.confirmedExtras?.length;
    confirmedExtras.textContent = result.roomScan.confirmedExtras?.length ? `Included in the reviewed time: ${result.roomScan.confirmedExtras.join(", ")}.` : "";
    const revision = document.querySelector("[data-revision-note]");
    revision.hidden = !result.roomScan.revisionNote;
    revision.textContent = result.roomScan.revisionNote ? `Revision requested: ${result.roomScan.revisionNote}` : "";
    scanSection.hidden = false;
  } else {
    scanSection.hidden = true;
  }

  const actions = document.querySelector("[data-actions]");
  actions.replaceChildren();
  if (result.links.bookingToken) actions.append(actionLink("Open confirmed booking", `/booking-confirmation#${result.links.bookingToken}`, true));
  else if (result.links.quoteToken) actions.append(actionLink("Review private quote", `/quote#${result.links.quoteToken}`, true));
  if (result.links.roomScanRequired) actions.append(actionLink(result.roomScan?.status === "needs-revision" ? "Submit revised room scan" : "Complete room scan", `/brief?reference=${encodeURIComponent(result.request.reference)}#${token}`, !actions.children.length));
  if (!actions.children.length) {
    const waiting = document.createElement("p");
    waiting.textContent = "No customer action is currently required. Refresh this private page after Tideway records the next stage.";
    actions.append(waiting);
  }
}

async function loadStatus() {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return showError("This private tracker link is incomplete or invalid.");
  refresh.disabled = true;
  try {
    const response = await fetch("/api/request-status", { headers: { "Accept": "application/json", "X-Request-Token": token } });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "The request status could not be loaded.");
    renderStatus(result);
  } catch (error) {
    showError(error.message);
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", loadStatus);
scheduleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  scheduleError.hidden = true;
  if (!scheduleForm.reportValidity()) return;
  const button = scheduleForm.querySelector("button");
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Saving timing…";
  try {
    const response = await fetch("/api/request-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Request-Token": token },
      body: JSON.stringify({ preferredDate: scheduleForm.elements.preferredDate.value, preferredTimeWindow: scheduleForm.elements.preferredTimeWindow.value, reason: scheduleForm.elements.reason.value.trim(), confirmed: scheduleForm.elements.confirmed.checked })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "The requested timing could not be changed.");
    scheduleForm.elements.reason.value = "";
    scheduleForm.elements.confirmed.checked = false;
    await loadStatus();
  } catch (error) {
    scheduleError.textContent = error.message;
    scheduleError.hidden = false;
    scheduleError.focus();
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
});
withdrawalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  withdrawalError.hidden = true;
  if (!withdrawalForm.reportValidity()) return;
  const button = withdrawalForm.querySelector("button");
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Closing request…";
  try {
    const response = await fetch("/api/request-withdrawal", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Request-Token": token },
      body: JSON.stringify({ reason: withdrawalForm.elements.reason.value, note: withdrawalForm.elements.note.value.trim(), confirmed: withdrawalForm.elements.confirmed.checked })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "This request could not be closed.");
    withdrawalForm.reset();
    await loadStatus();
  } catch (error) {
    withdrawalError.textContent = error.message;
    withdrawalError.hidden = false;
    withdrawalError.focus();
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
});
loadStatus();
