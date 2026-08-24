import { storedCsrf } from "./session-csrf.js";
import { poundsToPence, penceToPounds } from "./admin-scan-pricing-model.js";
import { scanOperationalWarnings, scanTimingSummary } from "./admin-scan-operations-model.js";

// Administrator view of whether the scan estimate has earned its way out of
// shadow mode, plus the two settings that were previously unreachable: how long
// a scan is kept, and which extras exist to be charged for.
//
// Nothing here is rendered as HTML. Operator-entered labels and codes become the
// customer-facing extras list, and rendering them as markup would carry that
// straight into every estimate.

const element = (selector) => document.querySelector(selector);
const gate = element("[data-admin-scan-gate]");
const workspace = element("[data-admin-scan-workspace]");

function saveCsrf(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 512) return false;
  try { sessionStorage.setItem("tideway_csrf", value); return true; } catch { return false; }
}

async function requestJson(path, options = {}) {
  if (!navigator.onLine) throw Object.assign(new Error("You are offline. Nothing was sent."), { code: "offline" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const { headers = {}, ...rest } = options;
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: controller.signal, ...rest, headers: { Accept: "application/json", ...headers } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || "That could not be loaded."), { statusCode: response.status, code: result.code || "" });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("That took too long. Reload before trying again."), { code: "request-timeout" });
    throw error;
  } finally { clearTimeout(timer); }
}

async function recoverCsrf() {
  if (storedCsrf()) return storedCsrf();
  const result = await requestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!saveCsrf(result.csrfToken)) throw new Error("Secure Administrator editing access could not be restored. Sign in again.");
  return result.csrfToken;
}

function listItem(text) {
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}

const percent = (value) => (typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "not measured");

function renderShadow(report) {
  const host = element("[data-admin-scan-shadow]");
  const verdict = element("[data-admin-scan-gate-verdict]");
  const compared = Number(report?.comparedBookings) || 0;
  if (!compared) {
    host.textContent = "No accepted booking has been compared yet, so the estimate's error is unknown. That is different from the error being zero.";
    verdict.textContent = "Not ready: the estimate must not influence a price until this has been measured.";
    return;
  }
  host.textContent = `${compared} accepted ${compared === 1 ? "booking" : "bookings"} compared · typical error ${percent(Number(report.medianAbsoluteError))} · ${percent(Number(report.within15Percent))} inside 15% · ${percent(Number(report.withinQuotedRange))} inside the quoted range`;
  // The gate the docs commit to, stated here rather than left to be remembered:
  // 50 accepted bookings with 90% inside 15%. The report itself deliberately
  // encodes no verdict, so this page states the threshold explicitly.
  const ready = report.sufficient === true && Number(report.within15Percent) >= 0.9;
  verdict.textContent = ready
    ? "Ready for review: 50 or more comparisons with 90% inside 15%. Whether to act on that is a business decision."
    : `Not ready: needs 50 or more comparisons (${compared}) with 90% inside 15% (${percent(Number(report.within15Percent))}).`;
}

function renderTelemetry(payload) {
  const rates = element("[data-admin-scan-rates]");
  const counters = element("[data-admin-scan-counters]");
  const latency = element("[data-admin-scan-latency]");
  const latencyBuckets = element("[data-admin-scan-latency-buckets]");
  const warnings = element("[data-admin-scan-warnings]");
  const releases = element("[data-admin-scan-releases]");
  const labels = {
    startedSessions: "Scans started", completionRate: "Completed", correctionRate: "Objects corrected per room",
    readingFailureRate: "Reading failures", crashFreeRate: "Crash-free", redactionRate: "Redactions per room",
    estimateRefusalRate: "Estimates refused"
  };
  rates.replaceChildren(...Object.entries(payload?.rates || {}).map(([key, value]) => listItem(
    // "Not measured" and zero are different facts, and a rate with no
    // denominator must not read as a clean bill of health.
    `${labels[key] || key}: ${key === "startedSessions" ? value : percent(value)}`
  )));
  const releaseRows = Array.isArray(payload?.releaseRates) ? payload.releaseRates : [];
  releases.replaceChildren(...(releaseRows.length
    ? releaseRows.map((release) => {
      const current = release.releaseCommit === payload.currentRelease ? " · current" : "";
      const measured = Number(release.rates?.startedSessions) || 0;
      return listItem(`${release.releaseCommit}${current} — ${measured} started · ${percent(release.rates?.completionRate)} completed · ${percent(release.rates?.crashFreeRate)} crash-free`);
    })
    : [listItem("No release-specific scans have been recorded yet.")]));
  const entries = Object.entries(payload?.snapshot?.counters || {});
  counters.replaceChildren(...(entries.length ? entries.map(([key, value]) => listItem(`${key} — ${value}`)) : [listItem("Nothing recorded yet.")]));

  const timing = scanTimingSummary(payload?.snapshot);
  latency.textContent = timing.total
    ? `${timing.total} assisted room ${timing.total === 1 ? "read" : "reads"} measured · ${timing.slowCount} took 8 seconds or longer (${percent(timing.slowRate)}).`
    : `No assisted room-reading time has been measured${payload?.durable ? " in the last 30 days" : " in this app instance"} yet.`;
  const measuredBuckets = timing.buckets.filter((entry) => entry.count > 0);
  latencyBuckets.replaceChildren(...(measuredBuckets.length
    ? measuredBuckets.map((entry) => listItem(`${entry.bucket} — ${entry.count}`))
    : [listItem("Nothing measured yet.")]));

  const attention = scanOperationalWarnings(payload?.snapshot);
  warnings.replaceChildren(...(attention.length
    ? attention.map((entry) => listItem(`${entry.title} — ${entry.count}. ${entry.guidance}`))
    : [listItem(`No scanner reliability warning has been measured${payload?.durable ? " in the last 30 days" : " in this app instance"}.`)]));
}

