import { readFile } from "node:fs/promises";
import {
  guidedRooms,
  maximumShots,
  nextRoomName,
  scanHint,
  canFinishScan,
  shotLabel,
  usableDetections,
  estimatedMinutes,
  durationLabel,
  overallCondition,
  conditionLabel,
  scanChecklistLines,
  scanTranscript,
  scanSummary,
  removeRoom,
  walkingReadIsBlocked,
  unresolvedRoomConditionKey,
  unresolvedRoomReadKey
} from "../public/room-scan-model.js";
import { encodeCanvasJpeg, waitForCameraFrame } from "../public/room-scan-overlay.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const [overlay, photoSelection, entryScript, entryPage, journey, journeyPage, styles, server] = await Promise.all([
  readFile(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8"),
  readFile(new URL("../public/room-photo-selection.js", import.meta.url), "utf8"),
  readFile(new URL("../public/room-scan.js", import.meta.url), "utf8"),
  readFile(new URL("../public/room-scan.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-journey.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-journey.html", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);

/* ── Model ─────────────────────────────────────────── */

// The walkthrough guides room by room but never traps the Landlord in a fixed
// count — homes are not all four rooms.
assert(guidedRooms.length >= 4 && nextRoomName(0) === guidedRooms[0], "The guided scan does not start with the first room.");
assert(nextRoomName(guidedRooms.length) === `Room ${guidedRooms.length + 1}`, "The scan stops guiding instead of continuing past the suggested rooms.");
assert(canFinishScan(1) && !canFinishScan(0), "The scan can be finished with no rooms, or cannot be finished after one.");
assert(!walkingReadIsBlocked(new Set(["kitchen"]), "bathroom"), "Moving to the next room remains blocked by the previous room's automatic read.");
const readingWarning = unresolvedRoomReadKey([
  { name: "Kitchen", readingStatus: "reading", readingRevision: 4 },
  { name: "Bathroom", readingStatus: "ready", readingRevision: 2 }
]);
assert(readingWarning.includes("kitchen:reading:4") && !readingWarning.includes("bathroom"), "A room still being read is not isolated from completed rooms for the finish warning.");
assert(
  unresolvedRoomReadKey([{ name: "Kitchen", readingStatus: "needs-retry", readingRevision: 4 }]).includes("kitchen:needs-retry:4"),
  "A room whose automatic read was deferred by the network can finish without a warning."
);
assert(
  unresolvedRoomReadKey([{ name: "Kitchen", readingStatus: "ready", readingRevision: 4 }]) === "",
  "A completed room continues to block or warn at the end of the scan."
);
assert(
  unresolvedRoomReadKey([
    { name: "Kitchen", readingStatus: "reading", readingRevision: 4 },
    { name: "Bathroom", readingStatus: "needs-retry", readingRevision: 7 }
  ]) === unresolvedRoomReadKey([
    { name: "Bathroom", readingStatus: "needs-retry", readingRevision: 7 },
    { name: "Kitchen", readingStatus: "reading", readingRevision: 4 }
  ]),
  "Reordering the room roster invalidates the exact same finish warning."
);
assert(
  unresolvedRoomReadKey([{ name: "Kitchen", readingStatus: "reading", readingRevision: 5 }]) !== readingWarning,
  "A later unresolved read can reuse an earlier room-reading override."
);
const conditionWarning = unresolvedRoomConditionKey([
  { name: "Kitchen", readingStatus: "ready", detections: [{ label: "Tap", condition: "" }] },
  { name: "Bathroom", readingStatus: "ready", detections: [{ label: "Shower screen", condition: "medium" }] }
]);
assert(conditionWarning.includes("kitchen") && conditionWarning.includes("tap"), "A completed room with an ungraded item can finish without a condition-review warning.");
assert(
  unresolvedRoomConditionKey([{ name: "Kitchen", readingStatus: "ready", detections: [{ label: "Tap", condition: "medium", confidence: 0.95, conditionConfidence: 0.3 }] }]),
  "A confident object label hides a low-confidence condition at the end of the scan."
);
assert(
  unresolvedRoomConditionKey([{ name: "Kitchen", readingStatus: "ready", detections: [{ label: "Tap", condition: "medium", confidence: 0.3, conditionConfidence: 0.8 }] }]) === "",
  "A weak object-label score incorrectly turns a confident condition into a finish warning."
);
assert(
  unresolvedRoomConditionKey([{ name: "Kitchen", readingStatus: "reading", detections: [{ label: "Tap", condition: "" }] }]) === "",
  "An in-flight automatic read triggers a second, competing condition warning before its result can resolve the item."
);
assert(
  unresolvedRoomConditionKey([
    { name: "Kitchen", readingStatus: "ready", detections: [{ label: "Tap", condition: "" }] },
    { name: "Bathroom", readingStatus: "manual", detections: [{ label: "Mirror", condition: "" }] }
  ]) === unresolvedRoomConditionKey([
    { name: "Bathroom", readingStatus: "manual", detections: [{ label: "Mirror", condition: "" }] },
    { name: "Kitchen", readingStatus: "ready", detections: [{ label: "Tap", condition: "" }] }
  ]),
  "Harmless room reordering invalidates the same condition-review decision."
);
assert(
  unresolvedRoomConditionKey([{ name: "Kitchen", readingStatus: "ready", detections: [
    { label: "Tap", condition: "" }, { label: "Tap", condition: "" }
  ] }]) === unresolvedRoomConditionKey([{ name: "Kitchen", readingStatus: "ready", detections: [
    { label: "Tap", condition: "" }
  ] }]),
  "A duplicate detector row turns one unresolved condition into a new finish decision."
);
assert(scanHint(0).includes("shutter") && scanHint(2, { voiceUsed: false }).includes("mic"), "The scan does not tell a first-time user what to do, or never offers the voice note.");
assert(!scanHint(2, { voiceUsed: true }).includes("mic"), "The voice tip is repeated after the Landlord has already used it.");
assert(scanHint(maximumShots).includes("maximum"), "Reaching the capture limit is not explained.");
assert(shotLabel("Living room") === "LIVI" && shotLabel("") === "ROOM", "Shot labels are not derived safely from the room name.");

// A detection box that does not fit the frame would be painted across the whole
// photograph and read as a confident detection of the entire room.
assert(usableDetections([{ x: 10, y: 10, width: 20, height: 20, label: "Worktop" }]).length === 1, "A valid detection was discarded.");
const confidenceDetection = usableDetections([{
  x: 10, y: 10, width: 20, height: 20, label: "Tap",
  confidence: 0.94, condition: "medium", conditionConfidence: 0.28
}])[0];
assert(confidenceDetection.confidence === 0.94 && confidenceDetection.conditionConfidence === 0.28, "Detection shaping collapsed label and condition confidence.");
for (const invalid of [
  { x: -1, y: 10, width: 20, height: 20, label: "Sofa" },
  { x: 90, y: 10, width: 20, height: 20, label: "Sofa" },
  { x: 10, y: 10, width: 0, height: 20, label: "Sofa" },
  { x: 10, y: 10, width: 20, height: 20, label: "   " },
  { x: "a", y: 10, width: 20, height: 20, label: "Sofa" }
]) {
  assert(usableDetections([invalid]).length === 0, `A malformed detection was drawn over the photograph: ${JSON.stringify(invalid)}`);
}
assert(usableDetections(null).length === 0 && usableDetections([]).length === 0, "Missing detections were not handled as simply having none.");
assert(usableDetections(Array.from({ length: 30 }, () => ({ x: 1, y: 1, width: 5, height: 5, label: "Shelf" }))).length === 12, "The detection overlay is not bounded.");

// Time comes from the tasks actually scoped; an unread room contributes nothing.
assert(estimatedMinutes([]) === 0 && estimatedMinutes([{ tasks: [] }]) === 0, "An unscoped scan produced a duration out of nothing.");
assert(estimatedMinutes([{ tasks: ["a", "b"] }]) >= 60, "A scoped job was estimated below the minimum visit length.");
assert(durationLabel(0) === "Not scoped yet", "An unscoped scan was given a duration.");
assert(durationLabel(195).includes("–"), `A guide time was presented as a single confident figure: ${durationLabel(195)}`);

assert(overallCondition([{ condition: "light" }, { condition: "heavy" }]) === "heavy", "A heavy room was not reflected in the overall condition.");
assert(overallCondition([{ condition: "" }]) === "" && conditionLabel("") === "Not assessed", "An unassessed scan claimed a condition.");

const lines = scanChecklistLines([{ name: "Kitchen", tasks: ["Degrease the worktops", "Degrease the worktops", "Mop the floor"] }, { name: "", tasks: ["Dust the shelves"] }]);
assert(lines.includes("Kitchen: Degrease the worktops") && lines.includes("Kitchen: Mop the floor") && lines.includes("Dust the shelves") && lines.length === 3, "The scan checklist lost a task, its room, or was not de-duplicated.");

const summary = scanSummary([{ name: "Kitchen", tasks: ["Degrease the worktops"], detections: [{ label: "Worktop" }], condition: "heavy" }]);
assert(summary.roomCount === 1 && summary.fixtureCount === 1 && summary.conditionLabel === "Heavy", `The scan summary is wrong: ${JSON.stringify(summary)}`);

const spokenRooms = scanTranscript([
  { name: "Kitchen", transcript: "Do not clean inside the oven." },
  { name: "Bathroom", transcript: "Please scrub the shower screen." }
]);
assert(spokenRooms === "Kitchen: Do not clean inside the oven.\nBathroom: Please scrub the shower screen.", `Spoken notes lost their room ownership: ${JSON.stringify(spokenRooms)}`);

const removableRooms = [
  { name: "Kitchen", image: "private-kitchen", transcript: "Wipe the worktops.", tasks: ["Wipe the worktops"] },
  { name: "Bathroom", image: "private-bathroom", transcript: "Clean the shower.", tasks: ["Clean the shower"] }
];
const roomsAfterRemoval = removeRoom(removableRooms, " kitchen ");
assert(removableRooms.length === 2 && roomsAfterRemoval.length === 1 && roomsAfterRemoval[0].name === "Bathroom", "Removing one room mutates the source roster, misses a case-insensitive match or removes another room.");
assert(scanTranscript(roomsAfterRemoval) === "Bathroom: Clean the shower." && scanChecklistLines(roomsAfterRemoval).length === 1, "A removed room's note or checklist task remains in the final scan handoff.");
assert(removeRoom(removableRooms, "").length === 2 && removeRoom(null, "Kitchen").length === 0, "An invalid room-removal request corrupts or invents a scan roster.");

/* ── Mobile camera readiness ───────────────────────── */

class FakeCameraVideo extends EventTarget {
  constructor(width = 0, height = 0, readyState = 0) {
    super();
    this.videoWidth = width;
    this.videoHeight = height;
    this.readyState = readyState;
  }
}

await waitForCameraFrame(new FakeCameraVideo(1280, 720, 2), 5);

const delayedCamera = new FakeCameraVideo();
const delayedFrame = waitForCameraFrame(delayedCamera, 100);
setTimeout(() => {
  delayedCamera.videoWidth = 1920;
  delayedCamera.videoHeight = 1080;
  delayedCamera.readyState = 2;
  delayedCamera.dispatchEvent(new Event("canplay"));
}, 0);
await delayedFrame;

let dimensionsOnlyError = null;
try { await waitForCameraFrame(new FakeCameraVideo(1280, 720, 0), 5); } catch (error) { dimensionsOnlyError = error; }
assert(dimensionsOnlyError?.name === "CameraNotReadyError", "Camera dimensions without a current video frame were treated as a usable picture.");

let stalledCameraError = null;
try { await waitForCameraFrame(new FakeCameraVideo(), 5); } catch (error) { stalledCameraError = error; }
assert(stalledCameraError?.name === "CameraNotReadyError", "A camera stream that never produced a frame was treated as usable.");

// A phone used to synchronously JPEG-compress every automatic walking frame on
// the same thread that paints the camera. The Blob path must return control
// before the bytes are ready, preserve the exact evidence settings, and never
// touch the synchronous fallback in a browser that supports the modern APIs.
const originalFileReader = globalThis.FileReader;
let finishBlob = null;
let synchronousEncodes = 0;
let blobType = "";
let blobQuality = 0;
class FakeFileReader {
  readAsDataURL() {
    queueMicrotask(() => {
      this.result = "data:image/jpeg;base64,ASYNC";
      this.onload?.();
    });
  }
}
globalThis.FileReader = FakeFileReader;
const asynchronousCanvas = {
  toBlob(callback, type, quality) {
    finishBlob = callback;
    blobType = type;
    blobQuality = quality;
  },
  toDataURL() {
    synchronousEncodes += 1;
    return "data:image/jpeg;base64,SYNC";
  }
};
let asynchronousSettled = false;
const asynchronousImage = encodeCanvasJpeg(asynchronousCanvas, 0.72)
  .then((image) => { asynchronousSettled = true; return image; });
await Promise.resolve();
assert(!asynchronousSettled, "Walking-frame JPEG encoding still completes synchronously and can stall the live camera.");
assert(typeof finishBlob === "function" && blobType === "image/jpeg" && blobQuality === 0.72, "The asynchronous encoder changed the walking frame's format or evidence quality.");
finishBlob({ size: 12, type: "image/jpeg" });
assert(await asynchronousImage === "data:image/jpeg;base64,ASYNC", "The asynchronous JPEG bytes do not reach the existing room-reading payload.");
assert(synchronousEncodes === 0, "A modern browser still invokes synchronous toDataURL and can pause the viewfinder.");

if (originalFileReader === undefined) delete globalThis.FileReader;
else globalThis.FileReader = originalFileReader;
let fallbackSettings = null;
const fallbackImage = await encodeCanvasJpeg({
  toDataURL(type, quality) {
    fallbackSettings = { type, quality };
    return "data:image/jpeg;base64,FALLBACK";
  }
}, 0.72);
assert(fallbackImage === "data:image/jpeg;base64,FALLBACK", "A browser without toBlob lost the compatibility capture path.");
assert(fallbackSettings?.type === "image/jpeg" && fallbackSettings?.quality === 0.72, "The compatibility encoder changed the walking frame evidence settings.");

/* ── Embedded overlay ──────────────────────────────── */

// The scan opens over the page that asked for it and hands its result straight
// back. A page navigation would drop the answers already given.
assert(overlay.includes("export function openRoomScan()") && overlay.includes("return new Promise"), "The scan is not an overlay the app can open in place.");
assert(overlay.includes("document.body.appendChild(overlay)") && overlay.includes("overlay.remove()"), "The scan overlay does not mount and unmount itself.");
assert(journey.includes("await openRoomScan()") && journey.includes("if (!result) return;"), "The journey does not open the scan in place, or cannot tell a finished scan from a cancelled one.");
assert(!journeyPage.includes('href="/landlord/scan"'), "The journey still navigates away to the scan instead of opening it in place.");

// One implementation only. An old bookmark now enters the protected guided
// journey instead of opening a second scanner and persisting its photo result.
assert(entryScript.includes('location.replace("/landlord/book")') && entryScript.split("\n").length < 12, "The legacy scan entry does not forward into the protected booking journey.");
assert(!entryScript.includes("openRoomScan") && !entryScript.includes("sessionStorage") && !entryScript.includes("JSON.stringify"), "The legacy scan entry can still run a second scanner or persist private scan data.");
assert(!entryPage.includes("data-shutter") && !entryPage.includes("data-viewfinder"), "The standalone scan page duplicates the overlay's markup.");

// Modal hygiene: the page behind must not scroll, Escape must offer a safe exit,
// and focus must come back to where it was.
assert(overlay.includes('aria-modal", "true"') && overlay.includes('document.body.style.overflow = "hidden"') && overlay.includes("previousOverflow"), "The scan overlay lets the page behind it scroll, or never restores it.");
assert(overlay.includes('event.key !== "Escape"') && overlay.includes("requestClose()") && overlay.includes("previouslyFocused"), "The scan overlay cannot be safely dismissed with Escape or loses the Landlord's place.");
assert(overlay.includes('data-discard hidden role="alertdialog"') && overlay.includes("Keep scanning") && overlay.includes("Discard scan"), "Closing a room scan with progress has no clear keep-or-discard decision.");
assert(/function requestClose\(\)[\s\S]{0,180}hasScanProgress\(\)[\s\S]{0,80}showDiscard\(\)[\s\S]{0,80}close\(null\)/.test(overlay) && /for \(const button of \$\$\("\[data-close\]"\)\) button\.addEventListener\("click", requestClose\)/.test(overlay), "A close button can still destroy confirmed rooms or notes without the discard safeguard.");
assert(/function setScanBackgroundInert\(inert, except = el\.discard\)[\s\S]{0,320}child\.inert = inert/.test(overlay) && /function openDiscardDecision\([\s\S]{0,700}setScanBackgroundInert\(true\)[\s\S]{0,120}discardKeep\.focus/.test(overlay), "The discard decision leaves covered camera controls interactive or does not move focus to its safe action.");
assert(overlay.includes('window.addEventListener("beforeunload", onBeforeUnload)') && overlay.includes('window.removeEventListener("beforeunload", onBeforeUnload)') && /function onBeforeUnload\(event\)[\s\S]{0,220}!hasScanProgress\(\)[\s\S]{0,320}event\.returnValue = ""/.test(overlay), "Browser navigation can silently erase an in-progress room scan or leaves a permanent leave-page warning after teardown.");
assert(!overlay.includes("localStorage") && !overlay.includes("JSON.stringify(state.rooms"), "The discard safeguard persists private room photos or the scan roster in browser storage.");
// Scoped to the function body. The window kept breaking as finishScan grew, and
// widening a number teaches nothing; what is guarded is that the photos handed on
// are the current rooms' own images.
const finishBody = overlay.slice(overlay.indexOf("function finishScan()"), overlay.indexOf("function close(result)"));
assert(/photos: state\.rooms\.filter[\s\S]{0,320}dataUrl: room\.image/.test(finishBody), "A completed scan does not hand its current room photos directly to the authenticated booking journey.");
// Finishing while a room is still being read would carry the provisional tasks
// and grade into the booking, and close() aborts the read that was about to
// replace them — so the customer would be quoted from a placeholder.
assert(
  finishBody.includes("unresolvedRoomReadKey(state.rooms)")
    && finishBody.includes("state.finishWarningKey !== unresolvedKey")
    && finishBody.includes('"needs-retry"'),
  "Finishing does not protect a network-deferred room, or an old override can silently cover a different unresolved room read."
);
assert(
  finishBody.includes("unresolvedRoomConditionKey(state.rooms)")
    && finishBody.includes("condition still needs checking")
    && finishBody.includes("Tap Done again"),
  "Finishing a completed scan never warns that a saved object's cleaning condition is still unresolved."
);
assert(
  finishBody.includes("conditionNotice")
    && finishBody.includes("condition also needs checking"),
  "A room still being read hides the unresolved condition warning from another completed room."
);
assert(!/sessionStorage\.setItem\([^)]*state\.rooms/.test(overlay) && !/sessionStorage\.setItem\([^)]*photos/.test(overlay), "Private room photos are written into browser storage instead of staying in the in-memory booking handoff.");
assert(/filter\(\(room\) => room\?\.image\)/.test(finishBody), "A room photo is discarded merely because automatic object reading produced no tasks.");

/* ── Real inputs, not a simulation ─────────────────── */
assert(overlay.includes("navigator.mediaDevices.getUserMedia") && overlay.includes('facingMode: { ideal: "environment" }'), "The scan does not open a real rear camera.");
assert(overlay.includes("width: { ideal: 1280, max: 1920 }") && overlay.includes("height: { ideal: 720, max: 1080 }") && overlay.includes("frameRate: { ideal: 24, max: 30 }"), "The scanner asks the phone for an unnecessarily expensive camera stream or no longer bounds capture quality.");
assert(overlay.includes("requestVideoFrameCallback") && overlay.includes("cancelVideoFrameCallback") && overlay.includes("requestAnimationFrame"), "Detection work is not synchronized to real video frames with a compatibility fallback.");
assert(overlay.includes("window.SpeechRecognition || window.webkitSpeechRecognition"), "The scan does not use real speech recognition.");
assert(!overlay.includes("const NOTE =") && !overlay.includes("DETECTIONS["), "The scan carries a scripted transcript or hardcoded detections instead of reading the room.");
assert(overlay.includes("roomTranscripts: new Map()") && overlay.includes("transcript: spokenNote") && overlay.includes("transcript: scanTranscript(state.rooms)"), "Spoken notes are not retained separately for each room and labelled in the final handoff.");
// The signature gained a `purpose` (which model tier answers the read); what this
// guards is unchanged — a room read is given that room's note, not the whole
// walkthrough, so one room's spoken instructions cannot be priced into another.
assert(/async function readRoom\(image, roomName, items = \[\], transcript = "", purpose = "confirmation"\)[\s\S]{0,1200}roomReadingPayload\(\{ roomName, transcript: String\(transcript/.test(overlay), "A room read still receives the global walkthrough instead of only that room's spoken note.");
// Defaulting to `confirmation` is deliberate: a new caller that forgets to say
// what it is gets the accurate-but-dearer tier, never a cheap read of the frame
// that sets the price. Only the walking loop opts down.
assert(/readRoom\(image, roomName, \[\], roomTranscript\(roomName\), "walking"\)/.test(overlay), "The walking loop no longer marks its reads as walking, so every keyframe would be billed at the confirmation tier.");
assert(overlay.includes("state.recognition !== recognition || generation !== state.voiceGeneration") && overlay.includes("recognition.onend = null"), "A delayed mobile speech callback can overwrite another room or stop a newly started recording.");
assert(overlay.includes("data-room-note") && overlay.includes("Check what Homle heard") && overlay.includes("Correct anything before confirming this room"), "A Landlord cannot review or correct the transcript before it becomes the Cleaner work order.");
assert(overlay.includes("data-note-open") && overlay.includes("Describe by voice or typing") && /if \(!Recognition\)[\s\S]{0,260}openNoteEditor\(\{ focus: true \}\)/.test(overlay), "A browser without speech recognition has no typed room-note path inside the scanner.");
assert(/async function saveRoom[\s\S]{0,220}setRoomTranscript\(el\.note\.value\)/.test(overlay) && /el\.note\.addEventListener\("input"[\s\S]{0,220}setRoomTranscriptDraft\(el\.note\.value\)/.test(overlay), "The corrected room note is displayed but not retained for the room read.");
assert(/function setRoomTranscriptDraft[\s\S]{0,260}String\(value \|\| ""\)\.slice\(0, 5000\)/.test(overlay) && !/el\.note\.addEventListener\("input"[\s\S]{0,220}renderVoiceTranscript\(\)/.test(overlay), "The room note is trimmed and rewritten on every keystroke, so phone typing can join adjacent words.");
assert(overlay.includes('data-voice-panel aria-label="Room note" hidden') && /function openNoteEditor[\s\S]{0,180}el\.voice\.hidden = false/.test(overlay) && /function closeNoteEditor[\s\S]{0,260}el\.voice\.hidden = true/.test(overlay), "The editable room note remains keyboard- or screen-reader-focusable while visually closed.");

// A phone browser cannot measure a room.
assert(!/\bm²/.test(overlay) && !overlay.includes("Floor area"), "The scan claims a floor-area measurement a phone cannot take.");

/* ── Privacy and lifecycle ─────────────────────────── */

// A photograph of the inside of a home must not be sent to a third party
// without the Landlord being asked first, in plain words.
assert(overlay.includes("sent to our AI provider") && overlay.includes("just take the photos"), "The scan sends photographs of a home without telling the Landlord who receives them, or without a working way to decline.");
assert(overlay.includes("!state.consentAsked) await askConsent();") && overlay.includes("if (!state.readingAllowed"), "A photograph can leave the device before consent has been given.");

// The camera must be released on every exit, including closing mid-scan and
// closing while the permission prompt is still open.
assert(/function close\(result\)[\s\S]{0,400}stopCamera\(\)/.test(overlay), "Closing the scan does not release the camera.");
assert(/stopCamera\(\);\s*\n\s*close\(\{/.test(overlay), "The camera is left running after the scan is read.");
assert(/if \(state\.closed \|\| document\.hidden\)[\s\S]{0,100}for \(const track of stream\.getTracks\(\)\) track\.stop\(\)/.test(overlay), "A camera granted after the scan was closed is left running with nothing able to stop it.");
assert(/if \(state\.closed \|\| document\.hidden\)[\s\S]{0,180}track\.stop\(\)[\s\S]{0,120}resumeCameraOnVisible/.test(overlay), "A camera permission result that arrives while the installed app is backgrounded can attach an invisible live stream.");
assert(/function pauseForBackground\(\)[\s\S]{0,260}stopDetection\(\);[\s\S]{0,100}stopCamera\(\);[\s\S]{0,120}stopVoice\(\{ silent: true \}\)/.test(overlay), "Backgrounding the scanner does not release its camera, detector and active microphone.");
assert(/function resumeAfterBackground\(\)[\s\S]{0,220}scheduleCameraResume\(\)/.test(overlay) && /function scheduleCameraResume\(\)[\s\S]{0,520}state\.frozen[\s\S]{0,240}state\.photoProcessing \|\| state\.videoProcessing[\s\S]{0,240}startCamera\(\)/.test(overlay), "Returning from a native camera or installed-app suspension can reopen a stale stream, race media decoding or resume behind a frozen photo.");
assert(overlay.includes('window.addEventListener("pagehide", onPageHide)') && overlay.includes('window.addEventListener("pageshow", onPageShow)') && overlay.includes('window.removeEventListener("pagehide", onPageHide)') && overlay.includes('window.removeEventListener("pageshow", onPageShow)'), "The installed-app page lifecycle is not paired, so camera hardware may survive navigation or fail after a back-forward restoration.");

// Boxes must surround what they describe, not whatever the camera now sees.
assert(overlay.includes("el.still.src = frame"), "Detections are drawn over the live camera instead of the frame they describe.");
// A reading that returns after the scan was closed, or after the Landlord moved
// to another room, must be discarded rather than saved under the wrong room.
assert(overlay.includes("session !== state.roomSession"), "A stale room reading can attach itself to a closed scan or a room the Landlord has left.");

// Assisted reading is optional; the scan must survive it being absent.
assert(overlay.includes("state.visionAvailable = false") && overlay.includes("status === 503"), "The scan does not fall back when assisted reading is unavailable.");
assert(overlay.includes("const controller = new AbortController()") && overlay.includes("signal: controller.signal") && overlay.includes("reading-timeout"), "A slow room-reading request can leave the scanner spinning indefinitely.");
assert(overlay.includes("function localRoomTasks") && overlay.includes("checklistFromTranscript") && overlay.includes('readingStatus: "needs-retry"'), "A failed automatic room read loses the spoken instructions or gives no clear retry state.");

/* ── On-device detection ───────────────────────────── */

// The detector runs in the browser, so the obvious shortcut is a CDN tag and a
// model fetched from a third party. Both are forbidden: the CSP is
// script-src 'self', and an off-origin model fetch would tell that third party
// which homes are being scanned and when.
// Every URL the overlay names must be same-origin, so no third party learns which homes
// are being scanned. Protocol-relative (`//host/…`) is checked too: it is off-origin
// but contains no scheme, so a `https?://` test alone would wave it through.
assert(!/https?:\/\//.test(overlay) && !/["'`]\/\/[a-z0-9]/i.test(overlay), "The scan overlay loads code or a model from off-origin.");
// `wasm-unsafe-eval` contains `unsafe-eval`, so asserting both proves nothing twice:
// the second could never fail while the first passed. What actually needs saying is
// that the policy still names the directive, and still grants it nothing but 'self' —
// an absent directive would satisfy a bare "does not contain" check just as well.
assert(!server.includes("unsafe-eval"), "The Content-Security-Policy was weakened to run the on-device detector.");
assert(/script-src\s+'self'/.test(server), "The script-src directive no longer pins scripts to 'self', so the no-eval guarantee above is checking a policy that may not exist.");

// The library's own default is an off-origin model that connect-src blocks
// silently — no boxes, no error, nothing in the console to explain it.
assert(overlay.includes('const detectorModelUrl = "/vendor/coco-ssd-lite-v1/model.json"') && overlay.includes("modelUrl: detectorModelUrl"), "The detector falls back to the library's off-origin model URL, which the CSP blocks silently.");

// /vendor/ is served immutable for a year, so every asset under it must carry a
// version in its path. Overwriting one of these names would strand every
// browser that already holds it on the old file, permanently.
for (const path of overlay.match(/"\/vendor\/[^"]+"/g) || []) {
  assert(/\/vendor\/[a-z-]+-(?:v\d+|\d+\.\d+\.\d+)\//.test(path), `A vendored asset is served immutable from an unversioned path and could never be replaced: ${path}`);
}
assert(overlay.includes('setBackend("webgl")'), "The detector does not pin the WebGL backend, so it may select one the CSP forbids.");

// Running the detector before the consent question is deliberate, and the
// reason has to survive someone reading this later and 'fixing' it: the model
// is local, so nothing has left the phone. Consent governs the network call.
// Scoped to the function rather than a character window, which kept breaking as
// the reasoning around it grew. The guarantee is what matters: inside readRoom,
// the consent check comes before the request that sends the photograph.
const readRoomBody = overlay.slice(overlay.indexOf("async function readRoom("), overlay.indexOf('fetch("/api/marketplace/landlord/room-reading"'));
assert(readRoomBody && /if \(!state\.readingAllowed/.test(readRoomBody), "The room reading is no longer gated on consent — a photograph could be sent before the Landlord agreed to it.");
// Each read owns its controller. Sharing one meant starting a read cancelled the
// one before it, which became routine the moment saving stopped waiting: walking
// into the next room would kill the previous room's confirmation.
assert(/state\.roomReadControllers\.add\(controller\)/.test(overlay), "Room reads share one abort controller again, so starting a new read cancels the one in flight.");
assert(!/state\.roomReadController\?\.abort\(\)/.test(overlay), "A new read aborts its predecessor again.");
assert(overlay.includes("!state.consentAsked) await askConsent();"), "A photograph can be read before consent has been given.");
// The room must exist before its background reader is scheduled. When this
// order was reversed, saving while `navigator.onLine === false` asked the retry
// path to find a room that had not been inserted yet. The room then appeared as
// permanently "reading" and never resumed after connectivity returned.
const saveRoomBodyForRetry = overlay.slice(
  overlay.indexOf("async function saveRoom("),
  overlay.indexOf("// The shutter freezes first", overlay.indexOf("async function saveRoom("))
);
assert(
  saveRoomBodyForRetry.indexOf("state.rooms = upsertRoom(state.rooms, room)") < saveRoomBodyForRetry.indexOf("readRoomInBackground({"),
  "A room's AI read starts before the room is saved, so an offline confirmation cannot be queued for retry."
);
// A same-named room can be removed and rescanned before an older request
// returns. Status alone cannot distinguish those revisions; the late kitchen
// result would otherwise overwrite the new kitchen's objects and condition.
assert(
  /readRoomInBackground\(\{[\s\S]{0,180}readingRevision/.test(saveRoomBodyForRetry)
    && (overlay.match(/current\.readingRevision !== readingRevision/g) || []).length >= 2,
  "Background room reads are not bound to the exact saved room revision, so a stale response can overwrite a rescan."
);
const keyframeDecisionBody = overlay.slice(
  overlay.indexOf("function maybeReadKeyframe(video)"),
  overlay.indexOf('let image = "";', overlay.indexOf("function maybeReadKeyframe(video)"))
);
assert(
  keyframeDecisionBody.includes("qualityKind: state.qualityKind")
    && keyframeDecisionBody.includes("shouldCaptureKeyframe(decision)"),
  "The live quality warning is not part of the keyframe decision, so dark, overexposed or blurred frames can still consume paid room reads."
);
assert(
  keyframeDecisionBody.includes("online: !state.networkOffline")
    && keyframeDecisionBody.includes("shouldCaptureKeyframe(decision)"),
  "A known-offline frame can still advance the paid room-read budget before the phone reconnects."
);

// A detector that cannot load must leave the scan exactly as good as it was
// before any of this existed.
assert(overlay.includes("state.liveDetectionAvailable = false") && overlay.includes('state.detectorState = "unavailable"'), "A detector that fails to load is not degraded away cleanly.");
assert(/catch[\s\S]{0,500}state\.liveDetectionAvailable = false/.test(overlay), "A detector that starts failing mid-scan can wedge the loop.");
assert(
  /function runKeyframePass\(generation\)[\s\S]{0,600}sampleFrameQuality\(video\)[\s\S]{0,180}maybeReadKeyframe\(video\)/.test(overlay)
    && overlay.includes("room reading still runs automatically"),
  "Losing the optional live glow also disables automatic room reading or falsely tells the Landlord the whole scanner stopped."
);
// A rejection arriving from a previous run must not wipe the boxes off a frame
// the Landlord has since frozen and is choosing on.
// The binding is optional — the catch takes an `error` so the failure can be logged —
// but the generation guard must still come before anything that touches the boxes.
assert(/catch (?:\(\w+\) )?\{[\s\S]{0,400}generation !== state\.detectionGeneration\) return;/.test(overlay), "A failed inference from an earlier run can clear a frozen frame's boxes.");

/* ── Freezing before choosing ──────────────────────── */

// Selecting on a live feed and cropping at send time would cut the crop from
// whatever the phone had moved on to. The frame is frozen first, always.
assert(overlay.includes("function freezeFrame") && /if \(state\.frozen\) return confirmSelection\(\)/.test(overlay), "The scan reads the room without freezing the frame that was chosen from.");
assert(/function freezeFrame[\s\S]{0,400}stopDetection\(\)/.test(overlay), "Freezing a frame leaves the detector running over the top of it.");
assert(overlay.includes("function drawVisibleRegion"), "The capture no longer matches the cropped region the viewfinder actually shows, so boxes and pixels can disagree.");

// Tapping empty space adds a box. Without this the scan loses every fixture
// COCO has no class for — air fryer, shower, worktop, radiator, extractor.
assert(overlay.includes("function onViewfinderTap") && overlay.includes('kind: "manual"'), "There is no way to mark something the detector cannot see.");
assert(overlay.includes('document.createElement("button")') && overlay.includes('setAttribute("aria-pressed"') && overlay.includes("toggleDetectedItem"), "Detected objects cannot be selected or removed as accessible one-tap controls.");
assert(/cropFor[\s\S]{0,220}if \(box\.kind !== "manual"\) return ""/.test(overlay), "Every selected item is cropped and sent, including ones already visible in the room frame.");

// Rotating the phone while choosing changes the viewfinder's aspect ratio.
// Unless the still and the boxes are pinned to one rectangle with the captured
// frame's aspect ratio, `object-fit: cover` re-crops the photograph underneath
// boxes that have not moved, and the crop sent for naming is of a different
// object than the one that was tapped.
assert(overlay.includes("function layoutFrozen") && /window\.addEventListener\("orientationchange"/.test(overlay), "Rotating the phone while choosing can leave the boxes over different pixels than the crop.");
assert(/tapPoint[\s\S]{0,320}state\.frozen \? el\.detections : el\.viewfinder/.test(overlay), "Taps are measured against a different rectangle than the boxes are drawn in.");

// The cap must count what was chosen, not what the detector found, or twelve
// stray detections lock out the hand-picked box the feature exists for. It must
// also apply on both ways of choosing: selecting an existing box as well as
// adding one, or a thirteenth is accepted here and silently truncated server-side.
assert(/function atSelectionLimit\(\)[\s\S]{0,120}selectionCount\(\) >= maximumSelectedItems/.test(overlay), "A full set of detections can block the Landlord from marking anything by hand.");
assert((overlay.match(/if \(atSelectionLimit\(\)\) return toast\(selectionLimitMessage\)/g) || []).length >= 2, "The selection cap is enforced when adding a box by hand but not when tapping one the detector found.");

// The detector is shared across overlays, so the guard against overlapping
// inference has to be shared too.
assert(overlay.includes("let detectorBusy = false") && !overlay.includes("state.detecting = true"), "Overlapping inference is guarded per overlay while the model is shared between them.");

// The detector's loop and its listeners must not outlive the overlay.
assert(/function close\(result\)[\s\S]{0,700}stopDetection\(\)/.test(overlay), "Closing the scan leaves the detection loop running.");
assert(overlay.includes('document.removeEventListener("visibilitychange"') && overlay.includes('window.removeEventListener("resize"'), "A listener is left on document or window, holding the camera and the model alive for the life of the page.");
assert(
  overlay.includes('window.addEventListener("online", onNetworkChange)')
    && overlay.includes('window.addEventListener("offline", onNetworkChange)')
    && overlay.includes('window.removeEventListener("online", onNetworkChange)')
    && overlay.includes('window.removeEventListener("offline", onNetworkChange)'),
  "Online/offline recovery listeners are missing or remain attached after the scanner closes."
);

// Camera refusal is explained and never dead-ends the booking.
assert(overlay.includes("data-camera-blocked") && overlay.includes("NotAllowedError") && overlay.includes("Describe by voice or typing"), "A declined camera leaves the Landlord stuck with no way to continue.");
assert(overlay.includes("data-camera-deck") && /function blockCamera[\s\S]{0,700}el\.deck\.hidden = true[\s\S]{0,120}el\.deck\.inert = true[\s\S]{0,120}setAttribute\("aria-hidden", "true"\)/.test(overlay) && (overlay.match(/el\.deck\.hidden = false/g) || []).length >= 2 && (overlay.match(/el\.deck\.inert = false/g) || []).length >= 2 && (overlay.match(/removeAttribute\("aria-hidden"\)/g) || []).length >= 2, "The camera-recovery card leaves covered duplicate controls keyboard- and screen-reader-focusable, or never restores them.");
assert(overlay.includes("data-camera-fallback") && overlay.includes("data-camera-fallback-input") && overlay.includes('capture="environment"') && overlay.includes("decodePhoto") && overlay.includes("captureSelectedPhoto"), "A denied live-camera permission no longer has a native phone-camera fallback.");
assert(overlay.includes("Live camera blank? Open your phone camera") && overlay.includes("for (const button of el.fallbacks)"), "The native phone-camera fallback is hidden until the live camera fails, leaving a black-but-open stream with no escape.");
assert(overlay.includes('accept="image/*"') && photoSelection.includes('startsWith("image/")'), "The native rear-camera fallback is restricted to a MIME list that can make phones open only the photo library or reject their own camera format.");
assert(/function captureSelectedPhoto\(file\)[\s\S]{0,220}state\.photoProcessing[\s\S]{0,180}aria-busy[\s\S]{0,1500}finally[\s\S]{0,180}state\.photoProcessing = false/.test(overlay), "A native photo decode can be started twice, gives no busy state or leaves the camera-resume gate permanently locked.");
assert(overlay.includes('import { extractRoomVideoFrames, maximumRoomVideoFrames, roomVideoContactSheetLayout } from "./room-video-frames.js"') && overlay.includes("data-video-fallback") && overlay.includes('accept="video/*"') && overlay.includes('capture="environment"'), "The main guided scanner cannot open a phone's rear video recorder or reuse the validated private video-frame extractor.");
assert(overlay.includes("function videoContactSheet(frames)") && /function captureSelectedVideo\(file\)[\s\S]{0,1400}extractRoomVideoFrames\(file, \{ frameCount: maximumRoomVideoFrames \}\)[\s\S]{0,300}videoContactSheet\(frames\)/.test(overlay) && overlay.includes("The raw video and audio stayed on this phone"), "A guided room video is uploaded raw, exposes its audio, or does not combine its beginning, middle and end into one locally extracted review frame.");
assert(overlay.includes("roomVideoContactSheetLayout({") && overlay.includes("sourceWidth: first.naturalWidth") && overlay.includes("canvasWidth: canvas.width"), "The video contact sheet ignores the tested portrait/landscape layout and can turn every frame into an unreadable thumbnail.");
assert(overlay.includes("state.videoProcessing") && /for \(const button of el\.videoFallbacks\)[\s\S]{0,220}aria-busy/.test(overlay) && /if \(state\.videoProcessing \|\| state\.capturing \|\| state\.loadingRoom\) return/.test(overlay), "Video preparation can race a live capture, revisit load or second video selection, or gives no busy state.");
assert(overlay.includes("function waitForCameraFrame") && overlay.includes('error.name = "CameraNotReadyError"') && overlay.includes("await waitForCameraFrame(el.camera)"), "A mobile camera stream that never produces a frame can leave the scanner warming up forever.");
assert(overlay.includes("Number(video.readyState) >= 2") && overlay.includes("Number(video.readyState) < 2"), "The scanner treats camera dimensions as a usable picture before the browser has delivered a current video frame.");
assert(/catch \(error\) \{[\s\S]{0,80}stopCamera\(\);[\s\S]{0,420}blockCamera\(/.test(overlay) && /function stopCamera\(\)[\s\S]{0,180}el\.camera\.srcObject = null/.test(overlay), "A failed or stalled camera stream is not released, so Try live camera again cannot recover.");
const unfreezeBody = overlay.slice(overlay.indexOf("function unfreeze()"), overlay.indexOf("const manualBoxSize", overlay.indexOf("function unfreeze()")));
assert(/if \(state\.stream\) startDetection\(\);\s*\n\s*else startCamera\(\)/.test(unfreezeBody), "Retaking after a backgrounded native capture cannot reacquire the live camera.");
// The failure message moved into the background reader when saving stopped
// waiting on the model. The guarantee is unchanged: a reader that fails must say
// so and leave the room retryable, never fail silently.
assert(overlay.includes("async function recoverCsrf") && overlay.includes('fetch("/api/marketplace/auth/session"') && overlay.includes('code: "sign-in-required"') && overlay.includes("automatic reading did not finish"), "The room reader silently fails when a signed-in phone loses its in-memory security token or when the provider fails.");
// Saved first, read after. The room, its photograph and the customer's own note
// are all in hand at press time, so nothing about that press needs a network
// round trip — waiting on one is what made the button feel dead.
assert(/readRoomInBackground\(\{ frame, roomName, chosen, spokenNote, readingRevision \}\)/.test(overlay), "Saving a room waits on the vision model again, so the confirm button blocks for as long as the provider and the connection take.");
assert(/readingStatus: "reading"/.test(overlay), "A room saved before its reading completes is not marked, so the hub cannot show that it is still being read.");
assert(
  /function readRoomInBackground[\s\S]{0,700}state\.networkDeferredRooms\.add\(transcriptKey\(roomName\)\)/.test(overlay)
    && /function resumeDeferredRoomReads[\s\S]{0,1100}readingStatus: "reading"[\s\S]{0,500}readRoomInBackground/.test(overlay)
    && /function onNetworkChange[\s\S]{0,500}resumeDeferredRoomReads\(\)/.test(overlay),
  "A room confirmed while offline is not retained and retried automatically after connectivity returns."
);
// A late reading must land only on the room it was started for.
assert(/current\.readingStatus !== "reading" \|\| current\.readingRevision !== readingRevision\) return;/.test(overlay), "A background reading is applied without checking the room is still awaiting this exact revision, so it could overwrite a room the customer has since edited or re-saved.");

/* ── The room hub: choose, review, return, finish ──── */

// The room is chosen, not counted off in order of capture. The old
// order-assigned naming must be gone from the flow.
assert(overlay.includes("function enterRoom") && overlay.includes("[data-hub]") && overlay.includes("data-hub-choices"), "There is no hub to choose a room from before scanning.");
assert(overlay.includes("data-live-progress") && overlay.includes("data-hub-progress") && overlay.includes("function renderScanProgress"), "The scanner has no simple progress indication while moving between rooms and review.");
assert(!overlay.includes("nextRoomName"), "Rooms are still assigned by capture order instead of chosen.");
assert(/for \(const preset of roomPresets\)[\s\S]{0,300}el\.hubChoices\.appendChild/.test(overlay), "The offered rooms (kitchen, bathroom, bedroom, living room) are not presented as choices.");

// Confirming a room saves it and returns to the hub — the hub is the one place
// to pick, review, revisit and finish.
assert(overlay.includes("state.rooms = upsertRoom(state.rooms, room)") && /function toHub\(\)/.test(overlay), "A confirmed room is not saved back into the roster, or there is no way back to the hub.");
assert(/for \(const button of el\.roomsOpen\)[\s\S]{0,120}toHub\(\)/.test(overlay), "There is no one-tap way back to the hub to switch or review rooms.");
assert(overlay.includes('remove.className = "hub-room-remove"') && overlay.includes("remove.dataset.roomRemove = room.name") && overlay.includes("Remove ${room.name} from this scan"), "A Landlord cannot remove a room scanned by mistake from the room hub.");
assert(/function showRoomRemoval\(rawName\)[\s\S]{0,520}mode: "room"[\s\S]{0,500}keepLabel: "Keep room"[\s\S]{0,140}confirmLabel: "Remove room"/.test(overlay), "Removing a scanned room happens immediately instead of requiring one clear keep-or-remove decision.");
// Widened, and strengthened: removing a room must now also take what the walk
// found in it, or re-adding a room of the same name resurrects items the Landlord
// deliberately removed.
// Scoped to the function body rather than a character window. The window kept
// breaking as cleanup was added, which trains you to widen it rather than read it.
const discardBody = overlay.slice(overlay.indexOf("function confirmDiscardDecision()"), overlay.indexOf("function confirmDiscardDecision()") + 1400);
for (const [step, pattern] of [["removes the room", /state\.rooms = removeRoom\(state\.rooms, removedName\)/], ["drops its note", /state\.roomTranscripts\.delete\(key\)/], ["redraws the list", /renderHub\(\)/]]) {
  assert(pattern.test(discardBody), `Confirmed room removal no longer ${step}, so its image, note or row survives the removal.`);
}
// The findings go; the spent budget deliberately STAYS. Deleting the budget made
// remove-and-re-add an unlimited supply of paid reads, which is the one bound the
// consent actually promises. The generation bump is what stops a read already in
// flight from recreating the inventory that was just deleted.
assert(/state\.inventories\.delete\(key\)[\s\S]{0,140}state\.walkEvidence\.delete\(key\)/.test(overlay), "Removing a room leaves behind what the walk found in it, so re-adding the same name brings back removed items.");
assert(!/state\.keyframeBudgets\.delete\(/.test(overlay), "Removing a room refunds its walking reads, so remove-and-re-add is an unlimited supply of paid provider calls.");
assert(/budget\.generation \+= 1/.test(overlay), "Removing a room does not invalidate reads already in flight for it, so a late result can recreate the inventory the Landlord just deleted.");
assert(/el\.hub\.addEventListener\("click"[\s\S]{0,180}\[data-room-remove\][\s\S]{0,160}showRoomRemoval[\s\S]{0,140}\[data-room\]/.test(overlay), "The room hub treats the Remove control as an Edit action before opening its safety decision.");
assert(styles.includes(".hub-room-row") && styles.includes(".hub-room-remove"), "The room-removal control has no mobile room-row presentation.");

// Returning to a scanned room reopens its saved photo and its objects.
assert(/function openRevisit\(room, session\)[\s\S]{0,1800}room\.detections/.test(overlay), "Returning to a room does not reopen the objects it already held.");
// An unchanged save reads nothing; a change — an object added OR removed — reads
// again, so a task like "clean the oven" cannot outlive the oven and keep
// pricing a job for it.
assert(overlay.includes("const changed = chosen.some((box) => box.kind === \"manual\") || keptCount < originalCount || spokenChanged") && overlay.includes('const mustRead = (!revisit || changed || existing.readingStatus === "needs-retry") && !clearedRevisit'), "Editing a saved room either always calls the reader (slow), cannot retry a failed read, or leaves orphaned tasks or changed spoken notes out of its scope.");

// Async work is scoped to the room it started in. A read or a photo decode that
// resolves after the Landlord has moved on must be dropped, never saved under
// the room now on screen.
assert(overlay.includes("state.roomSession") && /function enterRoom[\s\S]{0,700}state\.roomSession \+= 1/.test(overlay) && /function toHub[\s\S]{0,700}state\.roomSession \+= 1/.test(overlay), "Room navigation does not invalidate a read still in flight for the room just left.");
assert((overlay.match(/session !== state\.roomSession/g) || []).length >= 3, "A read or photo decode that resolves after leaving its room is not dropped.");
// Crops are cut from the canvas before the network await, so a later capture
// redrawing the shared canvas cannot corrupt the crop mid-request.
assert(/const selected = items\.map[\s\S]{0,400}cropFor\(item\)[\s\S]{0,900}await recoverCsrf\(\)/.test(overlay), "Crops are taken after an await, so a later capture can cut them from the wrong frame.");
// Rescanning a revisited room takes a fresh photo, which must read on save.
// `revisiting` (edit-a-stored-frame) is cleared whenever a fresh frame is
// frozen — a live capture or a phone-camera photo — so neither skips the read.
assert(/function freezeFrame[\s\S]{0,400}state\.revisiting = false/.test(overlay), "A phone-camera photo or live capture can be saved on the free-edit path and skip the read it needs.");

// The phone-camera decode must not draw onto the shared canvas until the
// Landlord is confirmed still in this room — otherwise an abandoned decode
// corrupts a later crop.
assert(overlay.includes("function decodePhoto") && /decodePhoto\(file\)[\s\S]{0,260}session !== state\.roomSession[\s\S]{0,200}drawVisibleRegion/.test(overlay), "A phone-camera photo draws to the shared canvas before confirming the room.");
assert(overlay.includes("validatedGuidedRoomPhotoFile(file)") && overlay.includes("validatedGuidedRoomPhotoDimensions(image.naturalWidth, image.naturalHeight)"), "The broad native phone-camera picker can pass vector or oversized decoded images into the scanner.");

// A tap during the revisit photo load must not start a fresh capture that the
// load then overwrites.
assert(overlay.includes("state.loadingRoom") && /function capture\(\)[\s\S]{0,120}state\.loadingRoom/.test(overlay), "A shutter tap while a revisited room is still loading can race the load.");

// Removing every object on a revisit saves an empty room, rather than reading
// the whole frame again and rediscovering exactly what was removed.
assert(overlay.includes("const clearedRevisit = revisit && chosen.length === 0") && /clearedRevisit[\s\S]{0,200}detections: \[\], tasks: \[\], condition: ""/.test(overlay), "Clearing every object re-reads the whole room and brings the removed objects back.");

// The in-progress flag is claimed before the consent prompt is awaited, so a
// second activation during that await cannot slip in and save an empty room
// over this one while the read is not yet permitted.
assert(overlay.includes("state.capturing = true;") && overlay.indexOf("state.capturing = true;") < overlay.indexOf("await askConsent()"), "A second confirm during the consent prompt can overwrite the room with an empty reading.");

// Finishing is instant: every room was read as it was confirmed, so there is
// nothing left to load and no reason to animate loading.
assert(!overlay.includes("Reading your home") && !/setTimeout\(\s*\(?\s*(?:wait|resolve)\)?\s*,\s*(?:340|700)\s*\)/.test(overlay), "The finish step still plays a loading animation over work that has already happened.");
// Scoped to the function body rather than a character window, which grew stale
// as finishScan gained its still-reading guard.
assert(/stopCamera\(\);\s*\n\s*close\(\{/.test(finishBody), "Finishing no longer closes cleanly with the gathered rooms.");

// Behind the hub the camera stays warm but detection is paused — no point
// running inference at a menu.
assert(/function startDetection\(\)[\s\S]{0,200}state\.screen !== "live"/.test(overlay), "The detector keeps running while the hub covers the camera.");

/* ── Presentation ──────────────────────────────────── */
// `scanSweepRun` used to be pinned here. It animated `top` on a full-width bar and
// its trigger class was never applied by any code path, so it was removed; the
// detector-state badge that reports model loading is pinned in its place.
assert(styles.includes(".scan-overlay") && styles.includes(".scan-stage") && styles.includes(".det-box") && styles.includes(".scan-detector-state") && styles.includes(".hub-room"), "The approved scan presentation is missing.");
assert(!styles.includes(".vf.scanning .vf-feed{filter") && !/\.hub\{[^}]*backdrop-filter/.test(styles), "The live camera feed is filtered or the hub blurs a playing video behind it, repainting the whole viewport every frame.");
assert(/\.scan-top\{[^}]*z-index:10/.test(styles) && /\.vf-blocked\{[^}]*z-index:9/.test(styles), "The camera-recovery panel covers the close button and room counter, trapping a Landlord whose camera permission is blocked.");

// The frozen still is z-index 2. A detection layer below it paints the boxes
// behind the photograph they describe, which is how this feature managed to
// look configured and show nothing.
assert(/\[data-detection-layer\]\{[^}]*z-index:3/.test(styles), "The detection layer sits under the frozen still, so the boxes are invisible.");
assert(styles.includes(".det-box.pickable") && styles.includes(".det-box.picked"), "Selectable and selected boxes are indistinguishable.");

// Several megabytes served no-cache would be re-downloaded every time the scan
// was opened, on a phone, on mobile data.
assert(/vendored[\s\S]{0,400}max-age=31536000, immutable/.test(server), "The vendored detector is served without a long-lived cache policy.");
assert(server.includes('".bin"'), "Weight shards have no declared content type.");
assert(styles.includes("prefers-reduced-motion") && styles.includes("env(safe-area-inset-bottom)"), "The scan ignores reduced-motion or phone safe areas.");
assert(server.includes('["/landlord/scan", "/room-scan.html"].includes(requestUrl.pathname)') && server.includes('{ "Location": "/landlord/book", "Cache-Control": "no-store" }'), "Old scanner links do not redirect into the protected booking journey.");
assert(!server.includes('"/landlord/scan": "room-scan.html"'), "The legacy standalone scanner is still served as a separate camera surface.");
assert(/requestPath === "\/brief" \|\| landlordDashboardPage \|\| journeyPage[\s\S]{0,120}\? "camera=\(self\), microphone=\(self\), geolocation=\(\)"/.test(server), "The embedded scanner is rendered on /landlord/book, but that real phone journey still blocks its own camera and microphone in Permissions-Policy.");

console.log("Room scan UI tests passed: embedded overlay with one implementation, real camera and speech, consent before any photograph leaves, camera released on every exit, safe detection overlay, honest duration and condition, no invented measurement and the approved presentation.");
