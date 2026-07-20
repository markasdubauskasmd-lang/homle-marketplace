// Pure logic for the guided booking journey. No DOM, no network, so the step
// sequence, validation and pricing shape can be tested directly.

// Six steps, in the order the Landlord walks them. The room scan is not a
// numbered step: it is an interstitial launched from the service step, so the
// rail never appears to go backwards while the camera is open.
export const journeySteps = Object.freeze([
  Object.freeze({ id: "postcode", eyebrow: "Where are we cleaning", title: "Let's check who's<br>near you." }),
  Object.freeze({ id: "service", eyebrow: "What needs doing", title: "What kind of<br>clean is it?" }),
  Object.freeze({ id: "results", eyebrow: "Scan complete", title: "Here's what<br>we found." }),
  Object.freeze({ id: "when", eyebrow: "When suits you", title: "Pick a day<br>and a time." }),
  Object.freeze({ id: "cleaner", eyebrow: "Who's cleaning", title: "Choose your<br>cleaner." }),
  Object.freeze({ id: "checkout", eyebrow: "Confirm", title: "One last<br>look." })
]);

export function stepIndex(id) {
  return journeySteps.findIndex((step) => step.id === id);
}

export function stepLabel(id) {
  const index = stepIndex(id);
  return index < 0 ? "" : `Step ${index + 1} / ${journeySteps.length}`;
}

// Each segment is done, current or still ahead — the rail the prototype shows.
export function railState(id) {
  const current = stepIndex(id);
  return journeySteps.map((step, index) => (index < current ? "done" : index === current ? "now" : ""));
}

export function previousStep(id) {
  const index = stepIndex(id);
  return index > 0 ? journeySteps[index - 1].id : "";
}

/* ── Step 1: postcode ─────────────────────────────────
   Only the outward code is needed to find cleaners, and
   only the outward code is sent. The full postcode is
   never required before the Landlord has seen a price. */
const postcodePattern = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})?$/i;

export function normalisedPostcode(value) {
  const supplied = String(value ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  const match = postcodePattern.exec(supplied);
  if (!match) return null;
  return Object.freeze({ outward: match[1].toUpperCase(), full: match[2] ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : "" });
}

export function postcodeMessage(value) {
  if (!String(value ?? "").trim()) return "";
  return normalisedPostcode(value) ? "" : "That doesn't look like a UK postcode yet.";
}

// The supply line only ever states what the directory actually returned. Zero
// is a real and useful answer, not something to paper over.
export function supplyMessage(count, outward) {
  const cleaners = Math.max(0, Math.trunc(Number(count) || 0));
  if (!cleaners) return Object.freeze({ available: false, headline: `No cleaners cover ${outward} yet`, detail: "You can still scan and save your request — we'll tell you as soon as someone covers your area." });
  return Object.freeze({
    available: true,
    headline: `${cleaners} ${cleaners === 1 ? "cleaner" : "cleaners"} near ${outward}`,
    detail: "You'll pick who cleans your home before anything is booked."
  });
}

/* ── Step 2: service ──────────────────────────────────
   Mirrors the service codes the marketplace already
   prices, so nothing here can be chosen that the
   booking engine cannot quote. */
export const services = Object.freeze([
  Object.freeze({ code: "regular-domestic", name: "Regular clean", detail: "Kitchen, bathrooms, floors and surfaces throughout." }),
  Object.freeze({ code: "deep-clean", name: "Deep clean", detail: "Everything in a regular clean, plus inside appliances and detailed work." }),
  Object.freeze({ code: "end-of-tenancy", name: "End of tenancy", detail: "A full property reset to handover standard." }),
  Object.freeze({ code: "after-builders", name: "After builders", detail: "Dust removal and finish clean after work is finished." })
]);

export function isKnownService(code) {
  return services.some((service) => service.code === code);
}

/* ── Step 4: when ─────────────────────────────────────
   Dates are generated relative to now so the journey
   never shows a day that has already passed. */
export function bookableDays(from = new Date(), count = 14) {
  const start = from instanceof Date && !Number.isNaN(from.getTime()) ? from : new Date();
  const days = [];
  for (let offset = 1; offset <= count; offset += 1) {
    const day = new Date(start.getTime() + offset * 86_400_000);
    days.push(Object.freeze({
      iso: day.toISOString().slice(0, 10),
      weekday: day.toLocaleDateString("en-GB", { weekday: "short" }),
      dayOfMonth: String(day.getDate())
    }));
  }
  return Object.freeze(days);
}

export const arrivalWindows = Object.freeze(["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);

export const frequencies = Object.freeze([
  Object.freeze({ code: "weekly", label: "Weekly" }),
  Object.freeze({ code: "fortnightly", label: "Fortnightly" }),
  Object.freeze({ code: "monthly", label: "Monthly" }),
  Object.freeze({ code: "once", label: "Just once" })
]);

export function isKnownFrequency(code) {
  return frequencies.some((frequency) => frequency.code === code);
}

/* ── Progress gate ────────────────────────────────────
   A step can only be left once it holds what the next
   one needs, so the journey cannot reach checkout with
   a gap in it. */
export function canLeaveStep(id, draft = {}) {
  if (id === "postcode") return Boolean(normalisedPostcode(draft.postcode));
  if (id === "service") return isKnownService(draft.serviceCode);
  if (id === "results") return Array.isArray(draft.tasks) && draft.tasks.length > 0;
  if (id === "when") return Boolean(draft.date) && arrivalWindows.includes(draft.time) && isKnownFrequency(draft.frequency);
  if (id === "cleaner") return Boolean(draft.cleanerId);
  return true;
}

export function blockedReason(id, draft = {}) {
  if (canLeaveStep(id, draft)) return "";
  if (id === "postcode") return "Enter your postcode to see who covers your area.";
  if (id === "service") return "Choose the kind of clean you need.";
  if (id === "results") return "Add at least one room task before continuing.";
  if (id === "when") return "Pick a day, an arrival window and how often.";
  if (id === "cleaner") return "Choose the cleaner you'd like.";
  return "";
}

/* ── Checkout honesty ─────────────────────────────────
   Payments are a deliberate deployment switch. When they
   are off the journey must say what will actually happen
   rather than showing a pay button that cannot charge. */
export function checkoutMode({ paymentsReady = false, matchingReady = false } = {}) {
  if (paymentsReady) return "pay";
  if (matchingReady) return "request";
  return "save";
}

export function checkoutCopy(mode) {
  if (mode === "pay") return Object.freeze({
    action: "Confirm and pay",
    note: "Your card is authorised now and charged after the clean is finished."
  });
  if (mode === "request") return Object.freeze({
    action: "Send this request",
    note: "Your cleaner is invited now. No payment is taken — we'll ask for that once card payments are switched on."
  });
  return Object.freeze({
    action: "Save this request",
    note: "Your scan and checklist are saved. Nothing is sent to a cleaner and no payment is taken yet."
  });
}
