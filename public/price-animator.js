// The running total on the scanner, and the small chip that says what changed.
//
// WHY ANIMATE AT ALL
//
// The number is not decoration — it is the answer to "what did that tap just
// do". A price that jumps from £27 to £30 between frames leaves the customer to
// work out whether they added £3 or £30, and the most common reaction to an
// unexplained increase is to stop. Counting up through the intermediate values
// makes the size of the change legible without anyone reading a breakdown, and
// the delta chip names the cause.
//
// It stays deliberately small: one number, one chip. The scanner's job is
// scanning, and a pricing panel over the viewfinder would be the thing people
// remember about it.
//
// RESPECTS REDUCED MOTION. Under prefers-reduced-motion the value is set
// directly and the chip still appears — the information survives, the movement
// does not. Nothing here is the only way to learn what happened: the breakdown
// below always carries the same figures.

const reduceMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

export function formatPence(pence) {
  const value = Math.max(0, Math.round(Number(pence) || 0));
  // Whole pounds read as "£45" rather than "£45.00": a price with .00 on it
  // looks like a form field, not an answer.
  return value % 100 === 0 ? `£${value / 100}` : `£${(value / 100).toFixed(2)}`;
}

/**
 * Binds a running total to an element.
 *
 * @param element  the node whose text is the price
 * @param options  { durationMs, onDelta } — onDelta receives the signed change
 */
export function createPriceAnimator(element, options = {}) {
  if (!element) return { set() {}, current: () => 0, stop() {} };
  const durationMs = Number(options.durationMs) > 0 ? Number(options.durationMs) : 420;

  let current = 0;
  let frame = 0;
  let started = false;

  function paint(value) {
    element.textContent = formatPence(value);
  }

  function stop() {
    if (frame) globalThis.cancelAnimationFrame?.(frame);
    frame = 0;
  }

  function set(nextPence, { animate = true } = {}) {
    const next = Math.max(0, Math.round(Number(nextPence) || 0));
    const from = current;
    const delta = next - from;
    current = next;

    // The first value is where the price starts, not a change to it. Counting
    // up from zero on load would announce a £45 increase that never happened.
    const jump = !started || !animate || reduceMotion() || delta === 0;
    started = true;

    if (typeof options.onDelta === "function" && delta !== 0 && !jump) options.onDelta(delta);

    stop();
    if (jump) return paint(next);

    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const step = () => {
      const now = globalThis.performance?.now?.() ?? Date.now();
      const elapsed = Math.min(1, (now - startedAt) / durationMs);
      // Ease-out: the number moves fast enough to feel immediate, then settles
      // so the final figure is the one the eye rests on.
      const eased = 1 - Math.pow(1 - elapsed, 3);
      paint(Math.round(from + delta * eased));
      if (elapsed < 1) frame = globalThis.requestAnimationFrame?.(step) ?? 0;
      else { frame = 0; paint(current); }
    };
    frame = globalThis.requestAnimationFrame?.(step) ?? 0;
    if (!frame) paint(next);
  }

  return { set, current: () => current, stop };
}

/**
 * The "+£3 Desk" chip.
 *
 * Appended, shown, then removed on its own timer. It never blocks anything and
 * never needs dismissing — a control that has to be closed is a control that
 * interrupts a scan.
 */
export function showPriceDelta(host, deltaPence, label = "") {
  if (!host || !deltaPence) return;
  const chip = host.ownerDocument.createElement("span");
  chip.className = `price-delta ${deltaPence > 0 ? "is-up" : "is-down"}`;
  chip.textContent = `${deltaPence > 0 ? "+" : "−"}${formatPence(Math.abs(deltaPence))}${label ? ` ${label}` : ""}`;
  // Announced politely so a screen-reader user hears the change without the
  // scanner stealing focus mid-scan.
  chip.setAttribute("role", "status");
  host.append(chip);
  const remove = () => chip.remove();
  if (reduceMotion()) globalThis.setTimeout(remove, 1800);
  else {
    globalThis.setTimeout(() => chip.classList.add("is-leaving"), 1200);
    globalThis.setTimeout(remove, 1700);
  }
}
