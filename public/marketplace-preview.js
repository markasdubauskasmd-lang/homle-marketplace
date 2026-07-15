import { marketplaceTaskPreview } from "./marketplace-preview-model.js";

const tabs = [...document.querySelectorAll("[data-preview-tab]")];
const screens = [...document.querySelectorAll("[data-preview-screen]")];
const roleButtons = [...document.querySelectorAll("[data-preview-role]")];
const stateButtons = [...document.querySelectorAll("[data-preview-state]")];
const stageItems = [...document.querySelectorAll("[data-stage]")];
const mobileAction = document.querySelector("[data-next-state]");
const taskItems = [...document.querySelectorAll("[data-preview-task]")];
const issueButton = document.querySelector("[data-report-sample-issue]");
const issueNotice = document.querySelector("[data-sample-issue]");

const stateOrder = ["confirmed", "en-route", "arrived", "cleaning", "finished"];
const stateCopy = {
  "en-route": { heading: "Cleaner en route", subtitle: "Preview state — no location is being collected", arrival: "Calculated when journey starts", update: "No live update", next: "I have arrived" },
  arrived: { heading: "Cleaner arrived", subtitle: "Arrival time is recorded for both participants", arrival: "Arrived", update: "Arrival recorded", next: "Start cleaning" },
  cleaning: { heading: "Cleaning in progress", subtitle: "Room and task updates appear as they are recorded", arrival: "Arrived", update: "Preview update just now", next: "Finish cleaning" },
  finished: { heading: "Cleaning complete", subtitle: "The Landlord can review photos, notes and completed tasks", arrival: "Completed", update: "Completion recorded", next: "Awaiting review" }
};
let currentState = "en-route";
let currentRole = "landlord";
const completedTaskIds = new Set();
const issueTaskIds = new Set();

