import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { loadOnboardingForm, saveOnboardingForm } from "./cleaner-onboarding-client.js?v=20260801-1";

const timeSlotRanges = Object.freeze({
  morning: Object.freeze({ label: "Morning", start: "06:00", end: "12:00" }),
  afternoon: Object.freeze({ label: "Afternoon", start: "12:00", end: "17:00" }),
  evening: Object.freeze({ label: "Evening", start: "17:00", end: "21:00" }),
  night: Object.freeze({ label: "Night", start: "21:00", end: "06:00" })
});

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "availability");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function availabilityStatus(count) {
  if (count === null) return "Confirmed dated availability is temporarily unavailable. Your weekly time slots can still be saved here.";
  const windows = `${count} confirmed future ${count === 1 ? "window remains" : "windows remain"}`;
  return `${windows} unchanged. Your weekly time slots are stored separately in your onboarding profile.`;
}

export async function setupAvailability({ account, showFeedback, requestJson }) {
  document.title = "Availability | Homle";
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
    document.querySelector("[data-work-areas]")
  ];
  const availabilityCard = document.querySelector("[data-availability]");
  const topbars = [
    document.querySelector("[data-business-topbar]"),
    document.querySelector("[data-identity-topbar]"),
    document.querySelector("[data-background-topbar]"),
    document.querySelector("[data-experience-topbar]"),
    document.querySelector("[data-references-topbar]"),
    document.querySelector("[data-insurance-topbar]"),
    document.querySelector("[data-banking-topbar]"),
    document.querySelector("[data-work-topbar]")
  ];
  const availabilityTopbar = document.querySelector("[data-availability-topbar]");
  const form = document.querySelector("[data-availability-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  for (const card of cards) if (card) card.hidden = true;
  if (availabilityCard) availabilityCard.hidden = false;
  for (const topbar of topbars) if (topbar) topbar.hidden = true;
  if (availabilityTopbar) availabilityTopbar.hidden = false;
  if (!(form instanceof HTMLFormElement)) return;

  const [profileResult, availabilityResult, payoutResult, onboardingResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    loadOnboardingForm(requestJson, "availability", form)
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : null;
  const payout = payoutResult.status === "fulfilled" ? payoutResult.value.payout : null;
  const payoutState = payout?.ready ? "ready" : payoutResult.status === "fulfilled" ? "not-started" : "unavailable";
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount: availabilityCount || 0 }));

  const status = form.querySelector("[data-availability-save-status]");
  const savedAvailabilityData = onboardingResult.status === "fulfilled" && onboardingResult.value?.data
    ? onboardingResult.value.data
    : {};
  if (status) {
    status.textContent = onboardingResult.status === "fulfilled"
      ? availabilityStatus(availabilityCount)
      : "Your saved weekly time slots could not be loaded. Refresh before making changes.";
  }

  const hours = form.elements.namedItem("maximumHours");
  const hoursOutput = form.querySelector("[data-availability-hours]");
  const updateHours = () => {
    if (!(hours instanceof HTMLInputElement) || !hoursOutput) return;
    const value = Number(hours.value);
    hoursOutput.textContent = `${value} ${value === 1 ? "hour" : "hours"}`;
  };
  updateHours();
  hours?.addEventListener("input", updateHours);

  form.addEventListener("change", () => {
    if (status) status.textContent = "You have unsaved availability changes.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector('button[type="submit"]');
    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    if (status) status.textContent = "Saving your weekly availability securely…";
    try {
      const timeOff = {};
      if ("holidayMode" in savedAvailabilityData) timeOff.holidayMode = savedAvailabilityData.holidayMode;
      if ("unavailableDate" in savedAvailabilityData) timeOff.unavailableDate = savedAvailabilityData.unavailableDate;
      await saveOnboardingForm(requestJson, "availability", form, { extra: { timeSlotRanges, ...timeOff } });
      if (status) status.textContent = "Weekly time slots, limits and job preferences saved securely.";
      showFeedback("Your weekly availability has been saved.", "success");
      location.assign("/cleaner/onboarding");
    } catch (error) {
      if (status) status.textContent = "Your availability was not saved. Review the message and try again.";
      showFeedback(error.message || "Your availability could not be saved.", "error");
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}
