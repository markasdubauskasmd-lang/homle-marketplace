import { saveBriefHandoff } from "./brief-handoff.js";
import { newSubmissionKey } from "./submission-key.js";

const pendingSubmissions = new WeakMap();

const focusedEntryRoutes = {
  "/request": { kind: "request", target: "request-cleaning", title: "Request a clean — Tideway", description: "Request a Tideway clean in three short steps, then scan the rooms and turn spoken notes into a clear cleaner checklist." },
  "/join": { kind: "join", target: "cleaner-application", title: "Apply as a cleaner — Tideway", description: "Apply to join the Tideway cleaning pilot and choose the areas, services and usual times that suit you." }
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
    }
  };

  form.querySelectorAll("[data-guided-next]").forEach((button) => {
    button.addEventListener("click", () => wizard.advance());
  });
  form.querySelectorAll("[data-guided-back]").forEach((button) => {
    button.addEventListener("click", () => wizard.back());
  });

  form.classList.add("guided-form-ready");
  guidedForms.set(form, wizard);
  showStep(1, false);
}

document.querySelectorAll("[data-guided-form]").forEach(enhanceGuidedForm);

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
      const response = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "Idempotency-Key": pending.key },
        body: submissionBody
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "We could not send this form.");

      form.reset();
      success.querySelector("[data-reference]").textContent = result.reference;
      const briefLink = success.querySelector("[data-brief-link]");
      if (briefLink) {
        try { saveBriefHandoff(window.sessionStorage, result.reference, submission.email); } catch {}
        briefLink.href = `/brief?reference=${encodeURIComponent(result.reference)}`;
      }
      const statusLink = success.querySelector("[data-status-link]");
      if (statusLink && result.customerStatusToken) {
        statusLink.href = `/request-status#${result.customerStatusToken}`;
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
    } catch (error) {
      showError(form, `${error.message} Please try again.`);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  });
});
