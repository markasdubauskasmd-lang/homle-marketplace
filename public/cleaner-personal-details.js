import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { saveOnboardingForm } from "./cleaner-onboarding-client.js?v=20260801-1";
import { storedCsrf } from "./session-csrf.js";

const draftKey = "homle-cleaner-personal-details-draft-v1";
const draftLifetimeMs = 8 * 60 * 60 * 1000;
const maximumProfilePhotoBytes = 5 * 1024 * 1024;
const acceptedProfilePhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

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

function savedDraft(storage) {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(draftKey) || "{}");
    if (!parsed || typeof parsed !== "object" || Date.now() - Number(parsed.savedAt || 0) > draftLifetimeMs) {
      storage.removeItem(draftKey);
      return {};
    }
    return parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
  } catch {
    return {};
  }
}

function nameParts(displayName) {
  const parts = String(displayName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", middleName: "", lastName: "", preferredName: "" };
  if (parts.length === 1) return { firstName: parts[0], middleName: "", lastName: "", preferredName: parts[0] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts.at(-1),
    preferredName: parts[0]
  };
}

function formFields(form) {
  return Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value)]));
}

function putValue(form, name, value) {
  const control = form.elements.namedItem(name);
  if (!control || value == null || value === "") return;
  if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = value === true || value === "true" || value === "on";
  else control.value = String(value);
}

function personalDetailsComplete(form) {
  return ["firstName", "lastName", "dateOfBirth", "nationality", "mobileNumber", "email", "emergencyName", "emergencyNumber", "emergencyRelationship", "postcode", "houseNumber", "street", "town", "country"]
    .every((name) => String(form.elements.namedItem(name)?.value || "").trim());
}

function renderRail(progress, form) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    const done = key === "personal" ? personalDetailsComplete(form) : steps.get(key)?.done === true;
    node.classList.toggle("is-complete", done);
  });
}

function updateUnderFiveCopy(form) {
  const copy = document.querySelector("[data-under-five-copy]");
  if (copy) copy.textContent = form.elements.livedUnderFiveYears.checked ? "Yes" : "No";
}

