import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";

const maximumDocumentBytes = 20 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "references");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function selectedFileCopy(file) {
  const megabytes = Math.max(0.1, file.size / (1024 * 1024)).toFixed(1);
  return `${file.name} · ${megabytes} MB · selected for this page only`;
}

export async function setupReferences({ account, showFeedback, requestJson }) {
  document.title = "References | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const cards = [
    document.querySelector("[data-personal-card]"),
    document.querySelector("[data-business-details]"),
    document.querySelector("[data-identity-verification]"),
    document.querySelector("[data-background-checks]"),
    document.querySelector("[data-experience]"),
    document.querySelector("[data-work-areas]")
  ];
  const referencesCard = document.querySelector("[data-references]");
  const topbars = [
    document.querySelector("[data-business-topbar]"),
    document.querySelector("[data-identity-topbar]"),
    document.querySelector("[data-background-topbar]"),
    document.querySelector("[data-experience-topbar]"),
    document.querySelector("[data-work-topbar]")
  ];
  const referencesTopbar = document.querySelector("[data-references-topbar]");
  const form = document.querySelector("[data-references-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  for (const card of cards) if (card) card.hidden = true;
  if (referencesCard) referencesCard.hidden = false;
  for (const topbar of topbars) if (topbar) topbar.hidden = true;
  if (referencesTopbar) referencesTopbar.hidden = false;
  if (!(form instanceof HTMLFormElement)) return;

  const [profileResult, availabilityResult, payoutResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account")
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "unavailable";
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));

  document.querySelectorAll("[data-reference-email]").forEach((button) => {
    button.addEventListener("click", () => {
      showFeedback("Reference email delivery is not connected yet. Nothing was sent and no referee details were stored.", "error");
    });
  });

  const fileInput = document.querySelector("[data-references-file]");
  fileInput?.addEventListener("change", () => {
    if (!(fileInput instanceof HTMLInputElement)) return;
    const file = fileInput.files?.[0];
    const row = fileInput.closest(".hc-references-document");
    const copy = row?.querySelector("small");
    const action = row?.querySelector(".hc-references-document-action");
    if (!file) {
      row?.classList.remove("is-selected");
      return;
    }
    if (!allowedDocumentTypes.has(file.type) || file.size > maximumDocumentBytes) {
      fileInput.value = "";
      row?.classList.remove("is-selected");
      showFeedback("Choose a PDF, JPEG or PNG reference letter no larger than 20MB.", "error");
      return;
    }
    row?.classList.add("is-selected");
    if (copy) copy.textContent = selectedFileCopy(file);
    if (action) action.textContent = "Replace";
    showFeedback("Reference letter selected for this page only. It has not been uploaded or stored.");
  });

  form.addEventListener("input", () => {
    const status = document.querySelector("[data-references-save-status]");
    if (status) status.textContent = "Referee contact details remain only in this open page and are not stored.";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    showFeedback("Secure reference storage, email requests and confirmation are not connected yet. Nothing was uploaded, emailed or saved.", "error");
  });
}
