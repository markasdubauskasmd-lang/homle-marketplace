import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260830-1";
import { loadOnboardingForm, saveOnboardingForm } from "./cleaner-onboarding-client.js?v=20260801-1";
import { loadOnboardingDocuments, storedDocumentCopy, uploadOnboardingFormDocuments } from "./cleaner-onboarding-documents.js?v=20260805-1";

const maximumDocumentBytes = 20 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const supplierLinks = {
  cleaner: "https://www.protectivity.com/product/cleaning-insurance/",
  beautician: "https://www.protectivity.com/product/beauty-therapist-insurance/"
};
const policyDefinitions = Object.freeze([
  Object.freeze({ type: "public_liability", label: "Public liability", documentType: "publicLiabilityPolicy" }),
  Object.freeze({ type: "product_liability", label: "Product liability", documentType: "productLiabilityPolicy" }),
  Object.freeze({ type: "treatment_professional_liability", label: "Treatment / professional liability", documentType: "treatmentProfessionalLiabilityPolicy", profession: "beautician" }),
  Object.freeze({ type: "employers_liability", label: "Employers’ liability", documentType: "employersLiabilityPolicy" }),
  Object.freeze({ type: "business_use_motor", label: "Business-use motor cover", documentType: "businessUseMotorPolicy" })
]);
const policyByType = new Map(policyDefinitions.map((definition) => [definition.type, definition]));
let serviceType = "cleaner";
let presentationType = "cleaner";
let storedInsuranceDocuments = new Map();

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
  const beautician = presentationType === "beautician";
  document.querySelectorAll("[data-insurance-requirements]").forEach((panel) => {
    panel.hidden = panel.dataset.insuranceRequirements !== presentationType;
  });
  const badge = document.querySelector("[data-insurance-profession-badge]");
  if (badge) badge.textContent = beautician ? "Viewing Beautician cover" : "Viewing Cleaner cover";
  document.querySelectorAll("[data-insurance-view-switch]").forEach((button) => {
    const active = button.dataset.insuranceViewSwitch === presentationType;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-insurance-cover-option]").forEach((option) => {
    option.hidden = option.dataset.insuranceCoverOption !== presentationType;
  });
  const selectionNote = document.querySelector("[data-insurance-selection-note]");
  if (selectionNote) {
    const savedProfession = serviceType === "beautician" ? "Beautician" : "Cleaner";
    const viewedProfession = beautician ? "Beautician" : "Cleaner";
    selectionNote.textContent = serviceType === presentationType
      ? `Your saved onboarding service is ${savedProfession}.`
      : `Viewing ${viewedProfession} guidance only. Your saved onboarding service remains ${savedProfession}.`;
  }
  const supplierCopy = document.querySelector("[data-insurance-supplier-copy]");
  if (supplierCopy) supplierCopy.textContent = beautician
    ? "Protectivity offers specialist cover for self-employed and mobile beauty therapists."
    : "Protectivity offers specialist cleaning insurance with online quotes.";
  const supplierLink = document.querySelector("[data-insurance-supplier-link]");
  if (supplierLink instanceof HTMLAnchorElement) supplierLink.href = supplierLinks[presentationType];
  const requirementCopy = document.querySelector("[data-insurance-requirement-copy]");
  if (requirementCopy) {
    const savedBeautician = serviceType === "beautician";
    requirementCopy.textContent = savedBeautician
      ? "For your saved Beautician application, public liability and treatment / professional liability must be selected before you continue."
      : "For your saved Cleaner application, public liability must be selected before you continue.";
  }
  document.querySelectorAll("[data-insurance-policy-entry]").forEach((row) => {
    configurePolicyEntry(row, row.dataset.policyType, { preserveFile: true });
  });
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

function resetPolicyDocument(input) {
  const document = input.closest(".hc-insurance-document");
  document?.classList.remove("is-selected");
  const copy = document?.querySelector("small");
  const action = document?.querySelector(".hc-insurance-document-action");
  if (copy) copy.textContent = "PDF, JPEG or PNG · max 20MB";
  if (action) action.textContent = "Choose file";
  input.value = "";
}

