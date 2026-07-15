import { saveBriefHandoff } from "./brief-handoff.js";
import { newSubmissionKey } from "./submission-key.js";
import { parseCleanerTravelAreas } from "./travel-coverage.js";
import { isPhone, isUkPostcode } from "./contact-validation.js";
import { cleanerApplicationPreview } from "./cleaner-application-preview.js";
import { cleanerApplicationDraftFields, cleanerApplicationDraftServices, clearCleanerApplicationDraft, readCleanerApplicationDraft, saveCleanerApplicationDraft } from "./cleaner-application-draft.js";

const pendingSubmissions = new WeakMap();
const cleanerDraftControls = new WeakMap();

const focusedEntryRoutes = {
  "/request": { kind: "request", target: "request-cleaning", title: "Request a clean — Tideway", description: "Request a Tideway clean in three short steps, then scan the rooms and turn spoken notes into a clear cleaner checklist." },
  "/join": { kind: "join", target: "cleaner-application", title: "Apply as a cleaner — Tideway", description: "Apply to join the Tideway cleaning pilot and choose your travel areas, services and first available work window." }
};
const focusedEntryRoute = focusedEntryRoutes[location.pathname] || null;
if (focusedEntryRoute) {
  document.body.classList.add("entry-route", `entry-route-${focusedEntryRoute.kind}`);
  document.title = focusedEntryRoute.title;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = focusedEntryRoute.description;
  history.replaceState(null, "", `${location.pathname}${location.search}#${focusedEntryRoute.target}`);
}

const menuButton = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");

if (menuButton && mainNav) {
  menuButton.addEventListener("click", () => {
    const open = mainNav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  mainNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      mainNav.classList.remove("open");
      menuButton.setAttribute("aria-expanded", "false");
    }
  });
}

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

document.querySelectorAll('input[type="date"]').forEach((input) => {
  const now = new Date();
  input.min = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10);
});

function formToJson(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    data[checkbox.name] = checkbox.checked;
  });
  return data;
}

function showError(form, messages) {
  const summary = form.querySelector(".error-summary");
  summary.textContent = Array.isArray(messages) ? messages.join(" ") : messages;
  summary.hidden = false;
  summary.focus();
}

const guidedForms = new WeakMap();

function validateStructuredContactFields(form, scope = form) {
  const checks = [
    { input: scope.querySelector('input[name="postcode"]'), valid: isUkPostcode, message: "Enter a valid UK postcode, for example SW1A 1AA." },
    { input: scope.querySelector('input[name="phone"]'), valid: isPhone, message: "Enter a valid phone number with 10 to 15 digits." }
  ];
  for (const check of checks) {
    if (!check.input) continue;
    check.input.setCustomValidity("");
    if (check.input.value.trim() && !check.valid(check.input.value)) {
      check.input.setCustomValidity(check.message);
      showError(form, check.message);
      check.input.reportValidity();
      check.input.focus();
      return false;
    }
  }
  return true;
}

