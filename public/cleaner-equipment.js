import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { saveOnboardingForm } from "./cleaner-onboarding-client.js?v=20260801-1";
import { saveCsrf, storedCsrf } from "./session-csrf.js";

const serviceTypes = new Set(["cleaner", "beautician"]);
const knownEquipment = new Set([
  "Vacuum", "Steam cleaner", "Mop & bucket", "Carpet cleaner", "Pressure washer", "Ladder", "Vehicle", "PPE",
  "Portable treatment bed", "Beauty stool or chair", "Towels and linens", "Sterilisation kit", "LED or UV nail lamp",
  "Hair styling tools", "Waxing kit", "Makeup kit", "Facial and skincare equipment"
]);
const knownProducts = new Set(["Cleaning chemicals", "Eco-friendly products", "Beauty products"]);
let profile = null;
let serviceType = "cleaner";
let equipmentData = {};
let currentOtherProducts = [];

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "equipment");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function selectedServiceType(value) {
  const selected = String(value || "").toLowerCase();
  return serviceTypes.has(selected) ? selected : "cleaner";
}

function normalizedKit(value = {}) {
  return {
    equipmentSupplied: Array.isArray(value.equipmentSupplied) ? value.equipmentSupplied.map(String).filter(Boolean) : [],
    productsSupplied: Array.isArray(value.productsSupplied) ? value.productsSupplied.map(String).filter(Boolean) : []
  };
}

function storedKits(value = {}) {
  return {
    cleaner: normalizedKit(value.kitsByProfession?.cleaner),
    beautician: normalizedKit(value.kitsByProfession?.beautician)
  };
}

function activeGrid(form) {
  return form.querySelector(`[data-equipment-grid="${serviceType}"]`);
}

function activeOtherControl(form) {
  return activeGrid(form)?.querySelector('[data-equipment-kind="other"]');
}

function syncOtherInput(form) {
  const own = form.elements.ownEquipment instanceof HTMLInputElement && form.elements.ownEquipment.checked;
  const selectedOther = activeOtherControl(form);
  const wrapper = form.querySelector("[data-equipment-other]");
  const input = form.elements.otherEquipment;
  const visible = own && selectedOther instanceof HTMLInputElement && selectedOther.checked;
  if (wrapper instanceof HTMLElement) wrapper.hidden = !visible;
  if (input instanceof HTMLInputElement) {
    input.disabled = !visible;
    input.required = visible;
  }
}

function setEquipmentPresentation(form, suppliedServiceType) {
  serviceType = selectedServiceType(suppliedServiceType);
  form.querySelectorAll("[data-equipment-grid]").forEach((grid) => {
    const active = grid.dataset.equipmentGrid === serviceType;
    grid.hidden = !active;
    grid.querySelectorAll("[data-equipment-item]").forEach((input) => { input.disabled = !active; });
  });
  const beautician = serviceType === "beautician";
  const heading = document.querySelector("[data-equipment-heading]");
  const intro = document.querySelector("[data-equipment-intro]");
  const professionLabel = document.querySelector("[data-equipment-profession-label]");
  const ownQuestion = document.querySelector("[data-equipment-own-question]");
  const legend = document.querySelector("[data-equipment-list-legend]");
  const customInput = form.elements.otherEquipment;
  if (heading) heading.textContent = beautician ? "Beauty equipment" : "Cleaning equipment";
  if (intro) intro.textContent = beautician
    ? "Tell us which beauty kit and products you can bring to appointments."
    : "Tell us which cleaning kit and products you can bring to jobs.";
  if (professionLabel) professionLabel.textContent = beautician ? "Beautician equipment" : "Cleaner equipment";
  if (ownQuestion) ownQuestion.textContent = beautician
    ? "Do you provide your own beauty equipment and products?"
    : "Do you provide your own cleaning equipment?";
  if (legend) legend.textContent = beautician ? "Tick the beauty kit you have" : "Tick what you have";
  if (customInput instanceof HTMLInputElement) customInput.placeholder = beautician
    ? "For example: airbrush makeup kit, hot towel cabinet"
    : "For example: floor scrubber, upholstery cleaner";
}