/* ── Ground truth: the scanner's accuracy, measured on real scans ────────── */

const truthConditions = ["clean", "light", "medium", "heavy", "unknown"];
const truthSoilingKinds = ["dust", "grease", "limescale", "stain", "mould", "soap-scum", "food-debris", "pet-hair", "damage", "clutter"];

function renderTruthReport(report) {
  const host = element("[data-admin-truth-report]");
  if (!report) { host.textContent = "Accuracy review is not available right now."; return; }
  if (!report.labelledTotal) {
    host.textContent = "Nothing has been reviewed yet, so the model's real accuracy is unknown. That is different from it being good.";
    return;
  }
  const kappa = report.agreement?.kappa;
  const parts = [
    `${report.labelledTotal} object${report.labelledTotal === 1 ? "" : "s"} reviewed`,
    `object names right ${percent(report.labelAccuracy)}`,
    kappa === null || kappa === undefined
      ? `condition agreement not yet computable (${report.agreement?.pairs ?? 0} graded pairs)`
      : `condition agreement κ ${kappa} over ${report.agreement.pairs} pairs`,
    // The one number the dirty-sink defect makes worth naming on its own.
    report.falseCleanRate === null
      ? "no 'clean' verdicts reviewed yet"
      : `'clean' wrong ${percent(report.falseCleanRate)} of the times it was claimed (${report.falseCleanCount})`,
    `${report.trainingConsentedCount} consented for training`
  ];
  host.textContent = parts.join(" · ")
    + (report.sufficient ? "" : " — below 50 reviews, treat every figure as anecdote, not accuracy.");
}

