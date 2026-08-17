import { createCleanerPage, element } from "./cleaner-page.js?v=20260816-restore-1";
import { uploadOnboardingDocument, validateOnboardingDocument } from "./cleaner-onboarding-documents.js?v=20260805-1";
import { saveCsrf, storedCsrf } from "./session-csrf.js";

function recordedCheck(status) {
  if (status === "verified") return { label: "Result verified", tone: "success" };
  if (status === "pending") return { label: "In review", tone: "pending" };
  if (status === "failed" || status === "expired") return { label: "Action needed", tone: "action" };
  return { label: "Not started", tone: "neutral" };
}

const definitions = [
  { section: "identity", documentType: "passportPhoto", extension: "PDF", title: "Passport — photo page", category: "Identity", href: "/cleaner/identity-verification" },
  { section: "identity", documentType: "licenceFront", extension: "JPG", title: "Driving licence — front", category: "Identity", href: "/cleaner/identity-verification" },
  { section: "identity", documentType: "licenceBack", extension: "JPG", title: "Driving licence — back", category: "Identity", href: "/cleaner/identity-verification" },
  { section: "identity", documentType: "birthCertificate", extension: "PDF", title: "Birth certificate", category: "Identity", href: "/cleaner/identity-verification" },
  { section: "identity", documentType: "residencePermit", extension: "PDF", title: "Visa / residence permit", category: "Identity", href: "/cleaner/identity-verification" },
  { section: "rtw", documentType: "rightToWorkPassport", extension: "PDF", title: "Right to work passport", category: "Right to work", href: "/cleaner/right-to-work" },
  { section: "rtw", documentType: "rightToWorkBirthCertificate", extension: "PDF", title: "Right to work birth certificate", category: "Right to work", href: "/cleaner/right-to-work" },
  { section: "dbs", documentType: "dbsCertificate", extension: "PDF", title: "DBS certificate", category: "Background", href: "/cleaner/background-checks" },
  { section: "experience", documentType: "cv", extension: "PDF", title: "CV", category: "Experience", href: "/cleaner/experience" },
  { section: "experience", documentType: "cleaningCertificates", extension: "PDF", title: "Cleaning certificates", category: "Experience", href: "/cleaner/experience" },
  { section: "experience", documentType: "coshhCertificate", extension: "PDF", title: "COSHH certificate", category: "Experience", href: "/cleaner/experience" },
  { section: "experience", documentType: "healthSafetyCertificate", extension: "PDF", title: "Health & safety certificate", category: "Experience", href: "/cleaner/experience" },
  { section: "insurance", documentType: "publicLiabilityPolicy", extension: "PDF", title: "Public liability policy", category: "Insurance", href: "/cleaner/insurance" },
  { section: "insurance", documentType: "productLiabilityPolicy", extension: "PDF", title: "Product liability policy", category: "Insurance", href: "/cleaner/insurance" },
  { section: "insurance", documentType: "treatmentProfessionalLiabilityPolicy", extension: "PDF", title: "Treatment / professional liability policy", category: "Insurance", href: "/cleaner/insurance" },
  { section: "insurance", documentType: "professionalIndemnityPolicy", extension: "PDF", title: "Professional indemnity policy", category: "Insurance", href: "/cleaner/insurance" },
  { section: "insurance", documentType: "employersLiabilityPolicy", extension: "PDF", title: "Employers’ liability policy", category: "Insurance", href: "/cleaner/insurance" },
  { section: "insurance", documentType: "businessUseMotorPolicy", extension: "PDF", title: "Business-use motor policy", category: "Insurance", href: "/cleaner/insurance" },
  { section: "banking", documentType: "invoiceTemplate", extension: "PDF", title: "Invoice template", category: "Banking", href: "/cleaner/banking" }
];

function documentKey(section, documentType) {
  return `${section}:${documentType}`;
}

function documentRows(profile, documents) {
  const stored = new Map(documents.map((document) => [documentKey(document.section, document.documentType), document]));
  return definitions.map((definition) => {
    const document = stored.get(documentKey(definition.section, definition.documentType));
    const check = definition.section === "identity" ? profile?.identityCheckStatus : definition.section === "dbs" ? profile?.backgroundCheckStatus : "not-started";
    return { ...definition, document, status: document ? { label: "Stored securely", tone: "success" } : recordedCheck(check) };
  });
}

function renderDocumentRow(row) {
  const item = element("li", "hc-document-row");
  const type = element("span", "hc-document-type", row.extension);
  type.setAttribute("aria-hidden", "true");
  const description = element("span", "hc-document-description");
  description.append(element("strong", "hc-document-title", row.title), element("small", "hc-document-category", row.category));
  const status = element("span", `hc-document-status is-${row.status.tone}`, row.status.label);
  const filename = element("span", "hc-document-expiry", row.document ? row.document.filename : "No file stored");
  const actions = element("span", "hc-document-actions");
  if (row.document) {
    const download = element("a", "hc-document-open", "Download");
    download.href = `/api/marketplace/cleaner/onboarding/documents/${encodeURIComponent(row.document.section)}/${encodeURIComponent(row.document.documentType)}`;
    actions.append(download);
  } else {
    const open = element("a", "hc-document-open", "Open step");
    open.href = row.href;
    actions.append(open);
  }
  item.append(type, description, status, filename, actions);
  return item;
}

