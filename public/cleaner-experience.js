import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { saveOnboardingForm } from "./cleaner-onboarding-client.js?v=20260801-1";
import { storedCsrf } from "./session-csrf.js";
import { hydrateOnboardingDocumentInputs, selectedDocumentCopy, storedDocumentCopy, uploadOnboardingFormDocuments, validateOnboardingDocument } from "./cleaner-onboarding-documents.js?v=20260805-1";

const serviceTypes = new Set(["cleaner", "beautician"]);
const cleanerSpecialisms = [
  { value: "regular-domestic", profileService: "regular-domestic" },
  { value: "communal-areas", profileService: "communal-areas" },
  { value: "rental-turnovers", profileService: "rental-turnovers" },
  { value: "airbnb" },
  { value: "deep-cleans", profileService: "deep-cleans" },
  { value: "end-of-tenancy", profileService: "end-of-tenancy" },
  { value: "workplaces", profileService: "workplaces" },
  { value: "builders-cleans" },
  { value: "carpet-cleaning" },
  { value: "oven-cleaning" },
  { value: "window-cleaning" },
  { value: "biohazard-cleaning" },
  { value: "school-cleaning" },
  { value: "medical-cleaning" },
  { value: "care-home-cleaning" },
  { value: "hotel-cleaning" },
  { value: "cleaning-other" }
];
const beauticianSpecialisms = [
  "beauty-hair-cutting", "beauty-hair-styling", "beauty-hair-colouring", "beauty-blow-dry",
  "beauty-makeup", "beauty-bridal-makeup", "beauty-manicure", "beauty-pedicure", "beauty-gel-nails",
  "beauty-acrylic-nails", "beauty-facials", "beauty-skincare", "beauty-waxing", "beauty-threading",
  "beauty-eyebrows", "beauty-eyelashes", "beauty-massage", "beauty-spray-tanning", "beauty-other"
];
const specialismsByService = {
  cleaner: new Set(cleanerSpecialisms.map((option) => option.value)),
  beautician: new Set(beauticianSpecialisms)
};
const managedServiceCodes = new Set(cleanerSpecialisms.map((option) => option.profileService).filter(Boolean));
let profile = null;
let originalYearsBucket = "";

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "experience");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function yearsBucket(years) {
  if (!Number.isFinite(years)) return "";
  if (years < 1) return "0";
  if (years < 3) return "1";
  if (years < 6) return "3";
  if (years < 11) return "6";
  return "11";
}

function selectedServiceType(form) {
  const value = String(new FormData(form).get("serviceType") || "");
  return serviceTypes.has(value) ? value : "cleaner";
}

function selectedSpecialisms(form, serviceType = selectedServiceType(form)) {
  return [...form.querySelectorAll(`[data-experience-specialisms="${serviceType}"] input[name="specialisms"]:checked`)]
    .map((input) => input.value)
    .filter((value) => specialismsByService[serviceType].has(value));
}

function setExperiencePresentation(form, suppliedServiceType) {
  const serviceType = serviceTypes.has(suppliedServiceType) ? suppliedServiceType : "cleaner";
  form.querySelectorAll("[data-experience-specialisms]").forEach((group) => {
    const active = group.dataset.experienceSpecialisms === serviceType;
    group.hidden = !active;
    group.querySelectorAll('input[name="specialisms"]').forEach((input) => { input.disabled = !active; });
  });
  const title = document.querySelector("[data-experience-specialisms-title]");
  const yearsLabel = document.querySelector("[data-experience-years-label]");
  const guidance = document.querySelector("[data-experience-guidance]");
  const status = document.querySelector("[data-experience-save-status]");
  if (title) title.textContent = `${serviceType === "beautician" ? "Beautician" : "Cleaner"} specialisms — tick all that apply`;
  if (yearsLabel) yearsLabel.textContent = `Years of ${serviceType === "beautician" ? "beauty" : "cleaning"} experience`;
  if (guidance) guidance.textContent = serviceType === "beautician"
    ? "Tick every beauty specialism you’re confident in. Your choices are stored securely with your onboarding information."
    : "Tick every cleaning specialism you’re confident in. Your choices are stored securely; connected cleaning services also support matching.";
  if (status) status.textContent = `Your ${serviceType} experience and selected specialisms are saved securely when you continue.`;
}

