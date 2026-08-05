import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-6";

function recordedCheck(status) {
  if (status === "verified") return { label: "Result verified", tone: "success" };
  if (status === "pending") return { label: "In review", tone: "pending" };
  if (status === "failed" || status === "expired") return { label: "Action needed", tone: "action" };
  return { label: "Not started", tone: "neutral" };
}

function unavailableStatus() {
  return { label: "Not connected", tone: "neutral" };
}

function documentRows(profile) {
  const identity = recordedCheck(profile?.identityCheckStatus);
  const background = recordedCheck(profile?.backgroundCheckStatus);
  return [
    { extension: "PDF", title: "Passport — photo page", category: "Identity", status: identity, href: "/cleaner/identity-verification" },
    { extension: "JPG", title: "Driving licence (front & back)", category: "Identity", status: identity, href: "/cleaner/identity-verification" },
    { extension: "PDF", title: "Basic DBS certificate", category: "Background", status: background, href: "/cleaner/background-checks" },
    { extension: "PDF", title: "Public liability policy", category: "Insurance", status: unavailableStatus(), href: "/cleaner/insurance" },
    { extension: "PDF", title: "Right to work share code", category: "Compliance", status: unavailableStatus(), href: "" },
    { extension: "PDF", title: "Proof of address — utility bill", category: "Address", status: unavailableStatus(), href: "/cleaner/personal-details" },
    { extension: "DOCX", title: "CV", category: "Experience", status: unavailableStatus(), href: "/cleaner/experience" },
    { extension: "—", title: "NI confirmation letter", category: "Tax", status: unavailableStatus(), href: "" }
  ];
}

function renderDocumentRow(row) {
  const item = element("li", "hc-document-row");
  const type = element("span", "hc-document-type", row.extension);
  type.setAttribute("aria-hidden", "true");

  const description = element("span", "hc-document-description");
  description.append(
    element("strong", "hc-document-title", row.title),
    element("small", "hc-document-category", row.category)
  );

  const status = element("span", `hc-document-status is-${row.status.tone}`, row.status.label);
  const expiry = element("span", "hc-document-expiry", "No file stored");
  const actions = element("span", "hc-document-actions");
  if (row.href) {
    const link = element("a", "hc-document-open", "Open step");
    link.href = row.href;
    actions.append(link);
  } else {
    actions.append(element("span", "hc-document-unavailable", "Unavailable"));
  }
  item.append(type, description, status, expiry, actions);
  return item;
}

createCleanerPage("documents", async ({ requestJson, showFeedback }) => {
  const profileResult = await requestJson("/api/marketplace/cleaner/profile");
  const profile = profileResult.profile && typeof profileResult.profile === "object" ? profileResult.profile : null;
  const list = document.querySelector("[data-documents-list]");
  list?.replaceChildren(...documentRows(profile).map(renderDocumentRow));

  document.querySelector("[data-documents-upload]")?.addEventListener("click", () => {
    showFeedback("Secure document uploads are not connected yet. Nothing was selected, sent or stored.", "error");
    document.querySelector("[data-documents-feedback]")?.focus();
  });
});
