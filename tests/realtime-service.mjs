import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRealtimeRepository } from "../src/marketplace/realtime-repository.mjs";
import { bookingRealtimeChannel, createPostgresRealtimeSignalSource, requestRealtimeChannel } from "../src/marketplace/realtime-signal-source.mjs";
import { createRealtimeService } from "../src/marketplace/realtime-service.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }
const tick = () => new Promise((resolve) => setImmediate(resolve));

const bookingId = "55555555-5555-4555-8555-555555555555";
const cleaningRequestId = "66666666-6666-4666-8666-666666666666";
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
let currentVersion = 3;
const repositoryCalls = [];
const repository = {
  async getSnapshot(actor, id, afterEventId, limit) {
    repositoryCalls.push({ actor, id, afterEventId, limit });
    return {
      bookingId: id,
      status: "cleaning-in-progress",
      currentVersion,
      events: currentVersion > afterEventId ? [{ eventId: currentVersion, kind: currentVersion === 3 ? "cleaning-progress" : "booking-message", actorUserId: cleaner.userId, createdAt: "2026-07-15T16:00:00.000Z", sourceKey: "private" }] : [],
      resyncRequired: false,
      tracking: { bookingId: id, sharingState: "live" },
      progress: { bookingId: id, overallPercentage: 50 },
      messages: { bookingId: id, messages: [], hasMore: false, nextCursor: null },
      privateDatabaseField: "never-return"
    };
  },
  async getRequestSnapshot(actor, id, afterEventId, limit) {
    repositoryCalls.push({ actor, id, afterEventId, limit, request: true });
    return { requestId: id, status: "searching-for-cleaner", currentVersion, events: currentVersion > afterEventId ? [{ eventId: currentVersion, kind: "matching-evaluation", createdAt: "2026-07-15T16:00:00.000Z", privateField: "hidden" }] : [], resyncRequired: false, automaticDispatch: { enabled: true, attemptLimit: 1, attemptCount: currentVersion === 5 ? 1 : 0, lastResult: currentVersion === 5 ? "invited" : "authorized", internalLease: "hidden" }, privateDatabaseField: "never-return" };
  }
};
let signalListener;
let signalReleased = false;
const signalSource = {
  async subscribe(listener) { signalListener = listener; return () => { signalReleased = true; }; },
  async close() {}
};
const fakeIntervals = new Set();
const fakeTimeouts = new Set();
function fakeSetInterval(callback) { const timer = { callback, unref() {} }; fakeIntervals.add(timer); return timer; }
function fakeClearInterval(timer) { fakeIntervals.delete(timer); }
function fakeSetTimeout(callback) { const timer = { callback, unref() {} }; fakeTimeouts.add(timer); return timer; }
function fakeClearTimeout(timer) { fakeTimeouts.delete(timer); }
class Request extends EventEmitter {}
class Response {
  constructor({ backpressure = false } = {}) { this.statusCode = null; this.headers = {}; this.chunks = []; this.ended = false; this.backpressure = backpressure; }
  writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; }
  flushHeaders() { this.flushed = true; }
  write(chunk) { this.chunks.push(String(chunk)); return !this.backpressure; }
  end() { this.ended = true; }
  text() { return this.chunks.join(""); }
}

const realtime = createRealtimeService(repository, signalSource, { maximumPerUser: 1, maximumConnections: 2, setInterval: fakeSetInterval, clearInterval: fakeClearInterval, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout });
const request = new Request();
const response = new Response();
await realtime.openStream(landlord, bookingId, request, response, 0);
assert(response.statusCode === 200 && response.headers["Content-Type"].startsWith("text/event-stream") && response.headers["Cache-Control"] === "no-store, no-transform" && response.flushed, "The booking stream did not open as non-cacheable unbuffered SSE.");
assert(response.text().includes("retry: 3000") && response.text().includes("id: 3") && response.text().includes("event: booking-snapshot") && !response.text().includes("privateDatabaseField") && !response.text().includes("sourceKey"), "Initial SSE snapshot lost reconnect metadata or leaked repository-only fields.");
assert(realtime.connectionCount() === 1 && await rejects(() => realtime.openStream(landlord, bookingId, new Request(), new Response(), 0), "Too many"), "Per-user real-time connection limits were not enforced.");
currentVersion = 4;
signalListener({ bookingId, eventId: 4, kind: "booking-message" });
await tick();
await tick();
assert(response.text().includes("id: 4") && repositoryCalls.at(-1).afterEventId === 3, "A committed PostgreSQL signal did not produce durable cursor catch-up without polling.");
request.emit("close");
assert(realtime.connectionCount() === 0 && response.ended && fakeIntervals.size === 0 && fakeTimeouts.size === 0, "Closing the browser stream did not release connection, heartbeat and session-expiry state.");

const requestStreamRequest = new Request();
const requestStreamResponse = new Response();
await realtime.openRequestStream(landlord, cleaningRequestId, requestStreamRequest, requestStreamResponse, 0);
assert(requestStreamResponse.text().includes("event: request-snapshot") && requestStreamResponse.text().includes(cleaningRequestId) && requestStreamResponse.text().includes('"attemptLimit":1') && !requestStreamResponse.text().includes("privateDatabaseField") && !requestStreamResponse.text().includes("internalLease") && !requestStreamResponse.text().includes("privateField"), "The request stream omitted safe matching state or leaked repository-only fields.");
currentVersion = 5;
signalListener({ entityType: "request", requestId: cleaningRequestId, eventId: 5, kind: "matching-evaluation" });
await tick();
await tick();
assert(requestStreamResponse.text().includes("id: 5") && repositoryCalls.at(-1).request === true, "A committed cleaning-request signal did not refresh the private landlord stream.");
requestStreamRequest.emit("close");