function setKitEnabled(form) {
  const own = form.elements.ownEquipment instanceof HTMLInputElement && form.elements.ownEquipment.checked;
  form.querySelectorAll("[data-equipment-grid]").forEach((grid) => {
    const active = grid.dataset.equipmentGrid === serviceType;
    grid.classList.toggle("is-disabled", active && !own);
    grid.querySelectorAll("[data-equipment-item]").forEach((input) => { input.disabled = !active || !own; });
  });
  const copy = form.querySelector("[data-equipment-own-copy]");
  if (copy) copy.textContent = own ? "Yes" : "No";
  syncOtherInput(form);
}

function hydrateEquipment(form, currentProfile, savedData = {}) {
  const kits = storedKits(savedData);
  const storedKit = kits[serviceType];
  const hasStoredKit = Boolean(savedData.kitsByProfession && Object.prototype.hasOwnProperty.call(savedData.kitsByProfession, serviceType));
  const legacyKit = serviceType === "cleaner" || savedData.serviceType === serviceType
    ? normalizedKit(currentProfile)
    : normalizedKit();
  const kit = hasStoredKit ? storedKit : legacyKit;
  const supplied = new Set([...kit.equipmentSupplied, ...kit.productsSupplied]);
  const customEquipment = kit.equipmentSupplied.filter((item) => !knownEquipment.has(item));
  currentOtherProducts = kit.productsSupplied.filter((item) => !knownProducts.has(item));
  const custom = [...new Set([...customEquipment, ...currentOtherProducts])];
  const own = form.elements.ownEquipment;
  if (own instanceof HTMLInputElement) own.checked = supplied.size > 0;
  form.querySelectorAll("[data-equipment-item]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const active = input.dataset.equipmentProfession === serviceType;
    input.checked = active && (input.dataset.equipmentKind === "other" ? custom.length > 0 : supplied.has(input.value));
  });
  const customInput = form.elements.otherEquipment;
  if (customInput instanceof HTMLInputElement) customInput.value = custom.join(", ");
  setEquipmentPresentation(form, serviceType);
  setKitEnabled(form);
}

function customEquipmentValues(form) {
  const input = form.elements.otherEquipment;
  if (!(input instanceof HTMLInputElement)) return [];
  return [...new Set(input.value.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean))];
}

function selectedKit(form) {
  if (!(form.elements.ownEquipment instanceof HTMLInputElement) || !form.elements.ownEquipment.checked) {
    return { equipmentSupplied: [], productsSupplied: [] };
  }
  const equipmentSupplied = [];
  const productsSupplied = [];
  let otherSelected = false;
  activeGrid(form)?.querySelectorAll("[data-equipment-item]:checked").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.equipmentKind === "product") productsSupplied.push(input.value);
    else if (input.dataset.equipmentKind === "other") otherSelected = true;
    else equipmentSupplied.push(input.value);
  });
  if (otherSelected) {
    const previousProducts = new Set(currentOtherProducts);
    for (const item of customEquipmentValues(form)) {
      if (previousProducts.has(item)) productsSupplied.push(item);
      else equipmentSupplied.push(item);
    }
  }
  return {
    equipmentSupplied: [...new Set(equipmentSupplied)],
    productsSupplied: [...new Set(productsSupplied)]
  };
}

function profileUpdate(currentProfile, kit) {
  return {
    biography: currentProfile.biography || "",
    hourlyRatePence: currentProfile.hourlyRatePence,
    fixedPriceOptions: currentProfile.fixedPriceOptions || [],
    travelRadiusKm: currentProfile.travelRadiusKm,
    yearsExperience: currentProfile.yearsExperience,
    languages: currentProfile.languages || [],
    equipmentSupplied: kit.equipmentSupplied,
    productsSupplied: kit.productsSupplied,
    residentialPreference: currentProfile.residentialPreference === true,
    commercialPreference: currentProfile.commercialPreference === true,
    services: currentProfile.services || [],
    serviceAreas: currentProfile.serviceAreas || [],
    isPublic: currentProfile.isPublic === true
  };
}

