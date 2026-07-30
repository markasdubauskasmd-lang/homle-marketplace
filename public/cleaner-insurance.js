import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { hydrateCleanerForm, loadCleanerSection, saveCleanerSection, uploadCleanerDocument } from "./cleaner-dashboard-data.js?v=20260730-1";

const maximumDocumentBytes = 20 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "insurance");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function selectedFileCopy(file) {
  const megabytes = Math.max(0.1, file.size / (1024 * 1024)).toFixed(1);
  return `${file.name} · ${megabytes} MB · selected for this page only`;
}

export async function setupInsurance({ account, showFeedback, requestJson }) {
  document.title = "Insurance | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const cards = [
    document.querySelector("[data-personal-card]"),
    document.querySelector("[data-business-details]"),
    document.querySelector("[data-identity-verification]"),
    document.querySelector("[data-background-checks]"),
    document.querySelector("[data-experience]"),
    document.querySelector("[data-references]"),
    document.querySelector("[data-work-areas]")
  ];
  const insuranceCard = document.querySelector("[data-insurance]");
  const topbars = [
    document.querySelector("[data-business-topbar]"),
    document.querySelector("[data-identity-topbar]"),
    document.querySelector("[data-background-topbar]"),
    document.querySelector("[data-experience-topbar]"),
    document.querySelector("[data-references-topbar]"),
    document.querySelector("[data-work-topbar]")
  ];
  const insuranceTopbar = document.querySelector("[data-insurance-topbar]");
  const form = document.querySelector("[data-insurance-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  for (const card of cards) if (card) card.hidden = true;
  if (insuranceCard) insuranceCard.hidden = false;
  for (const topbar of topbars) if (topbar) topbar.hidden = true;
  if (insuranceTopbar) insuranceTopbar.hidden = false;
  if (!(form instanceof HTMLFormElement)) return;

  const [profileResult, availabilityResult, payoutResult, sectionResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    loadCleanerSection(requestJson, "insurance")
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "unavailable";
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));
  if (sectionResult.status === "fulfilled") hydrateCleanerForm(form, sectionResult.value);

  document.querySelectorAll("[data-insurance-file]").forEach((fileInput) => {
    fileInput.addEventListener("change", () => {
      if (!(fileInput instanceof HTMLInputElement)) return;
      const file = fileInput.files?.[0];
      const row = fileInput.closest(".hc-insurance-document");
      const copy = row?.querySelector("small");
      const action = row?.querySelector(".hc-insurance-document-action");
      if (!file) {
        row?.classList.remove("is-selected");
        return;
      }
      if (!allowedDocumentTypes.has(file.type) || file.size > maximumDocumentBytes) {
        fileInput.value = "";
        row?.classList.remove("is-selected");
        showFeedback("Choose a PDF, JPEG or PNG insurance document no larger than 20MB.", "error");
        return;
      }
      row?.classList.add("is-selected");
      if (copy) copy.textContent = selectedFileCopy(file);
      if (action) action.textContent = "Replace";
      showFeedback("Insurance document selected. Save & continue to upload it securely.");
    });
  });

  form.addEventListener("input", () => {
    const status = document.querySelector("[data-insurance-save-status]");
    if (status) status.textContent = "Changes have not been saved yet.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const expiryInput = form.elements.namedItem("policyExpiry");
    const today = new Date().toISOString().slice(0, 10);
    if (expiryInput instanceof HTMLInputElement && expiryInput.value < today) {
      showFeedback("Enter a policy expiry date that has not passed.", "error");
      expiryInput.focus();
      return;
    }
    const documentTypes = { publicLiabilityPolicy: "public-liability", professionalIndemnityPolicy: "professional-indemnity", employersLiabilityPolicy: "employers-liability" };
    const submit = form.querySelector('button[type="submit"]');
    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    try {
      await saveCleanerSection(requestJson, "insurance", form, "submitted");
      for (const input of form.querySelectorAll("[data-insurance-file]")) {
        if (input instanceof HTMLInputElement && input.files?.[0]) await uploadCleanerDocument(requestJson, input.files[0], documentTypes[input.name] || "other");
      }
      showFeedback("Insurance details and selected policies were saved securely for review.", "success");
      location.assign("/cleaner/registration");
    } catch (error) {
      showFeedback(error.message || "Insurance details could not be saved.", "error");
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}
