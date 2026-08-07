import { createCleanerPage, element, requestJson, setText } from "./cleaner-page.js?v=20260807-1";

// The design's four rank tiers. Homle assigns none of them: there is no ranking engine,
// and two of the four inputs the design names (punctuality, cancellation rate) are not
// recorded anywhere. The ladder renders so the page matches the design, with no tier
// marked as reached.
const ladder = ["Bronze", "Silver", "Gold", "Platinum"];
const reviewDateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric"
});

function starText(rating) {
  const whole = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return "★".repeat(whole) + "☆".repeat(5 - whole);
}

function reviewDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? reviewDateFormat.format(date) : "Date unavailable";
}

function renderReviews(reviews) {
  const empty = document.querySelector("[data-reviews-empty]");
  const list = document.querySelector("[data-reviews-list]");
  if (empty) empty.hidden = reviews.length > 0;
  if (!list) return;
  list.replaceChildren(...reviews.map((review) => {
    const card = element("article", "hc-rev");
    const head = element("div", "hc-rev-head");
    head.append(element("div", "hc-rev-avatar", "C"));
    const who = element("div", "hc-rev-who");
    who.append(
      element("div", "hc-rev-name", "Verified client"),
      element("div", "hc-rev-meta", `Completed job · ${reviewDate(review.createdAt)}`)
    );
    head.append(who, element("span", "hc-rev-stars", starText(review.rating)));
    card.append(head);
    if (review.writtenReview) card.append(element("p", "hc-rev-body", review.writtenReview));
    if (review.cleanerResponse) {
      const response = element("div", "hc-rev-response");
      response.append(element("span", "hc-rev-response-label", "Your response"), document.createTextNode(review.cleanerResponse));
      card.append(response);
    }
    return card;
  }));
}

function renderBreakdown(reviews) {
  const bars = document.querySelector("[data-reviews-bars]");
  if (!bars) return;
  const counts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((review) => Math.round(Number(review.rating) || 0) === star).length
  }));
  const highest = Math.max(1, ...counts.map((row) => row.count));
  bars.replaceChildren(...counts.map((row) => {
    const line = element("div", "hc-bar-row");
    const track = element("div", "hc-bar-track");
    const fill = element("div", "hc-bar-fill");
    fill.style.width = `${Math.round(row.count / highest * 100)}%`;
    track.append(fill);
    line.append(element("span", "hc-bar-label", `${row.star}★`), track, element("span", "hc-bar-count", String(row.count)));
    return line;
  }));
}

createCleanerPage("perf", async ({ showFeedback }) => {
  const profileResult = await requestJson("/api/marketplace/cleaner/profile").catch(() => null);
  const profile = profileResult?.profile && typeof profileResult.profile === "object" ? profileResult.profile : null;
  const completed = Number(profile?.completedJobCount) || 0;
  const reviewCount = Number(profile?.reviewCount) || 0;
  const rating = reviewCount > 0 && Number.isFinite(profile?.averageRating) ? Number(profile.averageRating) : null;

  setText("[data-reviews-overall]", rating === null ? "—" : `${rating.toFixed(1)} ★`);
  setText("[data-reviews-count]", reviewCount > 0 ? `${reviewCount} approved ${reviewCount === 1 ? "review" : "reviews"}` : "No approved reviews yet");
  setText("[data-reviews-completed]", String(completed));
  setText("[data-reviews-public]", profile?.isPublic === true ? "Live" : "Not published");
  setText("[data-reviews-pending]", "Private");

  let reviews = [];
  if (profile?.cleanerId && reviewCount > 0) {
    try {
      const reviewResult = await requestJson(`/api/marketplace/cleaners/${encodeURIComponent(profile.cleanerId)}/reviews`);
      reviews = Array.isArray(reviewResult.reviews)
        ? reviewResult.reviews
        : Array.isArray(reviewResult.cleaner?.reviews) ? reviewResult.cleaner.reviews : [];
    } catch {
      showFeedback("Your performance totals loaded, but individual reviews could not be fetched. Nothing was changed.", "error");
    }
  }
  renderReviews(reviews);
  renderBreakdown(reviews);

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
