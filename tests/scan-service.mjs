import {
  createScanService, maximumRoomObjects, maximumScanObjects, maximumScanRooms,
  normalizedRoomScan, scanProjection
} from "../src/marketplace/scan-service.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(run, fragment) {
  try { await run(); } catch (error) { return String(error?.message || "").includes(fragment); }
  return false;
}
function throwsWith(run, fragment) {
  try { run(); } catch (error) { return String(error?.message || "").includes(fragment); }
  return false;
}

const requestId = "30000000-0000-4000-8000-000000000001";
const sessionId = "3b000000-0000-4000-8000-000000000001";
const landlord = { userId: "10000000-0000-4000-8000-000000000001", roles: ["landlord"] };
const cleaner = { userId: "10000000-0000-4000-8000-000000000002", roles: ["cleaner"] };

function object(overrides = {}) {
  return {
    inventoryKey: "hob", label: "Hob", quantity: 1, condition: "heavy", soiling: ["grease"],
    confidenceLabel: 0.91, confidenceCondition: 0.83, conditionConfirmed: false,
    evidence: "dark glossy streaks around the burners", origin: "vision", ...overrides
  };
}
function scan(overrides = {}) {
  return {
    sessionId, cleaningRequestId: requestId, deviceClass: "guided-web",
    capturedAt: "2026-07-29T10:00:00.000Z",
    rooms: [{ roomName: "Kitchen", condition: "medium", note: "Focus near the window.", objects: [object()] }],
    ...overrides
  };
}

/* ── Normalisation keeps the reading; it does not invent one ───────────── */

{
  const normalized = normalizedRoomScan(scan());
  assert(normalized.rooms.length === 1, "A valid scan lost its room.");
  const [item] = normalized.rooms[0].objects;
  assert(item.condition === "heavy" && item.soiling[0] === "grease", "Per-object condition or soiling was lost in normalisation.");
  assert(item.evidence === "dark glossy streaks around the burners", "The evidence supporting a grade was dropped.");
  assert(item.confidenceLabel === 0.91 && item.confidenceCondition === 0.83,
    "Label and condition confidence were not preserved independently.");
}

// The whole reason two scores exist: an object can be confidently named and
// honestly ungraded at the same time. Collapsing them is what makes an
// uncertain grade look like a confident one.
{
  const normalized = normalizedRoomScan(scan({
    rooms: [{ roomName: "Bathroom", objects: [object({ condition: "unknown", confidenceLabel: 0.95, confidenceCondition: 0 })] }]
  }));
  const [item] = normalized.rooms[0].objects;
  assert(item.condition === "", "An unknown object condition was coerced into a grade.");
  assert(item.confidenceLabel === 0.95, "A confident label was discarded alongside an unknown condition.");
}

// 'clean' is a real answer — most of a well-kept home is clean — and must not be
// treated as a missing one.
{
  const normalized = normalizedRoomScan(scan({ rooms: [{ roomName: "Kitchen", objects: [object({ condition: "clean", soiling: [] })] }] }));
  assert(normalized.rooms[0].objects[0].condition === "clean", "A genuinely clean object was recorded as unassessed.");
}

// A grade the reader was never allowed to produce has no honest substitute, so
// it becomes absence rather than the nearest-looking value.
{
  const normalized = normalizedRoomScan(scan({ rooms: [{ roomName: "Kitchen", condition: "filthy", objects: [object({ condition: "disgusting" })] }] }));
  assert(normalized.rooms[0].condition === "", "An invented room condition was accepted as a grade.");
  assert(normalized.rooms[0].objects[0].condition === "", "An invented object condition was accepted as a grade.");
}

// A room-level 'clean' is deliberately not in the room scale: a room's grade is
// the weight of what was found across it.
{
  const normalized = normalizedRoomScan(scan({ rooms: [{ roomName: "Kitchen", condition: "clean", objects: [] }] }));
  assert(normalized.rooms[0].condition === "", "'clean' was accepted as a whole-room grade.");
}

// Numbers are clamped, because a float that serialises badly must not discard a
// good scan. An omitted score reads as no confidence, never as full confidence.
{
  const normalized = normalizedRoomScan(scan({
    rooms: [{ roomName: "Kitchen", objects: [object({ confidenceLabel: 1.4, confidenceCondition: -3, quantity: 500 })] }]
  }));
  const [item] = normalized.rooms[0].objects;
  assert(item.confidenceLabel === 1 && item.confidenceCondition === 0, "Out-of-range confidence was not clamped.");
  assert(item.quantity === 20, "An out-of-range quantity was not clamped.");
}
{
  const normalized = normalizedRoomScan(scan({ rooms: [{ roomName: "Kitchen", objects: [{ label: "Sink", origin: "vision" }] }] }));
  const [item] = normalized.rooms[0].objects;
  assert(item.confidenceLabel === 0 && item.confidenceCondition === 0, "An omitted confidence was treated as certainty.");
  assert(item.quantity === 1, "An omitted quantity did not default to one.");
  assert(item.inventoryKey === "sink", "A hand-marked object with no key could not be recorded.");
}

