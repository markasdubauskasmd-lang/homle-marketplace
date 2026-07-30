import { createCleanerPage, element } from "./cleaner-page.js?v=20260730-1";
import { storedCsrf } from "./session-csrf.js";

const expectedDocuments = [
  { documentType: "passport", extension: "PDF", title: "Passport — photo page", category: "Identity", href: "/cleaner/identity-verification" },
  { documentType: "driving-licence", extension: "JPG", title: "Driving licence (front & back)", category: "Identity", href: "/cleaner/identity-verification" },
  { documentType: "dbs-certificate", extension: "PDF", title: "Basic DBS certificate", category: "Background", href: "/cleaner/background-checks" },
  { documentType: "public-liability", extension: "PDF", title: "Public liability policy", category: "Insurance", href: "/cleaner/insurance" },
  { documentType: "right-to-work", extension: "PDF", title: "Right to work share code", category: "Compliance", href: "" },
  { documentType: "proof-of-address", extension: "PDF", title: "Proof of address — utility bill", category: "Address", href: "/cleaner/personal-details" },
  { documentType: "cv", extension: "PDF", title: "CV", category: "Experience", href: "/cleaner/experience" },
  { documentType: "ni-confirmation", extension: "PDF", title: "NI confirmation letter", category: "Tax", href: "" }
];

function inferredType(fileName) {
  const name = String(fileName || "").toLowerCase();
  if (name.includes("passport")) return "passport";
  if (name.includes("licence") || name.includes("license")) return "driving-licence";
  if (name.includes("dbs")) return "dbs-certificate";
  if (name.includes("insurance") || name.includes("liability")) return "public-liability";
  if (name.includes("right-to-work") || name.includes("share-code")) return "right-to-work";
  if (name.includes("address") || name.includes("utility")) return "proof-of-address";
  if (name.includes("cv") || name.includes("resume")) return "cv";
  if (name.includes("national-insurance") || name.startsWith("ni-")) return "ni-confirmation";
  return "other";
}

function statusFor(document) {
  if (!document) return { label: "Not uploaded", tone: "neutral" };
  if (document.status === "verified") return { label: "Verified", tone: "success" };
  if (document.status === "rejected" || document.status === "expired") return { label: "Action needed", tone: "action" };
  if (document.status === "uploading") return { label: "Uploading", tone: "pending" };
  return { label: "Pending review", tone: "pending" };
}

function rows(documents) {
  const latest = new Map();
  for (const document of documents) if (!latest.has(document.documentType)) latest.set(document.documentType, document);
  const base = expectedDocuments.map((expected) => ({ ...expected, document: latest.get(expected.documentType) || null }));
  for (const document of documents) {
    if (expectedDocuments.some((expected) => expected.documentType === document.documentType)) continue;
    base.push({ documentType: document.documentType, extension: document.mimeType === "application/pdf" ? "PDF" : "IMG", title: document.originalFileName, category: "Other", href: "", document });
  }
  return base;
}

function renderDocumentRow(row, openDocument) {
  const item = element("li", "hc-document-row");
  const type = element("span", "hc-document-type", row.extension);
  type.setAttribute("aria-hidden", "true");
  const description = element("span", "hc-document-description");
  description.append(element("strong", "hc-document-title", row.title), element("small", "hc-document-category", row.category));
  const state = statusFor(row.document);
  const status = element("span", `hc-document-status is-${state.tone}`, state.label);
  const expiry = element("span", "hc-document-expiry", row.document ? row.document.originalFileName : "No file stored");
  const actions = element("span", "hc-document-actions");
  if (row.document && row.document.status !== "uploading") {
    const open = element("button", "hc-document-open", "Open");
    open.type = "button";
    open.addEventListener("click", () => openDocument(row.document.documentId));
    actions.append(open);
  } else if (row.href) {
    const link = element("a", "hc-document-open", "Open step");
    link.href = row.href;
    actions.append(link);
  } else actions.append(element("span", "hc-document-unavailable", "Upload above"));
  item.append(type, description, status, expiry, actions);
  return item;
}

async function checksum(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

createCleanerPage("documents", async ({ requestJson, showFeedback }) => {
  const list = document.querySelector("[data-documents-list]");
  const picker = document.querySelector("[data-documents-file]");
  const trigger = document.querySelector("[data-documents-upload]");

  async function openDocument(documentId) {
    try {
      const result = await requestJson(`/api/marketplace/cleaner/documents/${documentId}/access`);
      window.open(result.access.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      showFeedback(error.message || "This document could not be opened.", "error");
    }
  }

  async function load() {
    const result = await requestJson("/api/marketplace/cleaner/documents");
    const documents = Array.isArray(result.documents) ? result.documents : [];
    list?.replaceChildren(...rows(documents).map((row) => renderDocumentRow(row, openDocument)));
  }

  async function upload(file) {
    if (!(file instanceof File)) return;
    if (!new Set(["application/pdf", "image/jpeg", "image/png"]).has(file.type) || file.size < 1 || file.size > 20_000_000) {
      showFeedback("Choose a PDF, JPEG or PNG document up to 20MB.", "error");
      return;
    }
    const csrf = storedCsrf();
    if (!csrf) return showFeedback("Your secure editing token is missing. Sign in again before uploading.", "error");
    trigger.disabled = true;
    showFeedback("Preparing your secure upload…");
    try {
      const intentResult = await requestJson("/api/marketplace/cleaner/documents/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ documentType: inferredType(file.name), originalFileName: file.name, mimeType: file.type, byteSize: file.size, checksumSha256: await checksum(file) })
      });
      const uploadIntent = intentResult.upload;
      const stored = await fetch(uploadIntent.uploadUrl, {
        method: "PUT",
        headers: uploadIntent.requiredHeaders,
        body: file,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      if (!stored.ok) throw new Error("The encrypted file transfer did not finish.");
      await requestJson(`/api/marketplace/cleaner/documents/${uploadIntent.documentId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: "{}"
      });
      await load();
      showFeedback("Document uploaded securely and queued for review.", "success");
    } catch (error) {
      showFeedback(error.message || "The document could not be uploaded.", "error");
    } finally {
      trigger.disabled = false;
      if (picker instanceof HTMLInputElement) picker.value = "";
    }
  }

  trigger?.addEventListener("click", () => picker?.click());
  picker?.addEventListener("change", () => upload(picker.files?.[0]));
  trigger?.addEventListener("dragover", (event) => event.preventDefault());
  trigger?.addEventListener("drop", (event) => {
    event.preventDefault();
    upload(event.dataTransfer?.files?.[0]);
  });
  await load();
});
