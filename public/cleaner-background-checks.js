import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-3";

const maximumDocumentBytes = 20 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "dbs");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function renderBackgroundStatus(profile) {
  const banner = document.querySelector("[data-background-status]");
  if (!banner) return;
  const status = profile?.backgroundCheckStatus;
  banner.classList.remove("is-pending", "is-action");
  if (!profile) {
    banner.classList.add("is-action");
    banner.textContent = "Status unavailable — Homle could not load the background-check record.";
    return;
  }
  if (status === "verified") {
    banner.textContent = "Status: Verified — Homle has a verified background-check result on record.";
    return;
  }
  if (status === "not-required") {
    banner.textContent = "Status: Not required — Homle has recorded that a background check is not required.";
    return;
  }
  if (status === "pending") {
    banner.classList.add("is-pending");
    banner.textContent = "Status: In review — Homle is waiting for the approved background-check result.";
    return;
  }
  if (status === "failed" || status === "expired") {
    banner.classList.add("is-action");
    banner.textContent = `Status: ${status === "expired" ? "Expired" : "Action required"} — use the approved background-check process when it becomes available.`;
    return;
  }
  banner.classList.add("is-pending");
  banner.textContent = "Status: Not started — secure DBS submission is not connected on this preview.";
  const noDbs = document.querySelector('input[name="dbsLevel"][value="none"]');
  if (status === "not-checked" && noDbs instanceof HTMLInputElement) noDbs.checked = true;
}

function selectedFileCopy(file) {
  const megabytes = Math.max(0.1, file.size / (1024 * 1024)).toFixed(1);
  return `${file.name} · ${megabytes} MB · selected for this page only`;
}

export async function setupBackgroundChecks({ account, showFeedback, requestJson }) {
  document.title = "Background checks | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const personalCard = document.querySelector("[data-personal-card]");
  const businessCard = document.querySelector("[data-business-details]");
  const identityCard = document.querySelector("[data-identity-verification]");
  const backgroundCard = document.querySelector("[data-background-checks]");
  const businessTopbar = document.querySelector("[data-business-topbar]");
  const identityTopbar = document.querySelector("[data-identity-topbar]");
  const backgroundTopbar = document.querySelector("[data-background-topbar]");
  const form = document.querySelector("[data-background-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  if (personalCard) personalCard.hidden = true;
  if (businessCard) businessCard.hidden = true;
  if (identityCard) identityCard.hidden = true;
  if (backgroundCard) backgroundCard.hidden = false;
  if (businessTopbar) businessTopbar.hidden = true;
  if (identityTopbar) identityTopbar.hidden = true;
  if (backgroundTopbar) backgroundTopbar.hidden = false;
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
  renderBackgroundStatus(profile);

  const fileInput = document.querySelector("[data-background-file]");
  fileInput?.addEventListener("change", () => {
    if (!(fileInput instanceof HTMLInputElement)) return;
    const file = fileInput.files?.[0];
    const row = fileInput.closest(".hc-identity-document");
    const copy = row?.querySelector("small");
    const action = row?.querySelector(".hc-identity-document-action");
    if (!file) {
      row?.classList.remove("is-selected");
      return;
    }
    if (!allowedDocumentTypes.has(file.type) || file.size > maximumDocumentBytes) {
      fileInput.value = "";
      row?.classList.remove("is-selected");
      showFeedback("Choose a PDF, JPEG or PNG certificate no larger than 20MB.", "error");
      return;
    }
    row?.classList.add("is-selected");
    if (copy) copy.textContent = selectedFileCopy(file);
    if (action) action.textContent = "Replace";
    showFeedback("Certificate selected for this page only. It has not been uploaded or stored.");
  });

  form.addEventListener("input", () => {
    const status = document.querySelector("[data-background-save-status]");
    if (status) status.textContent = "Sensitive DBS details remain only in this open page and are not stored.";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    showFeedback("Secure DBS storage and verification are not connected yet. Nothing was uploaded, authorised or saved.", "error");
  });
}