function enhanceGuidedForm(form) {
  const steps = Array.from(form.querySelectorAll("[data-guided-step]"));
  const progress = form.querySelector("[data-guided-progress]");
  if (steps.length < 2 || !progress) return;

  let currentStep = 1;
  const lastStep = steps.length;
  const summary = form.querySelector(".error-summary");

  function showStep(stepNumber, moveFocus = true) {
    currentStep = Math.max(1, Math.min(lastStep, stepNumber));
    steps.forEach((step) => {
      step.hidden = Number(step.dataset.guidedStep) !== currentStep;
    });
    progress.querySelectorAll("[data-guided-progress-step]").forEach((item) => {
      const itemStep = Number(item.dataset.guidedProgressStep);
      item.classList.toggle("complete", itemStep < currentStep);
      item.classList.toggle("current", itemStep === currentStep);
      if (itemStep === currentStep) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    summary.hidden = true;
    form.dataset.currentGuidedStep = String(currentStep);
    if (moveFocus) {
      const heading = steps[currentStep - 1].querySelector(".guided-step-heading");
      heading?.focus({ preventScroll: true });
      steps[currentStep - 1].scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function validateCurrentStep() {
    if (!validateStructuredContactFields(form, steps[currentStep - 1])) return false;
    const travelAreas = steps[currentStep - 1].querySelector('input[name="travelAreas"]');
    if (travelAreas) {
      travelAreas.setCustomValidity("");
      if (travelAreas.value.trim() && !parseCleanerTravelAreas(travelAreas.value).valid) {
        const message = "Add at least one postcode district or comma-separated postcode area, for example SW1A, SW4, or SW, SE.";
        travelAreas.setCustomValidity(message);
        showError(form, message);
        travelAreas.reportValidity();
        travelAreas.focus();
        return false;
      }
    }
    const serviceGroup = steps[currentStep - 1].querySelector("[data-service-group]");
    if (serviceGroup && !serviceGroup.querySelector('input[type="checkbox"]:checked')) {
      showError(form, "Choose at least one type of cleaning work before continuing.");
      serviceGroup.querySelector('input[type="checkbox"]')?.focus();
      return false;
    }
    const controls = Array.from(steps[currentStep - 1].querySelectorAll("input, select, textarea"));
    const invalid = controls.find((control) => !control.checkValidity());
    if (!invalid) return true;
    showError(form, "Complete the highlighted details before continuing.");
    invalid.reportValidity();
    invalid.focus();
    return false;
  }

  const wizard = {
    advance() {
      if (!validateCurrentStep()) return false;
      if (currentStep < lastStep) showStep(currentStep + 1);
      return true;
    },
    back() {
      if (currentStep > 1) showStep(currentStep - 1);
    },
    isFinal() {
      return currentStep === lastStep;
    },
    complete() {
      progress.hidden = true;
      steps.forEach((step) => { step.hidden = true; });
      delete form.dataset.currentGuidedStep;
    },
    restore(stepNumber) {
      showStep(stepNumber, false);
    }
  };

  form.querySelectorAll("[data-guided-next]").forEach((button) => {
    button.addEventListener("click", () => wizard.advance());
  });
  form.querySelectorAll("[data-guided-back]").forEach((button) => {
    button.addEventListener("click", () => wizard.back());
  });
  form.querySelector('input[name="travelAreas"]')?.addEventListener("input", (event) => {
    event.currentTarget.setCustomValidity("");
  });

  form.classList.add("guided-form-ready");
  guidedForms.set(form, wizard);
  showStep(1, false);
}

document.querySelectorAll("[data-guided-form]").forEach(enhanceGuidedForm);

function readCleanerPreviewInput(form) {
  const value = (name) => form.elements.namedItem(name)?.value || "";
  const checked = (name) => form.elements.namedItem(name)?.checked === true;
  return {
    fullName: value("fullName"),
    travelAreas: value("travelAreas"),
    experience: value("experience"),
    professionalBio: value("professionalBio"),
    languages: value("languages"),
    equipmentPlan: value("equipmentPlan"),
    firstAvailableDate: value("firstAvailableDate"),
    firstAvailableStartTime: value("firstAvailableStartTime"),
    firstAvailableEndTime: value("firstAvailableEndTime"),
    serviceTurnovers: checked("serviceTurnovers"),
    serviceEndOfTenancy: checked("serviceEndOfTenancy"),
    serviceWorkplaces: checked("serviceWorkplaces"),
    serviceCommunal: checked("serviceCommunal"),
    serviceDeepCleans: checked("serviceDeepCleans")
  };
}

function enhanceCleanerApplicationPreview(form) {
  const preview = form.querySelector("[data-cleaner-application-preview]");
  if (!preview) return;
  const serviceList = preview.querySelector("[data-cleaner-preview-services]");

  function render() {
    const model = cleanerApplicationPreview(readCleanerPreviewInput(form));
    preview.querySelector("[data-cleaner-preview-initials]").textContent = model.initials;
    preview.querySelector("[data-cleaner-preview-name]").textContent = model.name;
    preview.querySelector("[data-cleaner-preview-bio]").textContent = model.bio;
    preview.querySelector("[data-cleaner-preview-experience]").textContent = model.experience;
    preview.querySelector("[data-cleaner-preview-languages]").textContent = model.languages.length ? model.languages.join(", ") : "Not added yet";
    preview.querySelector("[data-cleaner-preview-equipment]").textContent = model.equipment;
    preview.querySelector("[data-cleaner-preview-travel]").textContent = model.travelAreas;
    preview.querySelector("[data-cleaner-preview-availability]").textContent = model.firstAvailability;
    preview.querySelector("[data-cleaner-preview-completion]").textContent = `${model.completion.completed} of ${model.completion.total} preview details ready`;
    const progress = preview.querySelector("[data-cleaner-preview-progress]");
    progress.value = model.completion.completed;
    progress.max = model.completion.total;
    progress.setAttribute("aria-valuetext", `${model.completion.percent}% complete`);
    preview.querySelector("[data-cleaner-preview-missing]").textContent = model.completion.missing.length
      ? `Preview still needs: ${model.completion.missing.join(", ")}.`
      : "All preview details are ready for application review.";
    serviceList.replaceChildren(...(model.services.length ? model.services : ["Choose at least one service"]).map((label) => {
      const chip = document.createElement("span");
      chip.textContent = label;
      return chip;
    }));
  }

  form.addEventListener("input", render);
  form.addEventListener("change", render);
  render();
}

document.querySelectorAll('form[data-guided-kind="cleaner"]').forEach(enhanceCleanerApplicationPreview);

function cleanerDraftInput(form) {
  return {
    fields: Object.fromEntries(Object.keys(cleanerApplicationDraftFields).map((name) => [name, form.elements.namedItem(name)?.value || ""])),
    services: Object.fromEntries(cleanerApplicationDraftServices.map((name) => [name, form.elements.namedItem(name)?.checked === true])),
    currentStep: Number(form.dataset.currentGuidedStep) || 1
  };
}

function cleanerDraftHasContent(form) {
  const input = cleanerDraftInput(form);
  return Object.entries(input.fields).some(([name, value]) => name !== "transport" && value.trim()) || Object.values(input.services).some(Boolean);
}

function enhanceCleanerApplicationDraft(form) {
  const status = form.querySelector("[data-cleaner-draft-status]");
  if (!status) return;
  const title = status.querySelector("[data-cleaner-draft-title]");
  const copy = status.querySelector("[data-cleaner-draft-copy]");
  const discard = status.querySelector("[data-cleaner-draft-discard]");
  let saveTimer = null;
  let restored = false;
  let submitted = false;
  let online = navigator.onLine !== false;

  function render() {
    status.classList.toggle("is-offline", !online);
    discard.hidden = !cleanerDraftHasContent(form);
    if (!online) {
      title.textContent = "You are offline — your application is protected";
      copy.textContent = "Reconnect before submitting. Entries remain in this tab; eligibility and consent confirmations are never restored.";
    } else if (restored) {
      title.textContent = "Your application entries were recovered";
      copy.textContent = "Review every field and confirm right-to-work and privacy consent again before submitting.";
    } else {
      title.textContent = "Private reload protection is on";
      copy.textContent = "Your application entries stay in this tab for up to 30 minutes. Eligibility and consent confirmations are never restored.";
    }
  }

  function save() {
    clearTimeout(saveTimer);
    if (submitted) return;
    try { saveCleanerApplicationDraft(window.sessionStorage, cleanerDraftInput(form)); } catch {}
    if (!cleanerDraftHasContent(form)) restored = false;
    render();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
    render();
  }

  let draft = null;
  try { draft = readCleanerApplicationDraft(window.sessionStorage); } catch {}
  if (draft) {
    Object.entries(draft.fields).forEach(([name, value]) => {
      const control = form.elements.namedItem(name);
      if (control) control.value = value;
    });
    Object.entries(draft.services).forEach(([name, checked]) => {
      const control = form.elements.namedItem(name);
      if (control) control.checked = checked;
    });
    form.elements.namedItem("rightToWork").checked = false;
    form.elements.namedItem("consent").checked = false;
    guidedForms.get(form)?.restore(draft.currentStep);
    restored = true;
    form.dispatchEvent(new Event("input", { bubbles: true }));
  }

  form.addEventListener("input", scheduleSave);
  form.addEventListener("change", scheduleSave);
  form.addEventListener("click", (event) => {
    if (event.target.closest("[data-guided-next], [data-guided-back]")) setTimeout(scheduleSave, 0);
  });
  discard.addEventListener("click", () => {
    clearTimeout(saveTimer);
    try { clearCleanerApplicationDraft(window.sessionStorage); } catch {}
    form.reset();
    form.elements.namedItem("rightToWork").checked = false;
    form.elements.namedItem("consent").checked = false;
    guidedForms.get(form)?.restore(1);
    restored = false;
    form.dispatchEvent(new Event("input", { bubbles: true }));
    render();
    form.elements.namedItem("fullName")?.focus();
  });
  window.addEventListener("online", () => { online = true; render(); });
  window.addEventListener("offline", () => { online = false; save(); render(); });
  cleanerDraftControls.set(form, {
    complete() {
      clearTimeout(saveTimer);
      submitted = true;
      try { clearCleanerApplicationDraft(window.sessionStorage); } catch {}
      status.hidden = true;
    }
  });
  render();
}

document.querySelectorAll('form[data-guided-kind="cleaner"]').forEach(enhanceCleanerApplicationDraft);

document.querySelectorAll('input[name="postcode"], input[name="phone"]').forEach((input) => {
  input.addEventListener("input", () => input.setCustomValidity(""));
});

document.querySelectorAll("[data-api-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const guidedForm = guidedForms.get(form);
    if (guidedForm && !guidedForm.isFinal()) {
      guidedForm.advance();
      return;
    }
    const summary = form.querySelector(".error-summary");
    const success = form.querySelector(".success-panel");
    const submitButton = form.querySelector(".submit-button");
    summary.hidden = true;
    success.hidden = true;

    if (form.dataset.guidedKind === "cleaner" && navigator.onLine === false) {
      showError(form, "You are offline. Your application entries are protected in this tab; reconnect and try again.");
      return;
    }

    if (!validateStructuredContactFields(form)) return;

    const serviceGroup = form.querySelector("[data-service-group]");
    if (serviceGroup && !serviceGroup.querySelector('input[type="checkbox"]:checked')) {
      showError(form, "Choose at least one type of cleaning work.");
      serviceGroup.querySelector('input[type="checkbox"]').focus();
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      showError(form, "Please complete every required field and tick the required confirmations.");
      return;
    }

    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Sending…";

    try {
      const submission = formToJson(form);
      const submissionBody = JSON.stringify(submission);
      let pending = pendingSubmissions.get(form);
      if (!pending || pending.body !== submissionBody) {
        pending = { body: submissionBody, key: newSubmissionKey() };
        pendingSubmissions.set(form, pending);
      }
      const controller = new AbortController();
      const requestTimer = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(form.action, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json", "Idempotency-Key": pending.key },
          body: submissionBody,
          signal: controller.signal
        });
      } catch (error) {
        if (error.name === "AbortError") throw new Error("The connection took too long. Your entries are still protected in this tab.");
        throw error;
      } finally {
        clearTimeout(requestTimer);
      }
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "We could not send this form.");

      cleanerDraftControls.get(form)?.complete();
      form.reset();
      success.querySelector("[data-reference]").textContent = result.reference;
      const briefLink = success.querySelector("[data-brief-link]");
      const customerStatusToken = /^[A-Za-z0-9_-]{32}$/.test(result.customerStatusToken || "") ? result.customerStatusToken : "";
      if (briefLink) {
        try { saveBriefHandoff(window.sessionStorage, result.reference, submission.email); } catch {}
        briefLink.href = `/brief?reference=${encodeURIComponent(result.reference)}${customerStatusToken ? `#${customerStatusToken}` : ""}`;
      }
      const statusLink = success.querySelector("[data-status-link]");
      if (statusLink && customerStatusToken) {
        statusLink.href = `/request-status#${customerStatusToken}`;
        statusLink.hidden = false;
      }
      const cleanerStatusLink = success.querySelector("[data-cleaner-status-link]");
      if (cleanerStatusLink && /^[A-Za-z0-9_-]{32}$/.test(result.cleanerStatusToken || "")) {
        cleanerStatusLink.href = `/cleaner-status#${result.cleanerStatusToken}`;
        cleanerStatusLink.hidden = false;
      }
      guidedForm?.complete();
      success.hidden = false;
      success.focus();
      pendingSubmissions.delete(form);
      const continuationLink = briefLink || (cleanerStatusLink && !cleanerStatusLink.hidden ? cleanerStatusLink : null);
      if (continuationLink) {
        const destination = continuationLink.href;
        window.setTimeout(() => {
          if (!success.hidden && document.contains(form)) window.location.assign(destination);
        }, 900);
      }
    } catch (error) {
      showError(form, `${error.message} Please try again.`);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  });
});
