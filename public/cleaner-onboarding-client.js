import { storedCsrf } from "./session-csrf.js";

export function onboardingFormData(form) {
  const data = {};
  const checkboxGroups = new Map();
  for (const control of form.elements) {
    const name = String(control?.name || "").trim();
    if (!name || control.disabled || control.type === "file" || ["submit", "button", "reset"].includes(control.type)) continue;
    if (control.type === "radio") {
      if (control.checked) data[name] = control.value;
      continue;
    }
    if (control.type === "checkbox") {
      if (!checkboxGroups.has(name)) checkboxGroups.set(name, []);
      checkboxGroups.get(name).push(control);
      continue;
    }
    if (control instanceof HTMLSelectElement && control.multiple) data[name] = [...control.selectedOptions].map((option) => option.value);
    else data[name] = control.value;
  }
  for (const [name, controls] of checkboxGroups) {
    data[name] = controls.length === 1 ? controls[0].checked : controls.filter((control) => control.checked).map((control) => control.value);
  }
  return data;
}

export function onboardingFileMetadata(form) {
  const documents = [];
  for (const control of form.elements) {
    if (control.type !== "file" || !control.files?.length) continue;
    for (const file of control.files) documents.push({ field: control.name || "document", filename: file.name, mimeType: file.type, sizeBytes: file.size });
  }
  return documents;
}

export function applyOnboardingFormData(form, data = {}) {
  for (const control of form.elements) {
    const name = String(control?.name || "").trim();
    if (!name || !(name in data) || control.type === "file") continue;
    const value = data[name];
    if (control.type === "radio") control.checked = String(value) === control.value;
    else if (control.type === "checkbox") control.checked = Array.isArray(value) ? value.map(String).includes(control.value) : value === true;
    else if (control instanceof HTMLSelectElement && control.multiple && Array.isArray(value)) {
      const selected = new Set(value.map(String));
      for (const option of control.options) option.selected = selected.has(option.value);
    } else if (value != null) control.value = String(value);
  }
}

export async function loadOnboardingForm(requestJson, section, form) {
  const result = await requestJson(`/api/marketplace/cleaner/onboarding/${encodeURIComponent(section)}`);
  if (result.section?.data) applyOnboardingFormData(form, result.section.data);
  return result.section || null;
}

export async function saveOnboardingForm(requestJson, section, form, { status = "submitted", extra = {} } = {}) {
  const csrf = storedCsrf();
  if (!csrf) throw Object.assign(new Error("Your secure editing token is missing. Sign in again before saving."), { statusCode: 401 });
  const result = await requestJson(`/api/marketplace/cleaner/onboarding/${encodeURIComponent(section)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ status, data: { ...onboardingFormData(form), ...extra } })
  });
  return result.section;
}
