import { storedCsrf } from "./session-csrf.js";
import {
  basisPointsToPercent, changeReasonError, levelFields, penceToPounds,
  pricingChangeSummary, pricingFields, pricingRulesFromForm
} from "./admin-scan-pricing-model.js";

// The Administrator page for the rates behind a scan estimate.
//
// Every value an operator types is bounded here, in scan-pricing.mjs and in a
// CHECK constraint. This copy exists to name the wrong field before a request
// is sent; the server copy is the one that decides.
//
// Nothing on this page is rendered as HTML. An operator-entered change reason
// becomes the internal audit trail, and rendering it as markup would turn that
// trail into an injection surface.

const endpoint = "/api/marketplace/admin/pricing/scan-ruleset";
const element = (selector) => document.querySelector(selector);
const gate = element("[data-admin-pricing-gate]");
const workspace = element("[data-admin-pricing-workspace]");
const gateTitle = element("[data-admin-pricing-gate-title]");
const gateCopy = element("[data-admin-pricing-gate-copy]");
const signIn = element("[data-admin-pricing-sign-in]");
const retry = element("[data-admin-pricing-retry]");
const fieldHost = element("[data-admin-pricing-fields]");
const levelHost = element("[data-admin-pricing-levels]");
const currentHost = element("[data-admin-pricing-current]");
const historyHost = element("[data-admin-pricing-history]");
const summaryHost = element("[data-admin-pricing-summary]");
const errorHost = element("[data-admin-pricing-error]");
const statusHost = element("[data-admin-pricing-status]");
const reasonField = element("[data-admin-pricing-reason]");
const form = element("[data-admin-pricing-form]");
const publishButton = element("[data-admin-pricing-publish]");

let current = null;

function saveCsrf(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 512) return false;
  try { sessionStorage.setItem("tideway_csrf", value); return true; } catch { return false; }
}

async function requestJson(path, options = {}) {
  const mutation = options.method && options.method !== "GET";
  if (!navigator.onLine) throw Object.assign(new Error("You are offline. No rate change was sent."), { code: "offline" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const { headers = {}, ...rest } = options;
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: controller.signal, ...rest, headers: { Accept: "application/json", ...headers } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || "The pricing rules could not be loaded."), { statusCode: response.status, code: result.code || "" });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") {
      // A publish that timed out may still have landed. Telling an operator to
      // reload before retrying is the difference between one new version and
      // two.
      throw Object.assign(new Error(mutation
        ? "The rate change did not return in time. Reload the published rates before trying again."
        : "The pricing rules took too long to load."), { code: "request-timeout" });
    }
    throw error;
  } finally { clearTimeout(timeout); }
}

async function recoverCsrf() {
  if (storedCsrf()) return storedCsrf();
  const result = await requestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!saveCsrf(result.csrfToken)) throw new Error("Secure Administrator editing access could not be restored. Sign in again.");
  return result.csrfToken;
}

function labelledInput(id, labelText, helpText, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-row";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  const help = document.createElement("p");
  help.className = "form-help";
  help.id = `${id}-help`;
  help.textContent = helpText;
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.id = id;
  input.name = id;
  input.value = value;
  input.setAttribute("aria-describedby", help.id);
  wrapper.append(label, help, input);
  return wrapper;
}

function renderForm(ruleset) {
  fieldHost.replaceChildren();
  levelHost.replaceChildren();
  for (const field of pricingFields) {
    const stored = ruleset ? ruleset[field.key] : null;
    const value = field.money ? penceToPounds(stored) : (Number.isInteger(Number(stored)) ? String(stored) : "");
    fieldHost.append(labelledInput(field.key, field.money ? `${field.label} (£)` : field.label, field.help, value));
  }
  const multipliers = ruleset?.levelMultiplierBasisPoints || {};
  for (const field of levelFields) {
    const stored = multipliers[field.level] ?? multipliers[String(field.level)];
    levelHost.append(labelledInput(`level${field.level}`, `${field.label} (basis points)`,
      `${basisPointsToPercent(stored) || "100"}% of the standard rate. 10000 is exactly standard.`,
      Number.isInteger(Number(stored)) ? String(stored) : ""));
  }
}

