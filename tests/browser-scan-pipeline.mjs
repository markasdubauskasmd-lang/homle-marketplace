import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// The real camera pipeline, in a real browser.
//
// Every other test of the scanner is a unit test or a source-text assertion.
// Neither can tell you whether getUserMedia resolves, whether the canvas
// pipeline produces a frame, whether the review panel's selectors exist, or —
// the one that matters — whether redaction genuinely destroys pixels rather than
// appearing to.
//
// NOT a device trial. Desktop Chromium with a synthetic camera. A physical
// iPhone and Android handset over HTTPS is still required before activation.

function assert(condition, message) { if (!condition) throw new Error(message); }

// Skipped rather than failed where Chromium is absent, so this cannot break a
// build on a machine that has no browser. It is reported loudly either way.
const windowsCandidates = chromiumExecutableCandidates({
  platform: "win32",
  env: {
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\scanner\\AppData\\Local"
  }
});
assert(windowsCandidates.includes("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  && windowsCandidates.includes("C:\\Users\\scanner\\AppData\\Local\\Chromium\\Application\\chrome.exe"),
"The browser proof no longer discovers ordinary Windows Chrome or Chromium installations.");
const macCandidates = chromiumExecutableCandidates({ platform: "darwin", env: {} });
assert(macCandidates.includes("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  "The browser proof no longer discovers an ordinary macOS Chrome installation.");
const override = chromiumExecutableCandidates({ platform: "linux", env: { CHROMIUM_PATH: "/private/reviewed/chrome" } });
assert(override[0] === "/private/reviewed/chrome",
  "An explicit CI Chromium path no longer takes precedence over platform discovery.");

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Browser scan-pipeline checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const harnessPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>harness</title></head>
<body>
<video id="camera" autoplay muted playsinline></video>
<canvas id="frame"></canvas>
<script type="module">
  import {
    applyRedaction, redactedAreaRatio, redactionRegions, redactionSummary,
    shouldRedact, unusableRedactionRatio
  } from "/room-photo-redaction.js";
  import { coverSourceRect, fitBoxToFrame, frameBoxToSourceRect } from "/room-scan-model.js";
  import { createScanEventReporter } from "/scan-events.js";
  import { scanReview, applyCorrection } from "/scan-review-render.js";
  import { measurementStep } from "/room-measure-model.js";
  // Exposed so the driver can call the real modules rather than a copy.
  window.harness = {
    applyRedaction, redactedAreaRatio, redactionRegions, redactionSummary, shouldRedact,
    unusableRedactionRatio, coverSourceRect, fitBoxToFrame, frameBoxToSourceRect,
    createScanEventReporter, scanReview, applyCorrection, measurementStep
  };
  window.harnessReady = true;
</script>
</body></html>`;

const server = await serveStatic({ extraFiles: { "/harness.html": harnessPage } });
const browser = await launchBrowser();
let failure = null;

try {
  /* ── The modules load as ES modules in a browser at all ────────────────── */

  // A syntax check proves a file parses. It does not prove the module graph
  // resolves in a browser, which is where a bad relative import actually bites.
  await browser.goto(`${server.origin}/harness.html`);
  assert(await browser.evaluate("window.harnessReady === true"), "The scanner modules did not load in a browser.");
  assert(browser.pageErrors.length === 0, `The page threw while loading modules: ${browser.pageErrors.join(" | ")}`);

  /* ── getUserMedia actually resolves ────────────────────────────────────── */

  const camera = await browser.evaluate(`
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    const video = document.getElementById("camera");
    video.srcObject = stream;
    await new Promise((resolve) => { if (video.readyState >= 2) resolve(); else video.onloadeddata = resolve; });
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    return { width: video.videoWidth, height: video.videoHeight, readyState: video.readyState, live: track.readyState === "live" };
  `);
  assert(camera.live === true, "The camera track was not live.");
  assert(camera.width > 0 && camera.height > 0, `The video had no dimensions: ${JSON.stringify(camera)}`);
  assert(camera.readyState >= 2, "The video never reached a readable state, so no frame could be captured.");

  /* ── A real frame reaches a canvas ─────────────────────────────────────── */

  const frame = await browser.evaluate(`
    const video = document.getElementById("camera");
    const canvas = document.getElementById("frame");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const url = canvas.toDataURL("image/jpeg", 0.9);
    return { length: url.length, prefix: url.slice(0, 23) };
  `);
  assert(frame.prefix === "data:image/jpeg;base64,", `The canvas did not produce a JPEG: ${frame.prefix}`);
  // A blank canvas still encodes, so length is the check that pixels arrived.
  assert(frame.length > 5000, `The captured frame was suspiciously small (${frame.length} chars) — the canvas may be blank.`);

  /* ── Redaction genuinely destroys the pixels ───────────────────────────── */

  // The claim that matters and the one no unit test can make. The region is
  // filled with a known pattern, redacted, and then read back: if the variance
  // inside it collapses, the detail is genuinely gone. A CSS blur filter would
  // pass a "did it change" check while leaving recoverable detail behind.
  const redaction = await browser.evaluate(`
    const canvas = document.getElementById("frame");
    const context = canvas.getContext("2d");
    canvas.width = 400; canvas.height = 400;
    // High-frequency checkerboard: the hardest thing for a downscale to preserve,
    // which is exactly why it is the right probe.
    for (let y = 0; y < 400; y += 10) {
      for (let x = 0; x < 400; x += 10) {
        context.fillStyle = ((x / 10) + (y / 10)) % 2 ? "#000000" : "#ffffff";
        context.fillRect(x, y, 10, 10);
      }
    }
    const variance = (data) => {
      let sum = 0, sumSquares = 0, count = 0;
      for (let index = 0; index < data.length; index += 4) { sum += data[index]; sumSquares += data[index] ** 2; count += 1; }
      const mean = sum / count;
      return (sumSquares / count) - (mean * mean);
    };
    const before = variance(context.getImageData(100, 100, 200, 200).data);
    const regions = window.harness.redactionRegions(
      [{ class: "person", bbox: [100, 100, 200, 200] }], { width: 400, height: 400 });
    const applied = window.harness.applyRedaction(context, regions, { document });
    const after = variance(context.getImageData(100, 100, 200, 200).data);
    const outside = variance(context.getImageData(0, 0, 60, 60).data);
    return { applied, before, after, outside, regionCount: regions.length, filter: context.filter };
  `);
  assert(redaction.regionCount === 1 && redaction.applied === 1, "The redaction did not run in the browser.");
  assert(redaction.before > 1000, `The probe pattern had no detail to destroy (variance ${redaction.before}).`);
  // The detail is genuinely resampled away, not hidden behind something
  // reversible.
  assert(redaction.after < redaction.before / 4,
    `Redaction left most of the detail behind: variance ${redaction.before} to ${redaction.after}.`);
  // And it erased only what it was asked to.
  assert(redaction.outside > 1000, `Redaction destroyed detail outside its region (variance ${redaction.outside}).`);
  assert(redaction.filter === "none", "A canvas filter was used instead of resampling.");

  /* ── The geometry maths agrees with a real canvas ──────────────────────── */

  const geometry = await browser.evaluate(`
    // A 1280×720 video painted into a 390×844 portrait viewfinder with
    // object-fit: cover shows only a centred vertical slice about 333px wide,
    // from x≈474 to x≈806. This box sits inside that slice.
    const inside = window.harness.fitBoxToFrame(
      { x: 550, y: 200, width: 150, height: 200 },
      { videoWidth: 1280, videoHeight: 720, frameWidth: 390, frameHeight: 844 });
    // And this one is in the cropped-away part of the frame, which the mapper
    // must refuse rather than clamp — a clamped box would be drawn confidently
    // over the wrong thing.
    const outside = window.harness.fitBoxToFrame(
      { x: 20, y: 50, width: 100, height: 100 },
      { videoWidth: 1280, videoHeight: 720, frameWidth: 390, frameHeight: 844 });
    const back = inside ? window.harness.frameBoxToSourceRect(inside, { canvasWidth: 1280, canvasHeight: 720 }) : null;
    const cover = window.harness.coverSourceRect({ sourceWidth: 1280, sourceHeight: 720, frameWidth: 390, frameHeight: 844 });
    return { inside, outside, back, cover };
  `);
  assert(geometry.cover && geometry.cover.sWidth > 300 && geometry.cover.sWidth < 360,
    `The cover slice was computed unexpectedly in a browser: ${JSON.stringify(geometry.cover)}`);
  assert(geometry.inside && Number.isFinite(geometry.inside.x), "A box inside the visible slice was dropped in a browser.");
  assert(geometry.outside === null, "A box in the cropped-away region was mapped rather than refused.");
  assert(geometry.back && geometry.back.sWidth > 0, "The inverse crop mapping failed in a browser.");

  /* ── The review panel's selectors exist in the real page ───────────────── */

  // A source-text test proves a string is present. Only a browser proves the
  // element is actually queryable, which is what the renderer depends on.
  await browser.goto(`${server.origin}/landlord-journey.html`);
  const selectors = await browser.evaluate(`
    const needed = ["[data-review]", "[data-review-level-label]", "[data-review-explanation]",
      "[data-review-price]", "[data-review-breakdown]", "[data-review-question-list]",
      "[data-review-room-list]", "[data-review-refusal-reason]", "[data-review-provisional]"];
    return needed.filter((selector) => !document.querySelector(selector));
  `);
  assert(selectors.length === 0, `The review renderer targets elements the page does not contain: ${selectors.join(", ")}`);
  // Hidden until there is something to review.
  assert(await browser.evaluate('document.querySelector("[data-review]").hidden === true'),
    "The review panel is visible before anything has been reviewed.");

  /* ── The pure models behave identically in a browser ───────────────────── */

  await browser.goto(`${server.origin}/harness.html`);
  const models = await browser.evaluate(`
    const review = window.harness.scanReview({
      rooms: [{ roomName: "Kitchen", objects: [{ objectId: "a", inventoryKey: "hob", label: "Hob", quantity: 1,
        condition: "heavy", soiling: ["grease"], evidence: "dark streaks", needsConfirmation: false }], measurements: [] }],
      complexity: { assessed: true, level: 4, levelLabel: "Deep-clean conditions", explanation: "because grease", questions: [], provisional: false },
      estimate: { priceable: true, totalPence: 11000, lowPence: 9350, highPence: 12650, lines: [{ label: "Cleaning time", pence: 7000 }], rulesetVersion: 1 }
    });
    const corrected = window.harness.applyCorrection(
      [{ name: "Kitchen", objects: [{ inventoryKey: "hob", label: "Hob", condition: "heavy", quantity: 1 }] }],
      { roomName: "Kitchen", inventoryKey: "hob", field: "label", value: "Induction hob" });
    const step = window.harness.measurementStep({
      reference: "bank-card", referenceLine: { from: { x: 10, y: 10 }, to: { x: 210, y: 10 } },
      subject: "room-length", subjectLine: { from: { x: 0, y: 500 }, to: { x: 4000, y: 500 } } });
    return {
      level: review.levelLabel, price: review.price?.total, range: review.price?.range,
      renamed: corrected.rooms[0].objects[0].label, original: corrected.corrections[0].originalValue,
      stage: step.stage, spanPixels: step.spanPixels
    };
  `);
  assert(models.level === "Deep-clean conditions" && models.price === "£110.00", `The review model behaved differently in a browser: ${JSON.stringify(models)}`);
  assert(/Likely £93\.50/.test(models.range), `The price range was wrong in a browser: ${models.range}`);
  assert(models.renamed === "Induction hob" && models.original === "Hob", "Correction behaved differently in a browser.");
  assert(models.stage === "ready" && models.spanPixels === 4000, "Measurement capture behaved differently in a browser.");

  /* ── The event reporter batches, in a browser ──────────────────────────── */

  const reporter = await browser.evaluate(`
    const sent = [];
    const reporter = window.harness.createScanEventReporter({
      send: (path, options) => { sent.push({ path, body: JSON.parse(options.body) }); return Promise.resolve(); },
      token: "csrf-token-value-long-enough"
    });
    reporter.record("scan.session.started");
    reporter.record("scan.room.completed", { dimensions: { deviceClass: "guided-web", roomName: "Kitchen" } });
    const immediate = sent.length;
    await reporter.flush();
    return { immediate, batches: sent.length, events: sent[0]?.body.events, serialised: JSON.stringify(sent) };
  `);
  assert(reporter.immediate === 0, "An event was sent immediately in a browser rather than batched.");
  assert(reporter.batches === 1 && reporter.events.length === 2, "The browser did not batch its events into one request.");
  assert(!/Kitchen/.test(reporter.serialised), `A room name reached telemetry in a browser: ${reporter.serialised}`);

  const errors = browser.pageErrors.filter((error) => !/favicon|manifest/i.test(error));
  assert(errors.length === 0, `The page threw during the run: ${errors.join(" | ")}`);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;
console.log("Browser scan-pipeline checks passed (desktop Chromium with a synthetic camera — not a device trial).");
