import { newSubmissionKey } from "./submission-key.js";

const token = location.hash.slice(1);
if (token) history.replaceState(null, "", `${location.pathname}${location.search}`);

const loading = document.querySelector("#cleaner-status-loading");
const errorState = document.querySelector("#cleaner-status-error");
const content = document.querySelector("#cleaner-status-content");
const refresh = document.querySelector("[data-refresh]");
const availabilityAction = document.querySelector("[data-availability-action]");
const availabilityForm = document.querySelector("[data-availability-form]");
const availabilityMessage = document.querySelector("[data-availability-message]");
const pendingAvailability = document.querySelector("[data-pending-availability]");
const pendingList = document.querySelector("[data-pending-list]");
let availabilitySubmissionKey = newSubmissionKey();

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

function renderStatus(result) {
  loading.hidden = true;
  errorState.hidden = true;
  content.hidden = false;
  refresh.hidden = false;
  setText("[data-headline]", result.current.headline);
  setText("[data-next-action]", result.current.nextAction);
  setText("[data-reference]", result.application.reference);
  const firstAvailability = result.application.firstAvailability;
  setText("[data-first-availability]", firstAvailability ? `${firstAvailability.availableDate} · ${firstAvailability.startTime}-${firstAvailability.endTime} · awaiting verification` : "Not supplied");

  const timeline = document.querySelector("[data-timeline]");
  timeline.replaceChildren();
  for (const step of result.steps) {
    const item = document.createElement("li");
    item.className = `request-step request-step-${step.state}`;
    const marker = document.createElement("span");
    marker.textContent = step.state === "complete" ? "✓" : step.state === "current" ? "•" : "–";
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

  const readiness = document.querySelector("[data-readiness]");
  readiness.replaceChildren();
  const items = [
    result.readiness.firstAvailabilityCaptured ? "One exact first-available window was captured with the application; it is not yet confirmed for matching." : "No first-available window was captured with this application.",
    result.readiness.screeningComplete ? "Required screening checks are recorded." : "Screening checks are not yet complete.",
    result.readiness.approvalRecorded ? "The application is currently approved." : "No current approval is recorded.",
    result.readiness.confirmedAvailabilityWindows > 0
      ? `${result.readiness.confirmedAvailabilityWindows} future availability ${result.readiness.confirmedAvailabilityWindows === 1 ? "window is" : "windows are"} confirmed.`
      : "No future availability is currently confirmed for matching."
  ];
  for (const value of items) {
    const item = document.createElement("li");
    item.textContent = value;
    readiness.append(item);
  }

  const pending = result.availabilityRequests || [];
  availabilityAction.hidden = !result.links?.availabilitySubmissionAllowed;
  pendingAvailability.hidden = pending.length === 0;
  pendingList.replaceChildren();
  for (const request of pending) {
    const item = document.createElement("li");
    item.textContent = `${request.availableDate} · ${request.startTime}-${request.endTime} · pending`;
    pendingList.append(item);
  }
  if (result.links?.availabilitySubmissionAllowed && firstAvailability && pending.length === 0 && result.readiness.confirmedAvailabilityWindows === 0) {
    availabilityForm.elements.availableDate.value = firstAvailability.availableDate;
    availabilityForm.elements.startTime.value = firstAvailability.startTime;
    availabilityForm.elements.endTime.value = firstAvailability.endTime;
  }
}

async function loadStatus() {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return showError("This private cleaner tracker link is incomplete or invalid.");
  refresh.disabled = true;
  try {
    const response = await fetch("/api/cleaner-status", { headers: { "Accept": "application/json", "X-Cleaner-Status-Token": token } });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "The cleaner application status could not be loaded.");
    renderStatus(result);
  } catch (error) {
    showError(error.message);
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", loadStatus);
availabilityForm.elements.availableDate.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10);
availabilityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = availabilityForm.querySelector("button");
  button.disabled = true;
  availabilityMessage.textContent = "Submitting your time…";
  try {
    const body = Object.fromEntries(new FormData(availabilityForm).entries());
    const response = await fetch("/api/cleaner-availability-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Cleaner-Status-Token": token, "Idempotency-Key": availabilitySubmissionKey },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Your availability could not be submitted.");
    availabilityForm.reset();
    availabilitySubmissionKey = newSubmissionKey();
    availabilityMessage.textContent = result.message;
    await loadStatus();
  } catch (error) {
    availabilityMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
loadStatus();
