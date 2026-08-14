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
