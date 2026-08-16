import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// The opening room reveal is the first impression of Homle and the largest
// animated surface on the page. The end-to-end smoothness test can hide a slow
// hero inside hundreds of frames from later acts, so this measures only the
// opening pin from its first frame to full bleed at desktop and phone widths.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Landing hero smoothness checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const server = await serveStatic();
const browser = await launchBrowser();
let failure = null;
const readings = [];

const measureHero = `
  const hero = document.querySelector('[data-stage="open"]');
  const travel = Math.max(1, hero.offsetHeight - window.innerHeight);
  window.scrollTo(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const deltas = [];
  let previous = performance.now();
  let stop = false;
  const tick = (now) => {
    deltas.push(now - previous);
    previous = now;
    if (!stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const STEPS = 120;
  for (let step = 1; step <= STEPS; step++) {
    window.scrollTo(0, travel * (step / STEPS));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  stop = true;
  await new Promise((resolve) => setTimeout(resolve, 120));

  const sorted = deltas.slice(3).sort((a, b) => a - b);
  const at = (q) => sorted[Math.floor(sorted.length * q)] || 0;
  return {
    frames: sorted.length,
    median: Math.round(at(0.5) * 10) / 10,
    p90: Math.round(at(0.9) * 10) / 10,
    worst: Math.round(sorted[sorted.length - 1] * 10) / 10,
    over32: sorted.filter((delta) => delta > 32).length
  };
`;

try {
  for (const viewport of [{ label: "desktop", width: 1440, height: 900 }, { label: "phone", width: 390, height: 844 }]) {
    await browser.setViewport({ width: viewport.width, height: viewport.height, mobile: viewport.width < 700 });
    await browser.goto(`${server.origin}/home.html`);
    await browser.evaluate(`await new Promise((resolve) => setTimeout(resolve, 1500)); return true;`);

    // Frame timing alone cannot detect an intentionally delayed animation. The
    // old reveal held 60fps while following only 13% of a wheel movement per
    // frame, so it looked laggy despite passing every timing assertion. Move
    // through the opening act and require its CSS progress to meet the actual
    // scroll position by the next painted frame.
    const response = await browser.evaluate(`
      const hero = document.querySelector('[data-stage="open"]');
      const travel = Math.max(1, hero.offsetHeight - window.innerHeight);
      window.scrollTo(0, Math.round(travel * 0.41));
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      // The page uses native smooth scrolling for anchor navigation, so compare
      // against the browser's current position rather than the requested final
      // position while that native movement is still in flight.
      const position = Math.max(0, Math.min(1, -hero.getBoundingClientRect().top / travel));
      const expected = Math.min(1, position / 0.82);
      return {
        expected,
        actual: Number(hero.style.getPropertyValue("--p"))
      };
    `);
    assert(Math.abs(response.actual - response.expected) <= 0.03,
      `${viewport.label}: the opening reveal trails the scroll position (${response.actual} vs ${response.expected}), so smooth frames still feel laggy.`);

    const result = await browser.evaluate(measureHero);
    readings.push(`${viewport.label} median ${result.median}ms, p90 ${result.p90}ms, ${result.over32}/${result.frames} over 32ms`);
    assert(result.frames > 100, `${viewport.label}: only ${result.frames} hero frames were sampled.`);
    assert(result.median <= 20, `${viewport.label}: the hero median is ${result.median}ms, below 60fps.`);
    assert(result.p90 <= 20, `${viewport.label}: the hero p90 is ${result.p90}ms, so the reveal visibly hitches.`);
  }
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;

console.log(`Landing hero smoothness tests passed: ${readings.join("; ")}.`);