function selectedServices(form, currentProfile) {
  const selectedCodes = new Set(
    (selectedServiceType(form) === "cleaner" ? [...form.querySelectorAll('[data-experience-specialisms="cleaner"] [data-profile-service]:checked')] : [])
      .map((input) => input.dataset.profileService)
      .filter(Boolean)
  );
  const preserved = (currentProfile.services || []).filter((service) => !managedServiceCodes.has(service.serviceCode));
  const managed = [...selectedCodes].map((serviceCode) => {
    const existing = (currentProfile.services || []).find((service) => service.serviceCode === serviceCode);
    return existing || { serviceCode, pricingModel: "quote", pricePence: null };
  });
  return [...preserved, ...managed];
}

function profileUpdate(currentProfile, form) {
  const selectedBucket = form.elements.yearsExperience.value;
  const yearsExperience = selectedBucket === originalYearsBucket && Number.isFinite(currentProfile.yearsExperience)
    ? currentProfile.yearsExperience
    : Number(selectedBucket);
  return {
    biography: currentProfile.biography || "",
    hourlyRatePence: currentProfile.hourlyRatePence,
    fixedPriceOptions: currentProfile.fixedPriceOptions || [],
    travelRadiusKm: currentProfile.travelRadiusKm,
    yearsExperience,
    languages: currentProfile.languages || [],
    equipmentSupplied: currentProfile.equipmentSupplied || [],
    productsSupplied: currentProfile.productsSupplied || [],
    residentialPreference: currentProfile.residentialPreference === true,
    commercialPreference: currentProfile.commercialPreference === true,
    services: selectedServices(form, currentProfile),
    serviceAreas: currentProfile.serviceAreas || [],
    isPublic: selectedServiceType(form) === "cleaner" && currentProfile.isPublic === true
  };
}

function hydrateExperience(form, currentProfile, experienceData = {}, businessData = {}) {
  const select = form.elements.yearsExperience;
  originalYearsBucket = yearsBucket(currentProfile.yearsExperience);
  if (select instanceof HTMLSelectElement) select.value = experienceData.yearsExperience == null
    ? originalYearsBucket
    : String(experienceData.yearsExperience);
  const serviceType = serviceTypes.has(experienceData.serviceType)
    ? experienceData.serviceType
    : (serviceTypes.has(businessData.serviceType) ? businessData.serviceType : "cleaner");
  const serviceControl = form.elements.namedItem("serviceType");
  if (serviceControl instanceof RadioNodeList) serviceControl.value = serviceType;
  const storedSpecialisms = Array.isArray(experienceData.specialisms)
    ? experienceData.specialisms.filter((value) => specialismsByService[serviceType].has(String(value))).map(String)
    : [];
  const selected = storedSpecialisms.length
    ? new Set(storedSpecialisms)
    : new Set(serviceType === "cleaner" ? (currentProfile.services || []).map((service) => service.serviceCode) : []);
  form.querySelectorAll('input[name="specialisms"]').forEach((input) => { input.checked = selected.has(input.value); });
  setExperiencePresentation(form, serviceType);
}

function renderExperienceDocument(input, copyText) {
  const row = input.closest("label");
  row?.classList.add("is-selected");
  const copy = row?.querySelector("small");
  const action = row?.querySelector(".hc-experience-upload-action");
  if (copy) copy.textContent = copyText;
  if (action) action.textContent = "Replace";
}

