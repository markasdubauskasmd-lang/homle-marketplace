import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260728-2";
import { stepByKey, stepNumber, wizardSteps } from "./cleaner-registration-steps.js?v=20260728-1";
import { createCleanerPage, element, requestJson, setText } from "./cleaner-page.js?v=20260728-1";

const stepKey = (new URLSearchParams(location.search).get("step") || "").toLowerCase();

function field(spec, prefill) {
  const wrap = element("div", "hc-field");
  wrap.dataset.span = String(spec.span || 12);

  if (spec.type === "button") {
    const button = element("button", "hc-field-button", spec.label);
    button.type = "button";
    button.disabled = true;
    if (spec.note) button.title = spec.note;
    wrap.append(element("span", "hc-field-label", " "), button);
    if (spec.note) wrap.append(element("span", "hc-field-hint", spec.note));
    return wrap;
  }

  if (spec.type === "toggle") {
    const row = element("div", "hc-toggle");
    const copy = element("div", "hc-toggle-copy");
    copy.append(element("strong", "", spec.label));
    if (spec.hint) copy.append(element("span", "hc-field-hint", spec.hint));
    const control = element("label", "hc-toggle-control");
    const input = document.createElement("input");
    input.type = "checkbox";
    control.append(element("span", "hc-toggle-state", "No"), input, element("span", "hc-toggle-track"));
    input.addEventListener("change", () => { control.querySelector(".hc-toggle-state").textContent = input.checked ? "Yes" : "No"; });
    row.append(copy, control);
    wrap.append(row);
    return wrap;
  }

  if (spec.type === "upload") {
    const label = element("span", "hc-field-label", spec.label);
    const drop = element("div", "hc-upload");
    drop.append(element("strong", "", "No file chosen"));
    if (spec.hint) drop.append(element("span", "hc-field-hint", spec.hint));
    // No object storage is configured, so there is nowhere to put an upload.
    drop.append(element("span", "hc-field-hint", "Uploads are not connected yet."));
    wrap.append(label, drop);
    return wrap;
  }

  const id = `f-${spec.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const label = element("label", "hc-field-label", spec.label);
  label.htmlFor = id;
  if (spec.required) label.append(element("span", "hc-field-req", " *"));
  wrap.append(label);

  if (spec.type === "select") {
    const select = element("select", "hc-input");
    select.id = id;
    for (const option of spec.options || []) select.append(element("option", "", option));
    wrap.append(select);
  } else {
    const input = document.createElement("input");
    input.className = "hc-input";
    input.id = id;
    input.type = spec.type === "date" ? "text" : (spec.inputType || "text");
    if (spec.type === "date") input.placeholder = "DD / MM / YYYY";
    if (spec.required) input.required = true;
    if (prefill) input.value = prefill;
    wrap.append(input);
  }
  if (spec.hint) wrap.append(element("span", "hc-field-hint", spec.hint));
  return wrap;
}

function prefillValue(name, account) {
  const full = String(account?.displayName || "").trim();
  if (name === "firstName") return full.split(/\s+/)[0] || "";
  if (name === "lastName") return full.split(/\s+/).slice(1).join(" ");
  if (name === "email") return account?.email || "";
  return "";
}

createCleanerPage("reg", async ({ account }) => {
  const step = stepByKey(stepKey);
  const number = stepNumber(step.key);

  setText("[data-wiz-num]", String(number));
  setText("[data-wiz-title]", step.title);
  setText("[data-wiz-heading]", step.title);
  setText("[data-wiz-desc]", step.description || "");
  document.title = `${step.title} | Homle`;

  // Completion marks on the rail come from the same model the dashboard uses.
  const [profileResult, availabilityResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability")
  ]);
  const progress = onboardingProgress({
    account,
    profile: profileResult.status === "fulfilled" ? profileResult.value.profile : null,
    payoutState: "unavailable",
    availabilityCount: availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability) ? availabilityResult.value.availability.length : 0
  });
  const doneByKey = new Map(progress.steps.map((entry) => [entry.key, entry.done]));

  const percent = Math.round((number - 1) / wizardSteps.length * 100);
  const track = document.querySelector("[data-wiz-track]");
  const fill = document.querySelector("[data-wiz-fill]");
  if (track) track.setAttribute("aria-valuenow", String(percent));
  // Width through CSSOM so `style-src 'self'` still holds.
  if (fill) fill.style.width = `${percent}%`;

  const rail = document.querySelector("[data-wiz-rail]");
  if (rail) rail.replaceChildren(...wizardSteps.map((entry, index) => {
    const done = doneByKey.get(entry.key) === true;
    const item = element("a", "hc-wiz-rail-item");
    item.href = `/cleaner/registration?step=${encodeURIComponent(entry.key)}`;
    if (entry.key === step.key) item.setAttribute("aria-current", "step");
    item.dataset.done = String(done);
    item.append(
      element("span", "hc-wiz-rail-num", done ? "✓" : String(index + 1)),
      element("span", "hc-wiz-rail-label", entry.title)
    );
    return item;
  }));

  const form = document.querySelector("[data-wiz-form]");
  if (!form) return;
  if (!Array.isArray(step.sections)) {
    // Only the personal step's field table has been transcribed so far.
    form.replaceChildren(element("p", "hc-wiz-pending", `The ${step.title} form is not built yet. Its fields come from the design's own table and have not been transcribed; nothing on this step is saved.`));
  } else {
    form.replaceChildren(...step.sections.flatMap((section) => {
      const nodes = [];
      if (section.title) nodes.push(element("h3", "hc-wiz-section", section.title.toUpperCase()));
      const grid = element("div", "hc-field-grid");
      for (const spec of section.fields) grid.append(field(spec, spec.prefill ? prefillValue(spec.prefill, account) : ""));
      nodes.push(grid);
      return nodes;
    }));
  }

  const prev = document.querySelector("[data-wiz-prev]");
  if (prev && number > 1) {
    prev.hidden = false;
    prev.href = `/cleaner/registration?step=${encodeURIComponent(wizardSteps[number - 2].key)}`;
  }
  const save = document.querySelector("[data-wiz-save]");
  if (save) {
    const next = wizardSteps[number];
    save.textContent = next ? "Save & continue →" : "Review & submit →";
    save.addEventListener("click", () => {
      // No registration-write endpoint exists. Advancing the step is honest navigation;
      // pretending the entered values were stored would not be.
      if (next) location.assign(`/cleaner/registration?step=${encodeURIComponent(next.key)}`);
    });
  }
});
