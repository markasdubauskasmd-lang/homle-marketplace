import { commaList, fixedPriceOptionsFromText, fixedPriceOptionsToText, moneyToPence, outwardPostcodes, penceToMoney, preservedServiceAreas, profileCompletion, profileCompletionDetails } from "./cleaner-profile-model.js";

const form = document.querySelector("[data-cleaner-profile-form]");
const controls = document.querySelector("[data-profile-controls]");
const state = document.querySelector("[data-editor-state]");
const stateTitle = document.querySelector("[data-editor-state-title]");
const stateCopy = document.querySelector("[data-editor-state-copy]");
const signIn = document.querySelector("[data-sign-in]");
const retry = document.querySelector("[data-editor-retry]");
const feedback = document.querySelector("[data-editor-feedback]");
const saveButton = document.querySelector("[data-save-profile]");
const saveState = document.querySelector("[data-save-state]");
const completionValue = document.querySelector("[data-completion-value]");
const completionProgress = document.querySelector("[data-completion-progress]");
const completionCopy = document.querySelector("[data-completion-copy]");
const publicControl = form.elements.isPublic;
const publishHelp = document.querySelector("[data-publish-help]");
const serviceRows = [...document.querySelectorAll("[data-service-code]")];
const profileSections = [...document.querySelectorAll("[data-profile-section]")];
const profileStepButtons = [...document.querySelectorAll("[data-profile-step-target]")];
const profileNext = document.querySelector("[data-profile-next]");
const profileNextMark = profileNext.querySelector(":scope > span");
const profileNextTitle = document.querySelector("[data-profile-next-title]");
const profileNextCopy = document.querySelector("[data-profile-next-copy]");
const profileNextAction = document.querySelector("[data-profile-next-action]");
const profileSectionOrder = ["introduction", "services", "boundaries", "review"];
let currentProfile = null;
let dirty = false;
let loading = false;

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function editorState(title, copy, { allowSignIn = false, allowRetry = false, kind = "info" } = {}) {
  state.dataset.kind = kind;
  state.hidden = false;
  stateTitle.textContent = title;
  stateCopy.textContent = copy;
  signIn.hidden = !allowSignIn;
  retry.hidden = !allowRetry;
}

function showFeedback(message, kind = "info") {
  feedback.dataset.kind = kind;
  feedback.textContent = message;
  feedback.hidden = false;
}

function optionalNumber(value, label, minimum, maximum, integer, strict) {
  if (String(value || "").trim() === "") return null;
  const number = Number(value);
  const valid = Number.isFinite(number) && number >= minimum && number <= maximum && (!integer || Number.isInteger(number));
  if (!valid) {
    if (strict) throw new TypeError(`${label} must be ${integer ? "a whole number" : "a number"} between ${minimum} and ${maximum}.`);
    return null;
  }
  return number;
}

function parsedMoney(value, label, required, strict) {
  try { return moneyToPence(value, label, required); } catch (error) { if (strict) throw error; return null; }
}

function parsedList(value, maximumItems, maximumLength, label, strict) {
  try { return commaList(value, maximumItems, maximumLength, label); } catch (error) { if (strict) throw error; return []; }
}

function services(strict) {
  return serviceRows.flatMap((row) => {
    const enabled = row.querySelector("[data-service-enabled]");
    if (!enabled.checked) return [];
    const pricing = row.querySelector("[data-service-pricing]").value;
    const price = row.querySelector("[data-service-price]").value;
    return [{ serviceCode: row.dataset.serviceCode, pricingModel: pricing, pricePence: pricing === "quote" ? null : parsedMoney(price, `${enabled.nextElementSibling?.textContent || "Service"} price`, true, strict) }];
  });
}

function draftProfile(strict = true) {
  let fixedPriceOptions = [];
  let serviceAreas = [];
  try { fixedPriceOptions = fixedPriceOptionsFromText(form.elements.fixedPriceOptions.value); } catch (error) { if (strict) throw error; }
  try { serviceAreas = preservedServiceAreas(outwardPostcodes(form.elements.serviceAreas.value), currentProfile?.serviceAreas); } catch (error) { if (strict) throw error; }
  return {
    biography: form.elements.biography.value.trim(),
    hourlyRatePence: parsedMoney(form.elements.hourlyRate.value, "Hourly rate", false, strict),
    fixedPriceOptions,
    travelRadiusKm: optionalNumber(form.elements.travelRadiusKm.value, "Travel radius", 0.1, 500, false, strict),
    yearsExperience: optionalNumber(form.elements.yearsExperience.value, "Years of experience", 0, 80, true, strict),
    languages: parsedList(form.elements.languages.value, 20, 60, "Language", strict),
    equipmentSupplied: parsedList(form.elements.equipmentSupplied.value, 30, 100, "Equipment", strict),
    productsSupplied: parsedList(form.elements.productsSupplied.value, 30, 100, "Product", strict),
    residentialPreference: form.elements.residentialPreference.checked,
    commercialPreference: form.elements.commercialPreference.checked,
    services: services(strict),
    serviceAreas,
    isPublic: publicControl.checked
  };
}

