import { applicationStatusLabel, onboardingIcons, onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260816-completion-ticks-1";
import { createCleanerPage, element, requestJson, setText } from "./cleaner-page.js?v=20260816-completion-ticks-1";
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

const isIntroductionPage = location.pathname === "/cleaner/introduction";
if (isIntroductionPage) document.body.classList.add("cleaner-onboarding-introduction-page");

const registrationRouteShells = new Map([
  ["/cleaner/personal-details", ["[data-personal-topbar]", "[data-personal-card]"]],
  ["/cleaner/business-details", ["[data-business-topbar]", "[data-business-details]"]],
  ["/cleaner/identity-verification", ["[data-identity-topbar]", "[data-identity-verification]"]],
  ["/cleaner/right-to-work", ["[data-rtw-topbar]", "[data-right-to-work]"]],
  ["/cleaner/background-checks", ["[data-background-topbar]", "[data-background-checks]"]],
  ["/cleaner/experience", ["[data-experience-topbar]", "[data-experience]"]],
  ["/cleaner/insurance", ["[data-insurance-topbar]", "[data-insurance]"]],
  ["/cleaner/banking", ["[data-banking-topbar]", "[data-banking]"]],
  ["/cleaner/equipment", ["[data-equipment-topbar]", "[data-equipment]"]],
  ["/cleaner/availability", ["[data-availability-topbar]", "[data-availability]"]],
  ["/cleaner/work-areas", ["[data-work-topbar]", "[data-work-areas]"]],
  ["/cleaner/review-submit", ["[data-review-topbar]", "[data-review-submit]"]]
]);

function prepareRegistrationRouteShell() {
  const gate = document.querySelector("[data-reg-gate]");
  const view = document.querySelector("[data-reg]");
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const congratulations = document.querySelector("[data-congratulations]");
  if (gate) gate.hidden = true;
  if (view) view.hidden = false;
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = true;
  if (congratulations) congratulations.hidden = true;

  if (location.pathname === "/cleaner/introduction") return;
  if (location.pathname === "/cleaner/congratulations") {
    if (congratulations) congratulations.hidden = false;
    return;
  }

  const shell = registrationRouteShells.get(location.pathname);
  if (!shell) {
    if (overview) overview.hidden = false;
    return;
  }

  const shellSelectors = [...registrationRouteShells.values()].flat();
  for (const selector of shellSelectors) {
    const node = document.querySelector(selector);
    if (node) node.hidden = true;
  }
  if (layout) layout.hidden = false;
  for (const selector of shell) {
    const node = document.querySelector(selector);
    if (node) node.hidden = false;
  }
}

prepareRegistrationRouteShell();

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

createCleanerPage("reg", async (context) => {
  if (isIntroductionPage) {
    document.title = "Introduction | Homlle";
    const introduction = document.querySelector("[data-reg]");
    if (introduction) {
      introduction.className = "hc-onboarding-introduction";
      introduction.replaceChildren();
    }
    document.querySelector(".hc-fab")?.remove();
    document.querySelector(".hc-bell")?.remove();
    return;
  }
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
}, { silentInitialLoad: true });