export async function setupExperience({ account, showFeedback, requestJson }) {
  document.title = "Skills and Experience | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const cards = [
    document.querySelector("[data-personal-card]"),
    document.querySelector("[data-business-details]"),
    document.querySelector("[data-identity-verification]"),
    document.querySelector("[data-background-checks]"),
    document.querySelector("[data-work-areas]")
  ];
  const experienceCard = document.querySelector("[data-experience]");
  const topbars = [
    document.querySelector("[data-business-topbar]"),
    document.querySelector("[data-identity-topbar]"),
    document.querySelector("[data-background-topbar]"),
    document.querySelector("[data-work-topbar]")
  ];
  const experienceTopbar = document.querySelector("[data-experience-topbar]");
  const form = document.querySelector("[data-experience-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  for (const card of cards) if (card) card.hidden = true;
  if (experienceCard) experienceCard.hidden = false;
  for (const topbar of topbars) if (topbar) topbar.hidden = true;
  if (experienceTopbar) experienceTopbar.hidden = false;
  if (!(form instanceof HTMLFormElement)) return;

  const [profileResult, availabilityResult, payoutResult, experienceResult, businessResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    requestJson("/api/marketplace/cleaner/onboarding/experience"),
    requestJson("/api/marketplace/cleaner/onboarding/business")
  ]);
  profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "unavailable";
  const experienceSection = experienceResult.status === "fulfilled" ? experienceResult.value.section : null;
  const businessSection = businessResult.status === "fulfilled" ? businessResult.value.section : null;
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));
  if (!profile) {
    showFeedback("Skills and Experience could not be loaded. Nothing was changed.", "error");
    return;
  }
  hydrateExperience(form, profile, experienceSection?.data, businessSection?.data);
  await hydrateOnboardingDocumentInputs(requestJson, "experience", form, "[data-experience-file]", (input, document) => renderExperienceDocument(input, storedDocumentCopy(document))).catch(() => null);

  form.querySelectorAll('input[name="serviceType"]').forEach((input) => {
    input.addEventListener("change", () => setExperiencePresentation(form, selectedServiceType(form)));
  });

  form.querySelectorAll("[data-experience-file]").forEach((input) => {
    input.addEventListener("change", () => {
      if (!(input instanceof HTMLInputElement)) return;
      const file = input.files?.[0];
      if (!file) return;
      try {
        validateOnboardingDocument(file);
        renderExperienceDocument(input, selectedDocumentCopy(file));
        showFeedback("Document ready. Select Save & continue to store it securely.");
      } catch (error) {
        input.value = "";
        showFeedback(error.message, "error");
      }
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const serviceType = selectedServiceType(form);
    const specialisms = selectedSpecialisms(form, serviceType);
    if (!form.elements.yearsExperience.value) {
      showFeedback(`Choose your years of ${serviceType === "beautician" ? "beauty" : "cleaning"} experience before saving.`, "error");
      form.elements.yearsExperience.focus();
      return;
    }
    if (!specialisms.length) {
      showFeedback(`Choose at least one ${serviceType === "beautician" ? "beauty" : "cleaning"} specialism before saving.`, "error");
      form.querySelector(`[data-experience-specialisms="${serviceType}"] input`)?.focus();
      return;
    }
    const csrf = storedCsrf();
    if (!csrf) {
      showFeedback("Your secure editing token is missing. Sign in again before saving.", "error");
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    try {
      const uploaded = await uploadOnboardingFormDocuments(form, "experience", "[data-experience-file]", ({ current, total }) => showFeedback(`Uploading document ${current} of ${total} securely…`));
      for (const document of uploaded) {
        const input = form.elements.namedItem(document.documentType);
        if (input instanceof HTMLInputElement) renderExperienceDocument(input, storedDocumentCopy(document));
      }
      const operations = [
        saveOnboardingForm(requestJson, "experience", form, { extra: { serviceType, specialisms } }),
        requestJson("/api/marketplace/cleaner/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify(profileUpdate(profile, form))
        })
      ];
      if (businessSection?.data) {
        operations.push(requestJson("/api/marketplace/cleaner/onboarding/business", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ status: businessSection.status === "submitted" ? "submitted" : "draft", data: { ...businessSection.data, serviceType } })
        }));
      }
      const results = await Promise.all(operations);
      profile = results[1].profile;
      hydrateExperience(form, profile, results[0]?.data || { serviceType, specialisms, yearsExperience: form.elements.yearsExperience.value }, { serviceType });
      showFeedback(`${serviceType === "beautician" ? "Beautician" : "Cleaner"} Skills and Experience saved securely.`, "success");
      location.assign("/cleaner/registration");
    } catch (error) {
      showFeedback(error.message || "Skills and Experience could not be saved.", "error");
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}
