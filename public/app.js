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

document.querySelectorAll("[data-api-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
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
