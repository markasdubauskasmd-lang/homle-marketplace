import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { storedCsrf } from "./session-csrf.js";
import { hydrateCleanerForm, loadCleanerSection, saveCleanerSection, uploadCleanerDocument } from "./cleaner-dashboard-data.js?v=20260730-1";

const experienceOptions = [
  { label: "Domestic", serviceCode: "regular-domestic" },
  { label: "Commercial", serviceCode: "communal-areas" },
  { label: "Holiday lets", serviceCode: "rental-turnovers" },
  { label: "Airbnb", serviceCode: "" },
  { label: "Deep cleaning", serviceCode: "deep-cleans" },
  { label: "End of tenancy", serviceCode: "end-of-tenancy" },
  { label: "Office cleaning", serviceCode: "workplaces" },
  { label: "Builders cleans", serviceCode: "" },
  { label: "Carpet cleaning", serviceCode: "" },
  { label: "Oven cleaning", serviceCode: "" },
  { label: "Window cleaning", serviceCode: "" },
  { label: "Biohazard cleaning", serviceCode: "" },
  { label: "School cleaning", serviceCode: "" },
  { label: "Medical cleaning", serviceCode: "" },
  { label: "Care home cleaning", serviceCode: "" },
  { label: "Hotel cleaning", serviceCode: "" },
  { label: "Other", serviceCode: "" }
];

const managedServiceCodes = new Set(experienceOptions.map((option) => option.serviceCode).filter(Boolean));
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

function selectedServices(form, currentProfile) {
  const selectedCodes = new Set(
    [...form.querySelectorAll("[data-experience-service]:checked")]
      .map((input) => input.dataset.experienceService)
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
    isPublic: currentProfile.isPublic === true
  };
}

function hydrateExperience(form, currentProfile) {
  const select = form.elements.yearsExperience;
  originalYearsBucket = yearsBucket(currentProfile.yearsExperience);
  if (select instanceof HTMLSelectElement) select.value = originalYearsBucket;
  const currentCodes = new Set((currentProfile.services || []).map((service) => service.serviceCode));
  form.querySelectorAll("[data-experience-service]").forEach((input) => {
    input.checked = currentCodes.has(input.dataset.experienceService);
  });
}

export async function setupExperience({ account, showFeedback, requestJson }) {
  document.title = "Cleaning experience | Homle";
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

  const [profileResult, availabilityResult, payoutResult, sectionResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    loadCleanerSection(requestJson, "experience")
  ]);
  profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "unavailable";
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));
  if (!profile) {
    showFeedback("Cleaning experience could not be loaded. Nothing was changed.", "error");
    return;
  }
  hydrateExperience(form, profile);
  if (sectionResult.status === "fulfilled") hydrateCleanerForm(form, sectionResult.value);

  for (const input of form.querySelectorAll("[data-experience-file]")) {
    input.addEventListener("change", () => {
      if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
      showFeedback(`${input.files[0].name} is ready to upload when you save.`);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.elements.yearsExperience.value) {
      showFeedback("Choose your years of cleaning experience before saving.", "error");
      form.elements.yearsExperience.focus();
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
      const result = await requestJson("/api/marketplace/cleaner/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(profileUpdate(profile, form))
      });
      profile = result.profile;
      await saveCleanerSection(requestJson, "experience", form, "complete");
      const documentTypes = { cv: "cv", cleaningCertificates: "training-certificate", coshhCertificate: "training-certificate", healthSafetyCertificate: "training-certificate" };
      for (const input of form.querySelectorAll("[data-experience-file]")) {
        if (input instanceof HTMLInputElement && input.files?.[0]) await uploadCleanerDocument(requestJson, input.files[0], documentTypes[input.name] || "other");
      }
      hydrateExperience(form, profile);
      showFeedback("Cleaning experience, employment history and selected documents saved.", "success");
      location.assign("/cleaner/registration");
    } catch (error) {
      showFeedback(error.message || "Cleaning experience could not be saved.", "error");
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}