function truthRow(entry) {
  const row = document.createElement("li");
  row.className = "admin-truth-row";
  const heading = document.createElement("p");
  const model = [entry.condition || "no grade", ...(Array.isArray(entry.soiling) ? entry.soiling : [])].join(", ");
  heading.textContent = `${entry.roomName}: ${entry.label}${entry.quantity > 1 ? ` ×${entry.quantity}` : ""} — model said ${model}${entry.evidence ? ` ("${entry.evidence}")` : ""}`;
  const request = document.createElement("p");
  request.className = "hint";
  request.textContent = `Request ${entry.cleaningRequestId} · captured ${String(entry.capturedAt || "").slice(0, 10)}`;

  const form = document.createElement("form");
  form.className = "admin-truth-form";
  const conditionSelect = document.createElement("select");
  conditionSelect.setAttribute("aria-label", `True condition of ${entry.label}`);
  for (const condition of truthConditions) {
    const option = document.createElement("option");
    option.value = condition;
    option.textContent = condition === "unknown" ? "cannot tell from the photos" : condition;
    if (condition === entry.condition) option.selected = true;
    conditionSelect.append(option);
  }
  const soilingBox = document.createElement("details");
  const soilingSummary = document.createElement("summary");
  soilingSummary.textContent = "Soiling seen";
  soilingBox.append(soilingSummary);
  const soilingInputs = truthSoilingKinds.map((kind) => {
    const label = document.createElement("label");
    label.className = "admin-truth-kind";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = kind;
    input.checked = Array.isArray(entry.soiling) && entry.soiling.includes(kind);
    label.append(input, ` ${kind}`);
    soilingBox.append(label);
    return input;
  });
  const nameRight = document.createElement("label");
  const nameInput = document.createElement("input");
  nameInput.type = "checkbox";
  nameInput.checked = true;
  nameRight.append(nameInput, " the name is right");
  const consent = document.createElement("label");
  const consentInput = document.createElement("input");
  consentInput.type = "checkbox";
  consent.append(consentInput, " customer consented to training use");
  const save = document.createElement("button");
  save.className = "button";
  save.type = "submit";
  save.textContent = "Record truth";
  form.append(conditionSelect, soilingBox, nameRight, consent, save);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorHost = element("[data-admin-truth-error]");
    const status = element("[data-admin-truth-status]");
    errorHost.hidden = true;
    save.disabled = true;
    try {
      await requestJson(`/api/marketplace/admin/scan-ground-truth/objects/${encodeURIComponent(entry.objectId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await recoverCsrf() },
        body: JSON.stringify({
          condition: conditionSelect.value,
          soiling: soilingInputs.filter((input) => input.checked).map((input) => input.value).slice(0, 4),
          labelCorrect: nameInput.checked,
          trainingConsented: consentInput.checked
        })
      });
      status.textContent = `${entry.label} recorded.`;
      await loadTruth();
    } catch (error) {
      errorHost.textContent = error.message;
      errorHost.hidden = false;
    } finally {
      save.disabled = false;
    }
  });
  row.append(heading, request, form);
  return row;
}

async function loadTruth() {
  const queueHost = element("[data-admin-truth-queue]");
  try {
    const result = await requestJson("/api/marketplace/admin/scan-ground-truth?limit=25");
    renderTruthReport(result.report);
    const queue = Array.isArray(result.queue) ? result.queue : [];
    queueHost.replaceChildren(...(queue.length ? queue.map(truthRow) : [listItem("Nothing is waiting for review.")]));
  } catch {
    renderTruthReport(null);
    queueHost.replaceChildren(listItem("The review queue could not be loaded."));
  }
}

async function load() {
  try {
    const [shadow, telemetry, ruleset] = await Promise.all([
      requestJson("/api/marketplace/admin/pricing/scan-shadow-report"),
      requestJson("/api/marketplace/admin/scan-telemetry").catch(() => ({ snapshot: { counters: {} }, rates: {} })),
      requestJson("/api/marketplace/admin/pricing/scan-ruleset")
    ]);
    gate.hidden = true;
    workspace.hidden = false;
    renderShadow(shadow.report);
    renderTelemetry(telemetry);
    // After the gate has opened: a 503 here means the review service is off,
    // which the section reports without blocking the rest of the page.
    void loadTruth();
    // Retention is read from the same protected view as the rates.
    element("[data-admin-scan-abandoned]").value = String(ruleset.retention?.abandonedDays ?? 30);
    element("[data-admin-scan-completed]").value = String(ruleset.retention?.completedDays ?? 730);
  } catch (error) {
    workspace.hidden = true;
    gate.hidden = false;
    element("[data-admin-scan-gate-title]").textContent = error.statusCode === 401 || error.statusCode === 403
      ? "Administrator access is required"
      : "Scan operations could not be loaded";
    element("[data-admin-scan-gate-copy]").textContent = error.message;
    element("[data-admin-scan-sign-in]").hidden = error.statusCode !== 401;
    element("[data-admin-scan-retry]").hidden = false;
  }
}

element("[data-admin-scan-retention-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorHost = element("[data-admin-scan-retention-error]");
  const status = element("[data-admin-scan-retention-status]");
  errorHost.hidden = true;
  try {
    const abandonedDays = Number(element("[data-admin-scan-abandoned]").value.trim());
    const completedDays = Number(element("[data-admin-scan-completed]").value.trim());
    const result = await requestJson("/api/marketplace/admin/scan-retention", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await recoverCsrf() },
      body: JSON.stringify({ abandonedDays, completedDays })
    });
    status.textContent = `Saved. Unbooked scans are deleted after ${result.policy.abandonedDays} days, booked scans after ${result.policy.completedDays}.`;
  } catch (error) {
    status.textContent = "";
    errorHost.textContent = error.message;
    errorHost.hidden = false;
  }
});

element("[data-admin-scan-refresh]")?.addEventListener("click", load);
element("[data-admin-scan-retry]")?.addEventListener("click", load);
load();
