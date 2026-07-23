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

  // Native controls replaced by a design widget register a showError() here so
  // validation can point at the widget instead of a hidden native control.
  const enhanced = new Map();

  // Each widget registers a reflect() so its selected state can be re-synced
  // after the app sets a native value programmatically (recovery, suggested
  // cleaning type, defaults) or clears it via form.reset() — none of which fire
  // a "change" the widgets would otherwise hear.
  const syncers = [];
  function syncWidgets() { syncers.forEach(function (fn) { try { fn(); } catch (_) {} }); }

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
        const widget = enhanced.get(control);
        if (widget && typeof widget.showError === "function") widget.showError();
        else control.reportValidity();
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
    Promise.resolve().then(function () { current = 0; render(); syncWidgets(); });
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
        const widget = enhanced.get(invalid);
        if (widget && typeof widget.showError === "function") widget.showError();
        break;
      }
    }
  }, true);

  // Live, honest "My basket" summary — no price. The exact total only exists
  // later, at Cleaner approval, so we never invent a running figure here.
  const basketAddress = panel.querySelector("[data-pac-basket-address]");
  const basketAddressText = panel.querySelector("[data-pac-basket-address-text]");

  function optionText(select) {
    if (!select || select.selectedIndex < 0) return "";
    const option = select.options[select.selectedIndex];
    return option && option.value ? option.textContent.trim() : "";
  }

  function formatWhen(dateValue, timeValue) {
    let dateLabel = "";
    if (dateValue) {
      const parts = dateValue.split("-");
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      dateLabel = isNaN(d.getTime()) ? dateValue : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    }
    return [dateLabel, timeValue].filter(Boolean).join(" · ");
  }

  function bullet(text) {
    if (!text) return;
    const li = document.createElement("li");
    li.textContent = text;
    basketLines.appendChild(li);
  }

  function updateBasket() {
    if (!basketLines) return;

    let property = optionText(form.elements.propertyId);
    if (!property) {
      const sole = panel.querySelector("[data-sole-property-name]");
      if (sole && sole.textContent.trim()) property = sole.textContent.trim();
    }
    if (basketAddress && basketAddressText) {
      if (property) { basketAddressText.textContent = property; basketAddress.hidden = false; }
      else basketAddress.hidden = true;
    }

    basketLines.textContent = "";
    bullet(optionText(form.elements.cleaningType));
    const freq = form.elements.frequency;
    if (freq && freq.value && freq.value !== "one-time") bullet(optionText(freq));
    const duration = optionText(form.elements.durationMinutes);
    if (duration) bullet("For " + duration);
    bullet(formatWhen(
      form.elements.requestedDate ? form.elements.requestedDate.value : "",
      form.elements.requestedTime ? form.elements.requestedTime.value : ""
    ));
    const preview = panel.querySelector("[data-task-preview]");
    if (preview) {
      const taskCount = preview.querySelectorAll("li").length;
      if (taskCount) bullet(taskCount + (taskCount === 1 ? " task reviewed" : " tasks reviewed"));
    }
    if (!basketLines.children.length) {
      const li = document.createElement("li");
      li.className = "pac-basket-empty";
      li.textContent = "Choose a session to start your draft.";
      basketLines.appendChild(li);
    }
  }

  form.addEventListener("input", updateBasket);
  form.addEventListener("change", updateBasket);
  // Re-sync widgets after any change settles, so a value the app sets in the
  // same tick (e.g. suggested cleaning type after a property change) is shown.
  form.addEventListener("change", function () { Promise.resolve().then(syncWidgets); });

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

  // ── Design step inputs (progressive enhancement over the native fields) ──
  // Each builder renders the design's widget, keeps the native control in the
  // DOM (so it still submits and existing JS/tests keep working) and syncs both
  // ways. No price is shown or invented anywhere.

  function fieldLabel(control) { return control ? control.closest("label") : null; }

  function fieldError(message, afterEl) {
    const err = document.createElement("p");
    err.className = "pac-field-error";
    err.hidden = true;
    err.textContent = message;
    afterEl.insertAdjacentElement("afterend", err);
    return err;
  }

  function syncFromNative(control, handler) {
    control.addEventListener("change", handler);
    syncers.push(handler);
    handler();
  }

  const cleaningMeta = {
    "regular-domestic": { emoji: "🧴", desc: "Everyday tidy and reset", popular: true },
    "rental-turnovers": { emoji: "🔑", desc: "Guest or tenant turnaround" },
    "end-of-tenancy": { emoji: "📦", desc: "Move-out deep clean" },
    "workplaces": { emoji: "🏢", desc: "Offices and workplaces" },
    "communal-areas": { emoji: "🚪", desc: "Shared halls and stairs" },
    "deep-cleans": { emoji: "✨", desc: "Top-to-bottom reset" }
  };

  function buildCleaningCards() {
    const select = form.elements.cleaningType;
    const label = fieldLabel(select);
    if (!select || !label) return;
    const wrap = document.createElement("div");
    wrap.className = "pac-cards";
    const cards = [];
    Array.prototype.forEach.call(select.options, function (opt) {
      if (!opt.value) return;
      const meta = cleaningMeta[opt.value] || { emoji: "🧽", desc: "" };
      const card = document.createElement("button");
      card.type = "button";
      card.className = "pac-card-option";
      card.dataset.value = opt.value;
      card.setAttribute("aria-pressed", "false");
      const chip = document.createElement("span");
      chip.className = "pac-card-emoji";
      chip.setAttribute("aria-hidden", "true");
      chip.textContent = meta.emoji;
      const body = document.createElement("span");
      body.className = "pac-card-body";
      const name = document.createElement("span");
      name.className = "pac-card-name";
      name.textContent = opt.textContent.trim();
      body.appendChild(name);
      if (meta.desc) {
        const desc = document.createElement("span");
        desc.className = "pac-card-desc";
        desc.textContent = meta.desc;
        body.appendChild(desc);
      }
      card.appendChild(chip);
      card.appendChild(body);
      if (meta.popular) {
        const badge = document.createElement("span");
        badge.className = "pac-card-badge";
        badge.textContent = "Popular";
        card.appendChild(badge);
      }
      card.addEventListener("click", function () {
        select.value = opt.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        err.hidden = true;
      });
      wrap.appendChild(card);
      cards.push(card);
    });
    label.classList.add("pac-enhanced-native");
    label.insertAdjacentElement("afterend", wrap);
    const err = fieldError("Choose a cleaning session to continue.", wrap);
    function reflect() {
      cards.forEach(function (c) {
        const on = c.dataset.value === select.value;
        c.classList.toggle("is-selected", on);
        c.setAttribute("aria-pressed", String(on));
      });
    }
    syncFromNative(select, reflect);
    enhanced.set(select, { showError: function () { err.hidden = false; if (cards[0]) cards[0].focus(); } });
  }

  function buildChoiceGrid(control, className, labelFrom) {
    const label = fieldLabel(control);
    if (!control || !label) return null;
    const wrap = document.createElement("div");
    wrap.className = className;
    const buttons = [];
    Array.prototype.forEach.call(control.options, function (opt) {
      if (!opt.value) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = className === "pac-chips" ? "pac-chip" : "pac-slot";
      b.dataset.value = opt.value;
      b.textContent = labelFrom ? labelFrom(opt) : opt.textContent.trim();
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        control.value = opt.value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
      wrap.appendChild(b);
      buttons.push(b);
    });
    label.classList.add("pac-enhanced-native");
    label.insertAdjacentElement("afterend", wrap);
    function reflect() {
      buttons.forEach(function (b) {
        const on = b.dataset.value === control.value;
        b.classList.toggle("is-selected", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }
    syncFromNative(control, reflect);
    return wrap;
  }

  function buildDurationGrid() {
    const wrap = buildChoiceGrid(form.elements.durationMinutes, "pac-chips");
    if (!wrap) return;
    const tip = document.createElement("p");
    tip.className = "pac-tip";
    tip.textContent = "Not sure? Most 1–2 bed homes take 3–4 hours. Add time for windows or a deep clean.";
    wrap.insertAdjacentElement("afterend", tip);
  }

  function buildTimeSlots() {
    const input = form.elements.requestedTime;
    const label = fieldLabel(input);
    if (!input || !label) return;
    const wrap = document.createElement("div");
    wrap.className = "pac-slots";
    const slots = [];
    for (let h = 8; h <= 18; h += 1) {
      for (let m = 0; m < 60; m += 30) {
        if (h === 18 && m > 0) break;
        const val = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pac-slot";
        b.dataset.value = val;
        b.textContent = val;
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () {
          input.value = val;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          err.hidden = true;
        });
        wrap.appendChild(b);
        slots.push(b);
      }
    }
    label.classList.add("pac-enhanced-native");
    label.insertAdjacentElement("afterend", wrap);
    const err = fieldError("Pick a start time to continue.", wrap);
    function reflect() {
      slots.forEach(function (s) {
        const on = s.dataset.value === input.value;
        s.classList.toggle("is-selected", on);
        s.setAttribute("aria-pressed", String(on));
      });
    }
    syncFromNative(input, reflect);
    enhanced.set(input, { showError: function () { err.hidden = false; if (slots[0]) slots[0].focus(); } });
  }

  function buildCalendar() {
    const input = form.elements.requestedDate;
    const label = fieldLabel(input);
    if (!input || !label) return;
    const wrap = document.createElement("div");
    wrap.className = "pac-cal";
    const head = document.createElement("div");
    head.className = "pac-cal-head";
    const prev = document.createElement("button");
    prev.type = "button"; prev.className = "pac-cal-nav"; prev.setAttribute("aria-label", "Previous month"); prev.textContent = "‹";
    const title = document.createElement("span");
    title.className = "pac-cal-title";
    const next = document.createElement("button");
    next.type = "button"; next.className = "pac-cal-nav"; next.setAttribute("aria-label", "Next month"); next.textContent = "›";
    head.appendChild(prev); head.appendChild(title); head.appendChild(next);
    const grid = document.createElement("div");
    grid.className = "pac-cal-grid";
    wrap.appendChild(head); wrap.appendChild(grid);
    label.classList.add("pac-enhanced-native");
    label.insertAdjacentElement("afterend", wrap);
    const err = fieldError("Pick a date to continue.", wrap);

    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    function startOfToday() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
    function parse(value) { if (!value) return null; const p = value.split("-"); const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); return isNaN(d.getTime()) ? null : d; }
    function minDate() { return parse(input.min) || startOfToday(); }
    function fmt(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
    let view = parse(input.value) || minDate();
    view = new Date(view.getFullYear(), view.getMonth(), 1);

    function draw() {
      grid.textContent = "";
      title.textContent = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      weekdays.forEach(function (w) { const el = document.createElement("span"); el.className = "pac-cal-weekday"; el.textContent = w; grid.appendChild(el); });
      const first = new Date(view.getFullYear(), view.getMonth(), 1);
      const startDow = (first.getDay() + 6) % 7;
      for (let i = 0; i < startDow; i += 1) { const blank = document.createElement("span"); blank.className = "pac-cal-blank"; grid.appendChild(blank); }
      const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      const min = minDate();
      const sel = parse(input.value);
      for (let d = 1; d <= days; d += 1) {
        const date = new Date(view.getFullYear(), view.getMonth(), d);
        const btn = document.createElement("button");
        btn.type = "button"; btn.className = "pac-cal-day"; btn.textContent = String(d);
        btn.setAttribute("aria-label", date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
        const isSelected = !!(sel && date.getTime() === sel.getTime());
        btn.setAttribute("aria-pressed", String(isSelected));
        if (date < min) { btn.disabled = true; btn.classList.add("is-disabled"); }
        if (isSelected) btn.classList.add("is-selected");
        btn.addEventListener("click", function () {
          input.value = fmt(date);
          // The change listener below redraws the grid once; then restore focus
          // to the freshly rendered selected day so keyboard focus is not lost.
          input.dispatchEvent(new Event("change", { bubbles: true }));
          err.hidden = true;
          const selectedDay = grid.querySelector(".pac-cal-day.is-selected");
          if (selectedDay) selectedDay.focus();
        });
        grid.appendChild(btn);
      }
      prev.disabled = (view.getFullYear() === min.getFullYear() && view.getMonth() === min.getMonth());
    }
    prev.addEventListener("click", function () { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); draw(); });
    next.addEventListener("click", function () { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); draw(); });
    input.addEventListener("change", function () { const s = parse(input.value); if (s) view = new Date(s.getFullYear(), s.getMonth(), 1); draw(); });
    syncers.push(draw);
    draw();
    enhanced.set(input, { showError: function () { err.hidden = false; } });
  }

  try { buildCleaningCards(); } catch (_) {}
  try { buildDurationGrid(); } catch (_) {}
  try { buildCalendar(); } catch (_) {}
  try { buildTimeSlots(); } catch (_) {}

  // Recovery of an in-progress draft can populate native fields around load;
  // resync once after the current tick so the widgets reflect restored values.
  Promise.resolve().then(syncWidgets);

  render();
})();
