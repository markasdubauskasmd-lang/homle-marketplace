// Prepare-a-clean stepped wizard (progressive enhancement).
//
// The request builder in landlord-dashboard.html is a complete, working private
// draft form on its own. This file only *presents* it as the design's stepped
// wizard: one step visible at a time, step dots, Back/Next, a collapse toggle
// and a live draft summary. Every field, name and data-* hook is left untouched,
// so landlord-dashboard.js keeps owning validation, speech, recovery and submit.
//
// If this module fails to run while the rest of the dashboard still loads, the
// panel shows every step at once and the form works as a single page — the
// step-hiding CSS is gated on the `pac-wizard-on` class this file adds. Nothing
// here submits, prices or charges anything.

(function () {
  "use strict";

  const panel = document.querySelector('[data-landlord-panel="requests"]');
  if (!panel) return;

  const card = panel.querySelector("[data-pac-card]");
  const form = panel.querySelector("[data-request-form]");
  const steps = Array.prototype.slice.call(panel.querySelectorAll("[data-wizard-step]"));
  if (!card || !form || steps.length === 0) return;

  const dotsWrap = panel.querySelector("[data-pac-dots]");
  const stepper = panel.querySelector("[data-pac-stepper]");
  const stepNumEl = panel.querySelector("[data-pac-step-num]");
  const stepTotalEl = panel.querySelector("[data-pac-step-total]");
  const stepTitleEl = panel.querySelector("[data-pac-step-title]");
  const nav = panel.querySelector("[data-pac-nav]");
  const backBtn = panel.querySelector("[data-pac-back]");
  const nextBtn = panel.querySelector("[data-pac-next]");
  const basket = panel.querySelector("[data-pac-basket]");
  const basketLines = panel.querySelector("[data-pac-basket-lines]");
  const toggle = panel.querySelector("[data-pac-toggle]");

  const total = steps.length;
  let current = 0;

  // Each step is programmatically focusable so keyboard focus can be moved into
  // it after a step change (Tab then continues through the step's fields).
  steps.forEach((step) => { step.tabIndex = -1; });

  // Turn on wizard mode: reveal the chrome and let the CSS hide inactive steps.
  panel.classList.add("pac-wizard-on");
  if (stepper) stepper.hidden = false;
  if (nav) nav.hidden = false;
  if (basket) basket.hidden = false;
  if (toggle) toggle.hidden = false;
  if (stepTotalEl) stepTotalEl.textContent = String(total);

  // Build the step dots.
  const dots = [];
  if (dotsWrap) {
    for (let i = 0; i < total; i += 1) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "pac-dot";
      const title = steps[i].getAttribute("data-step-title") || "step " + (i + 1);
      dot.setAttribute("aria-label", "Go to step " + (i + 1) + ": " + title);
      dot.addEventListener("click", (function (idx) {
        return function () { goTo(idx); };
      })(i));
      dotsWrap.appendChild(dot);
      dots.push(dot);
    }
  }

  function render() {
    for (let i = 0; i < total; i += 1) {
      const active = i === current;
      steps[i].classList.toggle("is-active", active);
      if (dots[i]) {
        dots[i].classList.toggle("is-current", active);
        dots[i].classList.toggle("is-done", i < current);
        dots[i].setAttribute("aria-current", active ? "step" : "false");
      }
    }
    if (stepNumEl) stepNumEl.textContent = String(current + 1);
    if (stepTitleEl) stepTitleEl.textContent = steps[current].getAttribute("data-step-title") || "";
    if (backBtn) backBtn.disabled = current === 0;
    if (nextBtn) nextBtn.hidden = current === total - 1; // last step: the form's own Save button acts
    updateBasket();
  }

  function goTo(index) {
    const target = Math.max(0, Math.min(total - 1, index));
    if (target === current) return;
    current = target;
    render();
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ block: "nearest" });
    }
    // Move keyboard focus into the newly shown step so Tab continues through it.
    try { steps[current].focus({ preventScroll: true }); } catch (_) {}
  }

  // Validate only the controls a landlord can actually see on the current step.
  function validateStep(index) {
    const controls = Array.prototype.slice.call(steps[index].querySelectorAll("input, select, textarea"));
    for (let i = 0; i < controls.length; i += 1) {
      const control = controls[i];
      if (control.disabled || !control.willValidate) continue;
      if (!control.checkValidity()) {
        control.reportValidity();
        return false;
      }
    }
    return true;
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", function () {
      if (validateStep(current)) goTo(current + 1);
    });
  }
  if (backBtn) {
    backBtn.addEventListener("click", function () { goTo(current - 1); });
  }

  // If focus lands on a control in another step — the typed walkthrough opening,
  // or native validation focusing the first invalid field — reveal that step.
  form.addEventListener("focusin", function (event) {
    const owner = event.target && event.target.closest ? event.target.closest("[data-wizard-step]") : null;
    if (!owner) return;
    const index = steps.indexOf(owner);
    if (index >= 0 && index !== current) {
      current = index;
      render();
    }
  });

  // A programmatic click into a hidden step (for example the app opening the
  // walkthrough) must reveal that step first. Capture phase runs before the
  // app's own handlers, so the target is visible by the time they act.
  form.addEventListener("click", function (event) {
    const owner = event.target && event.target.closest ? event.target.closest("[data-wizard-step]") : null;
    if (!owner) return;
    const index = steps.indexOf(owner);
    if (index >= 0 && index !== current) {
      current = index;
      render();
    }
  }, true);

  // After a successful save the app resets the form; return to the first step
  // once the native reset has cleared the fields.
  form.addEventListener("reset", function () {
    Promise.resolve().then(function () { current = 0; render(); });
  });

  // Before the real submit handler runs, surface the step of the first invalid
  // control so the browser's own message points at a visible field. Capture
  // phase guarantees this runs before landlord-dashboard.js's submit handler.
  form.addEventListener("submit", function () {
    if (form.checkValidity()) return;
    for (let i = 0; i < total; i += 1) {
      const invalid = steps[i].querySelector(":invalid:not([disabled])");
      if (invalid) {
        if (i !== current) { current = i; render(); }
        break;
      }
    }
  }, true);

  // Live, honest draft summary — no price. The exact total only exists later,
  // at Cleaner approval, so we never invent a running figure here.
  function optionText(select) {
    if (!select || select.selectedIndex < 0) return "";
    const option = select.options[select.selectedIndex];
    return option && option.value ? option.textContent.trim() : "";
  }

  function addLine(label, value) {
    if (!value) return;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    basketLines.appendChild(dt);
    basketLines.appendChild(dd);
  }

  function updateBasket() {
    if (!basketLines) return;
    basketLines.textContent = "";

    let property = optionText(form.elements.propertyId);
    if (!property) {
      const sole = panel.querySelector("[data-sole-property-name]");
      if (sole && sole.textContent.trim()) property = sole.textContent.trim();
    }
    addLine("Property", property || "Not chosen yet");
    addLine("Cleaning", optionText(form.elements.cleaningType));

    const date = form.elements.requestedDate ? form.elements.requestedDate.value : "";
    const time = form.elements.requestedTime ? form.elements.requestedTime.value : "";
    const when = [date, time].filter(Boolean).join(" · ");
    if (when) addLine("When", when);

    addLine("Duration", optionText(form.elements.durationMinutes));

    const preview = panel.querySelector("[data-task-preview]");
    if (preview) {
      // Each room is a listitem; individual tasks are the nested <li> elements.
      const taskCount = preview.querySelectorAll("li").length;
      if (taskCount) addLine("Checklist", taskCount + (taskCount === 1 ? " task" : " tasks"));
    }
  }

  form.addEventListener("input", updateBasket);
  form.addEventListener("change", updateBasket);

  // The task checklist and the property list are populated asynchronously by
  // landlord-dashboard.js; keep the summary in step with them.
  if (typeof MutationObserver === "function") {
    const preview = panel.querySelector("[data-task-preview]");
    if (preview) new MutationObserver(updateBasket).observe(preview, { childList: true, subtree: true });
    if (form.elements.propertyId) new MutationObserver(updateBasket).observe(form.elements.propertyId, { childList: true });
  }

  // Collapse / expand the whole builder, matching the design's reveal toggle.
  if (toggle) {
    toggle.addEventListener("click", function () {
      const expanded = toggle.getAttribute("aria-expanded") !== "false";
      const next = !expanded;
      toggle.setAttribute("aria-expanded", String(next));
      panel.classList.toggle("pac-collapsed", !next);
      toggle.textContent = next ? "Hide ↑" : "Reveal builder ↓";
    });
  }

  render();
})();
