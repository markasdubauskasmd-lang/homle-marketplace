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

const [page, script, styles, server] = await Promise.all([
  readFile(new URL("../public/room-scan.html", import.meta.url), "utf8"),
  readFile(new URL("../public/room-scan.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);

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
assert(usableDetections(Array.from({ length: 20 }, () => ({ x: 1, y: 1, width: 5, height: 5, label: "Shelf" }))).length === 8, "The detection overlay is not bounded.");

// Time comes from the tasks actually scoped. A room that could not be read
// contributes nothing rather than an invented figure.
assert(estimatedMinutes([]) === 0 && estimatedMinutes([{ tasks: [] }]) === 0, "An unscoped scan produced a duration out of nothing.");
assert(estimatedMinutes([{ tasks: ["a", "b"] }]) >= 60, "A scoped job was estimated below the minimum visit length.");
// A photograph cannot say how long a task takes. Showing one confident figure
// derived from a task count would be the same invented precision as a floor area.
assert(durationLabel(0) === "Not scoped yet", "An unscoped scan was given a duration.");
assert(durationLabel(195).includes("–"), `A guide time was presented as a single confident figure: ${durationLabel(195)}`);

// The heaviest room decides the visit, and an unread room never inflates it.
assert(overallCondition([{ condition: "light" }, { condition: "heavy" }]) === "heavy", "A heavy room was not reflected in the overall condition.");
assert(overallCondition([{ condition: "" }]) === "" && conditionLabel("") === "Not assessed", "An unassessed scan claimed a condition.");
assert(conditionLabel("medium") === "Medium", "Condition labels are not readable.");

// The scan feeds the same checklist shape as the spoken and typed paths.
const lines = scanChecklistLines([{ name: "Kitchen", tasks: ["Degrease the worktops", "Degrease the worktops", "Mop the floor"] }, { name: "", tasks: ["Dust the shelves"] }]);
assert(lines.includes("Kitchen: Degrease the worktops") && lines.includes("Kitchen: Mop the floor") && lines.includes("Dust the shelves"), "The scan checklist lost a task or its room.");
assert(lines.length === 3, "The scan checklist was not de-duplicated.");

const summary = scanSummary([{ name: "Kitchen", tasks: ["Degrease the worktops"], detections: [{ label: "Worktop" }], condition: "heavy" }]);
assert(summary.roomCount === 1 && summary.fixtureCount === 1 && summary.conditionLabel === "Heavy" && summary.tasks.length === 1, `The scan summary is wrong: ${JSON.stringify(summary)}`);

// The prototype's camera and voice were simulated. These must be real.
assert(script.includes("navigator.mediaDevices.getUserMedia") && script.includes('facingMode: { ideal: "environment" }'), "The scan does not open a real rear camera.");
assert(script.includes("window.SpeechRecognition || window.webkitSpeechRecognition"), "The scan does not use real speech recognition.");
assert(!script.includes("const NOTE =") && !script.includes("DETECTIONS["), "The scan carries a scripted transcript or hardcoded detections instead of reading the room.");

// A phone browser cannot measure a room. Claiming a floor area would misprice
// the job on a number nobody measured.
assert(!page.includes("Floor area") && !/\bm²/.test(page) && !/\bm²/.test(script), "The scan claims a floor-area measurement a phone cannot take.");

// Camera refusal must be explained and must not dead-end the booking.
assert(page.includes("data-camera-blocked") && script.includes("NotAllowedError") && page.includes("Describe by voice instead"), "A declined camera leaves the Landlord stuck with no way to continue.");
assert(script.includes("stopCamera") && script.includes('addEventListener("pagehide"'), "The camera stream is not released when the scan is left.");

// Assisted reading is optional; the scan must survive it being absent or slow.
assert(script.includes("state.visionAvailable = false") && script.includes("status === 503"), "The scan does not fall back when assisted reading is unavailable.");
assert(script.includes("Captured — no fixtures read automatically"), "A room read without detections is not shown honestly.");

// Nothing is booked from the scan itself, and its result must actually arrive.
assert(page.includes("Nothing is booked yet") && script.includes("homle_scan_result"), "The scan either implies a booking or fails to carry its result forward.");
const dashboard = await readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");
assert(dashboard.includes("homle_scan_result") && dashboard.includes("adoptRoomScan"), "The dashboard never reads the scan result, so finishing a scan delivers nothing.");

// A photograph of the inside of a home must not be sent to a third party
// without the Landlord being asked first, in plain words.
assert(page.includes("data-consent") && page.includes("sent to our AI provider"), "The scan sends photographs of a home without telling the Landlord who receives them.");
assert(script.includes("if (!state.consentAsked) await askConsent();") && script.includes("if (!state.readingAllowed"), "A photograph can leave the device before consent has been given.");
assert(page.includes("just take the photos"), "Declining assisted reading is not offered as a working option.");

// Boxes must surround what they describe, not whatever the camera now sees.
assert(page.includes("data-still") && script.includes("el.still.src = frame"), "Detections are drawn over the live camera instead of the frame they describe.");

// A reading that returns after the scan was reset belongs to a scan that no
// longer exists.
assert(script.includes("generation !== state.generation"), "A stale room reading can attach itself to a different scan.");

// The camera must not stay live once the scan is read.
assert(/stopCamera\(\);\s*\n\s*showResults/.test(script), "The camera is left running behind the results screen.");

// The look and motion the prototype established.
assert(styles.includes(".scan-stage") && styles.includes(".det-box") && styles.includes("scanSweepRun") && styles.includes("scanMeshPulse") && styles.includes(".shutter") && styles.includes(".proc-log"), "The approved scan presentation is missing.");
assert(styles.includes("prefers-reduced-motion") && styles.includes("env(safe-area-inset-bottom)"), "The scan ignores reduced-motion or phone safe areas.");

// Route, camera permission and private-media policy.
assert(server.includes('"/landlord/scan": "room-scan.html"') && server.includes("roomScanPage"), "The scan page is not served.");
assert(server.includes("camera=(self), microphone=(self)"), "The scan page cannot use the camera or microphone.");

console.log("Room scan UI tests passed: guided but unbounded walkthrough, real camera and speech, safe detection overlay, honest duration and condition, no invented measurement, camera-refusal recovery, optional assisted reading and the approved scan presentation.");
