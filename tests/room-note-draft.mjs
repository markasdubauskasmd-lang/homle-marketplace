import { readFile } from "node:fs/promises";
import {
  clearRoomNotesDraft,
  maximumRoomNoteDrafts,
  readRoomNotesDraft,
  roomNoteDraftLifetimeMs,
  saveRoomNotesDraft
} from "../public/room-note-draft.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    setItem: (key, value) => map.set(key, String(value)),
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    removeItem: (key) => map.delete(key),
    get size() { return map.size; },
    dump: () => [...map.values()].join("")
  };
}

const now = Date.parse("2026-07-25T12:00:00.000Z");
const notes = [{ room: "Kitchen", note: "Grease on the worktop and the hob" }, { room: "Bathroom", note: "Limescale on the shower screen" }];

/* ── A walkthrough survives the tab being backgrounded ── */
const storage = fakeStorage();
const saved = saveRoomNotesDraft(storage, notes, now);
assert(saved?.notes.length === 2 && saved.expiresAt === now + roomNoteDraftLifetimeMs, `The room notes were not saved with an expiry: ${JSON.stringify(saved)}`);
const read = readRoomNotesDraft(storage, now + 60_000);
assert(read?.notes[0].room === "Kitchen" && read.notes[0].note.includes("Grease"), `A saved walkthrough did not come back: ${JSON.stringify(read)}`);

/* ── It expires, and a wound-back clock is not trusted ── */
assert(readRoomNotesDraft(storage, now + roomNoteDraftLifetimeMs + 1) === null, "An expired walkthrough was still offered.");
const stillThere = fakeStorage();
saveRoomNotesDraft(stillThere, notes, now);
assert(readRoomNotesDraft(stillThere, now - 10 * 60 * 1000) === null, "A draft from a clock that moved backwards was trusted.");
// Reading an expired or invalid draft clears it rather than leaving it to rot.
assert(stillThere.size === 0, "An invalid draft was left in storage.");

/* ── Nothing but the room and its note is ever written ── */
// This is the whole privacy position of the feature: a photograph of the inside of
// someone's home, and what was detected in it, must never reach browser storage.
const leaky = fakeStorage();
saveRoomNotesDraft(leaky, [{
  room: "Kitchen",
  note: "Wipe the worktop",
  image: "data:image/jpeg;base64,AAAABBBBCCCC",
  detections: [{ label: "Sofa", x: 1, y: 2 }],
  condition: "heavy",
  tasks: ["Kitchen: wipe"]
}], now);
const written = leaky.dump();
for (const forbidden of ["data:image", "base64", "AAAABBBB", "Sofa", "detections", "heavy", "condition", "tasks", "Kitchen: wipe"]) {
  assert(!written.includes(forbidden), `"${forbidden}" reached browser storage: ${written}`);
}
// The raw serialized shape is asserted, not just what comes back out. A read that
// sanitises would hide a write that had already stored too much.
const raw = JSON.parse(written);
assert(Object.keys(raw).sort().join(",") === "expiresAt,notes,savedAt,version", `The stored draft carries unexpected top-level fields: ${Object.keys(raw)}`);
assert(raw.notes.every((entry) => Object.keys(entry).sort().join(",") === "note,room"), `A stored note carries more than the room and its note: ${JSON.stringify(raw.notes)}`);

// Non-string shapes are refused, not coerced. `String(["a","b"])` would persist task
// text, and an object with its own toString could hand over a data URL.
const coerced = fakeStorage();
saveRoomNotesDraft(coerced, [
  { room: "Kitchen", note: ["Clean the oven", "Wipe the hob"] },
  { room: "Lounge", note: { toString: () => "data:image/jpeg;base64,SECRET" } },
  { room: ["Bath"], note: "Descale" },
  { room: "Hall", note: "data:image/jpeg;base64,SECRET2" },
  { room: "Study", note: 42 }
], now);
const coercedDump = coerced.dump();
for (const forbidden of ["Clean the oven", "Wipe the hob", "SECRET", "SECRET2", "42", "data:image"]) {
  assert(!coercedDump.includes(forbidden), `A non-string note was coerced into storage ("${forbidden}"): ${coercedDump}`);
}
assert(coerced.size === 0, `Only unusable shapes were supplied, yet something was stored: ${coercedDump}`);

/* ── Spoken access details are never written down ── */
// A Landlord talking through a flat may say where a spare key is. That is the one
// thing worth losing: the note can be re-recorded, a leaked key location cannot.
const spoken = fakeStorage();
saveRoomNotesDraft(spoken, [
  { room: "Hall", note: "The key safe code is 4821, let yourself in" },
  { room: "Kitchen", note: "Descale the kettle" }
], now);
const afterStripping = readRoomNotesDraft(spoken, now);
assert(afterStripping.notes.length === 1 && afterStripping.notes[0].room === "Kitchen", `An access code was written to storage: ${JSON.stringify(afterStripping.notes)}`);
assert(!spoken.dump().includes("4821"), "A key safe code reached browser storage.");

