import { saveBriefHandoff } from "./brief-handoff.js";
import { newSubmissionKey } from "./submission-key.js";

const pendingSubmissions = new WeakMap();

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

const requestWizards = new WeakMap();

function enhanceCustomerRequest(form) {
  const steps = Array.from(form.querySelectorAll("[data-request-step]"));
  const progress = form.querySelector("[data-request-progress]");
  if (steps.length < 2 || !progress) return;

  let currentStep = 1;
  const lastStep = steps.length;
  const summary = form.querySelector(".error-summary");

  function showStep(stepNumber, moveFocus = true) {
    currentStep = Math.max(1, Math.min(lastStep, stepNumber));
    steps.forEach((step) => {
      step.hidden = Number(step.dataset.requestStep) !== currentStep;
    });
    progress.querySelectorAll("[data-request-progress-step]").forEach((item) => {
      const itemStep = Number(item.dataset.requestProgressStep);
      item.classList.toggle("complete", itemStep < currentStep);
      item.classList.toggle("current", itemStep === currentStep);
      if (itemStep === currentStep) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    summary.hidden = true;
    form.dataset.currentRequestStep = String(currentStep);
    if (moveFocus) {
      const heading = steps[currentStep - 1].querySelector(".request-step-heading");
      heading?.focus({ preventScroll: true });
      steps[currentStep - 1].scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function validateCurrentStep() {
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
      delete form.dataset.currentRequestStep;
    }
  };

  form.querySelectorAll("[data-request-next]").forEach((button) => {
    button.addEventListener("click", () => wizard.advance());
  });
  form.querySelectorAll("[data-request-back]").forEach((button) => {
    button.addEventListener("click", () => wizard.back());
  });

  form.classList.add("request-wizard-ready");
  requestWizards.set(form, wizard);
  showStep(1, false);
}

document.querySelectorAll("[data-customer-request]").forEach(enhanceCustomerRequest);

document.querySelectorAll("[data-api-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const requestWizard = requestWizards.get(form);
    if (requestWizard && !requestWizard.isFinal()) {
      requestWizard.advance();
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
      requestWizard?.complete();
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

if (location.pathname === "/request") location.hash = "request-cleaning";
if (location.pathname === "/join") location.hash = "cleaner-application";
