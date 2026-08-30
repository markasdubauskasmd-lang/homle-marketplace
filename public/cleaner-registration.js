import { applicationStatusLabel, onboardingIcons, onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260830-1";
import { createCleanerPage, element, requestJson, setText } from "./cleaner-page.js?v=20260816-restore-1";
import { renderCleanerNav } from "./cleaner-sidebar.js?v=20260830-1";
import { setupPersonalDetails } from "./cleaner-personal-details.js?v=20260804-3";
import { setupBusinessDetails } from "./cleaner-business-details.js?v=20260728-1";
import { setupIdentityVerification } from "./cleaner-identity-verification.js?v=20260728-1";
import { setupRightToWork } from "./cleaner-right-to-work.js?v=20260808-1";
import { setupBackgroundChecks } from "./cleaner-background-checks.js?v=20260728-1";
import { setupWorkAreas } from "./cleaner-work-areas.js?v=20260807-1";
import { setupExperience } from "./cleaner-experience.js?v=20260805-1";
import { setupInsurance } from "./cleaner-insurance.js?v=20260810-3";
import { setupBanking } from "./cleaner-banking.js?v=20260729-1";
import { setupEquipment } from "./cleaner-equipment.js?v=20260807-1";
import { setupAvailability } from "./cleaner-availability.js?v=20260805-1";
import { setupCongratulations, setupReviewSubmit } from "./cleaner-review-submit.js?v=20260807-1";

function stepIcon(name) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", onboardingIcons[name] || onboardingIcons.folder);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.7");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.append(path);
  return svg;
}

const localDesignPreview = ["127.0.0.1", "localhost"].includes(location.hostname)
  && new URLSearchParams(location.search).has("design-preview");
const introductionPage = location.pathname === "/cleaner/introduction";

if (introductionPage) {
  document.body.classList.add("cleaner-onboarding-introduction-page");
  document.title = "Onboarding introduction | Homlle";
}

if (localDesignPreview) {
  const introductionLink = document.querySelector(".hc-brand-mark");
  if (introductionLink) introductionLink.href = "/cleaner/introduction?design-preview=1";
  document.querySelector("[data-reg-gate]")?.setAttribute("hidden", "");
  document.querySelector("[data-reg]")?.removeAttribute("hidden");
  document.querySelector("[data-registration-overview]")?.setAttribute("hidden", "");
  if (!introductionPage) document.querySelector("[data-personal-details]")?.removeAttribute("hidden");
  renderCleanerNav(onboardingProgress({
    account: null,
    profile: null,
    payoutState: "not-started",
    availabilityCount: 0,
    onboardingSections: []
  }));
}

/* Paint the step before the network, not after it.
 *
 * Every step's markup is already in this document and each setup function reveals its card
 * and topbar synchronously, before it fetches anything. But those setups only run inside
 * createCleanerPage's callback, which is reached after `await /api/marketplace/account`. So
 * the page sat blank for a full round trip while holding everything it needed to paint, and
 * moving between onboarding tabs showed an empty frame.
 *
 * This performs the same reveal immediately. It is a hint, not a decision: the setup function
 * still runs afterwards and still sets the authoritative state, so this can only ever be
 * early, never different. Steps absent from the table simply keep the old behaviour.
 */
const onboardingStepReveals = new Map([
  ["/cleaner/personal-details", { title: "Personal details | Homle", card: "[data-personal-card]", topbar: "" }],
  ["/cleaner/business-details", { title: "Business details | Homle", card: "[data-business-details]", topbar: "[data-business-topbar]" }],
  ["/cleaner/identity-verification", { title: "Identity verification | Homle", card: "[data-identity-verification]", topbar: "[data-identity-topbar]" }],
  ["/cleaner/right-to-work", { title: "Right to work | Homle", card: "[data-right-to-work]", topbar: "[data-rtw-topbar]" }],
  ["/cleaner/background-checks", { title: "Background checks | Homle", card: "[data-background-checks]", topbar: "[data-background-topbar]" }],
  ["/cleaner/work-areas", { title: "Work areas | Homle", card: "[data-work-areas]", topbar: "[data-work-topbar]" }],
  ["/cleaner/experience", { title: "Skills and Experience | Homle", card: "[data-experience]", topbar: "[data-experience-topbar]" }],
  ["/cleaner/insurance", { title: "Insurance | Homle", card: "[data-insurance]", topbar: "[data-insurance-topbar]" }],
  ["/cleaner/banking", { title: "Banking & payments | Homle", card: "[data-banking]", topbar: "[data-banking-topbar]" }],
  ["/cleaner/equipment", { title: "Equipment & Travel | Homle", card: "[data-equipment]", topbar: "[data-equipment-topbar]" }],
  ["/cleaner/availability", { title: "Availability | Homle", card: "[data-availability]", topbar: "[data-availability-topbar]" }]
]);

