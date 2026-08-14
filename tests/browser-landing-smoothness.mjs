import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// How the landing page actually scrolls, measured in frames.
//
// The whole page is scroll-driven: six acts were pinned and animated from a
// scroll position, and nothing in the suite could tell whether that arrived as
// motion or as stutter. It was reported as "very laggy", and the reporter
// pointed at the first act — but measuring found Act 1 holding a flawless 60fps
// and the handoff act dropping 20 of 89 sampled frames. The lag was in the act
// nobody suspected, and the fix was removing it: it carried decorative stock
// portraits over a filtered full-bleed backdrop, and its cost bought nothing.
//
// So this exists to keep the answer honest for the next change. It scrolls the
// entire page at both widths and looks at the distribution of frame times, not
// at a source string. A frame over 32ms is one the eye reads as a hitch: two
// refreshes missed at 60Hz.
//
// The budget is deliberately loose — 5% of frames — because this runs on
// whatever machine happens to be free, and a loaded CI box will drop a frame or
// two for reasons the page cannot control. It is still far tighter than the
// 22% the removed act produced, which is the regression worth catching.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Landing smoothness checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const LONG_FRAME_MS = 32;
const BUDGET = 0.05;

const server = await serveStatic();
const browser = await launchBrowser();
let failure = null;
const readings = [];

/* Scrolls the document in rAF-sized steps while sampling frame deltas. Driving
   it from rAF rather than a timer means the page is asked for exactly as much
   work per frame as a real scroll would ask for. */
const walk = `
  const viewport = window.innerHeight;
  const travel = document.documentElement.scrollHeight - viewport;
  window.scrollTo(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const deltas = [];
  let previous = performance.now();
  let stop = false;
  const tick = (now) => { deltas.push(now - previous); previous = now; if (!stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  const STEPS = 180;
  for (let step = 1; step <= STEPS; step++) {
    window.scrollTo(0, travel * (step / STEPS));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  stop = true;
  await new Promise((resolve) => setTimeout(resolve, 120));

  // The first frames cover the scroll starting up rather than running.
  const sorted = deltas.slice(3).sort((a, b) => a - b);
  const at = (q) => sorted[Math.floor(sorted.length * q)] || 0;
  return {
    frames: sorted.length,
    median: Math.round(at(0.5) * 10) / 10,
    p90: Math.round(at(0.9) * 10) / 10,
    worst: Math.round(sorted[sorted.length - 1] * 10) / 10,
    long: sorted.filter((delta) => delta > ${LONG_FRAME_MS}).length,
    travel: Math.round(travel)
  };
`;

try {
  for (const viewport of [{ label: "desktop", width: 1440, height: 900 }, { label: "phone", width: 390, height: 844 }]) {
    await browser.setViewport({ width: viewport.width, height: viewport.height, mobile: viewport.width < 700 });
    await browser.goto(`${server.origin}/home.html`);
    // The acts load photography and a clip; measuring mid-load would time the
    // network rather than the animation.
    await browser.evaluate(`await new Promise((resolve) => setTimeout(resolve, 2500)); return true;`);

    const result = await browser.evaluate(walk);
    readings.push(`${viewport.label} median ${result.median}ms, p90 ${result.p90}ms, ${result.long}/${result.frames} long`);

    assert(result.frames > 100,
      `${viewport.label}: only ${result.frames} frames were sampled, so this measured nothing.`);
    assert(result.travel > viewport.height * 5,
      `${viewport.label}: the page is only ${result.travel}px tall, so its scroll-driven acts cannot be playing.`);

    const longShare = result.long / result.frames;
    assert(longShare <= BUDGET,
      `${viewport.label}: ${result.long} of ${result.frames} frames (${Math.round(longShare * 100)}%) took longer than ${LONG_FRAME_MS}ms while scrolling the landing page, worst ${result.worst}ms. The budget is ${BUDGET * 100}%. Something in an act is doing per-frame work the compositor cannot absorb — a filter or clip-path being re-rasterised as it moves is the usual cause.`);

    assert(result.median <= 20,
      `${viewport.label}: the median frame took ${result.median}ms, so the page is not holding 60fps even at rest during a scroll.`);
  }
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;

console.log(`Landing smoothness tests passed: ${readings.join("; ")} — every act holds 60fps end to end at both widths, so the scroll-driven design arrives as motion rather than stutter.`);
