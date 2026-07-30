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
// Locally derived tasks already carry their room prefix. Re-prefixing them
// shipped "Bedroom: Bedroom: …" to a real checklist on a real phone.
{
  const prefixed = scanChecklistLines([{ name: "Bedroom", tasks: ["Bedroom: Make the bed", "Wipe the sills", "bedroom: dust the shelves"] }]);
  assert(prefixed.includes("Bedroom: Make the bed") && prefixed.includes("Bedroom: Wipe the sills"),
    `An already-prefixed task was double-prefixed or an unprefixed one missed its room: ${JSON.stringify(prefixed)}`);
  assert(prefixed.includes("bedroom: dust the shelves"), "Prefix detection is case-sensitive, so a lowercase room prefix gets doubled.");
  assert(!prefixed.some((line) => /Bedroom: Bedroom:/i.test(line)), `The double room prefix is back: ${JSON.stringify(prefixed)}`);
}

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
// Sharpened from a blanket localStorage ban when the spoken-guidance preference
// arrived: what is actually guarded is that nothing PRIVATE reaches browser
// storage. An on/off setting under its named key is allowed; a photo, a room
// roster or anything built from scan state is not.
{
  const storageWrites = [...overlay.matchAll(/localStorage\.setItem\(([^)]*)\)/g)].map((match) => match[1]);
  assert(storageWrites.every((args) => args.includes("spokenGuidancePreferenceKey")), `A localStorage write beyond the named guidance preference appeared: ${storageWrites.join(" | ")}`);
  const storageReads = [...overlay.matchAll(/localStorage\.getItem\(([^)]*)\)/g)].map((match) => match[1]);
  assert(storageReads.every((args) => args.includes("spokenGuidancePreferenceKey")), "A localStorage read beyond the named guidance preference appeared.");
  assert(!/localStorage\.setItem\([^)]*(rooms|photo|transcript|frozenFrame|image|dataUrl)/i.test(overlay), "Scan content reached localStorage.");
  assert(!overlay.includes("JSON.stringify(state.rooms"), "The discard safeguard persists private room photos or the scan roster in browser storage.");
}
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
assert(/async function readRoom\(image, roomName, items = \[\], transcript = "", purpose = "confirmation"\)[\s\S]{0,2600}roomReadingPayload\(\{ roomName, transcript: String\(transcript/.test(overlay), "A room read still receives the global walkthrough instead of only that room's spoken note.");
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
assert(/async function cropFor\(box, source\)[\s\S]{0,1400}encodeCanvasJpeg\(canvas, 0\.9\)/.test(overlay), "A selected detected item does not receive the focused, asynchronous condition crop used by a hand-marked item.");
assert(!/function cropFor[\s\S]{0,220}box\.kind !== "manual"/.test(overlay), "Detected items are still excluded from focused condition evidence.");

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
const selectedPhotoBody = overlay.slice(overlay.indexOf("async function captureSelectedPhoto(file)"), overlay.indexOf("function videoContactSheet", overlay.indexOf("async function captureSelectedPhoto(file)")));
assert(/state\.photoProcessing[\s\S]{0,180}aria-busy/.test(selectedPhotoBody) && /finally[\s\S]{0,180}state\.photoProcessing = false/.test(selectedPhotoBody), "A native photo decode can be started twice, gives no busy state or leaves the camera-resume gate permanently locked.");
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
// Crops decode from the immutable captured frame rather than the shared canvas,
// so scanning a later room cannot corrupt a background confirmation.
assert(/function snapshotCropSource\(frame\)[\s\S]{0,700}image\.src = frame/.test(overlay), "Selected-item crops are not tied to the immutable captured room frame.");
assert(/const cropSource = items\.length \? await snapshotCropSource\(image\) : null[\s\S]{0,500}await cropFor\(item, cropSource\)[\s\S]{0,900}await recoverCsrf\(\)/.test(overlay), "Selected-item crops do not consistently use the decoded captured-frame snapshot.");
// The confirmed room and toast paint before background crop preparation begins.
assert(/toHub\(\)[\s\S]{0,1800}toast\([\s\S]{0,900}window\.setTimeout\(\(\) => \{[\s\S]{0,240}readRoomInBackground/.test(overlay), "Condition crop preparation can still delay the red-button save confirmation.");
// Rescanning a revisited room takes a fresh photo, which must read on save.
// `revisiting` (edit-a-stored-frame) is cleared whenever a fresh frame is
// frozen — a live capture or a phone-camera photo — so neither skips the read.
assert(/function freezeFrame[\s\S]{0,400}state\.revisiting = false/.test(overlay), "A phone-camera photo or live capture can be saved on the free-edit path and skip the read it needs.");

// The phone-camera decode must not draw onto the shared canvas until the
// Landlord is confirmed still in this room — otherwise an abandoned decode
// corrupts a later crop.
assert(overlay.includes("function decodePhoto") && /decodePhoto\(file\)[\s\S]*session !== state\.roomSession[\s\S]*refreshPrivateRegionsForSource\(image[\s\S]*session !== state\.roomSession[\s\S]*drawVisibleRegion/.test(selectedPhotoBody), "A phone-camera photo draws to the shared canvas before confirming the room.");
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
assert(/landlordDashboardPage \|\| journeyPage[\s\S]{0,120}\? "camera=\(self\), microphone=\(self\), geolocation=\(\)"/.test(server), "The embedded scanner is rendered on /landlord/book, but that real phone journey still blocks its own camera and microphone in Permissions-Policy.");
assert(server.includes("activeJobPage || landlordDashboardPage || journeyPage"), "The protected booking journey cannot connect to private object storage for room-photo uploads.");


/* ── Nothing leaves the device with a face in it ───────────────────────── */

// Until Phase 8 a captured frame was metadata-stripped by the server and
// otherwise stored intact, so a person in the room or a payslip on a desk
// reached the assigned Cleaner under a signed URL.
assert(/redactPrivateContent\(el\.canvas[^)]*\);[\s\S]{0,600}toDataURL/.test(overlay),
  "A frame can be serialised before private content is erased.");
assert(/async function refreshPrivateRegionsForSource[\s\S]*state\.privateRegions = \[\][\s\S]*detector\.detect\(source[\s\S]*shouldRedact/.test(overlay),
  "A phone photo or video contact sheet can reuse stale live-camera privacy boxes instead of checking its own pixels.");
assert(/decodePhoto\(file\)[\s\S]{0,650}refreshPrivateRegionsForSource\(image[\s\S]{0,300}drawVisibleRegion\(image/.test(overlay),
  "The phone-camera fallback draws or serialises a selected photo before its own private-content check.");
assert(/state\.candidates = live \?[\s\S]{0,350}: \[\]/.test(overlay),
  "A fallback photo can inherit selectable boxes from an unrelated live camera frame.");
assert(/refreshPrivateRegionsForSource[\s\S]*private-content check[\s\S]*voice note instead/.test(overlay),
  "The selected-photo privacy check can fail open when on-device detection is unavailable.");
// The single place every uploaded frame, crop source and read frame is
// produced. Redacting anywhere else means a caller added later has to remember.
assert(overlay.split("toDataURL(\"image/jpeg\"").length === 2 || /redactPrivateContent/.test(overlay),
  "Frames are produced in more than one place without redaction.");
// Gathered from the raw detector output, not the tracker: a person is filtered
// out by implausibleForRoom and by the tracking threshold, and neither is a
// reason to publish their face.
assert(/state\.privateRegions = found[\s\S]{0,200}shouldRedact/.test(overlay),
  "Private regions are taken from the tracker rather than from raw detections.");
// Somebody handing a photograph of their home to a stranger is entitled to
// know what was removed from it.
assert(overlay.includes("state.lastRedaction?.summary") && overlay.includes("unusableRedactionRatio"),
  "The scanner neither reports what it blurred nor refuses a frame that is mostly a person.");

console.log("Room scan UI tests passed: embedded overlay with one implementation, real camera and speech, consent before any photograph leaves, camera released on every exit, safe detection overlay, honest duration and condition, no invented measurement and the approved presentation.");

/* ── The microphone can always be stopped, cancelled and reviewed ── */

// While recording, the panel header holds a visible Stop (and Cancel); while
// reviewing, Done and Delete. The old stylesheet rule hid the panel's only
// button during recording, leaving stop to an unlabelled toggle — the exact
// field complaint this section pins against return.
assert(overlay.includes("data-voice-stop") && overlay.includes("data-voice-cancel") && overlay.includes("data-voice-delete"), "The voice panel lost its explicit Stop, Cancel or Delete control.");
assert(!/\.voice\.recording \.voice-done\s*\{\s*display:\s*none/.test(styles), "The stylesheet once again hides the note panel's confirm button during recording, leaving no visible way to stop.");
assert(/el\.voiceStop\.hidden = !recording;\s*\n\s*el\.voiceCancel\.hidden = !recording;\s*\n\s*el\.noteDone\.hidden = recording;/.test(overlay), "Recording and review no longer swap the Stop/Cancel and Done/Delete button pairs, so one state shows the other's controls.");
assert(/micLabel\.textContent = recording \? "Stop"/.test(overlay) && /aria-label", recording \? "Stop recording"/.test(overlay), "The mic button does not become a labelled Stop control while recording.");
assert(/el\.voiceStop\.addEventListener\("click", \(\) => stopVoice\(\)\)/.test(overlay), "The visible Stop button is not wired to stop the recording.");
// Cancel restores the note to exactly what it was when the mic was tapped —
// discarding the recording, never the note it was being appended to.
assert(/state\.voiceSessionStartNote = sessionBase/.test(overlay) && /function cancelVoice\(\)[\s\S]{0,420}stopVoice\(\{ silent: true \}\);[\s\S]{0,120}setRoomTranscript\(restore\)/.test(overlay), "Cancelling a recording no longer restores the pre-recording note.");
assert(/function deleteVoiceNote\(\)[\s\S]{0,320}setRoomTranscript\(""\)/.test(overlay), "There is no way to delete a room note from the review panel.");
// Failure causes are named, because "try again" is wrong advice for a blocked
// permission and for a phone with no microphone.
assert(/event\?\.error === "not-allowed" \|\| event\?\.error === "service-not-allowed"/.test(overlay) && overlay.includes("Microphone access is blocked"), "A denied microphone permission is reported as a generic failure, sending people tapping the mic forever.");
assert(overlay.includes('event?.error === "audio-capture"') && overlay.includes("No microphone was found"), "A missing microphone is reported as a generic failure.");
assert(overlay.includes("Nothing was heard"), "An empty recording ends silently instead of saying nothing was heard.");
// The timer restarts visibly with each recording.
assert(/el\.voiceTime\.textContent = "0:00"/.test(overlay), "A new recording shows the previous recording's elapsed time until the first tick.");

/* ── One capture mode: the deck offers no video button ── */

// The scanner already reads the room continuously while the Landlord walks; a
// separate video mode was a second way to do what the default does, and a
// media-mode decision no customer should be handed. The video path itself must
// survive on the camera-blocked recovery card, where it is genuinely needed.
{
  const deckMarkup = overlay.slice(overlay.indexOf('class="deck-row"'), overlay.indexOf("deck-camera-alt"));
  assert(!deckMarkup.includes("data-video-fallback"), "The video-mode button is back in the main camera deck.");
  assert(deckMarkup.includes("data-note-open"), "The deck lost its typed-note entry when the video button left.");
  assert(deckMarkup.includes("Finish room"), "The shutter carries no visible label saying it finishes the room.");
  const blockedMarkup = overlay.slice(overlay.indexOf("vf-blocked"), overlay.indexOf('class="scan-top"'));
  assert(blockedMarkup.includes("data-video-fallback"), "The camera-blocked recovery card lost its video fallback — a phone with a blank live camera now has no walkthrough capture at all.");
}

/* ── The press is acknowledged before the encode ── */

// The 1600px JPEG now encodes off the main thread; the flash and the locked
// shutter are what make that wait read as a response instead of a dead button,
// and the post-await guards are what stop a stale encode landing on a view the
// Landlord has already left or frozen.
assert(/function flashViewfinder\(\)[\s\S]{0,240}classList\.add\("pop"\)/.test(overlay), "Nothing triggers the capture flash the stylesheet has always defined.");
assert(/async function capture\(\)[\s\S]{0,1200}flashViewfinder\(\);\s*\n\s*el\.shutter\.disabled = true/.test(overlay), "The shutter press is not acknowledged before the asynchronous encode.");
assert(/async function capture\(\)[\s\S]{0,1600}const frame = await pending;[\s\S]{0,300}if \(state\.closed \|\| state\.frozen \|\| state\.screen !== "live"\) return;/.test(overlay), "A capture encoded after the Landlord moved on can still freeze the wrong view.");
assert(/await pending\.catch\(\(\) => ""\)/.test(overlay), "A failed tap-to-freeze encode rejects unhandled instead of degrading to the warming-up message.");

/* ── Spoken guidance never talks into the microphone ── */

// The one hard rule: guidance must never be transcribed into the customer's
// own note. The speak function refuses while recording, and starting a
// recording silences anything mid-sentence BEFORE the microphone opens.
assert(/function announceGuidance\(text, key = text\)[\s\S]{0,120}state\.voiceOn\) return;/.test(overlay), "Spoken guidance can talk while a voice note is recording, transcribing itself into the customer's note.");
assert(/function startVoice\(\)[\s\S]{0,220}stopSpeaking\(\);/.test(overlay), "Starting a recording does not silence guidance already mid-sentence.");
// Off by default, per-device, and torn down with everything else.
assert(overlay.includes("data-speech-toggle") && /function toggleSpokenGuidance\(\)[\s\S]{0,320}localStorage\.setItem\(spokenGuidancePreferenceKey/.test(overlay), "The spoken-guidance choice is not a visible, remembered toggle.");
assert(/function readSpokenGuidancePreference\(\)[\s\S]{0,160}=== "on"/.test(overlay), "Spoken guidance is not off by default — an unset preference must stay silent.");
assert(/function close\(result\)[\s\S]{0,400}stopSpeaking\(\)/.test(overlay) && /function pauseForBackground\(\)[\s\S]{0,300}stopSpeaking\(\)/.test(overlay), "Closing or backgrounding the scanner can leave it talking.");
// One thing at a time — stale guidance queued behind current guidance narrates
// the past.
assert(/synth\.cancel\(\);[\s\S]{0,400}synth\.speak\(utterance\)/.test(overlay), "Queued utterances can stack up and narrate stale guidance.");

/* ── The capture assists come on by themselves, and off only by hand ── */

// Torch and zoom decisions live in camera-assist.js where their rules are
// tested; what is pinned here is the wiring that keeps them safe in the
// overlay: streaks counted on every quality sample (including unchanged-advice
// ones — the early return must come after), declines recorded on the manual
// controls and reset per room, and everything cleared when the camera stops.
assert(/state\.darkStreak = advice\?\.kind === "dark"[\s\S]{0,240}void maybeAssistCamera\(\);[\s\S]{0,140}if \(key === state\.qualityKind\) return true;/.test(overlay), "Assist streaks are counted after the unchanged-advice early return, so a persisting problem never accumulates one.");
assert(/async function maybeAssistCamera\(\)[\s\S]{0,120}state\.closed \|\| state\.frozen \|\| !state\.cameraTrack\) return;/.test(overlay), "The assist can fire while the frame is frozen or the camera is gone.");
assert(/if \(shouldEnableTorch\(\{/.test(overlay) && /nextAutoZoom\(\{/.test(overlay), "The overlay makes its own assist decisions instead of using the tested rules.");
// Manual off is final for the room, on both assists.
assert(/async function toggleTorch\(\)[\s\S]{0,420}state\.torchOn = false;[\s\S]{0,160}state\.torchDeclined = true;/.test(overlay), "Turning the torch off does not decline it, so it re-lights a second later.");
assert(/async function resetZoom\(\)[\s\S]{0,420}state\.zoomDeclined = true;/.test(overlay), "Resetting the zoom does not decline it, so it re-zooms a second later.");
// A new room is a new conversation: declines and streaks reset, zoom returns
// to wide.
assert(/function prepareLiveRoom\(\)[\s\S]{0,900}state\.torchDeclined = false;[\s\S]{0,80}state\.zoomDeclined = false;/.test(overlay), "A decline in one room silences the assists in every later room.");
// Stopping the camera physically extinguishes the torch; the state must agree.
assert(/function stopCamera\(\)[\s\S]{0,700}state\.torchOn = false;[\s\S]{0,120}renderCameraAssist\(\)/.test(overlay), "A stopped camera leaves the torch control claiming to be on.");
// The controls exist and are hidden until the camera proves support.
assert(overlay.includes("data-torch") && overlay.includes("data-zoom-reset") && /el\.torch\.hidden = !state\.stream \|\| !torchSupported\(state\.cameraCapabilities\)/.test(overlay), "The assist controls show on cameras that cannot honour them.");
// Counted, never photographed: the assists report bare counters only.
assert(/scanEvents\.record\("scan\.assist\.torch"\)/.test(overlay) && /scanEvents\.record\("scan\.assist\.zoom"\)/.test(overlay), "The assists fire without being counted, so nobody learns how often rooms are too dark or too far.");
