import { funnelWindow, percentLabel, stagePercent } from "./admin-funnel-model.js";
import { createRequestJson } from "./request-json.js";

const requestJson = createRequestJson({ failureMessage: "The funnel report could not be loaded." });
const gate = document.querySelector("[data-funnel-gate]");
const workspace = document.querySelector("[data-funnel-workspace]");
const reportRoot = document.querySelector("[data-funnel-report]");
const feedback = document.querySelector("[data-funnel-feedback]");
const windowControl = document.querySelector("[data-funnel-window]");

const laneDefinitions = Object.freeze([
  Object.freeze({
    title: "Landlord setup",
    copy: "Verified Landlord accounts that have had at least 24 hours to finish setup.",
    field: "onboarding",
    stages: Object.freeze([["accountCount", "Account created"], ["profileCount", "Profile created"], ["propertyCount", "Property added"]])
  }),
  Object.freeze({
    title: "Request to completed clean",
    copy: "Cleaning requests that have had at least 24 hours to progress.",
    field: "requestJourney",
    stages: Object.freeze([["requestCount", "Request started"], ["scanCount", "Room scan saved"], ["submittedCount", "Sent for matching"], ["bookingCount", "Booking created"], ["completedCount", "Clean completed"], ["reviewCount", "Review received"]])
  }),
  Object.freeze({
    title: "Booking payment",
    copy: "Bookings that have had at least 24 hours to create a payment record.",
    field: "payments",
    stages: Object.freeze([["bookingCount", "Booking created"], ["paymentRecordCount", "Payment started"], ["authorizedCount", "Payment authorized"], ["capturedCount", "Payment captured"]])
  })
]);

function showGate(title, copy, { signIn = false, retry = false } = {}) {
  gate.hidden = false;
  workspace.hidden = true;
  document.querySelector("[data-funnel-gate-title]").textContent = title;
  document.querySelector("[data-funnel-gate-copy]").textContent = copy;
  document.querySelector("[data-funnel-sign-in]").hidden = !signIn;
  document.querySelector("[data-funnel-retry]").hidden = !retry;
}

function stageRow(label, value, cohort) {
  const row = document.createElement("li");
  const heading = document.createElement("div");
  const name = document.createElement("strong"); name.textContent = label;
  const amount = document.createElement("span"); amount.textContent = String(value);
  heading.append(name, amount);
  const meter = document.createElement("div");
  meter.className = "funnel-meter";
  meter.setAttribute("role", "progressbar");
  meter.setAttribute("aria-label", label);
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  const percent = stagePercent(value, cohort);
  meter.setAttribute("aria-valuenow", String(percent ?? 0));
  const fill = document.createElement("i"); fill.style.setProperty("--funnel-progress", `${percent ?? 0}%`);
  meter.append(fill);
  const detail = document.createElement("small"); detail.textContent = percentLabel(value, cohort);
  row.append(heading, meter, detail);
  return row;
}

function laneCard(report, definition) {
  const values = report[definition.field];
  const cohort = values[definition.stages[0][0]];
  const card = document.createElement("article"); card.className = "funnel-lane";
  const title = document.createElement("h2"); title.textContent = definition.title;
  const copy = document.createElement("p"); copy.textContent = definition.copy;
  const list = document.createElement("ol");
  list.append(...definition.stages.map(([field, label]) => stageRow(label, values[field], cohort)));
  if (definition.field === "payments" && values.refundedCount > 0) {
    const note = document.createElement("aside");
    note.textContent = `${values.refundedCount} captured payment${values.refundedCount === 1 ? " has" : "s have"} been partly or fully refunded.`;
    card.append(title, copy, list, note);
  } else card.append(title, copy, list);
  return card;
}

function render(report) {
  reportRoot.replaceChildren(...laneDefinitions.map((definition) => laneCard(report, definition)));
  const formatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
  document.querySelector("[data-funnel-cohort]").textContent = `Cohorts run from ${formatter.format(new Date(report.cohortStartAt))} to ${formatter.format(new Date(report.cohortEndAt))}. Records from the latest ${report.maturityHours} hours are excluded.`;
  document.querySelector("[data-funnel-generated]").textContent = `Snapshot generated ${formatter.format(new Date(report.generatedAt))}.`;
}

async function loadReport() {
  const windowDays = funnelWindow(windowControl.value);
  feedback.hidden = true;
  reportRoot.setAttribute("aria-busy", "true");
  try {
    render(await requestJson(`/api/marketplace/admin/funnel?windowDays=${windowDays}`));
  } catch (error) {
    feedback.textContent = error.message;
    feedback.hidden = false;
  } finally {
    reportRoot.setAttribute("aria-busy", "false");
  }
}

async function load() {
  showGate("Checking secure Administrator access…", "Only aggregate marketplace stage counts are shown here.");
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (!account?.roles?.includes("administrator")) return showGate("Administrator account required", "This account cannot inspect Homle funnel metrics.", { signIn: true });
    gate.hidden = true;
    workspace.hidden = false;
    await loadReport();
  } catch (error) {
    if ([401, 403].includes(error.statusCode)) showGate("Sign in as a Homle Administrator", "Marketplace stage counts are unavailable to unrelated accounts.", { signIn: true });
    else showGate("Funnel report could not be opened", "Try again. No record was changed.", { retry: true });
  }
}

document.querySelector("[data-funnel-refresh]").addEventListener("click", loadReport);
document.querySelector("[data-funnel-retry]").addEventListener("click", load);
windowControl.addEventListener("change", loadReport);
load();
