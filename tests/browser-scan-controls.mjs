import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// The scanner's controls, driven in a real browser.
//
// The source-text tests pin that the Stop button exists and that capture is
// asynchronous; only a browser can prove the state machine actually swaps the
// buttons, that a cancelled recording restores the note, and that the shutter
// press blocks the main thread less than the synchronous path it replaced —
// with numbers, not adjectives.
//
// NOT a device trial. Desktop Chromium with a synthetic camera and a stubbed
// SpeechRecognition (headless Chromium has no real speech service).

function assert(condition, message) { if (!condition) throw new Error(message); }

// Use the same portable discovery as the camera-pipeline proof. Keeping a
// Linux-only Playwright path here made the highest-fidelity control test skip
// silently on an ordinary Windows or macOS development machine even when a
// suitable Chrome installation was present.
const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Browser scan-control checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const harnessPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>controls harness</title><link rel="stylesheet" href="/styles.css"></head>
<body>
<script>
  // A controllable SpeechRecognition. Headless Chromium exposes neither
  // implementation, so without this stub startVoice() would fall through to the
  // typed-note path and the recording state machine would never run at all.
  window.__recognitions = [];
  // Both names: modern Chromium exposes the unprefixed SpeechRecognition, and
  // the overlay prefers it, so stubbing only the webkit name would hand the
  // test to the real (microphone-less) service.
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    constructor() { window.__recognitions.push(this); this.started = 0; this.stopped = 0; }
    start() { this.started += 1; }
    stop() { this.stopped += 1; }
    abort() { this.stopped += 1; }
  };
  // One utterance in the cumulative shape real events carry.
  window.__speak = (text) => {
    const recognition = window.__recognitions.at(-1);
    if (!recognition?.onresult) return false;
    recognition.onresult({ results: [Object.assign([{ transcript: text }], { isFinal: true })], resultIndex: 0 });
    return true;
  };
</script>
<script type="module">
  import { openRoomScan, encodeCanvasJpeg } from "/room-scan-overlay.js";
  window.harness = { openRoomScan, encodeCanvasJpeg };
  window.harnessReady = true;
</script>
</body></html>`;

const server = await serveStatic({ extraFiles: { "/controls.html": harnessPage } });
const browser = await launchBrowser();
let failure = null;

// Poll inside the page rather than sleeping in the driver.
const waitFor = (expression, label, timeout = 8000) => browser.evaluate(`
  await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      let result;
      try { result = (${expression}); } catch { result = false; }
      if (result) return resolve();
      if (Date.now() - startedAt > ${timeout}) return reject(new Error(${JSON.stringify(label)}));
      setTimeout(check, 40);
    };
    check();
  });
  return true;
