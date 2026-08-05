import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-6";

function recordedCheck(status) {
  if (status === "verified") return { label: "Result verified", tone: "success" };
  if (status === "pending") return { label: "In review", tone: "pending" };
  if (status === "failed" || status === "expired") return { label: "Action needed", tone: "action" };
  return { label: "Not started", tone: "neutral" };
}

const definitions = [
  ["identity", "passportPhoto", "PDF", "Passport — photo page", "Identity", "/cleaner/identity-verification"],
  ["identity", "licenceFront", "JPG", "Driving licence — front", "Identity", "/cleaner/identity-verification"],
  ["identity", "licenceBack", "JPG", "Driving licence — back", "Identity", "/cleaner/identity-verification"],
  ["identity", "birthCertificate", "PDF", "Birth certificate", "Identity", "/cleaner/identity-verification"],
  ["identity", "residencePermit", "PDF", "Visa / residence permit", "Identity", "/cleaner/identity-verification"],
  ["dbs", "dbsCertificate", "PDF", "DBS certificate", "Background", "/cleaner/background-checks"],
  ["experience", "cv", "PDF", "CV", "Experience", "/cleaner/experience"],
  ["experience", "cleaningCertificates", "PDF", "Cleaning certificates", "Experience", "/cleaner/experience"],
  ["experience", "coshhCertificate", "PDF", "COSHH certificate", "Experience", "/cleaner/experience"],
  ["experience", "healthSafetyCertificate", "PDF", "Health & safety certificate", "Experience", "/cleaner/experience"],
  ["references", "referenceLetters", "PDF", "Reference letter", "References", "/cleaner/references"],
  ["insurance", "publicLiabilityPolicy", "PDF", "Public liability policy", "Insurance", "/cleaner/insurance"],
  ["insurance", "professionalIndemnityPolicy", "PDF", "Professional indemnity policy", "Insurance", "/cleaner/insurance"],
  ["insurance", "employersLiabilityPolicy", "PDF", "Employers’ liability policy", "Insurance", "/cleaner/insurance"],
  ["banking", "invoiceTemplate", "PDF", "Invoice template", "Banking", "/cleaner/banking"]
];

function documentRows(profile, documents) {
  const stored = new Map(documents.map((document) => [`${document.section}:${document.documentType}`, document]));
  return definitions.map(([section, documentType, extension, title, category, href]) => {
    const document = stored.get(`${section}:${documentType}`);
    const check = section === "identity" ? profile?.identityCheckStatus : section === "dbs" ? profile?.backgroundCheckStatus : "not-started";
    return { extension, title, category, href, document, status: document ? { label: "Stored securely", tone: "success" } : recordedCheck(check) };
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

createCleanerPage("documents", async ({ requestJson, showFeedback }) => {
  const [profileResult, documentResult] = await Promise.all([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/onboarding/documents")
  ]);
  const profile = profileResult.profile && typeof profileResult.profile === "object" ? profileResult.profile : null;
  const documents = Array.isArray(documentResult.documents) ? documentResult.documents : [];
  document.querySelector("[data-documents-list]")?.replaceChildren(...documentRows(profile, documents).map(renderDocumentRow));
  document.querySelector("[data-documents-upload]")?.addEventListener("click", () => {
    showFeedback("Choose the relevant onboarding step to add or replace a document.");
    location.assign("/cleaner/identity-verification");
  });
});