// Soiling outside the shared taxonomy is dropped rather than stored, because a
// kind nothing downstream can group is the problem the enumeration solved.
{
  const normalized = normalizedRoomScan(scan({
    rooms: [{ roomName: "Bathroom", objects: [object({ soiling: ["limescale", "lime scale", "calcium", "mould", "limescale"] })] }]
  }));
  assert(JSON.stringify(normalized.rooms[0].objects[0].soiling) === JSON.stringify(["limescale", "mould"]),
    "Unrecognised or duplicate soiling kinds were not filtered.");
}

// An unrecognised origin resolves to the on-device detector rather than to
// 'manual', which a correction rate is measured against.
{
  const normalized = normalizedRoomScan(scan({ rooms: [{ roomName: "Kitchen", objects: [object({ origin: "invented" })] }] }));
  assert(normalized.rooms[0].objects[0].origin === "detector", "An unrecognised object origin was not treated as a detection.");
}

// A client cannot select an unreviewed device class.
{
  assert(normalizedRoomScan(scan({ deviceClass: "lidar" })).deviceClass === "unknown", "An unsupported device class was accepted.");
  assert(normalizedRoomScan(scan({ deviceClass: "camera-fallback" })).deviceClass === "camera-fallback", "A supported device class was rejected.");
}

/* ── Bounds ────────────────────────────────────────────────────────────── */

assert(throwsWith(() => normalizedRoomScan(scan({ rooms: [] })), "1 to 20 rooms"), "An empty scan was accepted.");
assert(throwsWith(() => normalizedRoomScan(scan({
  rooms: Array.from({ length: maximumScanRooms + 1 }, (unused, index) => ({ roomName: `Room ${index}`, objects: [] }))
})), "1 to 20 rooms"), "A scan beyond the room limit was accepted.");
assert(throwsWith(() => normalizedRoomScan(scan({
  rooms: [{ roomName: "Kitchen", objects: Array.from({ length: maximumRoomObjects + 1 }, () => object()) }]
})), "more than 40 objects"), "A room beyond the object limit was accepted.");
assert(throwsWith(() => normalizedRoomScan(scan({
  rooms: Array.from({ length: 6 }, (unused, index) => ({ roomName: `Room ${index}`, objects: Array.from({ length: 40 }, () => object()) }))
})), `at most ${maximumScanObjects} objects`), "A scan beyond the total object limit was accepted.");
assert(throwsWith(() => normalizedRoomScan(scan({ rooms: [{ roomName: "", objects: [] }] })), "Room 1 name"), "A nameless room was accepted.");
assert(throwsWith(() => normalizedRoomScan(scan({ cleaningRequestId: "not-a-uuid" })), "cleaning request id"), "A malformed request id was accepted.");
assert(throwsWith(() => normalizedRoomScan(scan({ capturedAt: "the other day" })), "valid timestamp"), "A malformed capture time was accepted.");

// A missing session id is generated rather than rejected, so a caller that
// forgets one still cannot create two scans by pressing save twice.
{
  const first = normalizedRoomScan(scan({ sessionId: undefined }));
  assert(/^[0-9a-f-]{36}$/.test(first.sessionId), "A missing session id was not replaced with a usable one.");
}

/* ── Projection surfaces uncertainty instead of hiding it ──────────────── */

{
  const projected = scanProjection({
    cleaningRequestId: requestId,
    session: { sessionId, deviceClass: "guided-web", capturedAt: "2026-07-29T10:00:00.000Z", createdAt: "2026-07-29T10:00:01.000Z", model: { provider: "anthropic", modelId: "claude-haiku-4-5" } },
    rooms: [{
      roomScanId: "3c000000-0000-4000-8000-000000000001", roomName: "Kitchen", condition: "medium", note: "",
      objects: [
        { objectId: "1", label: "Hob", quantity: 1, condition: "heavy", soiling: ["grease"], confidenceLabel: 0.9, confidenceCondition: 0.8, conditionConfirmed: false, origin: "vision" },
        { objectId: "2", label: "Window", quantity: 2, condition: "", soiling: [], confidenceLabel: 0.8, confidenceCondition: 0, conditionConfirmed: false, origin: "detector" },
        { objectId: "3", label: "Tap", quantity: 1, condition: "light", soiling: [], confidenceLabel: 0.8, confidenceCondition: 0.2, conditionConfirmed: false, origin: "vision" },
        { objectId: "4", label: "Sink", quantity: 1, condition: "medium", soiling: [], confidenceLabel: 0.8, confidenceCondition: 0.1, conditionConfirmed: true, origin: "manual" }
      ]
    }]
  });

  assert(projected.roomCount === 1, "The projection lost a room.");
  // Quantity, not row count: "3 × Chair" is three things to clean.
  assert(projected.objectCount === 5, "The projection counted rows rather than objects.");
  assert(projected.session.model.modelId === "claude-haiku-4-5", "The projection dropped model attribution.");

  const [hob, window, tap, sink] = projected.rooms[0].objects;
  assert(hob.needsConfirmation === false, "A confidently graded object was flagged for confirmation.");
  assert(window.needsConfirmation === true, "An ungraded object was presented as a finding.");
  assert(tap.needsConfirmation === true, "A grade below the review threshold was presented as a finding.");
  // The customer has already looked at this one and said so; asking again is
  // noise, not honesty.
  assert(sink.needsConfirmation === false, "An object the customer confirmed was flagged for confirmation anyway.");
  assert(projected.rooms[0].unresolvedCount === 2 && projected.unresolvedCount === 2,
    "The projection did not report how much of the scan is still asking a question.");
}

