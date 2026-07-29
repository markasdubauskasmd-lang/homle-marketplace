import { createCleanerPage, element, requestJson, setText } from "./cleaner-page.js?v=20260729-6";

// The design's four rank tiers. Homle assigns none of them: there is no ranking engine,
// and two of the four inputs the design names (punctuality, cancellation rate) are not
// recorded anywhere. The ladder renders so the page matches the design, with no tier
// marked as reached.
const ladder = ["Bronze", "Silver", "Gold", "Platinum"];

createCleanerPage("perf", async () => {
  const profileResult = await requestJson("/api/marketplace/cleaner/profile").catch(() => null);
  const profile = profileResult?.profile && typeof profileResult.profile === "object" ? profileResult.profile : null;
  const completed = Number(profile?.completedJobCount) || 0;
  const reviewCount = Number(profile?.reviewCount) || 0;
  const rating = reviewCount > 0 && Number.isFinite(profile?.averageRating) ? Number(profile.averageRating) : null;

  setText("[data-perf-tier]", "Not ranked yet");

  const perks = document.querySelector("[data-perf-perks]");
  if (perks) perks.replaceChildren(
    element("span", "hc-rank-perk", "Ranking is not live"),
    element("span", "hc-rank-perk", "No tier assigned")
  );

  const ladderHost = document.querySelector("[data-perf-ladder]");
  if (ladderHost) ladderHost.replaceChildren(...ladder.map((tier) => {
    const step = element("div", "hc-ladder-step");
    step.append(element("span", "hc-ladder-dot"), element("span", "hc-ladder-name", tier));
    return step;
  }));

  // Only the two figures Homle genuinely records carry a value. The other two say what is
  // missing rather than showing a number nothing computed.
  const criteria = [
    { label: "COMPLETED JOBS", value: String(completed), chip: "Tracked", tracked: true },
    { label: "APPROVED RATING", value: rating === null ? "—" : `${rating.toFixed(1)} ★`, chip: reviewCount > 0 ? "Tracked" : "No reviews yet", tracked: true },
    { label: "ON-TIME ARRIVAL", value: "—", chip: "Not tracked", tracked: false, need: "arrival punctuality is not recorded" },
    { label: "CANCELLATION RATE", value: "—", chip: "Not tracked", tracked: false, need: "cancellations are not recorded" }
  ];
  const host = document.querySelector("[data-perf-criteria]");
  if (host) host.replaceChildren(...criteria.map((metric) => {
    const card = element("div", "hc-criterion");
    const head = element("div", "hc-criterion-head");
    head.append(
      element("span", "hc-criterion-label", metric.label),
      element("span", `hc-criterion-chip${metric.tracked ? "" : " hc-criterion-chip-off"}`, metric.chip)
    );
    card.append(head, element("div", "hc-criterion-value", metric.value));
    if (metric.need) card.append(element("div", "hc-criterion-need", `Need ${metric.need}`));
    return card;
  }));
});
