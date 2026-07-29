import { storedCsrf } from "./session-csrf.js";
import { poundsToPence, penceToPounds } from "./admin-scan-pricing-model.js";

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
  const entries = Object.entries(payload?.snapshot?.counters || {});
  counters.replaceChildren(...(entries.length ? entries.map(([key, value]) => listItem(`${key} — ${value}`)) : [listItem("Nothing recorded yet.")]));
}

function renderAddons(addons) {
  const host = element("[data-admin-scan-addons]");
  const list = Array.isArray(addons) ? addons : [];
  host.replaceChildren(...(list.length
    ? list.map((addon) => listItem(`${addon.label} (${addon.code}) — £${penceToPounds(addon.pence)}${addon.addedMinutes ? `, +${addon.addedMinutes} min` : ""}`))
    : [listItem("No extras are defined, so no extra can be charged for.")]));
}

async function load() {
  try {
    const [shadow, telemetry, addons, ruleset] = await Promise.all([
      requestJson("/api/marketplace/admin/pricing/scan-shadow-report"),
      requestJson("/api/marketplace/admin/scan-telemetry").catch(() => ({ snapshot: { counters: {} }, rates: {} })),
      requestJson("/api/marketplace/pricing/scan-addons"),
      requestJson("/api/marketplace/admin/pricing/scan-ruleset")
    ]);
    gate.hidden = true;
    workspace.hidden = false;
    renderShadow(shadow.report);
    renderTelemetry(telemetry);
    renderAddons(addons.addons);
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

element("[data-admin-scan-addon-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorHost = element("[data-admin-scan-addon-error]");
  const status = element("[data-admin-scan-addon-status]");
  errorHost.hidden = true;
  try {
    const result = await requestJson("/api/marketplace/admin/pricing/scan-addons", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await recoverCsrf() },
      body: JSON.stringify({
        code: element("[data-admin-scan-addon-code]").value.trim(),
        label: element("[data-admin-scan-addon-label]").value.trim(),
        pence: poundsToPence(element("[data-admin-scan-addon-price]").value),
        addedMinutes: Number(element("[data-admin-scan-addon-minutes]").value.trim() || "0"),
        active: true
      })
    });
    renderAddons(result.addons);
    status.textContent = "Saved. Every new estimate resolves extras against this list.";
  } catch (error) {
    status.textContent = "";
    errorHost.textContent = error.message;
    errorHost.hidden = false;
  }
});

element("[data-admin-scan-refresh]")?.addEventListener("click", load);
element("[data-admin-scan-retry]")?.addEventListener("click", load);
load();
