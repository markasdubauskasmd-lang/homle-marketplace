import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260728-6";

const draftKey = "homle-cleaner-business-details-draft-v1";
const draftLifetimeMs = 8 * 60 * 60 * 1000;
const guidance = {
  solo: "Joining solo — no company paperwork needed. You can switch to a business account later without re-onboarding.",
  business: "Choose this if you already trade as a cleaning business. Business records can be added during full onboarding.",
  limited: "Choose this if you operate through a registered limited company. Company details will be required before approval.",
  partnership: "Choose this if you operate with one or more business partners. Partnership details will be required before approval."
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

function savedBusinessType(storage) {
  if (!storage) return "solo";
  try {
    const parsed = JSON.parse(storage.getItem(draftKey) || "{}");
    if (!parsed || Date.now() - Number(parsed.savedAt || 0) > draftLifetimeMs || !guidance[parsed.businessType]) {
      storage.removeItem(draftKey);
      return "solo";
    }
    return parsed.businessType;
  } catch {
    return "solo";
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

function setGuidance(businessType) {
  const note = document.querySelector("[data-business-guidance]");
  if (note) note.textContent = guidance[businessType] || guidance.solo;
}

export async function setupBusinessDetails({ account, requestJson }) {
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
  const progress = onboardingProgress({ account, profile, payoutState, availabilityCount });
  renderRail(progress);

  const storage = safeSessionStorage();
  const savedType = savedBusinessType(storage);
  const savedControl = form.elements.namedItem("businessType");
  if (savedControl instanceof RadioNodeList) savedControl.value = savedType;
  setGuidance(savedType);

  function saveChoice() {
    const businessType = String(new FormData(form).get("businessType") || "solo");
    const status = document.querySelector("[data-business-save-status]");
    setGuidance(businessType);
    if (!storage) {
      if (status) status.textContent = "This browser blocked tab-only draft storage.";
      return;
    }
    try {
      storage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), businessType }));
      if (status) status.textContent = "Progress is saved for this browser tab as you choose.";
    } catch {
      if (status) status.textContent = "This browser could not save the tab-only draft.";
    }
  }

  form.addEventListener("change", saveChoice);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveChoice();
    location.assign("/cleaner/registration");
  });
}
