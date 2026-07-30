import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { storedCsrf } from "./session-csrf.js";

const guidance = {
  solo: "Joining solo — no company paperwork needed. You can switch to a business account later without re-onboarding.",
  business: "Choose this if you already trade as a cleaning business. Business records can be added during full onboarding.",
  limited: "Choose this if you operate through a registered limited company. Company details will be required before approval.",
  partnership: "Choose this if you operate with one or more business partners. Partnership details will be required before approval."
};

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

export async function setupBusinessDetails({ account, requestJson, showFeedback }) {
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

  const [profileResult, availabilityResult, payoutResult, detailsResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    requestJson("/api/marketplace/cleaner/data/business-details")
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability) ? availabilityResult.value.availability.length : 0;
  const payoutState = payoutResult.status === "fulfilled" && payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "unavailable";
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));

  const savedType = detailsResult.status === "fulfilled" && guidance[detailsResult.value.section?.payload?.businessType]
    ? detailsResult.value.section.payload.businessType
    : "solo";
  const savedControl = form.elements.namedItem("businessType");
  if (savedControl instanceof RadioNodeList) savedControl.value = savedType;
  setGuidance(savedType);

  async function saveChoice(completionStatus = "draft") {
    const businessType = String(new FormData(form).get("businessType") || "solo");
    const status = document.querySelector("[data-business-save-status]");
    setGuidance(businessType);
    const csrf = storedCsrf();
    if (!csrf) throw new Error("Your secure editing token is missing. Sign in again before saving.");
    try {
      await requestJson("/api/marketplace/cleaner/data/business-details", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ payload: { businessType }, completionStatus })
      });
      if (status) status.textContent = "Progress is saved securely to your Cleaner account.";
    } catch (error) {
      if (status) status.textContent = "Progress could not be saved. Check your connection.";
      throw error;
    }
  }

  form.addEventListener("change", () => saveChoice().catch(() => {}));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveChoice("complete");
      location.assign("/cleaner/registration");
    } catch (error) {
      showFeedback(error.message || "Business details could not be saved.", "error");
    }
  });
}