function configurePolicyEntry(row, type, { preserveFile = false } = {}) {
  const definition = policyByType.get(type) || null;
  const select = row.querySelector("[data-insurance-policy-type]");
  const fileInput = row.querySelector("[data-insurance-policy-file]");
  const documentLabel = row.querySelector("[data-insurance-policy-document-label]");
  if (!(select instanceof HTMLSelectElement) || !(fileInput instanceof HTMLInputElement)) return;
  for (const option of select.options) {
    const definitionForOption = policyByType.get(option.value);
    const unavailable = definitionForOption?.profession && definitionForOption.profession !== serviceType;
    option.hidden = Boolean(unavailable);
    option.disabled = Boolean(unavailable);
  }
  const allowedDefinition = definition?.profession && definition.profession !== serviceType ? null : definition;
  select.value = allowedDefinition?.type || "";
  const previousDocumentType = fileInput.name;
  const nextDocumentType = allowedDefinition?.documentType || "";
  if (!preserveFile && previousDocumentType && previousDocumentType !== nextDocumentType) resetPolicyDocument(fileInput);
  if (nextDocumentType) fileInput.name = nextDocumentType;
  else fileInput.removeAttribute("name");
  fileInput.disabled = !nextDocumentType;
  row.dataset.policyType = allowedDefinition?.type || "";
  if (documentLabel) documentLabel.textContent = allowedDefinition ? `${allowedDefinition.label} policy` : "Select an insurance type first";
  if (nextDocumentType && storedInsuranceDocuments.has(nextDocumentType)) renderStoredDocument(fileInput, storedInsuranceDocuments.get(nextDocumentType));
}

function updatePolicyRemoveButtons(container) {
  const rows = [...container.querySelectorAll("[data-insurance-policy-entry]")];
  for (const row of rows) {
    const remove = row.querySelector("[data-insurance-remove-policy]");
    if (remove instanceof HTMLButtonElement) remove.hidden = rows.length === 1;
  }
  const add = document.querySelector("[data-insurance-add-policy]");
  if (add instanceof HTMLButtonElement) add.disabled = rows.length >= policyDefinitions.filter((definition) => !definition.profession || definition.profession === serviceType).length;
}

function bindPolicyFileInput(fileInput, showFeedback) {
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    const row = fileInput.closest(".hc-insurance-document");
    const copy = row?.querySelector("small");
    const action = row?.querySelector(".hc-insurance-document-action");
    if (!file) {
      row?.classList.remove("is-selected");
      return;
    }
    if (!allowedDocumentTypes.has(file.type) || file.size > maximumDocumentBytes) {
      resetPolicyDocument(fileInput);
      showFeedback("Choose a PDF, JPEG or PNG insurance document no larger than 20MB.", "error");
      return;
    }
    row?.classList.add("is-selected");
    if (copy) copy.textContent = selectedFileCopy(file);
    if (action) action.textContent = "Replace";
    showFeedback("Insurance document ready. Select Save & continue to store it securely.");
  });
}

function addPolicyEntry(container, template, policy, showFeedback) {
  const source = template.content.firstElementChild;
  if (!(source instanceof HTMLElement)) return null;
  const row = source.cloneNode(true);
  const select = row.querySelector("[data-insurance-policy-type]");
  const number = row.querySelector("[data-insurance-policy-number]");
  const provider = row.querySelector("[data-insurance-policy-provider]");
  const expiry = row.querySelector("[data-insurance-policy-expiry]");
  const fileInput = row.querySelector("[data-insurance-policy-file]");
  if (number instanceof HTMLInputElement) number.value = String(policy?.policyNumber || "");
  if (provider instanceof HTMLInputElement) provider.value = String(policy?.provider || policy?.policyProvider || "");
  if (expiry instanceof HTMLInputElement) expiry.value = String(policy?.expiry || policy?.policyExpiry || "");
  container.append(row);
  configurePolicyEntry(row, String(policy?.type || ""), { preserveFile: true });
  if (select instanceof HTMLSelectElement) {
    select.addEventListener("change", () => {
      configurePolicyEntry(row, select.value);
      const matchingCover = document.querySelector(`input[name="coverTypes"][value="${select.value}"]`);
      if (matchingCover instanceof HTMLInputElement && select.value) matchingCover.checked = true;
    });
  }
  if (fileInput instanceof HTMLInputElement) bindPolicyFileInput(fileInput, showFeedback);
  row.querySelector("[data-insurance-remove-policy]")?.addEventListener("click", () => {
    row.remove();
    updatePolicyRemoveButtons(container);
  });
  updatePolicyRemoveButtons(container);
  return row;
}

function savedPolicyEntries(data) {
  if (Array.isArray(data?.policies) && data.policies.length) return data.policies;
  if (data?.policyNumber || data?.policyProvider || data?.policyExpiry) {
    return [{ type: "public_liability", policyNumber: data.policyNumber, provider: data.policyProvider, expiry: data.policyExpiry }];
  }
  return [];
}

