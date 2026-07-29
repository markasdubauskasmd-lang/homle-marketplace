import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-6";

const agreements = [
  { title: "GDPR consent", href: "/privacy", status: "Review available", tone: "available" },
  { title: "Privacy policy", href: "/privacy", status: "Review available", tone: "available" },
  { title: "Terms & conditions", href: "/terms", status: "Review available", tone: "available" },
  { title: "Background check permission", href: "/cleaner/background-checks", status: "Step available", tone: "available" },
  { title: "Document verification permission", href: "/cleaner/identity-verification", status: "Signing unavailable", tone: "pending" },
  { title: "Right to work declaration", href: "", status: "Signing unavailable", tone: "pending" },
  { title: "Data processing consent", href: "/privacy", status: "Signing unavailable", tone: "pending" },
  { title: "Code of conduct", href: "", status: "Signing unavailable", tone: "pending" },
  { title: "Self-employment declaration", href: "", status: "Signing unavailable", tone: "pending" },
  { title: "Anti-fraud declaration", href: "", status: "Signing unavailable", tone: "pending" },
  { title: "Health & safety agreement", href: "", status: "Signing unavailable", tone: "pending" },
  { title: "Lone working policy", href: "", status: "Signing unavailable", tone: "pending" },
  { title: "Equality & diversity policy", href: "", status: "Signing unavailable", tone: "pending" }
];

if (agreements.length !== 13) throw new Error("The Contracts page must contain all 13 agreements shown in the supplied design.");

function renderAgreement(agreement) {
  const row = element("li", "hc-contract-row");
  const state = element("span", `hc-contract-state is-${agreement.tone}`, agreement.tone === "available" ? "✓" : "○");
  state.setAttribute("aria-hidden", "true");

  const title = agreement.href
    ? element("a", "hc-contract-title", agreement.title)
    : element("span", "hc-contract-title", agreement.title);
  if (agreement.href) title.href = agreement.href;

  const date = element("span", "hc-contract-date", "—");
  const status = element("span", `hc-contract-status is-${agreement.tone}`, agreement.status);
  row.append(state, title, date, status);
  return row;
}

createCleanerPage("contracts", async ({ account, showFeedback }) => {
  document.querySelector("[data-contract-list]")?.replaceChildren(...agreements.map(renderAgreement));

  const name = document.querySelector("[data-contract-name]");
  const preview = document.querySelector("[data-contract-signature]");
  const sign = document.querySelector("[data-contract-sign]");

  if (name && account?.displayName) name.placeholder = account.displayName;

  name?.addEventListener("input", () => {
    if (preview) preview.textContent = name.value.trim() || "Your signature";
  });

  sign?.addEventListener("click", () => {
    if (!name?.value.trim()) {
      name?.focus();
      showFeedback("Enter your full legal name to preview the signature. Nothing will be signed or stored.", "error");
      return;
    }
    showFeedback("Contract signing is not connected yet. Nothing was signed, stored, time-stamped, emailed or logged.", "error");
    document.querySelector("[data-contracts-feedback]")?.focus();
  });
});
