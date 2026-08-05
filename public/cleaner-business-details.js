import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { saveOnboardingForm } from "./cleaner-onboarding-client.js?v=20260801-1";

const draftKey = "homle-cleaner-business-details-draft-v1";
const draftLifetimeMs = 8 * 60 * 60 * 1000;
const serviceTypes = new Set(["cleaner", "beautician"]);
const businessTypes = new Set(["solo", "business", "limited", "partnership"]);
const guidance = {
  cleaner: {
    solo: "Joining as a solo cleaner — no company paperwork needed. You can switch to a business account later without re-onboarding.",
    business: "Choose this if you trade as a cleaning business. Add the name clients know you by.",
    limited: "Choose this if your cleaning services operate through a registered limited company.",
    partnership: "Choose this if you provide cleaning services with one or more business partners."
  },
  beautician: {
    solo: "Joining as a solo beautician — no company paperwork needed. You can add a beauty business later without re-onboarding.",
    business: "Choose this if you trade under a beauty or personal-care business name.",
    limited: "Choose this if your beauty services operate through a registered limited company.",
    partnership: "Choose this if you provide beauty services with one or more business partners."
  }
};

function safeSessionStorage() {
  try {
    const probe = `${draftKey}-probe`;
    sessionStorage.setItem(probe, "1");
    sessionStorage.removeItem(probe);
    return sessionStorage;
  } catch {
    return null;
  }
}

function normalizedDraft(value = {}) {
  return {
    serviceType: serviceTypes.has(value.serviceType) ? value.serviceType : "cleaner",
    businessType: businessTypes.has(value.businessType) ? value.businessType : "solo",
    businessName: String(value.businessName || "").trim().slice(0, 160)
  };
}

function savedBusinessDraft(storage) {
  if (!storage) return normalizedDraft();
  try {
    const parsed = JSON.parse(storage.getItem(draftKey) || "{}");
    if (!parsed || Date.now() - Number(parsed.savedAt || 0) > draftLifetimeMs) {
      storage.removeItem(draftKey);
      return normalizedDraft();
    }
    return normalizedDraft(parsed);
  } catch {
    return normalizedDraft();
  }
}

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "business");
    node.classList.toggle("is-complete", key !== "business" && steps.get(key)?.done === true);
  });
}

function businessDraft(form) {
  const fields = new FormData(form);
  const businessName = form.elements.namedItem("businessName");
  return normalizedDraft({
    serviceType: String(fields.get("serviceType") || "cleaner"),
    businessType: String(fields.get("businessType") || "solo"),
    businessName: businessName instanceof HTMLInputElement ? businessName.value : ""
  });
}

function setBusinessPresentation(form, draft) {
  const note = document.querySelector("[data-business-guidance]");
  if (note) note.textContent = guidance[draft.serviceType][draft.businessType];
  const soloLabel = document.querySelector("[data-business-solo-label]");
  const companyLabel = document.querySelector("[data-business-company-label]");
  if (soloLabel) soloLabel.textContent = draft.serviceType === "beautician" ? "Solo beautician" : "Solo cleaner";
  if (companyLabel) companyLabel.textContent = draft.serviceType === "beautician" ? "Beauty business" : "Cleaning business";
  const nameInput = form.elements.namedItem("businessName");
  const requiredMarker = document.querySelector("[data-business-name-required]");
  const businessNameRequired = draft.businessType !== "solo";
  if (requiredMarker instanceof HTMLElement) requiredMarker.hidden = !businessNameRequired;
  if (nameInput instanceof HTMLInputElement) {
    nameInput.disabled = false;
    nameInput.required = businessNameRequired;
  }
}

export async function setupBusinessDetails({ account, showFeedback, requestJson }) {
  document.title = "Business details | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const personalCard = document.querySelector("[data-personal-card]");
  const businessCard = document.querySelector("[data-business-details]");
  const topbar = document.querySelector("[data-business-topbar]");
  const form = document.querySelector("[data-business-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  if (personalCard) personalCard.hidden = true;
  if (businessCard) businessCard.hidden = false;
  if (topbar) topbar.hidden = false;
  if (!(form instanceof HTMLFormElement)) return;

  const [profileResult, availabilityResult, payoutResult, onboardingResult] = await Promise.allSettled([
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
  const progress = onboardingProgress({ account, profile, payoutState, availabilityCount });
  renderRail(progress);

  const storage = safeSessionStorage();
  const saved = onboardingResult.status === "fulfilled" && onboardingResult.value.section?.data
    ? normalizedDraft(onboardingResult.value.section.data)
    : savedBusinessDraft(storage);
  const serviceControl = form.elements.namedItem("serviceType");
  const businessControl = form.elements.namedItem("businessType");
  const businessNameControl = form.elements.namedItem("businessName");
  if (serviceControl instanceof RadioNodeList) serviceControl.value = saved.serviceType;
  if (businessControl instanceof RadioNodeList) businessControl.value = saved.businessType;
  if (businessNameControl instanceof HTMLInputElement) businessNameControl.value = saved.businessName;
  setBusinessPresentation(form, saved);

  function saveChoice() {
    const draft = businessDraft(form);
    const status = document.querySelector("[data-business-save-status]");
    setBusinessPresentation(form, draft);
    if (!storage) {
      if (status) status.textContent = "This browser blocked tab-only draft storage.";
      return;
    }
    try {
      storage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), ...draft }));
      if (status) status.textContent = "Progress is saved for this browser tab as you choose.";
    } catch {
      if (status) status.textContent = "This browser could not save the tab-only draft.";
    }
  }

  form.addEventListener("change", saveChoice);
  businessNameControl?.addEventListener("input", saveChoice);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveChoice();
    const draft = businessDraft(form);
    if (draft.businessType !== "solo" && !draft.businessName) {
      showFeedback("Enter the business name clients should recognise.", "error");
      businessNameControl?.focus();
      return;
    }
    try {
      await saveOnboardingForm(requestJson, "business", form, { extra: draft });
      storage?.removeItem(draftKey);
      showFeedback("Business details saved securely to your Homle account.");
      location.assign("/cleaner/registration");
    } catch (error) {
      showFeedback(error.message || "Homle could not save your Business details.", "error");
    }
  });
}