function formValues() {
  const values = {};
  for (const field of pricingFields) values[field.key] = element(`#${field.key}`)?.value ?? "";
  for (const field of levelFields) values[`level${field.level}`] = element(`#level${field.level}`)?.value ?? "";
  return values;
}

function showError(message) {
  errorHost.textContent = message;
  errorHost.hidden = !message;
}

function renderSummary() {
  summaryHost.replaceChildren();
  let proposed;
  try { proposed = pricingRulesFromForm(formValues()); }
  catch (error) {
    showError(error.message);
    return null;
  }
  showError("");
  for (const line of pricingChangeSummary(current, proposed)) {
    const item = document.createElement("li");
    item.textContent = line;
    summaryHost.append(item);
  }
  return proposed;
}

function renderCurrent(ruleset) {
  if (!ruleset) {
    currentHost.textContent = "No rates have been published. Estimates currently use the shipped defaults, and publishing here replaces them.";
    return;
  }
  currentHost.textContent = `Version ${ruleset.version} · £${penceToPounds(ruleset.hourlyRatePence)} per hour · £${penceToPounds(ruleset.minimumChargePence)} minimum visit · published ${new Date(ruleset.createdAt).toLocaleString("en-GB")} · ${ruleset.changeReason}`;
}

function renderHistory(history) {
  historyHost.replaceChildren();
  for (const version of history?.versions || []) {
    const item = document.createElement("li");
    item.textContent = `Version ${version.version}${version.active ? " (live)" : ""} · £${penceToPounds(version.hourlyRatePence)}/hour · ${new Date(version.createdAt).toLocaleDateString("en-GB")} · ${version.changeReason}`;
    historyHost.append(item);
  }
  if (!historyHost.childElementCount) {
    const item = document.createElement("li");
    item.textContent = "No published versions yet.";
    historyHost.append(item);
  }
}

async function load() {
  try {
    const result = await requestJson(endpoint);
    current = result.ruleset || null;
    gate.hidden = true;
    workspace.hidden = false;
    renderCurrent(current);
    renderForm(current);
    renderHistory(result.history);
    renderSummary();
  } catch (error) {
    workspace.hidden = true;
    gate.hidden = false;
    gateTitle.textContent = error.statusCode === 401 || error.statusCode === 403
      ? "Administrator access is required"
      : "The pricing rules could not be loaded";
    gateCopy.textContent = error.message;
    signIn.hidden = error.statusCode !== 401;
    retry.hidden = false;
  }
}

form?.addEventListener("input", renderSummary);

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const proposed = renderSummary();
  if (!proposed) return;
  const reasonProblem = changeReasonError(reasonField.value);
  if (reasonProblem) return showError(reasonProblem);
  publishButton.disabled = true;
  statusHost.textContent = "Publishing…";
  try {
    const csrf = await recoverCsrf();
    const result = await requestJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ rulesetId: "default", rules: proposed, changeReason: reasonField.value.trim() })
    });
    current = result.ruleset || null;
    reasonField.value = "";
    renderCurrent(current);
    renderForm(current);
    renderSummary();
    statusHost.textContent = `Published version ${current?.version ?? ""}. Every new estimate uses these rates from now.`;
    // Reload so the history reflects the version just written rather than the
    // one before it.
    const refreshed = await requestJson(endpoint);
    renderHistory(refreshed.history);
  } catch (error) {
    statusHost.textContent = "";
    showError(error.message);
  } finally {
    publishButton.disabled = false;
  }
});

element("[data-admin-pricing-refresh]")?.addEventListener("click", load);
retry?.addEventListener("click", load);
load();
