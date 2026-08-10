import { onboardingIcons, onboardingProgress, requiredOnboardingSubmissionKeys } from "./cleaner-onboarding-steps.js?v=20260807-3";
import { element } from "./cleaner-page.js?v=20260807-1";
import { saveCsrf, storedCsrf } from "./session-csrf.js";

const stageDetails = Object.freeze([
  { key: "personal", title: "Personal details", href: "/cleaner/personal-details", icon: "user" },
  { key: "business", title: "Business details", href: "/cleaner/business-details", icon: "brief" },
  { key: "banking", title: "Banking & payments", href: "/cleaner/banking", icon: "card" },
  { key: "identity", title: "Identity verification", href: "/cleaner/identity-verification", icon: "id" },
  { key: "rtw", title: "Right to work", href: "/cleaner/right-to-work", icon: "id" },
  { key: "dbs", title: "Background checks (DBS)", href: "/cleaner/background-checks", icon: "shield" },
  { key: "experience", title: "Skills and Experience", href: "/cleaner/experience", icon: "star" },
  { key: "insurance", title: "Insurance", href: "/cleaner/insurance", icon: "umb" },
  { key: "equipment", title: "Equipment & Travel", href: "/cleaner/equipment", icon: "box" },
  { key: "areas", title: "Work areas", href: "/cleaner/work-areas", icon: "pin" },
  { key: "skills", title: "Skills", href: "/cleaner/experience", icon: "spark", optional: true },
  { key: "training", title: "Training & certificates", href: "/cleaner/training", icon: "award", optional: true },
  { key: "compliance", title: "Compliance & declarations", href: "/cleaner/contracts", icon: "pen", optional: true }
]);

function safeText(value, fallback = "Recorded securely") {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 120) : fallback;
}

function selectedValues(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function sectionSummary(key, data = {}, profile = null, documents = []) {
  const documentCount = documents.filter((document) => document.section === key).length;
  if (key === "personal") {
    const name = safeText(data.preferredName || data.firstName, "Name recorded");
    const postcode = safeText(data.postcode, "Postcode recorded");
    return `${name} · ${postcode}`;
  }
  if (key === "business") {
    const profession = data.serviceType === "beautician" ? "Beautician" : "Cleaner";
    const operation = { solo: "Solo", business: "Business", limited: "Limited company", partnership: "Partnership" }[data.businessType] || "Work type recorded";
    return data.businessName ? `${profession} · ${operation} · ${safeText(data.businessName)}` : `${profession} · ${operation}`;
  }
  if (key === "banking") return "Payout preference recorded securely; full bank details are never shown";
  if (key === "identity") return `${documentCount} identity document${documentCount === 1 ? "" : "s"} stored securely`;
  if (key === "rtw") return data.britishOrIrishCitizen === "yes" ? "British or Irish citizenship evidence supplied" : "Home Office share-code evidence supplied";
  if (key === "dbs") return `${safeText(data.dbsLevel, "DBS status recorded")} · ${documentCount} supporting document${documentCount === 1 ? "" : "s"}`;
  if (key === "experience") {
    const specialisms = selectedValues(data.specialisms || data.cleanerSpecialisms || data.beauticianSpecialisms);
    return `${safeText(data.yearsExperience, profile?.yearsExperience != null ? `${profile.yearsExperience} years` : "Experience recorded")} · ${specialisms.length} specialism${specialisms.length === 1 ? "" : "s"}`;
  }
  if (key === "insurance") return `${safeText(data.policyProvider, "Provider recorded")} · ${safeText(data.policyExpiry, "Expiry recorded")} · ${documentCount} document${documentCount === 1 ? "" : "s"}`;
  if (key === "equipment") {
    const kits = data.kitsByProfession?.[data.serviceType || "cleaner"] || {};
    const equipment = selectedValues(kits.equipmentSupplied || profile?.equipmentSupplied);
    return `${equipment.length} equipment item${equipment.length === 1 ? "" : "s"} · ${safeText(data.primaryTransport, "Travel method recorded")}`;
  }
  if (key === "areas") {
    const areas = selectedValues(data.serviceAreas || profile?.serviceAreas).map((area) => safeText(typeof area === "object" ? area.outwardPostcode || area.postcode : area)).slice(0, 8);
    return areas.length ? `Postcode areas: ${areas.join(", ")}` : "Work areas recorded securely";
  }
  if (key === "training") return "Only required training is active at this stage";
  if (key === "compliance") return "Review available agreements and declarations";
  return "This stage does not block application submission yet";
}

function stageIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", onboardingIcons[name] || onboardingIcons.folder);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.7");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function showReviewLayout() {
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const reviewCard = document.querySelector("[data-review-submit]");
  const reviewTopbar = document.querySelector("[data-review-topbar]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  document.querySelectorAll(".hc-personal-layout > .hc-personal-card").forEach((node) => { node.hidden = node !== reviewCard; });
  document.querySelectorAll(".hc-personal-layout > .hc-business-topbar").forEach((node) => { node.hidden = node !== reviewTopbar; });
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    node.classList.toggle("is-current", node.dataset.personalStepKey === "review");
  });
}