const pressureRequest = new Request();
const pressureResponse = new Response({ backpressure: true });
await realtime.openStream(cleaner, bookingId, pressureRequest, pressureResponse, 0);
assert(pressureResponse.ended && realtime.connectionCount() === 0 && fakeIntervals.size === 0 && fakeTimeouts.size === 0, "A stalled client was allowed to grow an unbounded SSE buffer.");
await realtime.close();
assert(signalReleased, "Closing real-time delivery did not release the database signal subscription.");

const databaseCalls = [];
let failure = null;
const database = { async withUserTransaction(actor, operation) { return operation({ async query(queryText, values) { databaseCalls.push({ actor, queryText, values }); if (failure) throw failure; return { rows: [{ snapshot: { bookingId, status: "confirmed", currentVersion: 0, events: [], resyncRequired: false, tracking: null, progress: {}, messages: { messages: [] } } }] }; } }); } };
const realtimeRepository = createRealtimeRepository(database);
await realtimeRepository.getSnapshot(landlord, bookingId, 7, 100);
assert(databaseCalls[0].queryText.includes("get_booking_realtime_snapshot") && databaseCalls[0].values.join(",") === `${bookingId},7,100` && !databaseCalls[0].queryText.includes(bookingId), "Real-time repository bypassed or interpolated its authorized snapshot function.");
failure = new Error("invalid-realtime-cursor");
assert(await rejects(() => realtimeRepository.getSnapshot(landlord, bookingId, -1, 100), "cursor"), "Invalid real-time cursors did not receive a safe repository error.");
failure = null;
await realtimeRepository.getRequestSnapshot(landlord, cleaningRequestId, 9, 100);
assert(databaseCalls.at(-1).queryText.includes("get_cleaning_request_realtime_snapshot") && databaseCalls.at(-1).values.join(",") === `${cleaningRequestId},9,100`, "Request real-time repository bypassed its owner-authorized snapshot function.");

class PgClient extends EventEmitter {
  constructor() { super(); this.queries = []; this.released = false; }
  async query(value) { this.queries.push(value); }
  release() { this.released = true; }
}
const pgClient = new PgClient();
const pgSource = createPostgresRealtimeSignalSource({ async connect() { return pgClient; } });
const signals = [];
const unsubscribe = await pgSource.subscribe((signal) => signals.push(signal));
assert(pgClient.queries[0] === `LISTEN ${bookingRealtimeChannel}`, "PostgreSQL source did not reserve the fixed booking-event channel.");
assert(pgClient.queries[1] === `LISTEN ${requestRealtimeChannel}`, "PostgreSQL source did not reserve the fixed cleaning-request channel.");
pgClient.emit("notification", { channel: bookingRealtimeChannel, payload: JSON.stringify({ bookingId, eventId: 8, kind: "booking-message" }) });
pgClient.emit("notification", { channel: requestRealtimeChannel, payload: JSON.stringify({ requestId: cleaningRequestId, eventId: 10, kind: "matching-evaluation" }) });
pgClient.emit("notification", { channel: "attacker", payload: JSON.stringify({ bookingId, eventId: 9, kind: "bad" }) });
pgClient.emit("notification", { channel: bookingRealtimeChannel, payload: "not-json" });
assert(signals.length === 2 && signals[0].eventId === 8 && signals[1].requestId === cleaningRequestId, "PostgreSQL source rejected a valid request signal or accepted a foreign/malformed payload.");
unsubscribe();
await pgSource.close();
assert(pgClient.queries.includes(`UNLISTEN ${bookingRealtimeChannel}`) && pgClient.queries.includes(`UNLISTEN ${requestRealtimeChannel}`) && pgClient.released, "PostgreSQL signal source did not unlisten and release its dedicated connection.");

const migration = await readFile(new URL("../db/migrations/016_booking_realtime_events.sql", import.meta.url), "utf8");
const requestMigration = await readFile(new URL("../db/migrations/054_cleaning_request_realtime_events.sql", import.meta.url), "utf8");
const grants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
for (const required of ["booking_realtime_events", "booking_realtime_events_participants", "emit_booking_realtime_event", "pg_notify", "tideway_booking_events", "booking_status_realtime_after_insert", "cleaning_progress_realtime_after_insert", "booking_message_realtime_after_insert", "cleaner_location_realtime_after_change", "get_booking_realtime_snapshot", "currentVersion", "resyncRequired", "get_booking_tracking", "get_cleaning_progress", "get_booking_messages"]) assert(migration.includes(required), `Real-time migration omitted ${required}.`);
assert(grants.includes("get_booking_realtime_snapshot") && grants.includes("REVOKE SELECT, INSERT, UPDATE, DELETE ON booking_realtime_events"), "The runtime role can read or forge real-time events directly.");
for (const required of ["cleaning_request_realtime_events", "tideway_request_events", "matching-authorization", "matching-evaluation", "get_cleaning_request_realtime_snapshot", "automaticDispatch", "attemptCount"]) assert(requestMigration.includes(required), `Request real-time migration omitted ${required}.`);
assert(grants.includes("get_cleaning_request_realtime_snapshot") && grants.includes("REVOKE SELECT, INSERT, UPDATE, DELETE ON cleaning_request_realtime_events"), "The runtime role can read or forge request events directly.");

console.log("Realtime tests passed: durable PostgreSQL commit signals, participant snapshot catch-up, no-poll SSE, origin-ready stream metadata, connection/backpressure cleanup and malformed notification rejection.");