function showScreen(name) {
  const safeName = name === "tracking" ? "tracking" : "profile";
  for (const tab of tabs) {
    const selected = tab.dataset.previewTab === safeName;
    tab.classList.toggle("current", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
  for (const screen of screens) screen.hidden = screen.dataset.previewScreen !== safeName;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderState(name) {
  const copy = stateCopy[name];
  if (!copy) return;
  if (name === "cleaning" && currentState !== "cleaning") {
    completedTaskIds.clear();
    issueTaskIds.clear();
  }
  currentState = name;
  document.querySelector("[data-live-heading]").textContent = copy.heading;
  document.querySelector("[data-live-subtitle]").textContent = currentRole === "cleaner"
    ? "Cleaner action view — location remains off in this preview"
    : copy.subtitle;
  document.querySelector("[data-arrival-value]").textContent = copy.arrival;
  document.querySelector("[data-update-value]").textContent = copy.update;
  document.querySelector("[data-map-cleaner]").hidden = name !== "en-route";
  for (const button of stateButtons) button.classList.toggle("current", button.dataset.previewState === name);
  const activeIndex = stateOrder.indexOf(name);
  for (const item of stageItems) {
    const index = stateOrder.indexOf(item.dataset.stage);
    item.classList.toggle("complete", index < activeIndex);
    item.classList.toggle("current", index === activeIndex);
    const marker = item.querySelector("span");
    marker.textContent = index < activeIndex ? "✓" : String(index + 1);
  }
  renderTasks();
}

function renderTasks() {
  const model = marketplaceTaskPreview({ state: currentState, role: currentRole, completedTaskIds: [...completedTaskIds], issueTaskIds: [...issueTaskIds] });
  document.querySelector("[data-progress-percent]").textContent = `${model.percent}%`;
  document.querySelector("[data-progress-bar]").style.width = `${model.percent}%`;
  document.querySelector("[role=progressbar]").setAttribute("aria-valuenow", String(model.percent));
  document.querySelector("[data-progress-copy]").textContent = model.progressCopy;
  for (const item of taskItems) {
    const task = model.tasks.find((candidate) => candidate.id === item.dataset.previewTask);
    if (!task) continue;
    item.classList.toggle("complete", task.status === "complete");
    item.classList.toggle("current", task.status === "current");
    item.classList.toggle("issue", task.status === "issue");
    item.querySelector("[data-task-marker]").textContent = task.marker;
    item.querySelector("[data-task-status]").textContent = task.statusLabel;
    const button = item.querySelector("[data-task-toggle]");
    button.textContent = task.actionLabel;
    button.hidden = !model.canUpdate;
    button.disabled = !task.actionAllowed;
  }
  issueButton.hidden = !model.canReportIssue;
  issueButton.textContent = issueTaskIds.has("bathroom") ? "Clear sample issue" : "Report sample issue";
  issueNotice.hidden = model.issueCount === 0;
  const copy = stateCopy[currentState];
  mobileAction.textContent = currentRole === "cleaner"
    ? currentState === "cleaning" && !model.canFinish ? "Complete every task first" : copy.next
    : currentState === "finished" ? "Leave a review" : "Message Cleaner";
  mobileAction.disabled = currentRole === "cleaner" && (currentState === "finished" || (currentState === "cleaning" && !model.canFinish));
  document.querySelector("[data-task-guidance]").textContent = model.canUpdate
    ? "Cleaner preview: mark each room task complete or report the sample issue."
    : currentRole === "landlord"
      ? "Landlord preview: progress is read-only and updates as the Cleaner records work."
      : currentState === "cleaning" ? "Task controls are available in the Cleaner view." : "Task controls unlock after cleaning starts.";
}

function renderRole(role) {
  currentRole = role;
  for (const button of roleButtons) button.classList.toggle("current", button.dataset.previewRole === role);
  document.querySelector("[data-live-subtitle]").textContent = role === "cleaner"
    ? "Cleaner action view — location remains off in this preview"
    : stateCopy[currentState].subtitle;
  renderTasks();
}

for (const tab of tabs) tab.addEventListener("click", () => showScreen(tab.dataset.previewTab));
for (const button of roleButtons) button.addEventListener("click", () => renderRole(button.dataset.previewRole));
for (const button of stateButtons) button.addEventListener("click", () => renderState(button.dataset.previewState));
for (const item of taskItems) item.querySelector("[data-task-toggle]").addEventListener("click", () => {
  const id = item.dataset.previewTask;
  const model = marketplaceTaskPreview({ state: currentState, role: currentRole, completedTaskIds: [...completedTaskIds], issueTaskIds: [...issueTaskIds] });
  if (!model.canUpdate) return;
  issueTaskIds.delete(id);
  if (completedTaskIds.has(id)) completedTaskIds.delete(id);
  else completedTaskIds.add(id);
  renderTasks();
});
issueButton.addEventListener("click", () => {
  const model = marketplaceTaskPreview({ state: currentState, role: currentRole, completedTaskIds: [...completedTaskIds], issueTaskIds: [...issueTaskIds] });
  if (!model.canReportIssue) return;
  completedTaskIds.delete("bathroom");
  if (issueTaskIds.has("bathroom")) issueTaskIds.delete("bathroom");
  else issueTaskIds.add("bathroom");
  renderTasks();
});
document.querySelector("[data-open-tracking]").addEventListener("click", () => showScreen("tracking"));
mobileAction.addEventListener("click", () => {
  if (currentRole !== "cleaner") return;
  const model = marketplaceTaskPreview({ state: currentState, role: currentRole, completedTaskIds: [...completedTaskIds], issueTaskIds: [...issueTaskIds] });
  if (currentState === "cleaning" && !model.canFinish) return;
  const index = Math.max(1, stateOrder.indexOf(currentState));
  renderState(stateOrder[Math.min(stateOrder.length - 1, index + 1)]);
});

renderState(currentState);
showScreen(new URLSearchParams(window.location.search).get("screen"));
