import { createCleanerPage, element, requestJson, setText } from "./cleaner-page.js?v=20260807-1";

const ladder = ["Bronze · 60–74", "Silver · 75–84", "Gold · 85–94", "Platinum · 95–100"];
createCleanerPage("perf", async ({ showFeedback }) => {
  const profileResult = await requestJson("/api/marketplace/cleaner/profile").catch(() => null);
  const profile = profileResult?.profile && typeof profileResult.profile === "object" ? profileResult.profile : null;
  const reviewCount = Number(profile?.reviewCount) || 0;
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


  setText("[data-perf-tier]", "Building your picture");

  const perks = document.querySelector("[data-perf-perks]");
  if (perks) perks.replaceChildren(
    element("span", "hc-rank-perk", "Proposed ranking"),
    element("span", "hc-rank-perk", "No tier assigned")
  );

  const ladderHost = document.querySelector("[data-perf-ladder]");
  if (ladderHost) ladderHost.replaceChildren(...ladder.map((tier) => {
    const step = element("div", "hc-ladder-step");
    step.append(element("span", "hc-ladder-dot"), element("span", "hc-ladder-name", tier));
    return step;
  }));


  const criteria = [
    ['Work quality', 'qualityRating', 25, '✓', 'Follow the agreed checklist, clean thoroughly and leave the space ready to use.'],
    ['Customer satisfaction', 'rating', 20, '★', 'The overall customer rating of a completed booking.'],
    ['Punctuality', 'punctualityRating', 20, '◷', 'Arrive at the agreed time and communicate delays. This is customer feedback, not a GPS measurement.'],
    ['Professionalism & safety', 'professionalismRating', 15, '◇', 'Clean appropriate workwear, hygiene, prepared equipment and respectful, safe working. Confirmed serious safety breaches affect the entire score out of 100 and can lower your overall rank, not just this category. Never physical appearance.'],
    ['Communication and Procedure adherence', 'communicationRating', 10, '☏', 'Communicate clearly, complete required checks before jobs and follow Homlle’s check-in, cleaning and completion procedures.'],
    ['Reliability', null, 10, '▣', 'Proposed: accepted bookings kept, excluding client cancellations, agreed changes and approved emergencies.']
  ];
  const host = document.querySelector('[data-perf-criteria]');
  if (host) host.replaceChildren(...criteria.map(([label,key,weight,icon,detail]) => {
    const values = key ? reviews.map(r => r[key]).filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 5) : [];
    const average = values.length ? values.reduce((a,b) => a+b,0) / values.length : null;
    const card = element('article','hc-criterion');
    const mark = element('span','hp-icon',icon); mark.setAttribute('aria-hidden','true');
    const head = element('div','hc-criterion-head');
    head.append(element('h3','hc-criterion-label',label), element('span','hc-criterion-chip',weight + '% weight'));
    const track = element('div','hp-meter'); track.setAttribute('aria-hidden','true');
    const fill = element('span'); fill.style.width = (average === null ? 0 : average / 5 * 100) + '%'; track.append(fill);
    card.append(mark,head,element('div','hc-criterion-value',average === null ? 'Awaiting data' : average.toFixed(1) + ' / 5'),track,element('p','hp-source',key ? values.length + (key === 'professionalismRating' ? ' professionalism ratings · safety adjustments not connected' : key === 'communicationRating' ? ' communication ratings · procedure scoring not connected' : ' ratings in the loaded review sample') : 'Cancellation scoring not connected'),element('p','hp-detail',detail));
    return card;
  }));
});

// Isolated illustration: never writes a profile or assigns a live tier.
const exampleInputs = [...document.querySelectorAll('[data-rank-example], [data-rank-reliability]')];
function updateRankingExample() {
  const output = document.querySelector('[data-rank-result]');
  if (!output) return;
  if (exampleInputs.some(input => input.value.trim() === '' || !input.validity.valid)) {
    output.textContent = 'Enter ratings from 1 to 5 and reliability from 0 to 100.';
    return;
  }
  const score = exampleInputs.reduce((total,input) => total + (input.hasAttribute('data-rank-example') ? Math.round(Number(input.value) * 10) * Number(input.dataset.rankExample) : Number(input.value) * 5),0) / 50;
  const tier = score >= 95 ? 'Platinum' : score >= 85 ? 'Gold' : score >= 75 ? 'Silver' : score >= 60 ? 'Bronze' : 'Developing';
  output.textContent = score.toFixed(2) + ' / 100 · ' + tier;
}
exampleInputs.forEach(input => input.addEventListener('input', updateRankingExample));
updateRankingExample();
