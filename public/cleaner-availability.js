import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "availability");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function availabilityStatus(count) {
  if (count === null) return "Confirmed availability is temporarily unavailable. Weekly planner choices are not saved.";
  const windows = `${count} confirmed future ${count === 1 ? "window remains" : "windows remain"}`;
  return `${windows} unchanged. Weekly planner choices are not saved.`;
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

  const [profileResult, availabilityResult, payoutResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account")
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : null;
  const payout = payoutResult.status === "fulfilled" ? payoutResult.value.payout : null;
  const payoutState = payout?.ready ? "ready" : payoutResult.status === "fulfilled" ? "not-started" : "unavailable";
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount: availabilityCount || 0 }));

  const status = form.querySelector("[data-availability-save-status]");
  if (status) status.textContent = availabilityStatus(availabilityCount);

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
    if (status) status.textContent = "Availability choices remain on this open page and are not saved.";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    showFeedback("Recurring availability, limits, holiday mode and job preferences are not connected yet. Your existing confirmed windows were not changed.", "error");
  });
}
