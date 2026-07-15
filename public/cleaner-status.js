const token = location.hash.slice(1);
if (token) history.replaceState(null, "", `${location.pathname}${location.search}`);

const loading = document.querySelector("#cleaner-status-loading");
const errorState = document.querySelector("#cleaner-status-error");
const content = document.querySelector("#cleaner-status-content");
const refresh = document.querySelector("[data-refresh]");

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
loadStatus();
