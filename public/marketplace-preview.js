const tabs = [...document.querySelectorAll("[data-preview-tab]")];
const screens = [...document.querySelectorAll("[data-preview-screen]")];
const roleButtons = [...document.querySelectorAll("[data-preview-role]")];
const stateButtons = [...document.querySelectorAll("[data-preview-state]")];
const stageItems = [...document.querySelectorAll("[data-stage]")];
const mobileAction = document.querySelector("[data-next-state]");

const stateOrder = ["confirmed", "en-route", "arrived", "cleaning", "finished"];
const stateCopy = {
  "en-route": { heading: "Cleaner en route", subtitle: "Preview state — no location is being collected", arrival: "Calculated when journey starts", update: "No live update", progress: 25, progressCopy: "1 of 4 sample tasks resolved", next: "I have arrived" },
  arrived: { heading: "Cleaner arrived", subtitle: "Arrival time is recorded for both participants", arrival: "Arrived", update: "Arrival recorded", progress: 25, progressCopy: "1 of 4 sample tasks resolved", next: "Start cleaning" },
  cleaning: { heading: "Cleaning in progress", subtitle: "Room and task updates appear as they are recorded", arrival: "Arrived", update: "Progress event received", progress: 50, progressCopy: "2 of 4 sample tasks resolved", next: "Finish cleaning" },
  finished: { heading: "Cleaning complete", subtitle: "The Landlord can review photos, notes and completed tasks", arrival: "Completed", update: "Completion recorded", progress: 100, progressCopy: "4 of 4 sample tasks resolved", next: "Awaiting review" }
};
let currentState = "en-route";
let currentRole = "landlord";

function showScreen(name) {
  for (const tab of tabs) {
    const selected = tab.dataset.previewTab === name;
    tab.classList.toggle("current", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
  for (const screen of screens) screen.hidden = screen.dataset.previewScreen !== name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderState(name) {
  const copy = stateCopy[name];
  if (!copy) return;
  currentState = name;
  document.querySelector("[data-live-heading]").textContent = copy.heading;
  document.querySelector("[data-live-subtitle]").textContent = currentRole === "cleaner"
    ? "Cleaner action view — location remains off in this preview"
    : copy.subtitle;
  document.querySelector("[data-arrival-value]").textContent = copy.arrival;
  document.querySelector("[data-update-value]").textContent = copy.update;
  document.querySelector("[data-progress-percent]").textContent = `${copy.progress}%`;
  document.querySelector("[data-progress-bar]").style.width = `${copy.progress}%`;
  document.querySelector("[role=progressbar]").setAttribute("aria-valuenow", String(copy.progress));
  document.querySelector("[data-progress-copy]").textContent = copy.progressCopy;
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
  mobileAction.textContent = currentRole === "cleaner" ? copy.next : name === "finished" ? "Leave a review" : "Message Cleaner";
  mobileAction.disabled = currentRole === "cleaner" && name === "finished";
}

function renderRole(role) {
  currentRole = role;
  for (const button of roleButtons) button.classList.toggle("current", button.dataset.previewRole === role);
  renderState(currentState);
}

for (const tab of tabs) tab.addEventListener("click", () => showScreen(tab.dataset.previewTab));
for (const button of roleButtons) button.addEventListener("click", () => renderRole(button.dataset.previewRole));
for (const button of stateButtons) button.addEventListener("click", () => renderState(button.dataset.previewState));
document.querySelector("[data-open-tracking]").addEventListener("click", () => showScreen("tracking"));
mobileAction.addEventListener("click", () => {
  if (currentRole !== "cleaner") return;
  const index = Math.max(1, stateOrder.indexOf(currentState));
  renderState(stateOrder[Math.min(stateOrder.length - 1, index + 1)]);
});

renderState(currentState);