function revealOnboardingStepEarly() {
  const step = onboardingStepReveals.get(location.pathname);
  const layout = document.querySelector("[data-personal-details]");
  if (!step || !layout) return;
  const card = step.card ? document.querySelector(step.card) : null;
  const topbar = step.topbar ? document.querySelector(step.topbar) : null;
  document.title = step.title;
  const overview = document.querySelector("[data-registration-overview]");
  if (overview) overview.hidden = true;
  layout.hidden = false;
  // The same two groups cleaner-right-to-work.js already switches on, so a step added to the
  // markup without a table entry is left hidden rather than shown in the wrong place.
  document.querySelectorAll(".hc-personal-layout > .hc-personal-card").forEach((node) => { node.hidden = node !== card; });
  document.querySelectorAll(".hc-personal-layout > .hc-business-topbar").forEach((node) => { node.hidden = node !== topbar; });
}

if (!localDesignPreview && !introductionPage) revealOnboardingStepEarly();

if (!localDesignPreview) createCleanerPage("reg", async (context) => {
  if (introductionPage) return;
  if (location.pathname === "/cleaner/congratulations") {
    await setupCongratulations(context);
    return;
  }
  if (location.pathname === "/cleaner/review-submit") {
    await setupReviewSubmit(context);
    return;
  }
  if (location.pathname === "/cleaner/personal-details") {
    await setupPersonalDetails(context);
    return;
  }
  if (location.pathname === "/cleaner/business-details") {
    await setupBusinessDetails(context);
    return;
  }
  if (location.pathname === "/cleaner/identity-verification") {
    await setupIdentityVerification(context);
    return;
  }
  if (location.pathname === "/cleaner/right-to-work") {
    await setupRightToWork(context);
    return;
  }
  if (location.pathname === "/cleaner/background-checks") {
    await setupBackgroundChecks(context);
    return;
  }
  if (location.pathname === "/cleaner/work-areas") {
    await setupWorkAreas(context);
    return;
  }
  if (location.pathname === "/cleaner/experience") {
    await setupExperience(context);
    return;
  }
  if (location.pathname === "/cleaner/insurance") {
    await setupInsurance(context);
    return;
  }
  if (location.pathname === "/cleaner/banking") {
    await setupBanking(context);
    return;
  }
  if (location.pathname === "/cleaner/equipment") {
    await setupEquipment(context);
    return;
  }
  if (location.pathname === "/cleaner/availability") {
    await setupAvailability(context);
    return;
  }
  const [profileResult, availabilityResult, payoutResult, onboardingResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    requestJson("/api/marketplace/cleaner/onboarding")
  ]);
  const profile = profileResult.status === "fulfilled" && profileResult.value.profile ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability) ? availabilityResult.value.availability.length : 0;
  const payoutState = payoutResult.status === "fulfilled" ? (payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "not-started") : "unavailable";

  const progress = onboardingProgress({
    account: { displayName: document.querySelector("[data-account-name]")?.textContent, email: true },
    profile,
    payoutState,
    availabilityCount,
    onboardingSections: onboardingResult.status === "fulfilled" && Array.isArray(onboardingResult.value.sections) ? onboardingResult.value.sections : []
  });

  setText("[data-reg-percent]", `${progress.percent}%`);
  setText("[data-reg-remaining]", String(progress.remaining));
  setText("[data-reg-status]", applicationStatusLabel({ profile }, progress));
  const track = document.querySelector("[data-reg-track]");
  const fill = document.querySelector("[data-reg-fill]");
  if (track) track.setAttribute("aria-valuenow", String(progress.percent));
  // Width through CSSOM, not a style attribute, so `style-src 'self'` still holds.
  if (fill) fill.style.width = `${progress.percent}%`;

  const host = document.querySelector("[data-reg-steps]");
  if (!host) return;
  host.replaceChildren(...progress.steps.map((step, index) => {
    const card = element(step.href ? "a" : "div", "hc-reg-card");
    if (step.href) card.href = step.href;
    card.dataset.done = String(step.done);
    if (!step.tracked) card.dataset.pending = "true";

    const mark = element("span", "hc-reg-mark");
    mark.append(stepIcon(step.icon));
    const body = element("div", "hc-reg-body");
    body.append(
      element("span", "hc-reg-index", String(index + 1).padStart(2, "0")),
      element("span", "hc-reg-title", step.title),
      element("span", "hc-reg-state", step.done ? "Complete" : step.tracked ? "Outstanding" : "Not open yet")
    );
    const chip = element("span", `hc-reg-chip${step.done ? " hc-reg-chip-done" : ""}`, step.done ? "✓" : "○");
    card.append(mark, body, chip);
    if (!step.tracked) card.title = "This step needs document capture, which Homle does not have yet.";
    return card;
  }));
});
