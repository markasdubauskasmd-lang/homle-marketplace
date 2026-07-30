import { storedCsrf } from "./session-csrf.js";

export function cleanerFormPayload(form) {
  const payload = {};
  const controls = new Map();
  for (const control of form.elements) {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) continue;
    if (!control.name || control.disabled || control instanceof HTMLInputElement && (control.type === "file" || control.type === "submit" || control.type === "button")) continue;
    if (!controls.has(control.name)) controls.set(control.name, []);
    controls.get(control.name).push(control);
  }
  for (const [name, group] of controls) {
    const first = group[0];
    if (first instanceof HTMLInputElement && first.type === "radio") {
      payload[name] = group.find((control) => control.checked)?.value || "";
    } else if (first instanceof HTMLInputElement && first.type === "checkbox") {
      payload[name] = group.length === 1 ? first.checked : group.filter((control) => control.checked).map((control) => control.value);
    } else {
      payload[name] = group.length === 1 ? first.value : group.map((control) => control.value);
    }
  }
  return payload;
}

export function hydrateCleanerForm(form, payload) {
  if (!payload || typeof payload !== "object") return;
  for (const [name, value] of Object.entries(payload)) {
    const control = form.elements.namedItem(name);
    if (!control) continue;
    if (control instanceof RadioNodeList) {
      for (const item of control) {
        if (item instanceof HTMLInputElement && item.type === "checkbox") item.checked = Array.isArray(value) && value.includes(item.value);
        else if (item instanceof HTMLInputElement && item.type === "radio") item.checked = item.value === String(value);
      }
    }
    else if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = value === true;
    else if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) control.value = String(value ?? "");
  }
}

export async function loadCleanerSection(requestJson, sectionCode) {
  const result = await requestJson(`/api/marketplace/cleaner/data/${sectionCode}`);
  return result.section?.payload && typeof result.section.payload === "object" ? result.section.payload : {};
}

export async function saveCleanerSection(requestJson, sectionCode, form, completionStatus = "draft") {
  const csrf = storedCsrf();
  if (!csrf) throw new Error("Your secure editing token is missing. Sign in again before saving.");
  const result = await requestJson(`/api/marketplace/cleaner/data/${sectionCode}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ payload: cleanerFormPayload(form), completionStatus })
  });
  return result.section;
}

async function fileChecksum(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadCleanerDocument(requestJson, file, documentType) {
  if (!(file instanceof File)) return null;
  if (!new Set(["application/pdf", "image/jpeg", "image/png"]).has(file.type) || file.size < 1 || file.size > 20_000_000) throw new TypeError("Choose a PDF, JPEG or PNG document up to 20MB.");
  const csrf = storedCsrf();
  if (!csrf) throw new Error("Your secure editing token is missing. Sign in again before uploading.");
  const result = await requestJson("/api/marketplace/cleaner/documents/intents", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ documentType, originalFileName: file.name, mimeType: file.type, byteSize: file.size, checksumSha256: await fileChecksum(file) })
  });
  const upload = result.upload;
  const stored = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.requiredHeaders,
    body: file,
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer"
  });
  if (!stored.ok) throw new Error("The encrypted file transfer did not finish.");
  const completed = await requestJson(`/api/marketplace/cleaner/documents/${upload.documentId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: "{}"
  });
  return completed.document;
}
