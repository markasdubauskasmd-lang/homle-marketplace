import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// A real browser proof that the landing design actually moves.
//
// Source assertions can confirm the markup and the script exist. They cannot
// prove that scroll progress reaches the stages, that the room walk repositions
// the phone and swaps the angle under it, that the reveal marks fire in order,
// or that the clip plays only while its act is on screen. Those are the whole
// design, and all of them are invisible to a source read.
//
// This is desktop Chromium at 1280 x 800. Progress is eased toward the scroll
// position over several frames, so each probe waits before reading.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Browser landing-motion checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const server = await serveStatic();
const browser = await launchBrowser();
let failure = null;

// Probe positions are derived from each act's own offsets rather than from a
// fraction of the page, so the checks stay put if an act's scroll length is
// retuned. `t` is progress through the named act: 0 as it pins, 1 as it unpins.
const probe = `
  (async (kind, t) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const act = document.querySelector('[data-stage="' + kind + '"]');
    const travel = Math.max(1, act.offsetHeight - window.innerHeight);
    window.scrollTo(0, Math.round(act.offsetTop + travel * t));
    // Progress eases toward the target, so give the loop time to settle there.
    await wait(900);
    const stage = (k) => {
      const el = document.querySelector('[data-stage="' + k + '"]');
      const raw = el.style.getPropertyValue('--p');
      return raw === '' ? null : Number(raw);
    };
    const phone = document.querySelector('[data-phone]');
    const frame = document.querySelector('[data-hero-frame]');
    const dirty = document.querySelector('.ci-hero-dirty');
    const edge = document.querySelector('.ci-wipe-edge');
    const video = document.querySelector('[data-detail-video]');
    const angles = [...document.querySelectorAll('[data-angle]')];
    return {
      open: stage('open'), scan: stage('scan'), manual: stage('manual'),
      detail: stage('detail'), join: stage('join'),
      heroTransform: frame.style.transform,
      heroRadius: frame.style.borderRadius,
      dirtyTransform: getComputedStyle(dirty).transform,
      dirtyClipPath: getComputedStyle(dirty).clipPath,
      edgeTransform: getComputedStyle(edge).transform,
      phoneTransform: phone.style.transform,
      litAngle: angles.findIndex((i) => i.style.opacity === '1') + 1,
      angleSources: angles.map((image) => image.currentSrc),
      phoneView: document.querySelector('[data-phone-view]').getAttribute('src'),
      phoneViewSource: document.querySelector('[data-phone-view]').currentSrc,
      resourcePaths: performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname),
      manualBgSource: document.querySelector('.ci-manual-bg').currentSrc,
      videoSource: video.getAttribute('src'),
      videoDeferredSource: video.dataset.videoSrc,
      videoPoster: video.getAttribute('poster'),
      videoDeferredPoster: video.dataset.videoPoster,
      beat: document.querySelector('[data-beat-title]').textContent,
      items: Number(document.querySelector('[data-beat-items]').textContent),
      views: document.querySelector('[data-views]').textContent,
      launchOn: document.querySelector('[data-launch]').classList.contains('is-on'),
      joinOn: document.querySelector('[data-join]').classList.contains('is-on'),
      telsOn: [...document.querySelectorAll('[data-tel]')].filter((e) => e.classList.contains('is-on')).length,
      mstepsOn: [...document.querySelectorAll('[data-mstep]')].filter((e) => e.classList.contains('is-on')).length,
      dotsOn: [...document.querySelectorAll('[data-mdot]')].filter((e) => e.style.background && !e.style.background.includes('244')).length,
      cardTransform: document.querySelector('[data-mcard]').style.transform,
      videoPaused: video.paused,
      videoTime: video.currentTime,
      // A Chromium built without proprietary codecs cannot decode the reviewed
      // H.264 clip, so it can never leave the paused state however correct the
      // page is. That is a property of the runner, not of the landing page.
      h264Support: document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"')
    };
  })
`;

