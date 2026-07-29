import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-3";

const maximumDocumentBytes = 20 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "banking");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function selectedFileCopy(file) {
  const megabytes = Math.max(0.1, file.size / (1024 * 1024)).toFixed(1);
  return `${file.name} · ${megabytes} MB · selected for this page only`;
}

function payoutStatusCopy(payout) {
  if (payout?.ready) return "Payout destination verified by Stripe. Homle cannot see or display the full bank details.";
  if (payout?.status === "action-required") return "Stripe needs more information before payouts can be enabled. Continue securely to finish setup.";
  return "No payout destination is connected yet. Continue securely to provide details directly to Stripe.";
}

export async function setupBanking({ account, showFeedback, requestJson }) {
  document.title = "Banking & payments | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const cards = [
    document.querySelector("[data-personal-card]"),
    document.querySelector("[data-business-details]"),
    document.querySelector("[data-identity-verification]"),
    document.querySelector("[data-background-checks]"),
    document.querySelector("[data-experience]"),
    document.querySelector("[data-references]"),
    document.querySelector("[data-insurance]"),
    document.querySelector("[data-work-areas]")
  ];
  const bankingCard = document.querySelector("[data-banking]");
  const topbars = [
    document.querySelector("[data-business-topbar]"),
    document.querySelector("[data-identity-topbar]"),
    document.querySelector("[data-background-topbar]"),
    document.querySelector("[data-experience-topbar]"),
    document.querySelector("[data-references-topbar]"),
    document.querySelector("[data-insurance-topbar]"),
    document.querySelector("[data-work-topbar]")
  ];
  const bankingTopbar = document.querySelector("[data-banking-topbar]");
  const form = document.querySelector("[data-banking-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  for (const card of cards) if (card) card.hidden = true;
  if (bankingCard) bankingCard.hidden = false;
  for (const topbar of topbars) if (topbar) topbar.hidden = true;
  if (bankingTopbar) bankingTopbar.hidden = false;
  if (!(form instanceof HTMLFormElement)) return;

  const holder = form.querySelector("[data-banking-holder]");
  if (holder instanceof HTMLInputElement) holder.value = account?.displayName || "";

  const [profileResult, availabilityResult, payoutResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account")
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payout = payoutResult.status === "fulfilled" ? payoutResult.value.payout : null;
  const payoutState = payout?.ready ? "ready" : payoutResult.status === "fulfilled" ? "not-started" : "unavailable";
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));

  const providerStatus = form.querySelector("[data-banking-provider-status]");
  if (providerStatus) {
    providerStatus.textContent = payoutResult.status === "fulfilled"
      ? payoutStatusCopy(payout)
      : "Payout status is temporarily unavailable. No bank details were requested or exposed.";
    providerStatus.classList.toggle("is-ready", payout?.ready === true);
  }

  form.querySelectorAll('input[name="paymentFrequency"]').forEach((input) => {
    input.addEventListener("change", () => {
      const status = form.querySelector("[data-banking-save-status]");
      if (status) status.textContent = "Payment preference selected for this page only. Stripe controls the actual payout schedule.";
    });
  });

  const fileInput = form.querySelector("[data-banking-file]");
  fileInput?.addEventListener("change", () => {
    if (!(fileInput instanceof HTMLInputElement)) return;
    const file = fileInput.files?.[0];
    const row = fileInput.closest(".hc-banking-document");
    const copy = row?.querySelector("small");
    const action = row?.querySelector(".hc-banking-document-action");
    if (!file) {
      row?.classList.remove("is-selected");
      return;
    }
    if (!allowedDocumentTypes.has(file.type) || file.size > maximumDocumentBytes) {
      fileInput.value = "";
      row?.classList.remove("is-selected");
      showFeedback("Choose a PDF, JPEG or PNG invoice template no larger than 20MB.", "error");
      return;
    }
    row?.classList.add("is-selected");
    if (copy) copy.textContent = selectedFileCopy(file);
    if (action) action.textContent = "Replace";
    const status = form.querySelector("[data-banking-save-status]");
    if (status) status.textContent = "Invoice template selected for this page only. It has not been uploaded or stored.";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    showFeedback("Opening secure Stripe payout setup. Homle will not receive your full bank details.");
    location.assign(payout?.ready ? "/cleaner/payouts" : "/cleaner/payouts?resume=1");
  });
}
