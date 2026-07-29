import { randomUUID } from "node:crypto";
import { uuid } from "./validation.mjs";
import {
  conditionReviewThreshold, isItemCondition, isRoomCondition, isSoilingKind, objectOrigins
} from "./room-condition-vocabulary.mjs";
import { assessCleaningComplexity } from "./cleaning-complexity.mjs";
import { measurementLabel, normalizedMeasurements } from "./room-measurement.mjs";

// Structured room scans: what the scanner actually saw, kept.
//
// Until this module existed the scan produced per-object conditions, soiling
// types, two confidence scores and evidence strings, and the browser threw all
// of it away at the moment of submission — only the generated task strings
// survived. See docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md, gap G1.
//
// Two rules govern everything below, and both are about not manufacturing
// certainty the scan never had:
//
//   1. An absent or unrecognised condition becomes no assessment, never a
//      grade. The vision reader already refuses to coerce 'unknown' into
//      'light'; a normaliser that quietly did so on the way to storage would
//      undo that at the last step, and the stored grade is what will later
//      influence a price.
//   2. Numbers are clamped, names and enums are rejected. A confidence of 1.4
//      is a malformed number with an obvious honest reading; a condition of
//      "filthy" is a claim about someone's home that has no safe substitute.
//
// This module records observations. It computes no price and no duration.

export const maximumScanRooms = 20;
export const maximumRoomObjects = 40;
export const maximumScanObjects = 200;
const deviceClasses = Object.freeze(["guided-web", "camera-fallback", "unknown"]);
const correctionFields = Object.freeze(["label", "condition", "quantity", "removed"]);

function boundedText(value, maximum, label, minimum = 0) {
  const normalized = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
  if (normalized.length < minimum || normalized.length > maximum) throw new TypeError(`${label} must contain ${minimum} to ${maximum} characters.`);
  return normalized;
}

// Absent, unparseable or out-of-range all resolve to a number inside 0..1,
// matching confidenceValue() on the device. A missing score reads as no
// confidence rather than as full confidence, so a payload that omits the field
// cannot silently assert certainty.
function confidence(value) {
  const supplied = Number(value);
  if (!Number.isFinite(supplied)) return 0;
  return Math.round(Math.max(0, Math.min(1, supplied)) * 1000) / 1000;
}

function quantity(value) {
  const supplied = Number(value);
  if (!Number.isInteger(supplied)) return 1;
  return Math.max(1, Math.min(20, supplied));
}