async function secureCsrf(requestJson) {
  const existing = storedCsrf();
  if (existing) return existing;
  const session = await requestJson("/api/marketplace/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!session.csrfToken || !saveCsrf(session.csrfToken)) throw new Error("Your secure editing token could not be restored. Sign in again before saving.");
  return session.csrfToken;
}

export async function setupEquipment({ account, showFeedback, requestJson }) {
  document.title = "Equipment | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const cards = [
    document.querySelector("[data-personal-card]"),
    document.querySelector("[data-business-details]"),
    document.querySelector("[data-identity-verification]"),
    document.querySelector("[data-background-checks]"),
    document.querySelector("[data-experience]"),
    document.querySelector("[data-insurance]"),
    document.querySelector("[data-banking]"),
    document.querySelector("[data-availability]"),
    document.querySelector("[data-work-areas]")
  ];
  const equipmentCard = document.querySelector("[data-equipment]");
  const topbars = [
    document.querySelector("[data-business-topbar]"),
    document.querySelector("[data-identity-topbar]"),
    document.querySelector("[data-background-topbar]"),
    document.querySelector("[data-experience-topbar]"),
    document.querySelector("[data-insurance-topbar]"),
    document.querySelector("[data-banking-topbar]"),
    document.querySelector("[data-availability-topbar]"),
    document.querySelector("[data-work-topbar]")
  ];
  const equipmentTopbar = document.querySelector("[data-equipment-topbar]");
  const form = document.querySelector("[data-equipment-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  for (const card of cards) if (card) card.hidden = true;
  if (equipmentCard) equipmentCard.hidden = false;
  for (const topbar of topbars) if (topbar) topbar.hidden = true;
  if (equipmentTopbar) equipmentTopbar.hidden = false;
  if (!(form instanceof HTMLFormElement)) return;

  const [profileResult, availabilityResult, payoutResult, businessResult, equipmentResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    requestJson("/api/marketplace/cleaner/onboarding/business"),
    requestJson("/api/marketplace/cleaner/onboarding/equipment")
  ]);
  profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && (payoutResult.value.payoutAccount?.payoutsEnabled || payoutResult.value.payout?.ready)
    ? "ready"
    : payoutResult.status === "fulfilled" ? "not-started" : "unavailable";
  const businessData = businessResult.status === "fulfilled" ? businessResult.value.section?.data : null;
  equipmentData = equipmentResult.status === "fulfilled" && equipmentResult.value.section?.data ? equipmentResult.value.section.data : {};
  serviceType = selectedServiceType(businessData?.serviceType);
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));
  if (!profile) {
    showFeedback("Equipment could not be loaded. Nothing was changed.", "error");
    return;
  }

  hydrateEquipment(form, profile, equipmentData);
  const status = form.querySelector("[data-equipment-save-status]");
  if (status) status.textContent = `Saved ${serviceType === "beautician" ? "beauty" : "cleaning"} equipment and products support suitable job matching.`;

  form.elements.ownEquipment?.addEventListener("change", () => {
    setKitEnabled(form);
    if (status) status.textContent = "Your equipment changes have not been saved yet.";
  });
  form.querySelectorAll("[data-equipment-item]").forEach((input) => {
    input.addEventListener("change", () => {
      syncOtherInput(form);
      if (status) status.textContent = "Your equipment changes have not been saved yet.";
    });
  });
  form.elements.otherEquipment?.addEventListener("input", () => {
    if (status) status.textContent = "Your equipment changes have not been saved yet.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const customInput = form.elements.otherEquipment;
    const customValues = customEquipmentValues(form);
    if (customInput instanceof HTMLInputElement && customInput.required && !customValues.length) {
      customInput.setCustomValidity("Enter the other equipment you can provide.");
      customInput.reportValidity();
      customInput.setCustomValidity("");
      return;
    }
    if (customValues.some((value) => value.length > 100)) {
      showFeedback("Keep each custom equipment name under 100 characters.", "error");
      customInput?.focus();
      return;
    }
    const kit = selectedKit(form);
    if (form.elements.ownEquipment.checked && kit.equipmentSupplied.length + kit.productsSupplied.length === 0) {
      showFeedback("Choose at least one item you can bring, or switch your own equipment to No.", "error");
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    try {
      const csrf = await secureCsrf(requestJson);
      const kitsByProfession = storedKits(equipmentData);
      kitsByProfession[serviceType] = kit;
      const results = await Promise.all([
        saveOnboardingForm(requestJson, "equipment", form, { extra: { serviceType, kitsByProfession } }),
        requestJson("/api/marketplace/cleaner/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify(profileUpdate(profile, kit))
        })
      ]);
      equipmentData = results[0]?.data || { serviceType, kitsByProfession };
      profile = results[1].profile;
      hydrateEquipment(form, profile, equipmentData);
      showFeedback(`${serviceType === "beautician" ? "Beauty" : "Cleaning"} equipment and products saved.`, "success");
      location.assign("/cleaner/availability");
    } catch (error) {
      showFeedback(error.message || "Equipment could not be saved.", "error");
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}