/* ── Bounded, deduplicated, and empty means absent ── */
const many = fakeStorage();
saveRoomNotesDraft(many, Array.from({ length: 40 }, (_, index) => ({ room: `Room ${index}`, note: `Note ${index}` })), now);
assert(readRoomNotesDraft(many, now).notes.length === maximumRoomNoteDrafts, "The recovery draft is unbounded.");
const duplicated = fakeStorage();
saveRoomNotesDraft(duplicated, [{ room: "Kitchen", note: "First" }, { room: "kitchen", note: "Second" }], now);
assert(readRoomNotesDraft(duplicated, now).notes.length === 1, "The same room was stored twice under different casing.");
const blank = fakeStorage();
assert(saveRoomNotesDraft(blank, [{ room: "Kitchen", note: "   " }], now) === null && blank.size === 0, "An empty walkthrough was still written to storage.");
assert(saveRoomNotesDraft(blank, [], now) === null, "An empty list was written to storage.");
assert(saveRoomNotesDraft(null, notes, now) === null && readRoomNotesDraft(null) === null, "A missing storage was not handled.");

/* ── Corrupt or tampered storage fails closed ── */
const corrupt = fakeStorage({ homleRoomNotesDraftV1: "{not json" });
assert(readRoomNotesDraft(corrupt, now) === null && corrupt.size === 0, "Corrupt storage was not discarded.");
const tampered = fakeStorage({ homleRoomNotesDraftV1: JSON.stringify({ version: 1, notes, savedAt: now, expiresAt: now + 999 }) });
assert(readRoomNotesDraft(tampered, now) === null, "A draft with a stretched expiry was trusted.");
const wrongVersion = fakeStorage({ homleRoomNotesDraftV1: JSON.stringify({ version: 99, notes, savedAt: now, expiresAt: now + roomNoteDraftLifetimeMs }) });
assert(readRoomNotesDraft(wrongVersion, now) === null, "A draft from an unknown version was trusted.");

/* ── Discarding really discards ── */
const discarded = fakeStorage();
saveRoomNotesDraft(discarded, notes, now);
clearRoomNotesDraft(discarded);
assert(discarded.size === 0 && readRoomNotesDraft(discarded, now) === null, "Discarding a scan left its notes recoverable.");

/* ── The overlay only ever persists through this module ── */
const [overlay, legacyEntry, journey, dashboard] = await Promise.all([
  readFile(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8"),
  readFile(new URL("../public/room-scan.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-journey.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8")
]);
// Sharpened from a blanket ban when the spoken-guidance preference arrived:
// what must not outlive the tab is scan CONTENT. A named on/off setting may
// live in localStorage; notes, photos and rosters may not — room-scan-ui.mjs
// holds the matching allowlist assertion on the write sites themselves.
{
  const localStorageUses = [...overlay.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(([^)]*)\)/g)].map((match) => match[1]);
  assert(localStorageUses.length > 0 === overlay.includes("spokenGuidancePreferenceKey")
    && localStorageUses.every((args) => args.includes("spokenGuidancePreferenceKey")),
    `The scan overlay reaches for localStorage beyond the named guidance preference: ${localStorageUses.join(" | ")}`);
}
// The overlay stores exactly one thing itself — the CSRF token — and everything
// about the scan goes through the guarded module above. Any other direct write is
// how a photograph or a roster would quietly end up in storage.
const directWrites = [...overlay.matchAll(/sessionStorage\.setItem\(([^)]*)\)/g)].map((match) => match[1]);
assert(directWrites.every((argument) => /csrf/i.test(argument)), `The scan overlay writes scan data to sessionStorage directly instead of through the guarded room-note draft: ${JSON.stringify(directWrites)}`);
assert(!/JSON\.stringify\(state\.rooms/.test(overlay) && !/setItem\([^)]*(photos|frozenFrame|state\.rooms)/.test(overlay), "The scan overlay serialises room photographs or its roster into storage.");
assert(overlay.includes("saveRoomNotesDraft") && overlay.includes("forgetRoomNotes()") && overlay.includes("restoreRoomNotes()"), "The scan overlay does not save, restore or clear its room notes.");

assert(
  legacyEntry.includes('location.replace("/landlord/book")')
    && !legacyEntry.includes("openRoomScan")
    && !legacyEntry.includes("sessionStorage")
    && !legacyEntry.includes("JSON.stringify"),
  "The legacy scanner entry can still open outside the protected booking journey or serialize its result into browser storage."
);
for (const [name, reader] of [["guided journey", journey], ["Landlord dashboard", dashboard]]) {
  assert(
    reader.includes('sessionStorage.removeItem("homle_scan_result")')
      && reader.includes("Array.isArray(scan?.photos) && scan.photos.length"),
    `The ${name} does not purge and refuse a legacy photo-bearing scanner handoff.`
  );
}

console.log("Room note recovery tests passed: an unfinished walkthrough survives a backgrounded tab, expires, and fails closed — while no scanner entry or recovery handoff writes or accepts private photographs in browser storage.");
