import { areaPriority, coverageWindow, eligibleLabel, serviceLabel } from "./admin-coverage-model.js";
import { createRequestJson } from "./request-json.js";

const requestJson = createRequestJson({ failureMessage: "The coverage report could not be loaded." });
const gate = document.querySelector("[data-coverage-gate]");
const workspace = document.querySelector("[data-coverage-workspace]");
const summary = document.querySelector("[data-coverage-summary]");
const list = document.querySelector("[data-coverage-list]");
const empty = document.querySelector("[data-coverage-empty]");
const feedback = document.querySelector("[data-coverage-feedback]");
const windowControl = document.querySelector("[data-coverage-window]");

function showGate(title, copy, { signIn = false, retry = false } = {}) {
  gate.hidden = false;
  workspace.hidden = true;
  document.querySelector("[data-coverage-gate-title]").textContent = title;
  document.querySelector("[data-coverage-gate-copy]").textContent = copy;
  document.querySelector("[data-coverage-sign-in]").hidden = !signIn;
  document.querySelector("[data-coverage-retry]").hidden = !retry;
}

function metric(label, value, copy) {
  const article = document.createElement("article");
  const name = document.createElement("span"); name.textContent = label;
  const amount = document.createElement("strong"); amount.textContent = String(value);
  const detail = document.createElement("small"); detail.textContent = copy;
  article.append(name, amount, detail);
  return article;
}

function chips(values) {
  const container = document.createElement("div"); container.className = "coverage-chips";
  for (const value of values) { const chip = document.createElement("span"); chip.textContent = serviceLabel(value); container.append(chip); }
  return container;
}

function areaCard(area) {
  const card = document.createElement("article");
  card.className = `coverage-area ${area.zeroMatchRequestCount > 0 || area.expiredUnmatchedRequestCount > 0 ? "coverage-area-gap" : ""}`;
  const heading = document.createElement("div"); heading.className = "coverage-area-heading";
  const title = document.createElement("div");
  const eyebrow = document.createElement("span"); eyebrow.textContent = areaPriority(area);
  const name = document.createElement("h2"); name.textContent = area.outwardPostcode === "UNKNOWN" ? "Area unavailable" : area.outwardPostcode;
  title.append(eyebrow, name);
  const eligible = document.createElement("strong"); eligible.textContent = eligibleLabel(area);
  heading.append(title, eligible);
  const metrics = document.createElement("div"); metrics.className = "coverage-area-metrics";
  metrics.append(
    metric("Demand", area.submittedRequestCount, "submitted requests"),
    metric("Unmatched", area.openUnmatchedRequestCount, `${area.expiredUnmatchedRequestCount} time passed`),
    metric("No match", area.zeroMatchRequestCount, `${area.atRiskRequestCount} with one or fewer eligible`)
  );
  const services = document.createElement("div"); services.className = "coverage-area-services";
  const label = document.createElement("strong"); label.textContent = area.zeroMatchServiceCodes.length ? "Services with no eligible match" : "Services requested";
  services.append(label, chips(area.zeroMatchServiceCodes.length ? area.zeroMatchServiceCodes : area.demandServiceCodes));
  const age = document.createElement("small"); age.textContent = area.openUnmatchedRequestCount ? `Oldest unmatched request in this window: ${area.oldestUnmatchedHours} hours.` : "No unmatched request in this window.";
  card.append(heading, metrics, services, age);
  return card;
}

function render(report) {
  summary.replaceChildren(
    metric("Submitted demand", report.summary.submittedRequestCount, `last ${report.windowDays} days`),
    metric("Needs a match", report.summary.openUnmatchedRequestCount, `${report.summary.expiredUnmatchedRequestCount} requested times passed`),
    metric("No eligible Cleaner", report.summary.zeroMatchRequestCount, `${report.summary.gapAreaCount} outward areas with a gap`),
    metric("Listed supply", report.summary.activeListedCleanerCount, report.matchingMode === "payout-ready" ? "public, complete and payout-ready" : "public, complete and currently available")
  );
  list.replaceChildren(...report.areas.map(areaCard));
  list.hidden = report.areas.length === 0;
  empty.hidden = report.areas.length > 0;
  document.querySelector("[data-coverage-generated]").textContent = `Snapshot generated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(report.generatedAt))}. Candidate counts are capped at 50 per request.`;
}

async function loadReport() {
  const windowDays = coverageWindow(windowControl.value);
  feedback.hidden = true;
  list.setAttribute("aria-busy", "true");
  try {
    render(await requestJson(`/api/marketplace/admin/coverage?windowDays=${windowDays}`));
  } catch (error) {
    feedback.textContent = error.message;
    feedback.hidden = false;
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

async function load() {
  showGate("Checking secure Administrator access…", "Coverage counts are private operational data.");
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (!account?.roles?.includes("administrator")) return showGate("Administrator account required", "This account cannot inspect Homle supply and demand coverage.", { signIn: true });
    gate.hidden = true;
    workspace.hidden = false;
    await loadReport();
  } catch (error) {
    if ([401, 403].includes(error.statusCode)) showGate("Sign in as a Homle Administrator", "Coverage counts are unavailable to unrelated accounts.", { signIn: true });
    else showGate("Coverage report could not be opened", "Try again. No record was changed.", { retry: true });
  }
}

document.querySelector("[data-coverage-refresh]").addEventListener("click", loadReport);
document.querySelector("[data-coverage-retry]").addEventListener("click", load);
windowControl.addEventListener("change", loadReport);
load();
