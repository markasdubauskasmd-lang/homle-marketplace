import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { hydrateCleanerForm, loadCleanerSection, saveCleanerSection, uploadCleanerDocument } from "./cleaner-dashboard-data.js?v=20260730-1";

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
  banner.textContent = "Status: Not started — upload your documents below to submit them for review.";
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

  const [profileResult, availabilityResult, payoutResult, sectionResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    loadCleanerSection(requestJson, "identity-verification")
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "unavailable";
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));
  renderVerificationStatus(profile);
  if (sectionResult.status === "fulfilled") hydrateCleanerForm(form, sectionResult.value);

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
      showFeedback("Document selected. Save & continue to upload it securely.");
    });
  });

  form.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type !== "file") {
      const status = document.querySelector("[data-identity-save-status]");
      if (status) status.textContent = "Changes have not been saved yet.";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const documentTypes = { passportPhoto: "passport", licenceFront: "driving-licence", licenceBack: "driving-licence", birthCertificate: "birth-certificate", residencePermit: "residence-permit" };
    const submit = form.querySelector('button[type="submit"]');
    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    try {
      await saveCleanerSection(requestJson, "identity-verification", form, "submitted");
      for (const input of form.querySelectorAll("[data-identity-file]")) {
        if (input instanceof HTMLInputElement && input.files?.[0]) await uploadCleanerDocument(requestJson, input.files[0], documentTypes[input.name] || "other");
      }
      showFeedback("Identity details and selected documents were saved securely for review.", "success");
      location.assign("/cleaner/registration");
    } catch (error) {
      showFeedback(error.message || "Identity details could not be saved.", "error");
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}