// An absent scan is a valid, empty answer rather than an error.
{
  const projected = scanProjection({ cleaningRequestId: requestId, session: null, rooms: [] });
  assert(projected.session === null && projected.roomCount === 0 && projected.objectCount === 0,
    "A request with no scan did not project as empty.");
}

/* ── Service: roles, attribution and correction ────────────────────────── */

function repositoryStub(capture = {}) {
  return {
    async recordScan(actor, value) { capture.recorded = value; return { cleaningRequestId: requestId, session: null, rooms: [] }; },
    async getScan(actor, id) { capture.read = id; return { cleaningRequestId: requestId, session: null, rooms: [] }; },
    async correctObject(actor, objectId, correction) { capture.correction = { objectId, correction }; return { objectId, label: "Kitchen worktop", quantity: 1, condition: "light", conditionConfirmed: true, confidenceLabel: 1, confidenceCondition: 1, removed: false }; },
    async deleteScan(actor, id) { capture.deleted = id; return true; },
    async recordMeasurements(actor, roomScanId, measurements) { capture.measurements = { roomScanId, measurements }; return measurements.map((entry, index) => ({ ...entry, measurementId: `m${index}` })); }
  };
}

assert(throwsWith(() => createScanService(null), "complete room-scan repository"), "An incomplete repository was accepted.");

{
  const capture = {};
  const service = createScanService(repositoryStub(capture), {
    vision: { provider: "anthropic", models: { walking: "claude-haiku-4-5", confirmation: "claude-sonnet-5" }, schemaVersion: 1 }
  });
  await service.recordOwnScan(landlord, scan());
  // Attribution names the model that actually reads the confirmation — the one
  // whose judgement will inform a price — not the cheaper walking tier.
  assert(capture.recorded.model.modelId === "claude-sonnet-5", "A stored scan was not attributed to the confirmation model.");
  assert(capture.recorded.model.provider === "anthropic" && capture.recorded.model.schemaVersion === 1,
    "Model attribution was incomplete.");
}

// A client must never be able to name the model that read its own scan: the
// audit trail exists to be trusted when a quote is disputed.
{
  const capture = {};
  const service = createScanService(repositoryStub(capture), {
    vision: { provider: "anthropic", models: { confirmation: "claude-sonnet-5" }, schemaVersion: 1 }
  });
  await service.recordOwnScan(landlord, { ...scan(), model: { provider: "attacker", modelId: "free-model", schemaVersion: 99 } });
  assert(capture.recorded.model.provider === "anthropic" && capture.recorded.model.modelId === "claude-sonnet-5",
    "A client-supplied model claim reached the audit trail.");
}

// With no reader configured the scan still records everything the device found,
// simply without attribution.
{
  const capture = {};
  const service = createScanService(repositoryStub(capture), {});
  await service.recordOwnScan(landlord, scan());
  assert(capture.recorded.model === null, "An unconfigured reader produced an invented attribution.");
  assert(capture.recorded.rooms.length === 1, "An unconfigured reader stopped the scan being recorded.");
}

{
  const service = createScanService(repositoryStub(), {});
  assert(await rejects(() => service.recordOwnScan(cleaner, scan()), "Landlord account is required"), "A Cleaner recorded a room scan.");
  assert(await rejects(() => service.recordOwnScan({ userId: null }, scan()), "Landlord account is required"), "An unauthenticated caller recorded a room scan.");
  assert(await rejects(() => service.correctOwnObject(cleaner, sessionId, { field: "label", value: "Hob" }), "Landlord account is required"), "A Cleaner corrected a room scan.");
  assert(await rejects(() => service.deleteOwnScan(cleaner, requestId), "Landlord account is required"), "A Cleaner deleted a room scan.");
  assert(await rejects(() => service.getScan({ userId: null, roles: [] }, requestId), "Landlord or Administrator"), "An unauthenticated caller read a room scan.");
  assert(await rejects(() => service.getScan(cleaner, requestId), "Landlord or Administrator"), "A Cleaner read the Landlord/Admin structured scan projection.");
  await service.getScan(landlord, requestId);
  await service.getScan({ userId: landlord.userId, roles: ["administrator"] }, requestId);
}