function updateServiceRow(row) {
  const enabled = row.querySelector("[data-service-enabled]").checked;
  const pricing = row.querySelector("[data-service-pricing]");
  const price = row.querySelector("[data-service-price]");
  pricing.disabled = !enabled;
  price.disabled = !enabled || pricing.value === "quote";
  row.classList.toggle("is-enabled", enabled);
}

function selectProfileSection(key, { focus = true } = {}) {
  const selected = profileSectionOrder.includes(key) ? key : "introduction";
  for (const section of profileSections) section.hidden = section.dataset.profileSection !== selected;
  for (const button of profileStepButtons) {
    const current = button.dataset.profileStepTarget === selected;
    button.classList.toggle("current", current);
    if (current) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  const section = profileSections.find((item) => item.dataset.profileSection === selected);
  if (focus && section) {
    section.focus({ preventScroll: true });
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function updateCompletion() {
  const details = profileCompletionDetails(draftProfile(false));
  const { percent } = details;
  completionValue.textContent = `${percent}%`;
  completionProgress.value = percent;
  completionProgress.textContent = `${percent}%`;
  for (const section of details.sections) {
    const status = document.querySelector(`[data-profile-step-status="${section.key}"]`);
    status.textContent = section.complete ? "Complete" : `${section.completed} of ${section.total}`;
    status.closest("button")?.classList.toggle("complete", section.complete);
  }
  const reviewStatus = document.querySelector('[data-profile-step-status="review"]');
  reviewStatus.textContent = percent === 100 ? "Ready" : `${details.completed} of ${details.total}`;
  reviewStatus.closest("button")?.classList.toggle("complete", percent === 100);
  const nextSection = details.sections.find((section) => !section.complete) || { key: "review", label: "Review and publish", missing: [] };
  const nextIndex = profileSectionOrder.indexOf(nextSection.key);
  profileNextMark.textContent = String(nextIndex + 1);
  profileNextTitle.textContent = nextSection.key === "review" ? "Review your completed profile" : `Complete ${nextSection.label.toLowerCase()}`;
  profileNextCopy.textContent = nextSection.key === "review" ? "All required details are complete. Review visibility and save your choice." : `Still needed: ${nextSection.missing.join(", ")}.`;
  profileNextAction.dataset.profileTarget = nextSection.key;
  profileNextAction.textContent = nextSection.key === "review" ? "Review profile" : `Open ${nextSection.label.toLowerCase()}`;
  if (percent === 100) {
    publicControl.disabled = false;
    completionCopy.textContent = publicControl.checked ? "Complete and visible in public search." : "Complete. You can choose to publish when ready.";
    publishHelp.textContent = "Your profile is complete. Choose whether it should appear in public Cleaner search.";
  } else {
    if (publicControl.checked) publicControl.checked = false;
    publicControl.disabled = true;
    const remaining = details.total - details.completed;
    completionCopy.textContent = `${remaining} required ${remaining === 1 ? "detail remains" : "details remain"}.`;
    publishHelp.textContent = `Complete all ${details.total} required profile details before the public option becomes available.`;
  }
  return details;
}

function setField(name, value) {
  if (form.elements[name]) form.elements[name].value = value ?? "";
}

function populate(profile) {
  currentProfile = profile;
  setField("biography", profile.biography);
  setField("hourlyRate", penceToMoney(profile.hourlyRatePence));
  setField("fixedPriceOptions", fixedPriceOptionsToText(profile.fixedPriceOptions));
  setField("travelRadiusKm", profile.travelRadiusKm);
  setField("yearsExperience", profile.yearsExperience);
  setField("languages", (profile.languages || []).join(", "));
  setField("equipmentSupplied", (profile.equipmentSupplied || []).join(", "));
  setField("productsSupplied", (profile.productsSupplied || []).join(", "));
  setField("serviceAreas", (profile.serviceAreas || []).map((area) => area.outwardPostcode).join(", "));
  form.elements.residentialPreference.checked = profile.residentialPreference === true;
  form.elements.commercialPreference.checked = profile.commercialPreference === true;
  for (const row of serviceRows) {
    const service = (profile.services || []).find((item) => item.serviceCode === row.dataset.serviceCode);
    row.querySelector("[data-service-enabled]").checked = Boolean(service);
    row.querySelector("[data-service-pricing]").value = service?.pricingModel || "hourly";
    row.querySelector("[data-service-price]").value = penceToMoney(service?.pricePence);
    updateServiceRow(row);
  }
  publicControl.checked = profile.isPublic === true;
  const completion = updateCompletion();
  selectProfileSection(completion.sections.find((section) => !section.complete)?.key || "review", { focus: false });
  dirty = false;
  saveState.textContent = "Profile loaded securely.";
}

async function loadProfile() {
  if (loading) return;
  loading = true;
  form.hidden = true;
  controls.disabled = true;
  editorState("Checking secure profile access…", "The form opens only for an authenticated Cleaner account.");
  try {
    const response = await fetch("/api/marketplace/cleaner/profile", { credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) return editorState("Sign in as a Cleaner to edit this profile.", "Your profile is private and cannot be opened without an authenticated Cleaner session.", { allowSignIn: true, kind: "authentication" });
      if (response.status === 403) return editorState("This account does not have the Cleaner role.", "Use a Cleaner account, or return to the workspace selected during onboarding.", { allowSignIn: true, kind: "authentication" });
      if (response.status === 404 || response.status === 503) return editorState("Cleaner accounts are not connected yet.", "The profile editor is ready, but remains closed until Homle's secure marketplace database and account runtime are activated.", { allowRetry: true, kind: "unavailable" });
      throw new Error(result.error || result.message || "The profile could not be loaded.");
    }
    if (!result.profile || typeof result.profile !== "object") throw new Error("The profile response was incomplete.");
    populate(result.profile);
    state.hidden = true;
    form.hidden = false;
    controls.disabled = false;
  } catch (error) {
    editorState("Profile access is temporarily unavailable.", "No information was changed. Check the connection and try again.", { allowRetry: true, kind: "error" });
  } finally {
    loading = false;
  }
}

async function saveProfile(event) {
  event.preventDefault();
  feedback.hidden = true;
  let profile;
  try { profile = draftProfile(true); } catch (error) {
    showFeedback(error.message, "error");
    return;
  }
  const percent = profileCompletion(profile);
  if (profile.isPublic && percent !== 100) {
    showFeedback("Complete every required section before publishing your profile.", "error");
    return;
  }
  const csrf = storedCsrf();
  if (!csrf) {
    showFeedback("Your secure editing token is missing. Sign in again before saving.", "error");
    return;
  }
  saveButton.disabled = true;
  saveButton.setAttribute("aria-busy", "true");
  saveButton.textContent = "Saving…";
  try {
    const response = await fetch("/api/marketplace/cleaner/profile", { method: "PUT", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(profile) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("Your secure session has expired or cannot edit this Cleaner profile. Sign in again.");
      throw new Error(result.error || result.message || "The profile could not be saved.");
    }
    populate(result.profile || profile);
    showFeedback(profile.isPublic ? "Profile saved and marked for public Cleaner search." : "Profile saved privately.", "success");
    saveState.textContent = `Saved at ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date())}.`;
  } catch (error) {
    showFeedback(error.message || "The profile could not be saved. No changes were confirmed.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.removeAttribute("aria-busy");
    saveButton.textContent = "Save progress";
  }
}

for (const row of serviceRows) {
  row.querySelector("[data-service-enabled]").addEventListener("change", () => updateServiceRow(row));
  row.querySelector("[data-service-pricing]").addEventListener("change", () => updateServiceRow(row));
  updateServiceRow(row);
}
for (const button of profileStepButtons) button.addEventListener("click", () => selectProfileSection(button.dataset.profileStepTarget));
for (const button of document.querySelectorAll("[data-profile-continue]")) button.addEventListener("click", () => selectProfileSection(button.dataset.profileContinue));
profileNextAction.addEventListener("click", () => selectProfileSection(profileNextAction.dataset.profileTarget));
form.addEventListener("input", () => { dirty = true; saveState.textContent = "Unsaved changes."; updateCompletion(); });
form.addEventListener("change", () => { dirty = true; saveState.textContent = "Unsaved changes."; updateCompletion(); });
form.addEventListener("submit", saveProfile);
retry.addEventListener("click", loadProfile);
window.addEventListener("beforeunload", (event) => { if (dirty) event.preventDefault(); });
document.querySelector("[data-year]").textContent = new Date().getFullYear();
loadProfile();
