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
  scanSummary
} from "../public/room-scan-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const [overlay, entryScript, entryPage, journey, journeyPage, styles, server] = await Promise.all([
  readFile(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8"),
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
assert(scanHint(0).includes("shutter") && scanHint(2, { voiceUsed: false }).includes("mic"), "The scan does not tell a first-time user what to do, or never offers the voice note.");
assert(!scanHint(2, { voiceUsed: true }).includes("mic"), "The voice tip is repeated after the Landlord has already used it.");
assert(scanHint(maximumShots).includes("maximum"), "Reaching the capture limit is not explained.");
assert(shotLabel("Living room") === "LIVI" && shotLabel("") === "ROOM", "Shot labels are not derived safely from the room name.");

// A detection box that does not fit the frame would be painted across the whole
// photograph and read as a confident detection of the entire room.
assert(usableDetections([{ x: 10, y: 10, width: 20, height: 20, label: "Worktop" }]).length === 1, "A valid detection was discarded.");
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

/* ── Embedded overlay ──────────────────────────────── */

// The scan opens over the page that asked for it and hands its result straight
// back. A page navigation would drop the answers already given.
assert(overlay.includes("export function openRoomScan()") && overlay.includes("return new Promise"), "The scan is not an overlay the app can open in place.");
assert(overlay.includes("document.body.appendChild(overlay)") && overlay.includes("overlay.remove()"), "The scan overlay does not mount and unmount itself.");
assert(journey.includes("await openRoomScan()") && journey.includes("if (!result) return;"), "The journey does not open the scan in place, or cannot tell a finished scan from a cancelled one.");
assert(!journeyPage.includes('href="/landlord/scan"'), "The journey still navigates away to the scan instead of opening it in place.");

// One implementation only. The standalone route exists for a bookmark and must
// reuse the overlay rather than drift into a second scanner.
assert(entryScript.includes("openRoomScan") && entryScript.split("\n").length < 20, "The standalone scan route is a second implementation rather than a thin entry point.");
assert(!entryPage.includes("data-shutter") && !entryPage.includes("data-viewfinder"), "The standalone scan page duplicates the overlay's markup.");

// Modal hygiene: the page behind must not scroll, Escape must close, and focus
// must come back to where it was.
assert(overlay.includes('aria-modal", "true"') && overlay.includes('document.body.style.overflow = "hidden"') && overlay.includes("previousOverflow"), "The scan overlay lets the page behind it scroll, or never restores it.");
assert(overlay.includes('event.key === "Escape"') && overlay.includes("previouslyFocused"), "The scan overlay cannot be dismissed with Escape or loses the Landlord's place.");

/* ── Real inputs, not a simulation ─────────────────── */
assert(overlay.includes("navigator.mediaDevices.getUserMedia") && overlay.includes('facingMode: { ideal: "environment" }'), "The scan does not open a real rear camera.");
assert(overlay.includes("window.SpeechRecognition || window.webkitSpeechRecognition"), "The scan does not use real speech recognition.");
assert(!overlay.includes("const NOTE =") && !overlay.includes("DETECTIONS["), "The scan carries a scripted transcript or hardcoded detections instead of reading the room.");

// A phone browser cannot measure a room.
assert(!/\bm²/.test(overlay) && !overlay.includes("Floor area"), "The scan claims a floor-area measurement a phone cannot take.");

/* ── Privacy and lifecycle ─────────────────────────── */

// A photograph of the inside of a home must not be sent to a third party
// without the Landlord being asked first, in plain words.
assert(overlay.includes("sent to our AI provider") && overlay.includes("just take the photos"), "The scan sends photographs of a home without telling the Landlord who receives them, or without a working way to decline.");
assert(overlay.includes("if (!state.consentAsked) await askConsent();") && overlay.includes("if (!state.readingAllowed"), "A photograph can leave the device before consent has been given.");

// The camera must be released on every exit, including closing mid-scan and
// closing while the permission prompt is still open.
assert(/function close\(result\)[\s\S]{0,400}stopCamera\(\)/.test(overlay), "Closing the scan does not release the camera.");
assert(/stopCamera\(\);\s*\n\s*close\(\{/.test(overlay), "The camera is left running after the scan is read.");
assert(overlay.includes("if (state.closed) { for (const track of stream.getTracks()) track.stop(); return; }"), "A camera granted after the scan was closed is left running with nothing able to stop it.");

// Boxes must surround what they describe, not whatever the camera now sees.
assert(overlay.includes("el.still.src = frame"), "Detections are drawn over the live camera instead of the frame they describe.");
// A reading that returns after the scan was closed or reset must be discarded.
assert(overlay.includes("generation !== state.generation"), "A stale room reading can attach itself to a closed or restarted scan.");

// Assisted reading is optional; the scan must survive it being absent.
assert(overlay.includes("state.visionAvailable = false") && overlay.includes("status === 503"), "The scan does not fall back when assisted reading is unavailable.");

// Camera refusal is explained and never dead-ends the booking.
assert(overlay.includes("data-camera-blocked") && overlay.includes("NotAllowedError") && overlay.includes("Describe by voice instead"), "A declined camera leaves the Landlord stuck with no way to continue.");

/* ── Presentation ──────────────────────────────────── */
assert(styles.includes(".scan-overlay") && styles.includes(".scan-stage") && styles.includes(".det-box") && styles.includes("scanSweepRun") && styles.includes(".proc-log"), "The approved scan presentation is missing.");
assert(styles.includes("prefers-reduced-motion") && styles.includes("env(safe-area-inset-bottom)"), "The scan ignores reduced-motion or phone safe areas.");
assert(server.includes('"/landlord/scan": "room-scan.html"') && server.includes("camera=(self), microphone=(self)"), "The scan route is missing or cannot use the camera and microphone.");
assert(/requestPath === "\/brief" \|\| landlordDashboardPage \|\| roomScanPage \|\| journeyPage[\s\S]{0,120}\? "camera=\(self\), microphone=\(self\), geolocation=\(\)"/.test(server), "The embedded scanner is rendered on /landlord/book, but that real phone journey still blocks its own camera and microphone in Permissions-Policy.");

console.log("Room scan UI tests passed: embedded overlay with one implementation, real camera and speech, consent before any photograph leaves, camera released on every exit, safe detection overlay, honest duration and condition, no invented measurement and the approved presentation.");