function collectPolicyEntries(form) {
  return [...form.querySelectorAll("[data-insurance-policy-entry]")].map((row) => ({
    type: row.querySelector("[data-insurance-policy-type]")?.value || "",
    policyNumber: row.querySelector("[data-insurance-policy-number]")?.value.trim() || "",
    provider: row.querySelector("[data-insurance-policy-provider]")?.value.trim() || "",
    expiry: row.querySelector("[data-insurance-policy-expiry]")?.value || "",
    documentType: row.querySelector("[data-insurance-policy-file]")?.name || ""
  }));
}

function validatePolicyEntries(form, showFeedback) {
  const policies = collectPolicyEntries(form);
  const selectedTypes = selectedCoverTypes(form);
  const policyTypes = policies.map((policy) => policy.type);
  if (new Set(policyTypes).size !== policyTypes.length) {
    showFeedback("Add each insurance type only once. Nothing was uploaded or saved.", "error");
    return false;
  }
  const missingPolicies = [...selectedTypes].filter((type) => !policyTypes.includes(type));
  if (missingPolicies.length) {
    const labels = missingPolicies.map((type) => policyByType.get(type)?.label || type);
    showFeedback(`Add policy details for ${labels.join(" and ")} before continuing. Nothing was uploaded or saved.`, "error");
    return false;
  }
  const today = new Date().toISOString().slice(0, 10);
  const expired = policies.find((policy) => policy.expiry < today);
  if (expired) {
    showFeedback(`Enter a future expiry date for ${policyByType.get(expired.type)?.label || "the selected policy"}. Nothing was uploaded or saved.`, "error");
    form.querySelector(`[data-insurance-policy-entry][data-policy-type="${expired.type}"] [data-insurance-policy-expiry]`)?.focus();
    return false;
  }
  return true;
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
  presentationType = serviceType;
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));
  const insuranceSection = await loadOnboardingForm(requestJson, "insurance", form).catch(() => null);
  const documents = await loadOnboardingDocuments(requestJson, "insurance").catch(() => []);
  storedInsuranceDocuments = new Map(documents.map((document) => [document.documentType, document]));
  const policyContainer = document.querySelector("[data-insurance-policy-entries]");
  const policyTemplate = document.querySelector("[data-insurance-policy-template]");
  const addPolicyButton = document.querySelector("[data-insurance-add-policy]");
  if (!(policyContainer instanceof HTMLElement) || !(policyTemplate instanceof HTMLTemplateElement)) return;
  const policies = savedPolicyEntries(insuranceSection?.data);
  for (const policy of policies.length ? policies : [{}]) addPolicyEntry(policyContainer, policyTemplate, policy, showFeedback);
  setInsurancePresentation();

  const ensurePolicyEntry = (type) => {
    const existing = [...policyContainer.querySelectorAll("[data-insurance-policy-entry]")].find((row) => row.dataset.policyType === type);
    if (existing) return existing;
    const blank = [...policyContainer.querySelectorAll("[data-insurance-policy-entry]")].find((row) => !row.dataset.policyType);
    if (blank) {
      configurePolicyEntry(blank, type);
      return blank;
    }
    return addPolicyEntry(policyContainer, policyTemplate, { type }, showFeedback);
  };
  addPolicyButton?.addEventListener("click", () => addPolicyEntry(policyContainer, policyTemplate, {}, showFeedback));
  form.querySelectorAll('input[name="coverTypes"]').forEach((cover) => {
    cover.addEventListener("change", () => {
      if (cover.checked) ensurePolicyEntry(cover.value);
    });
  });

  document.querySelectorAll("[data-insurance-view-switch]").forEach((button) => {
    button.addEventListener("click", () => {
      presentationType = selectedServiceType(button.dataset.insuranceViewSwitch);
      setInsurancePresentation();
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
    if (!validatePolicyEntries(form, showFeedback)) return;
    try {
      const uploaded = await uploadOnboardingFormDocuments(form, "insurance", "[data-insurance-file]", ({ current, total }) => showFeedback(`Uploading insurance document ${current} of ${total} securely…`));
      for (const document of uploaded) {
        const input = form.elements.namedItem(document.documentType);
        if (input instanceof HTMLInputElement) renderStoredDocument(input, document);
      }
      await saveOnboardingForm(requestJson, "insurance", form, { extra: { policies: collectPolicyEntries(form) } });
      showFeedback("Insurance details and selected documents were stored securely. Homle will mark the policy verified only after the document check is complete.");
    } catch (error) {
      showFeedback(error.message || "Homle could not save your insurance details.", "error");
    }
  });
}