`);

try {
  await browser.goto(`${server.origin}/controls.html`);
  await waitFor("window.harnessReady === true", "The overlay module did not load.");

  /* ── The encode benchmark: how long the main thread is held ────────────── */

  // Measured before the overlay opens so nothing else competes for the thread.
  // The "before" number is the code the old capture path ran (synchronous
  // toDataURL at 1600px); the "after" number is how long the replacement holds
  // the thread before yielding. This is the responsiveness claim, quantified.
  const encode = await browser.evaluate(`
    const canvas = document.createElement("canvas");
    canvas.width = 1600; canvas.height = 900;
    const context = canvas.getContext("2d");
    const image = context.createImageData(1600, 900);
    // Noise: the worst case for a JPEG encoder, so the numbers are a ceiling.
    let seed = 42;
    for (let index = 0; index < image.data.length; index += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      image.data[index] = seed & 255;
      image.data[index + 1] = (seed >> 8) & 255;
      image.data[index + 2] = (seed >> 16) & 255;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    // Old path, three runs, worst kept: the whole encode blocks.
    let syncMs = 0;
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now();
      canvas.toDataURL("image/jpeg", 0.90);
      syncMs = Math.max(syncMs, performance.now() - start);
    }
    // New path: the synchronous portion is only until the call returns...
    const callStart = performance.now();
    const pending = window.harness.encodeCanvasJpeg(canvas, 0.90);
    const blockMs = performance.now() - callStart;
    // ...and the thread is genuinely free while the JPEG finishes: a queued
    // timer must fire before the encode resolves would ever allow it to.
    const timerStart = performance.now();
    const timerDelay = await new Promise((resolve) => setTimeout(() => resolve(performance.now() - timerStart), 0));
    const wallStart = performance.now();
    const url = await pending;
    return { syncMs, blockMs, timerDelay, wallMs: performance.now() - wallStart, encoded: url.startsWith("data:image/jpeg") };
  `);
  assert(encode.encoded, "The asynchronous path did not produce a JPEG.");
  assert(encode.blockMs < encode.syncMs, `The new path blocks no less than the old one (sync ${encode.syncMs.toFixed(1)}ms vs call ${encode.blockMs.toFixed(1)}ms).`);
  // The thread must be usable while encoding — a queued task fires promptly
  // instead of waiting out the compression.
  assert(encode.timerDelay < Math.max(5, encode.syncMs / 2), `The main thread was still held during the encode (timer waited ${encode.timerDelay.toFixed(1)}ms).`);

  /* ── The overlay opens; the deck offers one capture mode ───────────────── */

  await browser.evaluate(`window.__scanResult = window.harness.openRoomScan(); return true;`);
  await waitFor('document.querySelector("[data-hub]") && !document.querySelector("[data-hub]").hidden', "The room hub never appeared.");
  const deck = await browser.evaluate(`
    const deckRow = document.querySelector(".deck-row");
    return {
      videoInDeck: Boolean(deckRow.querySelector("[data-video-fallback]")),
      noteInDeck: Boolean(deckRow.querySelector("[data-note-open]")),
      shutterLabel: document.querySelector("[data-shutter] .deck-btn-lbl")?.textContent || "",
      videoInRecovery: Boolean(document.querySelector("[data-camera-blocked] [data-video-fallback]"))
    };
  `);
  assert(!deck.videoInDeck, "The video-mode button is in the live deck.");
  assert(deck.noteInDeck, "The deck lost its typed-note entry.");
  assert(deck.shutterLabel === "Finish room", `The shutter label reads "${deck.shutterLabel}".`);
  assert(deck.videoInRecovery, "The camera-blocked recovery card lost its video fallback.");

  /* ── Enter a room; decline consent so nothing tries to leave the page ──── */

  await browser.evaluate(`document.querySelector('[data-room="Kitchen"]').click(); return true;`);
  await waitFor('!document.querySelector("[data-consent]").hidden', "The consent question never appeared.");
  await browser.evaluate(`document.querySelector("[data-consent-decline]").click(); return true;`);
  await waitFor('document.querySelector("[data-camera]").videoWidth > 0', "The synthetic camera never produced a frame.");

  /* ── Capture assists degrade to invisible on cameras without them ──────── */

  // The synthetic camera reports neither torch nor zoom — like every iPhone —
  // so the controls must not exist for the user, and nothing may have thrown
  // while the assists probed the capabilities.
  const assists = await browser.evaluate(`
    return {
      torchHidden: document.querySelector("[data-torch]").hidden,
      zoomHidden: document.querySelector("[data-zoom-reset]").hidden
    };
  `);
  assert(assists.torchHidden, "The torch control is visible on a camera that cannot honour it.");
  assert(assists.zoomHidden, "The zoom chip is visible on a camera that cannot zoom.");

  /* ── Recording: Stop and Cancel visible, Done hidden, mic says Stop ────── */

  await browser.evaluate(`document.querySelector("[data-mic]").click(); return true;`);
  await waitFor("window.__recognitions.length === 1", "Recording never started.");
  const recording = await browser.evaluate(`
    const visible = (selector) => { const node = document.querySelector(selector); return Boolean(node) && !node.hidden; };
    return {
      stop: visible("[data-voice-stop]"), cancel: visible("[data-voice-cancel]"),
      done: visible("[data-note-done]"), remove: visible("[data-voice-delete]"),
      micLabel: document.querySelector("[data-mic] .deck-btn-lbl").textContent,
      micPressed: document.querySelector("[data-mic]").getAttribute("aria-pressed"),
      status: document.querySelector("[data-voice-status]").textContent,
      timer: document.querySelector("[data-voice-time]").textContent
    };
  `);
  assert(recording.stop && recording.cancel, "Stop or Cancel is not visible while recording.");
  assert(!recording.done && !recording.remove, "Review controls are visible while recording.");
  assert(recording.micLabel === "Stop" && recording.micPressed === "true", `The mic button did not become Stop (label "${recording.micLabel}").`);
  assert(/Recording/.test(recording.status), `The status does not say it is recording: "${recording.status}".`);
  // A busy CI runner can cross the first one-second boundary between the mic
  // click and this snapshot. Both values prove the clock restarted; accepting
  // anything later would hide a stale timer from a previous recording.
  assert(["0:00", "0:01"].includes(recording.timer), `The timer did not restart: "${recording.timer}".`);

  /* ── Speech arrives; Stop moves to review with the transcript editable ─── */

  assert(await browser.evaluate(`window.__speak("wipe the worktops"); return true;`), "The stub could not deliver a result.");
  await browser.evaluate(`document.querySelector("[data-voice-stop]").click(); return true;`);
  const review = await browser.evaluate(`
    const visible = (selector) => { const node = document.querySelector(selector); return Boolean(node) && !node.hidden; };
    return {
      stop: visible("[data-voice-stop]"), done: visible("[data-note-done]"), remove: visible("[data-voice-delete]"),
      note: document.querySelector("[data-room-note]").value,
      stopped: window.__recognitions[0].stopped > 0,
      micLabel: document.querySelector("[data-mic] .deck-btn-lbl").textContent
    };
  `);
  assert(!review.stop && review.done && review.remove, "Stopping did not swap to the review controls.");
  assert(review.note === "wipe the worktops", `The transcript did not reach the editor: "${review.note}".`);
  assert(review.stopped, "The underlying recognition session was not stopped.");
  assert(review.micLabel !== "Stop", "The mic button still claims to be recording after stop.");

  /* ── Cancel discards the recording, not the note it was added to ───────── */

  await browser.evaluate(`document.querySelector("[data-note-done]").click(); return true;`);
  await browser.evaluate(`document.querySelector("[data-mic]").click(); return true;`);
  await waitFor("window.__recognitions.length === 2", "A second recording never started.");
  await browser.evaluate(`window.__speak("wipe the worktops and also burn everything"); return true;`);
  await browser.evaluate(`document.querySelector("[data-voice-cancel]").click(); return true;`);
  const cancelled = await browser.evaluate(`
    return { note: document.querySelector("[data-room-note]").value, stopped: window.__recognitions[1].stopped > 0 };
  `);
  assert(cancelled.note === "wipe the worktops", `Cancel did not restore the pre-recording note: "${cancelled.note}".`);
  assert(cancelled.stopped, "Cancel left the recognition session running.");

  /* ── A blocked microphone names the problem ────────────────────────────── */

  await browser.evaluate(`document.querySelector("[data-mic]").click(); return true;`);
  await waitFor("window.__recognitions.length === 3", "A third recording never started.");
  await browser.evaluate(`window.__recognitions[2].onerror({ error: "not-allowed" }); return true;`);
  const denied = await browser.evaluate(`
    return { hint: document.querySelector("[data-hint]").textContent, recording: document.querySelector("[data-mic]").getAttribute("aria-pressed") };
  `);
  assert(/Microphone access is blocked/.test(denied.hint), `A denied permission was not named: "${denied.hint}".`);
  assert(denied.recording === "false", "The mic still reads as recording after a permission failure.");

  /* ── Delete removes the note entirely ──────────────────────────────────── */

  await browser.evaluate(`document.querySelector("[data-voice-delete]").click(); return true;`);
  const deleted = await browser.evaluate(`
    return { note: document.querySelector("[data-room-note]").value, panelHidden: document.querySelector("[data-voice-panel]").hidden };
  `);
  assert(deleted.note === "" && deleted.panelHidden, "Delete did not clear the note and close the panel.");

  /* ── The shutter acknowledges the press and freezes the frame ──────────── */

  const captured = await browser.evaluate(`
    const flash = document.querySelector("[data-flash]");
    const pressedAt = performance.now();
    document.querySelector("[data-shutter]").click();
    const flashImmediately = flash.classList.contains("pop");
    await new Promise((resolve, reject) => {
      const check = () => {
        if (!document.querySelector("[data-still]").hidden) return resolve();
        if (performance.now() - pressedAt > 8000) return reject(new Error("The frame never froze."));
        setTimeout(check, 25);
      };
      check();
    });
    return {
      flashImmediately,
      freezeMs: performance.now() - pressedAt,
      still: document.querySelector("[data-still]").src.startsWith("data:image/jpeg"),
      confirmVisible: !document.querySelector("[data-selection]").hidden
    };
  `);
  assert(captured.flashImmediately, "The shutter press produced no immediate flash.");
  assert(captured.still, "The frozen still is not the captured JPEG.");
  assert(captured.confirmVisible, "The confirm controls did not appear after capture.");

  /* ── Leaving the scanner mid-recording stops the microphone ────────────── */

  await browser.evaluate(`document.querySelector("[data-retake]").click(); return true;`);
  await browser.evaluate(`document.querySelector("[data-mic]").click(); return true;`);
  await waitFor("window.__recognitions.length === 4", "A fourth recording never started.");
  await browser.evaluate(`
    document.querySelectorAll("[data-close]").forEach((btn) => { if (btn.offsetParent !== null || !btn.closest("[hidden]")) btn.click(); });
    return true;
  `);
  await browser.evaluate(`
    const discard = document.querySelector("[data-discard-confirm]");
    if (discard && !document.querySelector("[data-discard]").hidden) discard.click();
    return true;
  `);
  await waitFor('!document.querySelector(".scan-overlay")', "The overlay did not close.");
  const afterClose = await browser.evaluate(`
    return { stopped: window.__recognitions[3].stopped > 0, result: await window.__scanResult };
  `);
  assert(afterClose.stopped, "Closing the scanner left the microphone session running.");
  assert(afterClose.result === null, "An abandoned scan did not resolve null.");

  const errors = browser.pageErrors.filter((error) => !/favicon|manifest/i.test(error));
  assert(errors.length === 0, `The page threw during the run: ${errors.join(" | ")}`);

  console.log(`Browser scan-control checks passed (desktop Chromium, synthetic camera, stubbed speech — not a device trial).`);
  console.log(`Capture encode, 1600×900 noise frame: synchronous toDataURL blocked ${encode.syncMs.toFixed(1)}ms (the old path); the Blob path holds the thread ${encode.blockMs.toFixed(1)}ms before yielding, a queued task ran after ${encode.timerDelay.toFixed(1)}ms, full encode ${encode.wallMs.toFixed(1)}ms in the background. Shutter press to frozen frame: ${captured.freezeMs.toFixed(0)}ms.`);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;
