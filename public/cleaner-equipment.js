import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-5";
import { storedCsrf } from "./session-csrf.js";

const knownEquipment = new Set(["Vacuum", "Steam cleaner", "Mop & bucket", "Carpet cleaner", "Pressure washer", "Ladder", "Vehicle", "PPE"]);
const knownProducts = new Set(["Cleaning chemicals", "Eco-friendly products"]);
let profile = null;
let otherEquipment = [];
let otherProducts = [];

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "equipment");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function setKitEnabled(form) {
  const own = form.elements.ownEquipment instanceof HTMLInputElement && form.elements.ownEquipment.checked;
  form.querySelectorAll("[data-equipment-item]").forEach((input) => {
    input.disabled = !own;
  });
  const copy = form.querySelector("[data-equipment-own-copy]");
  if (copy) copy.textContent = own ? "Yes" : "No";
  form.querySelector("[data-equipment-grid]")?.classList.toggle("is-disabled", !own);
}

function hydrateEquipment(form, currentProfile) {
  const suppliedEquipment = Array.isArray(currentProfile.equipmentSupplied) ? currentProfile.equipmentSupplied : [];
  const suppliedProducts = Array.isArray(currentProfile.productsSupplied) ? currentProfile.productsSupplied : [];
  otherEquipment = suppliedEquipment.filter((item) => !knownEquipment.has(item));
  otherProducts = suppliedProducts.filter((item) => !knownProducts.has(item));
  const supplied = new Set([...suppliedEquipment, ...suppliedProducts]);
  const own = form.elements.ownEquipment;
  if (own instanceof HTMLInputElement) own.checked = supplied.size > 0;
  form.querySelectorAll("[data-equipment-item]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    input.checked = input.dataset.equipmentKind === "other"
      ? otherEquipment.length + otherProducts.length > 0
      : supplied.has(input.value);
  });
  setKitEnabled(form);
}

function selectedKit(form) {
  if (!(form.elements.ownEquipment instanceof HTMLInputElement) || !form.elements.ownEquipment.checked) {
    return { equipmentSupplied: [], productsSupplied: [] };
  }
  const equipmentSupplied = [];
  const productsSupplied = [];
  let otherSelected = false;
  form.querySelectorAll("[data-equipment-item]:checked").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.equipmentKind === "product") productsSupplied.push(input.value);
    else if (input.dataset.equipmentKind === "other") otherSelected = true;
    else equipmentSupplied.push(input.value);
  });
  if (otherSelected) {
    if (otherEquipment.length + otherProducts.length === 0) equipmentSupplied.push("Other equipment");
    else {
      equipmentSupplied.push(...otherEquipment);
      productsSupplied.push(...otherProducts);
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
    document.querySelector("[data-references]"),
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
    document.querySelector("[data-references-topbar]"),
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

  const [profileResult, availabilityResult, payoutResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account")
  ]);
  profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && (payoutResult.value.payoutAccount?.payoutsEnabled || payoutResult.value.payout?.ready)
    ? "ready"
    : payoutResult.status === "fulfilled" ? "not-started" : "unavailable";
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));
  if (!profile) {
    showFeedback("Equipment could not be loaded. Nothing was changed.", "error");
    return;
  }

  hydrateEquipment(form, profile);
  const status = form.querySelector("[data-equipment-save-status]");
  if (status) status.textContent = "Saved equipment and products are used to support suitable job matching.";

  form.elements.ownEquipment?.addEventListener("change", () => {
    setKitEnabled(form);
    if (status) status.textContent = "Your equipment changes have not been saved yet.";
  });
  form.querySelectorAll("[data-equipment-item]").forEach((input) => {
    input.addEventListener("change", () => {
      if (status) status.textContent = "Your equipment changes have not been saved yet.";
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const kit = selectedKit(form);
    if (form.elements.ownEquipment.checked && kit.equipmentSupplied.length + kit.productsSupplied.length === 0) {
      showFeedback("Choose at least one item you can bring, or switch your own equipment to No.", "error");
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
        body: JSON.stringify(profileUpdate(profile, kit))
      });
      profile = result.profile;
      hydrateEquipment(form, profile);
      showFeedback("Equipment and products saved.", "success");
      location.assign("/cleaner/availability");
    } catch (error) {
      showFeedback(error.message || "Equipment could not be saved.", "error");
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}
