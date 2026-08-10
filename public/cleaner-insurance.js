import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { loadOnboardingForm, saveOnboardingForm } from "./cleaner-onboarding-client.js?v=20260801-1";
import { hydrateOnboardingDocumentInputs, storedDocumentCopy, uploadOnboardingFormDocuments } from "./cleaner-onboarding-documents.js?v=20260805-1";

const maximumDocumentBytes = 20 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const supplierLinks = {
  cleaner: "https://www.protectivity.com/product/cleaning-insurance/",
  beautician: "https://www.protectivity.com/product/beauty-therapist-insurance/"
};
let serviceType = "cleaner";

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
  return `${file.name} · ${megabytes} MB · ready to upload when you save`;
}

function renderStoredDocument(input, document) {
  const row = input.closest(".hc-insurance-document");
  row?.classList.add("is-selected");
  const copy = row?.querySelector("small");
  const action = row?.querySelector(".hc-insurance-document-action");
  if (copy) copy.textContent = storedDocumentCopy(document);
  if (action) action.textContent = "Replace";
}

function selectedServiceType(value) {
  return String(value || "").toLowerCase() === "beautician" ? "beautician" : "cleaner";
}

function setInsurancePresentation() {
  const beautician = serviceType === "beautician";
  document.querySelectorAll("[data-insurance-requirements]").forEach((panel) => {
    panel.hidden = panel.dataset.insuranceRequirements !== serviceType;
  });
  const badge = document.querySelector("[data-insurance-profession-badge]");
  if (badge) badge.textContent = beautician ? "Beautician cover" : "Cleaner cover";
  const professionalLabel = document.querySelector("[data-insurance-professional-label]");
  if (professionalLabel) professionalLabel.textContent = beautician
    ? "Treatment / professional liability policy"
    : "Professional indemnity (if held)";
  const supplierCopy = document.querySelector("[data-insurance-supplier-copy]");
  if (supplierCopy) supplierCopy.textContent = beautician
    ? "Protectivity offers specialist cover for self-employed and mobile beauty therapists."
    : "Protectivity offers specialist cleaning insurance with online quotes.";
  const supplierLink = document.querySelector("[data-insurance-supplier-link]");
  if (supplierLink instanceof HTMLAnchorElement) supplierLink.href = supplierLinks[serviceType];
  const requirementCopy = document.querySelector("[data-insurance-requirement-copy]");
  if (requirementCopy) requirementCopy.textContent = beautician
    ? "Public liability and treatment / professional liability must be selected before you continue."
    : "Public liability must be selected before you continue.";
}

function selectedCoverTypes(form) {
  return new Set([...form.querySelectorAll('input[name="coverTypes"]:checked')].map((input) => input.value));
}

function validateCoverTypes(form, showFeedback) {
  const selected = selectedCoverTypes(form);
  const missing = [];
  if (!selected.has("public_liability")) missing.push("public liability");
  if (serviceType === "beautician" && !selected.has("treatment_professional_liability")) missing.push("treatment / professional liability");
  if (!missing.length) return true;
  showFeedback(`Confirm that your policy includes ${missing.join(" and ")} before continuing. Nothing was uploaded or saved.`, "error");
  form.querySelector('input[name="coverTypes"]')?.focus();
  return false;
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
    document.querySelector("[data-work-areas]")
  ];
  const insuranceCard = document.querySelector("[data-insurance]");
  const topbars = [
    document.querySelector("[data-business-topbar]"),
    document.querySelector("[data-identity-topbar]"),
    document.querySelector("[data-background-topbar]"),
    document.querySelector("[data-experience-topbar]"),
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

  const [profileResult, availabilityResult, payoutResult, businessResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    requestJson("/api/marketplace/cleaner/onboarding/business")
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "unavailable";
  const businessData = businessResult.status === "fulfilled" ? businessResult.value.section?.data : null;
  serviceType = selectedServiceType(businessData?.serviceType);
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));
  await loadOnboardingForm(requestJson, "insurance", form).catch(() => null);
  await hydrateOnboardingDocumentInputs(requestJson, "insurance", form, "[data-insurance-file]", renderStoredDocument).catch(() => null);
  setInsurancePresentation();

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
      showFeedback("Insurance document ready. Select Save & continue to store it securely.");
    });
  });

  form.addEventListener("input", () => {
    const status = document.querySelector("[data-insurance-save-status]");
    if (status) status.textContent = "Policy details and selected documents will be encrypted and stored when you continue.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!validateCoverTypes(form, showFeedback)) return;
    const expiryInput = form.elements.namedItem("policyExpiry");
    const today = new Date().toISOString().slice(0, 10);
    if (expiryInput instanceof HTMLInputElement && expiryInput.value < today) {
      showFeedback("Enter a policy expiry date that has not passed. Nothing was uploaded or saved.", "error");
      expiryInput.focus();
      return;
    }
    try {
      const uploaded = await uploadOnboardingFormDocuments(form, "insurance", "[data-insurance-file]", ({ current, total }) => showFeedback(`Uploading insurance document ${current} of ${total} securely…`));
      for (const document of uploaded) {
        const input = form.elements.namedItem(document.documentType);
        if (input instanceof HTMLInputElement) renderStoredDocument(input, document);
      }
      await saveOnboardingForm(requestJson, "insurance", form);
      showFeedback("Insurance details and selected documents were stored securely. Homle will mark the policy verified only after the document check is complete.");
    } catch (error) {
      showFeedback(error.message || "Homle could not save your insurance details.", "error");
    }
  });
}