async function secureCsrf(requestJson) {
  const existing = storedCsrf();
  if (existing) return existing;
  const session = await requestJson("/api/marketplace/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!session.csrfToken || !saveCsrf(session.csrfToken)) throw new Error("Your secure submission token could not be restored. Sign in again before submitting.");
  return session.csrfToken;
}

function renderReviewStages({ sections, submission, profile, documents }) {
  const host = document.querySelector("[data-review-list]");
  if (!host) return;
  const bySection = new Map(sections.map((section) => [section.section, section]));
  const required = new Set(requiredOnboardingSubmissionKeys);
  const missing = new Set(submission.missingSections || []);
  host.replaceChildren(...stageDetails.map((stage) => {
    const section = bySection.get(stage.key);
    const complete = stage.optional ? ["submitted", "verified"].includes(section?.status) : !missing.has(stage.key);
    const row = element("article", "hc-review-stage");
    row.dataset.complete = String(complete);
    const icon = element("span", "hc-review-stage-icon");
    icon.append(stageIcon(stage.icon));
    const copy = element("div", "hc-review-stage-copy");
    copy.append(element("strong", "", stage.title), element("p", "", complete ? sectionSummary(stage.key, section?.data, profile, documents) : "Complete this stage before submitting."));
    const state = element("span", `hc-review-stage-state${complete ? " is-complete" : ""}`, complete ? "Ready" : stage.optional ? "Optional" : "Needs attention");
    const edit = element("a", "hc-review-stage-edit", complete ? "Review" : "Complete");
    edit.href = stage.href;
    edit.setAttribute("aria-label", `${complete ? "Review" : "Complete"} ${stage.title}`);
    row.append(icon, copy, state, edit);
    if (!required.has(stage.key)) row.dataset.optional = "true";
    return row;
  }));
}

export async function setupReviewSubmit({ account, showFeedback, requestJson }) {
  document.title = "Review & submit | Homlle";
  showReviewLayout();
  const [onboardingResult, submissionResult, profileResult, documentsResult] = await Promise.all([
    requestJson("/api/marketplace/cleaner/onboarding"),
    requestJson("/api/marketplace/cleaner/onboarding/submission"),
    requestJson("/api/marketplace/cleaner/profile").catch(() => ({ profile: null })),
    requestJson("/api/marketplace/cleaner/onboarding/documents").catch(() => ({ documents: [] }))
  ]);
  const sections = Array.isArray(onboardingResult.sections) ? onboardingResult.sections : [];
  const submission = submissionResult.submission || {};
  const profile = profileResult.profile || null;
  const documents = Array.isArray(documentsResult.documents) ? documentsResult.documents : [];
  const progress = onboardingProgress({ account, profile, onboardingSections: sections, payoutState: "unavailable", availabilityCount: 0 });
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const step = progress.steps.find((item) => item.key === node.dataset.personalStepKey);
    node.classList.toggle("is-complete", step?.done === true);
    node.classList.toggle("is-current", node.dataset.personalStepKey === "review");
  });
  renderReviewStages({ sections, submission, profile, documents });

  const readyCount = requiredOnboardingSubmissionKeys.length - (submission.missingSections?.length || 0);
  const count = document.querySelector("[data-review-count]");
  const summary = document.querySelector("[data-review-summary]");
  const status = document.querySelector("[data-review-save-status]");
  const confirm = document.querySelector("[data-review-confirm]");
  const button = document.querySelector("[data-review-submit-button]");
  if (count) count.textContent = `${readyCount}/${requiredOnboardingSubmissionKeys.length} ready`;
  if (summary) summary.textContent = submission.submitted
    ? "Your application has already been submitted for verification."
    : submission.ready
      ? "All required stages are ready. Check the summaries and confirm below."
      : `${submission.missingSections?.length || 0} required stage${submission.missingSections?.length === 1 ? " needs" : "s need"} attention.`;
  if (status) status.textContent = submission.submitted
    ? "Submitted securely. You can view your confirmation."
    : submission.ready
      ? "Confirm the declaration to submit your application."
      : "Complete every required stage before submitting.";
  if (submission.submitted) {
    if (confirm instanceof HTMLInputElement) confirm.closest("label").hidden = true;
    if (button instanceof HTMLButtonElement) {
      button.disabled = false;
      button.textContent = "View confirmation";
      button.addEventListener("click", () => location.assign("/cleaner/congratulations"));
    }
    return;
  }
  const updateButton = () => {
    if (button instanceof HTMLButtonElement) button.disabled = !(submission.ready && confirm instanceof HTMLInputElement && confirm.checked);
  };
  confirm?.addEventListener("change", updateButton);
  updateButton();
  button?.addEventListener("click", async () => {
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    button.disabled = true;
    button.textContent = "Submitting securely…";
    try {
      const csrf = await secureCsrf(requestJson);
      await requestJson("/api/marketplace/cleaner/onboarding/submission", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ confirmed: true })
      });
      location.assign("/cleaner/congratulations");
    } catch (error) {
      showFeedback(error.message || "Homlle could not submit your application. Nothing was lost.", "error");
      button.textContent = "Submit application";
      updateButton();
    }
  });
}

export async function setupCongratulations({ account, requestJson }) {
  document.title = "Application submitted | Homlle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const congratulations = document.querySelector("[data-congratulations]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = true;
  const result = await requestJson("/api/marketplace/cleaner/onboarding/submission");
  if (!result.submission?.submitted) {
    location.replace("/cleaner/review-submit");
    return;
  }
  if (congratulations) congratulations.hidden = false;
  const email = document.querySelector("[data-congratulations-email]");
  if (email) email.textContent = safeText(account?.email, "your registered email");
}
