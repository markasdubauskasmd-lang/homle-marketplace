import { storedCsrf } from "./session-csrf.js";

export const maximumOnboardingDocumentBytes = 20 * 1024 * 1024;
export const allowedOnboardingDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const uploadTimeoutMs = 90_000;

function megabytes(bytes) {
  return `${Math.max(0.1, Number(bytes) / (1024 * 1024)).toFixed(1)} MB`;
}

export function selectedDocumentCopy(file) {
  return `${file.name} · ${megabytes(file.size)} · ready to upload when you save`;
}

export function storedDocumentCopy(document) {
  return `${document.filename} · ${megabytes(document.sizeBytes)} · stored securely`;
}

export function validateOnboardingDocument(file) {
  if (!(file instanceof File) || !allowedOnboardingDocumentTypes.has(file.type) || file.size < 1 || file.size > maximumOnboardingDocumentBytes) {
    throw new Error("Choose a PDF, JPEG or PNG document no larger than 20MB.");
  }
  return file;
}

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || "Homle could not store this document.");
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

export async function loadOnboardingDocuments(requestJson, section = "") {
  const query = section ? `?section=${encodeURIComponent(section)}` : "";
  const result = await requestJson(`/api/marketplace/cleaner/onboarding/documents${query}`);
  return Array.isArray(result.documents) ? result.documents : [];
}

export async function uploadOnboardingDocument(section, documentType, file) {
  validateOnboardingDocument(file);
  const csrf = storedCsrf();
  if (!csrf) throw new Error("Your secure editing token is missing. Sign in again before uploading.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), uploadTimeoutMs);
  try {
    const response = await fetch(`/api/marketplace/cleaner/onboarding/documents/${encodeURIComponent(section)}/${encodeURIComponent(documentType)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "Content-Type": file.type,
        "X-CSRF-Token": csrf,
        "X-Document-Filename": encodeURIComponent(file.name)
      },
      body: file,
      signal: controller.signal
    });
    return (await responseJson(response)).document;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The secure document upload timed out. Please try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadOnboardingFormDocuments(form, section, selector, onProgress = () => {}) {
  const inputs = [...form.querySelectorAll(selector)].filter((input) => input instanceof HTMLInputElement && input.type === "file" && input.files?.length);
  const uploaded = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const file = input.files[0];
    onProgress({ current: index + 1, total: inputs.length, filename: file.name });
    uploaded.push(await uploadOnboardingDocument(section, input.name, file));
    input.value = "";
  }
  return uploaded;
}

export async function hydrateOnboardingDocumentInputs(requestJson, section, form, selector, render) {
  const documents = await loadOnboardingDocuments(requestJson, section);
  const byType = new Map(documents.map((document) => [document.documentType, document]));
  for (const input of form.querySelectorAll(selector)) {
    if (input instanceof HTMLInputElement && byType.has(input.name)) render(input, byType.get(input.name));
  }
  return documents;
}