export async function setupPersonalDetails({ account, showFeedback, requestJson }) {
  document.title = "Personal details | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const personal = document.querySelector("[data-personal-details]");
  const form = document.querySelector("[data-personal-form]");
  if (overview) overview.hidden = true;
  if (personal) personal.hidden = false;
  if (!(form instanceof HTMLFormElement)) return;

  const [profileResult, availabilityResult, payoutResult, onboardingResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    requestJson("/api/marketplace/cleaner/onboarding/personal")
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "unavailable";
  const progress = onboardingProgress({ account, profile, payoutState, availabilityCount });
  const storage = safeSessionStorage();
  const draft = savedDraft(storage);
  const defaults = {
    ...nameParts(account.displayName),
    email: account.email || "",
    postcode: profile?.serviceAreas?.[0]?.outwardPostcode || "",
    country: "United Kingdom"
  };
  const storedFields = onboardingResult.status === "fulfilled" ? onboardingResult.value.section?.data || {} : {};
  Object.entries({ ...defaults, ...draft, ...storedFields, email: account.email || "" }).forEach(([name, value]) => putValue(form, name, value));

  const photoTitle = document.querySelector("[data-personal-photo-title]");
  const photoCopy = document.querySelector("[data-personal-photo-copy]");
  const photoStatus = document.querySelector("[data-personal-photo-status]");
  const photoPreview = document.querySelector("[data-personal-photo-preview]");
  const photoPlaceholder = document.querySelector("[data-personal-photo-placeholder]");
  const photoInput = document.querySelector("[data-personal-photo-input]");
  const photoButton = document.querySelector("[data-personal-photo-button]");
  let photoObjectUrl = "";

  function showPhoto(blob) {
    if (!(photoPreview instanceof HTMLImageElement)) return;
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
    photoObjectUrl = URL.createObjectURL(blob);
    photoPreview.src = photoObjectUrl;
    photoPreview.hidden = false;
    if (photoPlaceholder) photoPlaceholder.hidden = true;
  }

  async function loadSavedPhoto() {
    try {
      const response = await fetch("/api/marketplace/cleaner/profile-photo", { credentials: "same-origin", headers: { Accept: "image/*" } });
      if (response.status === 404) return;
      if (!response.ok) throw new Error("The saved photo could not be loaded.");
      showPhoto(await response.blob());
      if (photoTitle) photoTitle.textContent = "Profile photo uploaded";
      if (photoStatus) photoStatus.textContent = "Saved securely to your Homle account.";
      if (photoButton) photoButton.textContent = "Change photo";
    } catch {
      if (photoStatus) photoStatus.textContent = "Your saved photo could not be displayed. You can upload it again.";
    }
  }

  photoButton?.addEventListener("click", () => photoInput?.click());
  photoInput?.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    if (!acceptedProfilePhotoTypes.has(file.type)) {
      photoInput.value = "";
      showFeedback("Choose a JPG, PNG or WebP photo.", "error");
      return;
    }
    if (file.size > maximumProfilePhotoBytes) {
      photoInput.value = "";
      showFeedback("The profile photo must be 5 MB or smaller.", "error");
      return;
    }
    const csrf = storedCsrf();
    if (!csrf) {
      showFeedback("Your secure editing token is missing. Sign in again before uploading a photo.", "error");
      return;
    }
    showPhoto(file);
    photoButton.disabled = true;
    photoButton.textContent = "Uploading…";
    if (photoStatus) photoStatus.textContent = "Preparing and securely saving your photo…";
    try {
      const response = await fetch("/api/marketplace/cleaner/profile-photo", {
        method: "PUT",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": file.type, "X-CSRF-Token": csrf },
        body: file
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Homle could not upload your photo.");
      if (photoTitle) photoTitle.textContent = "Profile photo uploaded";
      if (photoCopy) photoCopy.textContent = "Your photo was resized and its metadata was removed before private storage.";
      if (photoStatus) photoStatus.textContent = "Saved securely to your Homle account.";
      showFeedback("Profile photo uploaded securely.");
    } catch (error) {
      if (photoStatus) photoStatus.textContent = "The photo was not saved. Try again.";
      showFeedback(error.message || "Homle could not upload your photo.", "error");
    } finally {
      photoButton.disabled = false;
      photoButton.textContent = "Change photo";
      photoInput.value = "";
    }
  });
  window.addEventListener("pagehide", () => { if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl); }, { once: true });
  void loadSavedPhoto();

  let saveTimer = 0;
  function saveDraft() {
    window.clearTimeout(saveTimer);
    const status = document.querySelector("[data-personal-save-status]");
    if (!storage) {
      if (status) status.textContent = "This browser blocked tab-only draft storage.";
      return;
    }
    try {
      storage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), fields: formFields(form) }));
      if (status) status.textContent = "Progress is saved for this browser tab as you type.";
    } catch {
      if (status) status.textContent = "This browser could not save the tab-only draft.";
    }
    renderRail(progress, form);
  }

  form.addEventListener("input", () => {
    const status = document.querySelector("[data-personal-save-status]");
    if (status) status.textContent = "Saving in this browser tab…";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDraft, 250);
  });
  form.addEventListener("change", () => {
    updateUnderFiveCopy(form);
    saveDraft();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      showFeedback("Complete the required Personal details before continuing.", "error");
      return;
    }
    try {
      await saveOnboardingForm(requestJson, "personal", form);
      storage?.removeItem(draftKey);
      showFeedback("Personal details saved securely to your Homle account.");
      location.assign("/cleaner/registration");
    } catch (error) {
      showFeedback(error.message || "Homle could not save your Personal details.", "error");
    }
  });

  updateUnderFiveCopy(form);
  renderRail(progress, form);
}