function instant(value, label) {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${label} must be a valid timestamp.`);
  return parsed.toISOString();
}

function soiling(value) {
  const supplied = Array.isArray(value) ? value : [];
  const kept = [];
  for (const entry of supplied) {
    const kind = String(entry || "").toLowerCase().trim();
    if (isSoilingKind(kind) && !kept.includes(kind)) kept.push(kind);
  }
  return kept.slice(0, 4);
}

// '' and 'unknown' both mean the photograph could not support a judgement, and
// so does any value the reader was never allowed to produce. All three become
// absence, because there is no honest grade to fall back to.
function itemCondition(value) {
  const supplied = String(value || "").toLowerCase().trim();
  return isItemCondition(supplied) ? supplied : "";
}

function roomCondition(value) {
  const supplied = String(value || "").toLowerCase().trim();
  return isRoomCondition(supplied) ? supplied : "";
}

function scanObject(input, roomLabel, index) {
  const label = boundedText(input?.label, 40, `${roomLabel} object ${index + 1} name`, 1);
  // The identity the device tracked this object under, from before any rename.
  // Falling back to the label keeps a hand-marked item recordable; it is the
  // only case where the two are the same by construction.
  const inventoryKey = boundedText(input?.inventoryKey || label, 60, `${roomLabel} object ${index + 1} key`, 1).toLowerCase();
  const origin = String(input?.origin || "").toLowerCase().trim();
  return {
    inventoryKey,
    label,
    quantity: quantity(input?.quantity),
    condition: itemCondition(input?.condition),
    soiling: soiling(input?.soiling),
    confidenceLabel: confidence(input?.confidenceLabel ?? input?.confidence),
    confidenceCondition: confidence(input?.confidenceCondition),
    conditionConfirmed: input?.conditionConfirmed === true,
    evidence: boundedText(input?.evidence ?? input?.note, 200, `${roomLabel} object ${index + 1} evidence`),
    // An unrecognised origin resolves to the on-device detector rather than
    // rejecting the object. 'manual' and 'vision' are the two values a
    // correction rate is measured against, so neither may be assumed.
    origin: objectOrigins.includes(origin) ? origin : "detector"
  };
}

function scanRoom(input, index) {
  const roomName = boundedText(input?.roomName ?? input?.name, 120, `Room ${index + 1} name`, 1);
  const objects = Array.isArray(input?.objects) ? input.objects : [];
  if (objects.length > maximumRoomObjects) throw new TypeError(`${roomName} contains more than ${maximumRoomObjects} objects.`);
  return {
    roomName,
    condition: roomCondition(input?.condition),
    note: boundedText(input?.note ?? input?.transcript, 1000, `${roomName} note`),
    objects: objects.map((object, objectIndex) => scanObject(object, roomName, objectIndex))
  };
}

export function normalizedRoomScan(input = {}, options = {}) {
  const rooms = Array.isArray(input.rooms) ? input.rooms : [];
  if (!rooms.length || rooms.length > maximumScanRooms) throw new TypeError(`A room scan must contain 1 to ${maximumScanRooms} rooms.`);
  const normalizedRooms = rooms.map(scanRoom);
  const totalObjects = normalizedRooms.reduce((total, room) => total + room.objects.length, 0);
  if (totalObjects > maximumScanObjects) throw new TypeError(`A room scan may carry at most ${maximumScanObjects} objects.`);
  const deviceClass = String(input.deviceClass || "").trim();
  return {
    // Supplied by the client so a retried save is absorbed rather than
    // duplicated, and generated here when absent so a caller that forgets one
    // still cannot create two scans by pressing save twice.
    sessionId: uuid(input.sessionId || randomUUID(), "scan session id"),
    cleaningRequestId: uuid(input.cleaningRequestId, "cleaning request id"),
    deviceClass: deviceClasses.includes(deviceClass) ? deviceClass : "unknown",
    capturedAt: instant(input.capturedAt ?? options.clock?.() ?? new Date(), "Scan capture time"),
    rooms: normalizedRooms
  };
}

// Attribution comes from the server's own configuration, never from the request
// body. A client able to name the model that read its scan could write an
// arbitrary claim into the audit trail, and the audit trail exists precisely to
// be trusted when a quote is disputed.
function modelAttribution(vision) {
  if (!vision?.provider || !vision.models?.confirmation) return null;
  return {
    purpose: "confirmation",
    provider: String(vision.provider).slice(0, 40),
    modelId: String(vision.models.confirmation).slice(0, 80),
    schemaVersion: Number.isInteger(vision.schemaVersion) ? vision.schemaVersion : 1
  };
}

function objectProjection(record) {
  const conditionValue = itemCondition(record?.condition);
  const confidenceCondition = confidence(record?.confidenceCondition);
  const confirmed = record?.conditionConfirmed === true;
  return Object.freeze({
    objectId: record?.objectId,
    inventoryKey: record?.inventoryKey || "",
    label: record?.label || "",
    quantity: quantity(record?.quantity),
    condition: conditionValue,
    soiling: Object.freeze(soiling(record?.soiling)),
    confidenceLabel: confidence(record?.confidenceLabel),
    confidenceCondition,
    conditionConfirmed: confirmed,
    evidence: String(record?.evidence || ""),
    origin: record?.origin || "detector",
    // Surfaced rather than hidden. An uncertain grade the customer can see and
    // correct is useful; the same grade presented as a finding is what changes
    // what someone is charged on evidence nobody checked. A grade the customer
    // has already confirmed needs no second look.
    needsConfirmation: !confirmed && (!conditionValue || confidenceCondition < conditionReviewThreshold)
  });
}

// A measurement always travels with how it was arrived at and how far out it
// could be. There is no shape in which one leaves this module as a bare number.
function measurementProjection(record) {
  const projected = {
    measurementId: record?.measurementId,
    subject: String(record?.subject || ""),
    method: String(record?.method || ""),
    valueMm: Number(record?.valueMm) || 0,
    toleranceMm: Number(record?.toleranceMm) || 0,
    confidence: String(record?.confidence || "low"),
    reference: String(record?.reference || ""),
    // Both figures survive a correction, for the same reason object
    // corrections keep theirs: the first is the label, the second is the truth
    // the customer asserted.
    originalValueMm: record?.originalValueMm == null ? null : Number(record.originalValueMm)
  };
  return Object.freeze({
    ...projected,
    relativeTolerance: projected.valueMm ? Math.round((projected.toleranceMm / projected.valueMm) * 10000) / 10000 : 0,
    // Only a person's own figure about their own home is settled. Everything
    // else stays an estimate however tight the arithmetic came out.
    estimated: projected.method !== "user-confirmed",
    label: measurementLabel({ ...projected, referenceLabel: projected.reference.replace(/-/g, " "), relativeTolerance: projected.valueMm ? projected.toleranceMm / projected.valueMm : 0 })
  });
}

function roomProjection(record) {
  const objects = (Array.isArray(record?.objects) ? record.objects : []).map(objectProjection);
  const measurements = (Array.isArray(record?.measurements) ? record.measurements : []).map(measurementProjection);
  return Object.freeze({
    roomScanId: record?.roomScanId,
    roomName: record?.roomName || "",
    condition: roomCondition(record?.condition),
    note: String(record?.note || ""),
    measurements: Object.freeze(measurements),
    objects: Object.freeze(objects),
    objectCount: objects.reduce((total, object) => total + object.quantity, 0),
    unresolvedCount: objects.filter((object) => object.needsConfirmation).length
  });
}

export function scanProjection(record) {
  const rooms = (Array.isArray(record?.rooms) ? record.rooms : []).map(roomProjection);
  const session = record?.session;
  return Object.freeze({
    cleaningRequestId: record?.cleaningRequestId ?? null,
    session: session ? Object.freeze({
      sessionId: session.sessionId,
      deviceClass: session.deviceClass,
      capturedAt: session.capturedAt ? new Date(session.capturedAt).toISOString() : null,
      createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : null,
      model: session.model ? Object.freeze({ ...session.model }) : null
    }) : null,
    rooms: Object.freeze(rooms),
    roomCount: rooms.length,
    objectCount: rooms.reduce((total, room) => total + room.objectCount, 0),
    // How much of this scan is still asking a question. The booking journey
    // shows it rather than burying it, because the alternative is a confident
    // summary built on readings the scan itself was unsure about.
    unresolvedCount: rooms.reduce((total, room) => total + room.unresolvedCount, 0),
    // Derived on read, never stored. The observations are the record; this is a
    // reading of them. Keeping it derived means a weight change re-scores every
    // historical scan and can be evaluated against them, which is impossible
    // once a score has been frozen into a row.
    complexity: assessCleaningComplexity({ rooms })
  });
}

function normalizedCorrection(input = {}) {
  const field = String(input.field || "").toLowerCase().trim();
  if (!correctionFields.includes(field)) throw new TypeError("Choose a supported room-scan correction.");
  if (field === "removed") return { field, value: null, trainingConsent: input.trainingConsent === true };
  if (field === "label") return { field, value: boundedText(input.value, 40, "Corrected object name", 1), trainingConsent: input.trainingConsent === true };
  if (field === "quantity") {
    const supplied = Number(input.value);
    if (!Number.isInteger(supplied) || supplied < 1 || supplied > 20) throw new TypeError("An object quantity must be between 1 and 20.");
    return { field, value: String(supplied), trainingConsent: input.trainingConsent === true };
  }
  const condition = String(input.value || "").toLowerCase().trim();
  // An empty condition is a real correction: it is the customer saying they
  // cannot tell either, which is more honest than the grade that was there.
  if (condition && !isItemCondition(condition)) throw new TypeError("Choose a supported cleaning condition.");
  return { field, value: condition, trainingConsent: input.trainingConsent === true };
}

export function createScanService(repository, options = {}) {
  if (!repository || typeof repository.recordScan !== "function" || typeof repository.getScan !== "function"
    || typeof repository.correctObject !== "function" || typeof repository.deleteScan !== "function"
    || typeof repository.recordMeasurements !== "function") {
    throw new TypeError("A complete room-scan repository is required.");
  }
  const vision = options.vision || null;
  return Object.freeze({
    async recordOwnScan(actor, input = {}) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to save a room scan.");
      const scan = normalizedRoomScan(input, options);
      return scanProjection(await repository.recordScan(actor, { ...scan, model: modelAttribution(vision) }));
    },
    async getScan(actor, cleaningRequestId) {
      if (!actor?.userId) throw new TypeError("Sign in to view this room scan.");
      return scanProjection(await repository.getScan(actor, uuid(cleaningRequestId, "cleaning request id")));
    },
    async correctOwnObject(actor, objectId, input = {}) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to correct a room scan.");
      const correction = await repository.correctObject(actor, uuid(objectId, "scan object id"), normalizedCorrection(input));
      if (correction?.removed === true) return Object.freeze({ objectId: correction.objectId, removed: true });
      return Object.freeze({ ...objectProjection(correction), removed: false });
    },
    async recordOwnMeasurements(actor, roomScanId, input = {}) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to save room measurements.");
      // Normalised before it reaches the database, which then applies the same
      // rules again. Both layers refuse a bare number on purpose: a measurement
      // whose provenance is unknown sits in the same column as the others and
      // looks exactly like them.
      const measurements = normalizedMeasurements(input.measurements);
      if (!measurements.length) throw new TypeError("A measurement needs a supported subject, a method and a tolerance.");
      const stored = await repository.recordMeasurements(actor, uuid(roomScanId, "room scan id"), measurements);
      return Object.freeze({ measurements: Object.freeze((Array.isArray(stored) ? stored : []).map(measurementProjection)) });
    },
    async deleteOwnScan(actor, cleaningRequestId) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to delete a room scan.");
      return Object.freeze({ deleted: await repository.deleteScan(actor, uuid(cleaningRequestId, "cleaning request id")) === true });
    }
  });
}
