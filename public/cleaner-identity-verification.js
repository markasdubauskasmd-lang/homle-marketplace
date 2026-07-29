import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-2";

const maximumDocumentBytes = 20 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "identity");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function renderVerificationStatus(profile) {
  const banner = document.querySelector("[data-identity-status]");
  if (!banner) return;
  banner.classList.remove("is-pending", "is-action");
  if (profile?.identityCheckStatus === "verified") {
    banner.textContent = "Status: Verified — Homle has a verified identity result on record.";
    return;
  }
  if (profile?.identityCheckStatus === "pending") {
    banner.classList.add("is-pending");
    banner.textContent = "Status: In review — Homle is waiting for the approved verification result.";
    return;
  }
  if (profile?.identityCheckStatus === "failed" || profile?.identityCheckStatus === "expired") {
    banner.classList.add("is-action");
    banner.textContent = `Status: ${profile.identityCheckStatus === "expired" ? "Expired" : "Action required"} — use the approved verification process when it becomes available.`;
    return;
  }
  banner.classList.add("is-pending");
  banner.textContent = "Status: Not started — secure document submission is not connected on this preview.";
}

function selectedFileCopy(file) {
  const megabytes = Math.max(0.1, file.size / (1024 * 1024)).toFixed(1);
  return `${file.name} · ${megabytes} MB · selected for this page only`;
}

export async function setupIdentityVerification({ account, showFeedback, requestJson }) {
  document.title = "Identity verification | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const personalCard = document.querySelector("[data-personal-card]");
  const businessCard = document.querySelector("[data-business-details]");
  const identityCard = document.querySelector("[data-identity-verification]");
  const businessTopbar = document.querySelector("[data-business-topbar]");
  const identityTopbar = document.querySelector("[data-identity-topbar]");
  const form = document.querySelector("[data-identity-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  if (personalCard) personalCard.hidden = true;
  if (businessCard) businessCard.hidden = true;
  if (identityCard) identityCard.hidden = false;
  if (businessTopbar) businessTopbar.hidden = true;
  if (identityTopbar) identityTopbar.hidden = false;
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
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));
  renderVerificationStatus(profile);

  document.querySelectorAll("[data-identity-file]").forEach((input) => {
    input.addEventListener("change", () => {
      if (!(input instanceof HTMLInputElement)) return;
      const file = input.files?.[0];
      const row = input.closest(".hc-identity-document");
      const copy = row?.querySelector("small");
      const action = row?.querySelector(".hc-identity-document-action");
      if (!file) {
        row?.classList.remove("is-selected");
        return;
      }
      if (!allowedDocumentTypes.has(file.type) || file.size > maximumDocumentBytes) {
        input.value = "";
        row?.classList.remove("is-selected");
        showFeedback("Choose a PDF, JPEG or PNG document no larger than 20MB.", "error");
        return;
      }
      row?.classList.add("is-selected");
      if (copy) copy.textContent = selectedFileCopy(file);
      if (action) action.textContent = "Replace";
      showFeedback("Document selected for this page only. It has not been uploaded or stored.");
    });
  });

  form.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type !== "file") {
      const status = document.querySelector("[data-identity-save-status]");
      if (status) status.textContent = "Sensitive document numbers remain only in this open page and are not stored.";
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    showFeedback("Secure identity-document storage is not connected yet. Nothing was uploaded or saved.", "error");
  });
}
