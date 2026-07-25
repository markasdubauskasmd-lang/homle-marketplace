import { containsSensitiveAccessDetails } from "./access-detail-safety.js";

// Recovery for the spoken and typed room notes taken during a scan, and nothing
// else. It exists because of an asymmetry in what a scan costs to redo: a
// photograph takes five seconds to retake, while walking a flat describing every
// room out loud does not, and losing that to a backgrounded tab or a stray tap is
// the expensive failure.
//
// What is deliberately NOT stored, and must stay that way:
//   * room photographs — pictures of the inside of someone's home
//   * detected objects, condition grades, checklist tasks
// Those live in memory for the life of the scan and are handed straight to the
// booking journey. Only the room's name and the note attached to it are kept, in
// `sessionStorage`, so the notes die with the tab rather than lingering on a shared
// device. Access details a Landlord may have spoken aloud — a key safe code, an
// alarm code, where a spare key is hidden — are stripped before anything is
// written, exactly as the request draft does.
const roomNoteDraftKey = "homleRoomNotesDraftV1";
const roomNoteDraftVersion = 1;

export const roomNoteDraftLifetimeMs = 30 * 60 * 1000;
export const maximumRoomNoteDrafts = 12;
export const maximumRoomNoteLength = 5000;
export const maximumRoomNameLength = 60;

// Anything that is not already a plain string is refused rather than converted.
// `String(value)` is how a photograph gets in: an array of task strings stringifies
// to task text, and an object with its own `toString` can hand over a data URL. The
// only shape that may be written is one this module recognises.
function plainText(value, limit) {
  if (typeof value !== "string") return "";
  const text = value.trim().slice(0, limit);
  // Belt and braces against an encoded image arriving as a genuine string.
  if (/^\s*(data|blob):/i.test(text) || /base64,/i.test(text)) return "";
  return text;
}

function cleanNotes(notes) {
  const cleaned = [];
  const seen = new Set();
  for (const entry of Array.isArray(notes) ? notes : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const room = plainText(entry.room, maximumRoomNameLength);
    const note = plainText(entry.note, maximumRoomNoteLength);
    if (!room || !note) continue;
    const key = room.toLowerCase();
    if (seen.has(key)) continue;
    // A spoken note that carries a code or a hiding place is not written down at
    // all. Dropping the note is the safe failure: it is re-recordable, a leaked
    // key location is not.
    if (containsSensitiveAccessDetails(note) || containsSensitiveAccessDetails(room)) continue;
    seen.add(key);
    cleaned.push({ room, note });
    if (cleaned.length >= maximumRoomNoteDrafts) break;
  }
  return cleaned;
}

export function saveRoomNotesDraft(storage, notes, now = Date.now()) {
  if (!storage?.setItem) return null;
  const safeNotes = cleanNotes(notes);
  if (!safeNotes.length) {
    storage.removeItem?.(roomNoteDraftKey);
    return null;
  }
  const savedAt = Number.isFinite(now) ? now : Date.now();
  const draft = { version: roomNoteDraftVersion, notes: safeNotes, savedAt, expiresAt: savedAt + roomNoteDraftLifetimeMs };
  try { storage.setItem(roomNoteDraftKey, JSON.stringify(draft)); } catch { return null; }
  return draft;
}

export function readRoomNotesDraft(storage, now = Date.now()) {
  if (!storage?.getItem) return null;
  try {
    const value = JSON.parse(storage.getItem(roomNoteDraftKey) || "null");
    const savedAt = Number(value?.savedAt);
    const expiresAt = Number(value?.expiresAt);
    const valid = value?.version === roomNoteDraftVersion
      && Number.isFinite(savedAt)
      && Number.isFinite(expiresAt)
      && expiresAt === savedAt + roomNoteDraftLifetimeMs
      // A clock that has moved backwards a long way, or a draft already past its
      // life, is discarded rather than trusted.
      && now >= savedAt - 5 * 60 * 1000
      && now < expiresAt;
    if (!valid) {
      storage.removeItem?.(roomNoteDraftKey);
      return null;
    }
    const notes = cleanNotes(value.notes);
    if (!notes.length) {
      storage.removeItem?.(roomNoteDraftKey);
      return null;
    }
    return { notes, savedAt, expiresAt };
  } catch {
    storage.removeItem?.(roomNoteDraftKey);
    return null;
  }
}

export function clearRoomNotesDraft(storage) {
  storage?.removeItem?.(roomNoteDraftKey);
}