try {
  await browser.setViewport({ width: 1280, height: 800 });
  await browser.goto(`${server.origin}/home.html`);

  const at = async (kind, t) => browser.evaluate(`return await (${probe})(${JSON.stringify(kind)}, ${t});`);

  // The loop must actually be running: rAF is the whole engine.
  const alive = await browser.evaluate(`
    return await new Promise((resolve) => {
      let frames = 0;
      const tick = () => { if (++frames < 3) requestAnimationFrame(tick); else resolve(frames); };
      requestAnimationFrame(tick);
      // Headless Chromium can briefly throttle a just-opened page on a busy CI
      // host. Give it enough time to produce three real frames before treating
      // the animation engine as unavailable.
      setTimeout(() => resolve(frames), 3000);
    });
  `);
  assert(alive >= 3, "requestAnimationFrame is not running, so no motion can be verified in this browser.");

  /* ── Act 1: the hero wipe and the button drop ─────── */

  const top = await at("open", 0);
  assert(top.open !== null && top.open < 0.05, `The opening act does not start at zero progress: ${top.open}.`);
  assert(top.launchOn === false, "The launch button is already revealed before the wipe begins.");
  assert(top.videoSource === null && top.videoDeferredSource === "/landing/cleaning-720-e8b1a7ce.mp4",
    `The detail clip was not held off the initial desktop load: ${JSON.stringify({ source: top.videoSource, deferred: top.videoDeferredSource })}.`);
  assert(top.videoPoster === null && top.videoDeferredPoster === "/landing/dark-kitchen-1600-f930f4ce.webp",
    `The detail poster was not held off the initial desktop load: ${JSON.stringify({ poster: top.videoPoster, deferred: top.videoDeferredPoster })}.`);

  const wiping = await at("open", 0.55);
  assert(wiping.open > top.open, `Scrolling does not advance the opening act: ${top.open} -> ${wiping.open}.`);
  assert(/scale\(/.test(wiping.heroTransform), "The hero frame is not being scaled open by the script.");
  const heroScale = Number(/scale\(([\d.]+)\)/.exec(wiping.heroTransform)[1]);
  assert(heroScale > 1, `The hero frame is not growing toward full bleed: scale ${heroScale}.`);
  assert(wiping.dirtyTransform !== "none" && wiping.edgeTransform !== "none",
    `The opening wipe is not moving on transform layers: ${JSON.stringify({ dirty: wiping.dirtyTransform, edge: wiping.edgeTransform })}.`);
  assert(wiping.dirtyClipPath === "none",
    `The opening wipe still clips a full-screen photograph instead of moving its layer: ${wiping.dirtyClipPath}.`);
  assert(wiping.launchOn === true, "The launch button never drops in after its mark.");

  /* ── Act 2: the walk around the room ──────────────── */

  const scanEarly = await at("scan", 0.12);
  const scanMid = await at("scan", 0.5);
  const scanLate = await at("scan", 0.9);
  assert(scanEarly.scan > 0 && scanLate.scan > scanEarly.scan, `The scan act does not advance: ${scanEarly.scan} -> ${scanLate.scan}.`);
  assert(/translate3d\(/.test(scanMid.phoneTransform) && /rotateY\(/.test(scanMid.phoneTransform),
    `The phone is not being walked around the room: ${scanMid.phoneTransform}.`);
  assert(scanEarly.phoneTransform !== scanLate.phoneTransform, "The phone holds one position for the whole scan act.");

  // The room plate lights exactly one angle, and the phone shows that same angle.
  const angleFile = { 1: 5, 2: 1, 3: 4, 4: 2, 5: 3 };
  for (const shot of [scanEarly, scanMid, scanLate]) {
    assert(shot.litAngle >= 1 && shot.litAngle <= 5, `No single room angle is lit: ${shot.litAngle}.`);
    const fileNumber = angleFile[shot.litAngle];
    assert(shot.phoneView === `/landing/angle-${fileNumber}.png`, `The phone fallback disagrees with lit angle ${shot.litAngle}: ${shot.phoneView}.`);
    assert(new RegExp(`/landing/angle-${fileNumber}-[0-9a-f]{8}\\.webp$`).test(shot.phoneViewSource),
      `The visible phone source disagrees with lit angle ${shot.litAngle}: ${shot.phoneViewSource}.`);
  }
  assert(new Set([scanEarly.litAngle, scanMid.litAngle, scanLate.litAngle]).size > 1,
    "The room never changes angle, so the walk is not moving between beats.");
  assert(new Set([scanEarly.phoneViewSource, scanMid.phoneViewSource, scanLate.phoneViewSource]).size > 1,
    "The phone keeps showing one image while the room walk changes angle.");
  assert(scanLate.angleSources.length === 5 && scanLate.angleSources.every((source) => /\/landing\/angle-[1-5]-[0-9a-f]{8}\.webp$/.test(source)),
    `The scanner animation downloaded a PNG fallback or unversioned frame: ${JSON.stringify(scanLate.angleSources)}.`);
  assert(!scanLate.resourcePaths.some((pathname) => /\/landing\/angle-[1-5]\.png$/.test(pathname)),
    `The scanner-phone view downloaded a 200-470 KB PNG fallback: ${JSON.stringify(scanLate.resourcePaths.filter((pathname) => pathname.includes("/landing/angle-")))}.`);

  // The read-out counts up with the walk rather than sitting at its final value.
  assert(scanLate.items > scanEarly.items, `Items analysed does not climb: ${scanEarly.items} -> ${scanLate.items}.`);
  assert(scanLate.telsOn > scanEarly.telsOn, `Telemetry chips do not reveal in order: ${scanEarly.telsOn} -> ${scanLate.telsOn}.`);
  assert(scanEarly.beat !== scanLate.beat, "The beat caption never changes across the scan.");

  /* ── Act 3: the manual booking card ───────────────── */

  const manualEarly = await at("manual", 0.05);
  const manualLate = await at("manual", 0.75);
  assert(manualLate.manual > manualEarly.manual, `The manual act does not advance: ${manualEarly.manual} -> ${manualLate.manual}.`);
  assert(manualLate.mstepsOn > manualEarly.mstepsOn, `The booking steps do not reveal in order: ${manualEarly.mstepsOn} -> ${manualLate.mstepsOn}.`);
  assert(manualLate.dotsOn > manualEarly.dotsOn, `The step dots do not fill as the act runs: ${manualEarly.dotsOn} -> ${manualLate.dotsOn}.`);
  assert(/scale\(/.test(manualLate.cardTransform), "The booking card is never scaled to fit its column.");

  /* ── Act 4: the clip plays only on screen ─────────── */

  const detail = await at("detail", 0.4);
  // Playback needs a codec this runner may not ship. The source, poster and
  // deferred-activation assertions below run everywhere; only the three that
  // require the clip to actually decode are gated, and Chrome, Edge, Safari or
  // any proprietary-codec CI image still proves them.
  const canDecodeClip = Boolean(detail.h264Support);
  if (!canDecodeClip) {
    console.log("Landing clip playback checks SKIPPED: this Chromium has no H.264 decoder, so the reviewed MP4 cannot start here.");
  }
  if (canDecodeClip) assert(detail.videoPaused === false, "The clip does not play while its act is on screen.");
  const detailAgain = await at("detail", 0.6);
  if (canDecodeClip) assert(detailAgain.videoTime > 0, `The clip is not actually advancing: currentTime ${detailAgain.videoTime}.`);

  const past = await at("join", 0.85);
  if (canDecodeClip) assert(past.videoPaused === true, "The clip keeps playing after its act has left the screen.");
  assert(/\/landing\/sage-living-(?:960|1600)-[0-9a-f]{8}\.webp$/.test(past.manualBgSource),
    `The manual-booking act downloaded its full JPEG fallback: ${past.manualBgSource}.`);
  // The handoff act and its four portraits were removed: that act was the only
  // one that could not hold 60fps, so there is no backdrop or portrait left to
  // check for a full-JPEG download here.
  assert(past.videoSource === "/landing/cleaning-720-e8b1a7ce.mp4", `The detail act did not retain its reviewed optimized clip: ${past.videoSource}.`);
  assert(past.videoDeferredSource === past.videoSource, `The active detail clip differs from its reviewed deferred source: ${past.videoDeferredSource}.`);
  assert(past.videoPoster === "/landing/dark-kitchen-1600-f930f4ce.webp", `The clip retained its full JPEG poster: ${past.videoPoster}.`);
  assert(past.videoDeferredPoster === past.videoPoster, `The active detail poster differs from its reviewed deferred poster: ${past.videoDeferredPoster}.`);

  /* ── Act 6: the closing button ────────────────────── */

  assert(past.join !== null && past.join > 0.3, `The closing act never reaches its reveal: ${past.join}.`);
  assert(past.joinOn === true, "The closing sign-up button never drops in.");

  assert(browser.pageErrors.length === 0,
    `The landing page threw in Chromium: ${browser.pageErrors.join(" | ")}`);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;
console.log("Browser landing-motion checks passed: hero wipe, room walk with angle swaps, ordered reveals, card scaling, and a clip that plays only on screen.");
