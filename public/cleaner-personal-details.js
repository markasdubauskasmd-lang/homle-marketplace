import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260728-3";

const draftKey = "homle-cleaner-personal-details-draft-v1";
const draftLifetimeMs = 8 * 60 * 60 * 1000;

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
  const storage = safeSessionStorage();
  const draft = savedDraft(storage);
  const defaults = {
    ...nameParts(account.displayName),
    email: account.email || "",
    postcode: profile?.serviceAreas?.[0]?.outwardPostcode || "",
    country: "United Kingdom"
  };
  Object.entries({ ...defaults, ...draft, email: account.email || "" }).forEach(([name, value]) => putValue(form, name, value));

  const connectedPhoto = Boolean(profile?.profilePhotoUrl || account.avatarUrl);
  const photoTitle = document.querySelector("[data-personal-photo-title]");
  const photoCopy = document.querySelector("[data-personal-photo-copy]");
  const photoAction = document.querySelector(".hc-personal-photo-action");
  if (photoTitle) photoTitle.textContent = connectedPhoto ? "Profile photo connected" : "No profile photo connected";
  if (photoCopy) photoCopy.textContent = connectedPhoto ? "Homle uses your verified account photo." : "A verified sign-in photo will appear here when available.";
  if (photoAction) photoAction.textContent = connectedPhoto ? "Connected" : "Not connected";

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
  document.querySelector("[data-address-lookup]")?.addEventListener("click", () => {
    form.elements.postcode?.focus();
    showFeedback("Address lookup is not connected yet. Enter the verified address manually; nothing was sent.");
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      showFeedback("Complete the required Personal details before continuing.", "error");
      return;
    }
    saveDraft();
    location.assign("/cleaner/registration");
  });

  updateUnderFiveCopy(form);
  renderRail(progress, form);
}
