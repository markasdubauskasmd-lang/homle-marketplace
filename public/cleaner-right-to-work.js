import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260807-2";
import { loadOnboardingForm, saveOnboardingForm } from "./cleaner-onboarding-client.js?v=20260801-1";
import {
  hydrateOnboardingDocumentInputs,
  selectedDocumentCopy,
  storedDocumentCopy,
  uploadOnboardingFormDocuments,
  validateOnboardingDocument
} from "./cleaner-onboarding-documents.js?v=20260805-1";

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "rtw");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function renderStoredPassport(input, document) {
  input.dataset.stored = "true";
  const row = input.closest(".hc-identity-document");
  row?.classList.add("is-selected");
  const copy = row?.querySelector("small");
  const action = row?.querySelector(".hc-identity-document-action");
  if (copy) copy.textContent = storedDocumentCopy(document);
  if (action) action.textContent = "Replace";
}

function setBranchState(form) {
  const selected = form.elements.namedItem("britishOrIrishCitizen")?.value || "";
  const yes = form.querySelector("[data-rtw-yes]");
  const no = form.querySelector("[data-rtw-no]");
  if (yes instanceof HTMLFieldSetElement) {
    yes.hidden = selected !== "yes";
    yes.disabled = selected !== "yes";
  }
  if (no instanceof HTMLFieldSetElement) {
    no.hidden = selected !== "no";
    no.disabled = selected !== "no";
  }
  const shareCode = form.elements.namedItem("shareCode");
  const dateOfBirth = form.elements.namedItem("rightToWorkDateOfBirth");
  if (shareCode instanceof HTMLInputElement) shareCode.required = selected === "no";
  if (dateOfBirth instanceof HTMLInputElement) dateOfBirth.required = selected === "no";
  const status = document.querySelector("[data-rtw-save-status]");
  if (status) {
    status.textContent = selected === "yes"
      ? "Your passport and consent will be encrypted and stored when you continue."
      : selected === "no"
        ? "Your share code, date of birth and consent will be encrypted and stored when you continue."
        : "Choose Yes or No to see the required right-to-work details.";
  }
}

function passportIsReady(form) {
  const input = form.elements.namedItem("rightToWorkPassport");
  return input instanceof HTMLInputElement && (input.files?.length > 0 || input.dataset.stored === "true");
}

export async function setupRightToWork({ account, showFeedback, requestJson }) {
  document.title = "Right to work | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const cards = document.querySelectorAll(".hc-personal-layout > .hc-personal-card");
  const topbars = document.querySelectorAll(".hc-personal-layout > .hc-business-topbar");
  const card = document.querySelector("[data-right-to-work]");
  const topbar = document.querySelector("[data-rtw-topbar]");
  const form = document.querySelector("[data-rtw-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  cards.forEach((node) => { node.hidden = node !== card; });
  topbars.forEach((node) => { node.hidden = node !== topbar; });
  if (!(form instanceof HTMLFormElement)) return;

  const [profileResult, availabilityResult, payoutResult, onboardingResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    requestJson("/api/marketplace/cleaner/onboarding")
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "unavailable";
  const onboardingSections = onboardingResult.status === "fulfilled" && Array.isArray(onboardingResult.value.sections)
    ? onboardingResult.value.sections
    : [];
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount, onboardingSections }));

  await loadOnboardingForm(requestJson, "rtw", form).catch(() => null);
  await hydrateOnboardingDocumentInputs(requestJson, "rtw", form, "[data-rtw-file]", renderStoredPassport).catch(() => null);
  setBranchState(form);

  form.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "britishOrIrishCitizen") setBranchState(form);
  });

  const passportInput = form.querySelector("[data-rtw-file]");
  passportInput?.addEventListener("change", () => {
    if (!(passportInput instanceof HTMLInputElement)) return;
    const file = passportInput.files?.[0];
    const row = passportInput.closest(".hc-identity-document");
    const copy = row?.querySelector("small");
    const action = row?.querySelector(".hc-identity-document-action");
    if (!file) return;
    try {
      validateOnboardingDocument(file);
      row?.classList.add("is-selected");
      if (copy) copy.textContent = selectedDocumentCopy(file);
      if (action) action.textContent = "Replace";
      showFeedback("Passport ready. Select Save & continue to store it securely.");
    } catch (error) {
      passportInput.value = "";
      row?.classList.remove("is-selected");
      showFeedback(error.message || "Choose a valid passport file.", "error");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const citizenship = form.elements.namedItem("britishOrIrishCitizen")?.value || "";
    if (!form.reportValidity()) return;
    if (citizenship === "yes" && !passportIsReady(form)) {
      showFeedback("Upload your passport photo page before continuing.", "error");
      passportInput?.focus();
      return;
    }
    try {
      if (citizenship === "yes") {
        const uploaded = await uploadOnboardingFormDocuments(form, "rtw", "[data-rtw-file]", () => showFeedback("Uploading your passport securely…"));
        if (uploaded[0] && passportInput instanceof HTMLInputElement) renderStoredPassport(passportInput, uploaded[0]);
      }
      await saveOnboardingForm(requestJson, "rtw", form);
      showFeedback("Your right-to-work details were stored securely.");
      location.assign("/cleaner/background-checks");
    } catch (error) {
      showFeedback(error.message || "Homle could not save your right-to-work details.", "error");
    }
  });
}