{
  const capture = {};
  const service = createScanService(repositoryStub(capture), {});
  await service.correctOwnObject(landlord, sessionId, { field: "quantity", value: 3, trainingConsent: true });
  assert(capture.correction.correction.value === "3" && capture.correction.correction.trainingConsent === true,
    "A quantity correction lost its value or its consent.");
  // Consent is per-correction and defaults false. No customer scan trains
  // anything without an explicit choice.
  await service.correctOwnObject(landlord, sessionId, { field: "label", value: "Kitchen worktop" });
  assert(capture.correction.correction.trainingConsent === false, "An unstated training consent did not default to false.");
  // Saying "I cannot tell either" is a real correction and more honest than the
  // grade that was there.
  await service.correctOwnObject(landlord, sessionId, { field: "condition", value: "" });
  assert(capture.correction.correction.value === "", "Clearing a condition was not accepted as a correction.");

  assert(await rejects(() => service.correctOwnObject(landlord, sessionId, { field: "colour", value: "blue" }), "supported room-scan correction"), "An unsupported correction field was accepted.");
  assert(await rejects(() => service.correctOwnObject(landlord, sessionId, { field: "condition", value: "filthy" }), "supported cleaning condition"), "An invented condition was accepted as a correction.");
  assert(await rejects(() => service.correctOwnObject(landlord, sessionId, { field: "quantity", value: 0 }), "between 1 and 20"), "A zero quantity was accepted as a correction.");
  assert(await rejects(() => service.correctOwnObject(landlord, sessionId, { field: "quantity", value: 21 }), "between 1 and 20"), "An oversized quantity was accepted as a correction.");
  assert(await rejects(() => service.correctOwnObject(landlord, sessionId, { field: "label", value: "" }), "Corrected object name"), "An empty rename was accepted.");
}

{
  const removing = createScanService({
    ...repositoryStub(),
    async correctObject(actor, objectId) { return { objectId, removed: true }; }
  }, {});
  const result = await removing.correctOwnObject(landlord, sessionId, { field: "removed" });
  assert(result.removed === true && result.objectId === sessionId, "Removing an object did not report the removal.");
}


/* ── Measurements never leave as bare numbers ──────────────────────────── */

{
  const capture = {};
  const service = createScanService(repositoryStub(capture), {});
  const stored = await service.recordOwnMeasurements(landlord, "3c000000-0000-4000-8000-000000000001", {
    measurements: [
      { subject: "room-length", method: "reference-calibrated", valueMm: 3400, toleranceMm: 420, reference: "bank-card" },
      { subject: "ceiling-height", method: "user-confirmed", valueMm: 2400, toleranceMm: 0 },
      // No method, so no provenance. Dropped rather than stored looking like
      // the others.
      { subject: "room-width", valueMm: 2600, toleranceMm: 300 }
    ]
  });
  assert(capture.measurements.measurements.length === 2, "A measurement with no provenance reached the database boundary.");
  assert(stored.measurements.every((entry) => entry.method && entry.confidence && entry.label),
    "A measurement was projected without its method, confidence or label.");
  const [length, height] = stored.measurements;
  assert(length.estimated === true && length.label.includes("±"), `An estimate was projected without a range: ${length.label}`);
  // Only a person's own figure about their own home is settled.
  assert(height.estimated === false, "A customer-confirmed figure was reported as an estimate.");
  assert(await rejects(() => service.recordOwnMeasurements(landlord, "3c000000-0000-4000-8000-000000000001", { measurements: [] }), "supported subject"),
    "An empty measurement set was accepted.");
  assert(await rejects(() => service.recordOwnMeasurements(cleaner, "3c000000-0000-4000-8000-000000000001", { measurements: [] }), "Landlord account is required"),
    "A Cleaner recorded room measurements.");
}

// A room with no measurements projects as an empty list, not as a room with
// unknown dimensions dressed up as zeroes.
{
  const service = createScanService({
    ...repositoryStub(),
    async getScan() {
      return { cleaningRequestId: requestId, session: null, rooms: [{ roomScanId: "r1", roomName: "Kitchen", objects: [], measurements: [] }] };
    }
  }, {});
  const projected = await service.getScan(landlord, requestId);
  assert(Array.isArray(projected.rooms[0].measurements) && projected.rooms[0].measurements.length === 0,
    "An unmeasured room did not project as unmeasured.");
}

console.log("Structured room-scan service checks passed.");