function readableMegabytes(bytes) {
  return `${Math.max(0.1, Number(bytes) / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(file) {
  if (file.type === "application/pdf") return "PDF";
  if (file.type === "image/png") return "PNG";
  return "JPG";
}

function populateDestinations(select) {
  const options = definitions.map((definition) => {
    const option = element("option", "", `${definition.title} — ${definition.category}`);
    option.value = documentKey(definition.section, definition.documentType);
    return option;
  });
  select.append(...options);
}

async function secureCsrf(requestJson) {
  const existing = storedCsrf();
  if (existing) return existing;
  const session = await requestJson("/api/marketplace/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!session.csrfToken || !saveCsrf(session.csrfToken)) throw new Error("Your secure upload access could not be restored. Sign in again before uploading.");
  return session.csrfToken;
}

createCleanerPage("documents", async ({ requestJson, showFeedback }) => {
  const [profileResult, documentResult] = await Promise.all([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/onboarding/documents")
  ]);
  const profile = profileResult.profile && typeof profileResult.profile === "object" ? profileResult.profile : null;
  let documents = Array.isArray(documentResult.documents) ? documentResult.documents : [];
  let pendingFile = null;
  let uploading = false;

  const list = document.querySelector("[data-documents-list]");
  const drop = document.querySelector("[data-documents-upload]");
  const fileInput = document.querySelector("[data-documents-file]");
  const form = document.querySelector("[data-documents-confirm]");
  const destination = document.querySelector("[data-documents-destination]");
  const confirmed = document.querySelector("[data-documents-confirm-check]");
  const submit = document.querySelector("[data-documents-submit]");
  const status = document.querySelector("[data-documents-confirm-status]");

  function renderRows() {
    list?.replaceChildren(...documentRows(profile, documents).map(renderDocumentRow));
  }

  function selectedDefinition() {
    return definitions.find((definition) => documentKey(definition.section, definition.documentType) === destination?.value) || null;
  }

  function updateConfirmationState() {
    const ready = Boolean(pendingFile && selectedDefinition() && confirmed?.checked && !uploading);
    if (submit instanceof HTMLButtonElement) submit.disabled = !ready;
    const replacement = document.querySelector("[data-documents-replacement-note]");
    const definition = selectedDefinition();
    const existing = definition && documents.find((document) => documentKey(document.section, document.documentType) === documentKey(definition.section, definition.documentType));
    if (replacement) replacement.textContent = existing
      ? `This will securely replace ${existing.filename}.`
      : "Select the correct category so it is stored with the right onboarding step.";
    if (status && !uploading) status.textContent = ready
      ? "Confirmed. This document is ready for secure submission."
      : "Confirm the file and category to enable secure upload.";
  }

  function resetConfirmation({ hide = true } = {}) {
    pendingFile = null;
    uploading = false;
    if (fileInput instanceof HTMLInputElement) fileInput.value = "";
    if (destination instanceof HTMLSelectElement) destination.value = "";
    if (confirmed instanceof HTMLInputElement) confirmed.checked = false;
    if (form instanceof HTMLFormElement) form.hidden = hide;
    drop?.classList.remove("is-dragging");
    updateConfirmationState();
  }

  function prepareFile(file) {
    try {
      pendingFile = validateOnboardingDocument(file);
    } catch (error) {
      resetConfirmation();
      showFeedback(error.message, "error");
      return;
    }
    const name = document.querySelector("[data-documents-selected-name]");
    const meta = document.querySelector("[data-documents-selected-meta]");
    const type = document.querySelector("[data-documents-selected-type]");
    if (name) name.textContent = pendingFile.name;
    if (meta) meta.textContent = `${pendingFile.type} • ${readableMegabytes(pendingFile.size)}`;
    if (type) type.textContent = fileExtension(pendingFile);
    if (form instanceof HTMLFormElement) {
      form.hidden = false;
      form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (confirmed instanceof HTMLInputElement) confirmed.checked = false;
    showFeedback("Review the selected document and confirm it before uploading.");
    updateConfirmationState();
    destination?.focus();
  }

  renderRows();
  if (destination instanceof HTMLSelectElement) populateDestinations(destination);

  drop?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    const file = fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : null;
    if (file) prepareFile(file);
  });
  for (const eventName of ["dragenter", "dragover"]) {
    drop?.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    drop?.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.remove("is-dragging");
    });
  }
  drop?.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) prepareFile(file);
  });
  destination?.addEventListener("change", updateConfirmationState);
  confirmed?.addEventListener("change", updateConfirmationState);
  document.querySelector("[data-documents-cancel]")?.addEventListener("click", () => {
    resetConfirmation();
    showFeedback("Document upload cancelled. Nothing was submitted.");
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const definition = selectedDefinition();
    if (!pendingFile || !definition || !(confirmed instanceof HTMLInputElement) || !confirmed.checked || uploading) {
      showFeedback("Review the document, choose its category and confirm it before submitting.", "error");
      updateConfirmationState();
      return;
    }
    uploading = true;
    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    if (status) status.textContent = "Uploading and encrypting your confirmed document…";
    try {
      await secureCsrf(requestJson);
      const stored = await uploadOnboardingDocument(definition.section, definition.documentType, pendingFile);
      documents = [...documents.filter((document) => documentKey(document.section, document.documentType) !== documentKey(stored.section, stored.documentType)), stored];
      renderRows();
      const filename = stored.filename;
      resetConfirmation();
      showFeedback(`${filename} was confirmed, encrypted and stored securely in your Document Centre.`, "success");
    } catch (error) {
      uploading = false;
      updateConfirmationState();
      showFeedback(error.message || "The confirmed document could not be uploaded.", "error");
    }
  });
});
