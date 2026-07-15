import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const defaultSessionTtlMs = 30 * 60 * 1000;
const defaultPointTtlMs = 2 * 60 * 1000;

function tokenDigest(token) {
  return createHash("sha256").update(String(token || "")).digest();
}

function tokenMatches(token, expectedDigest) {
  const digest = tokenDigest(token);
  return expectedDigest && digest.length === expectedDigest.length && timingSafeEqual(digest, expectedDigest);
}

function trackingError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function finiteNumber(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw trackingError(`${label} is invalid.`, 422);
  return number;
}

export function createTrackingTestStore(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const createToken = typeof options.createToken === "function" ? options.createToken : () => randomBytes(32).toString("base64url");
  const createId = typeof options.createId === "function" ? options.createId : () => `TST-${randomUUID().slice(0, 8).toUpperCase()}`;
  const sessionTtlMs = Number.isFinite(options.sessionTtlMs) ? options.sessionTtlMs : defaultSessionTtlMs;
  const pointTtlMs = Number.isFinite(options.pointTtlMs) ? options.pointTtlMs : defaultPointTtlMs;
  const maximumSessions = Number.isInteger(options.maximumSessions) ? options.maximumSessions : 20;
  const maximumSubscribers = Number.isInteger(options.maximumSubscribers) ? options.maximumSubscribers : 8;
  const sessions = new Map();

  function expireStaleSessions() {
    const timestamp = now();
    for (const [id, session] of sessions) {
      if (timestamp < session.expiresAtMs) continue;
      session.location = null;
      session.state = "expired";
      notify(session);
      sessions.delete(id);
    }
  }

  function findAccess(token) {
    expireStaleSessions();
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ""))) throw trackingError("This private tracking-test link is invalid or expired.", 401);
    for (const session of sessions.values()) {
      if (tokenMatches(token, session.controllerDigest)) return { session, role: "cleaner" };
      if (tokenMatches(token, session.viewerDigest)) return { session, role: "landlord" };
    }
    throw trackingError("This private tracking-test link is invalid or expired.", 401);
  }

  function snapshotFor(session, role) {
    const timestamp = now();
    const locationCurrent = session.location && timestamp < session.location.expiresAtMs;
    const state = session.state === "live" && !locationCurrent ? "stale" : session.state;
    return Object.freeze({
      reference: session.id,
      role,
      state,
      createdAt: new Date(session.createdAtMs).toISOString(),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      stoppedAt: session.stoppedAtMs ? new Date(session.stoppedAtMs).toISOString() : null,
      location: locationCurrent ? Object.freeze({
        latitude: session.location.latitude,
        longitude: session.location.longitude,
        accuracyMetres: session.location.accuracyMetres,
        recordedAt: new Date(session.location.recordedAtMs).toISOString(),
        expiresAt: new Date(session.location.expiresAtMs).toISOString()
      }) : null
    });
  }

  function notify(session) {
    for (const subscriber of [...session.subscribers]) {
      try { subscriber.listener(snapshotFor(session, subscriber.role)); } catch { session.subscribers.delete(subscriber); }
    }
  }

  function createSession() {
    expireStaleSessions();
    if (sessions.size >= maximumSessions) throw trackingError("Too many local tracking tests are already active. End one and try again.", 429);
    const controllerToken = createToken();
    const viewerToken = createToken();
    if (!/^[A-Za-z0-9_-]{43}$/.test(controllerToken) || !/^[A-Za-z0-9_-]{43}$/.test(viewerToken) || controllerToken === viewerToken) throw new Error("Tracking-test token source is invalid.");
    const createdAtMs = now();
    const session = {
      id: createId(),
      controllerDigest: tokenDigest(controllerToken),
      viewerDigest: tokenDigest(viewerToken),
      createdAtMs,
      expiresAtMs: createdAtMs + sessionTtlMs,
      stoppedAtMs: null,
      state: "waiting",
      location: null,
      subscribers: new Set()
    };
    sessions.set(session.id, session);
    return Object.freeze({
      reference: session.id,
      controllerToken,
      viewerToken,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      snapshot: snapshotFor(session, "cleaner")
    });
  }

  function getSnapshot(token) {
    const { session, role } = findAccess(token);
    return snapshotFor(session, role);
  }

  function updateLocation(token, input = {}) {
    const { session, role } = findAccess(token);
    if (role !== "cleaner") throw trackingError("Only the Cleaner test controller may update location.", 403);
    if (session.state === "stopped") throw trackingError("This tracking test has stopped. Create a new test to share location again.", 409);
    const recordedAtMs = now();
    session.location = {
      latitude: finiteNumber(input.latitude, -90, 90, "Latitude"),
      longitude: finiteNumber(input.longitude, -180, 180, "Longitude"),
      accuracyMetres: Math.round(finiteNumber(input.accuracyMetres, 0, 10_000, "Location accuracy") * 10) / 10,
      recordedAtMs,
      expiresAtMs: recordedAtMs + pointTtlMs
    };
    session.state = "live";
    session.stoppedAtMs = null;
    notify(session);
    return snapshotFor(session, role);
  }

  function stop(token) {
    const { session, role } = findAccess(token);
    if (role !== "cleaner") throw trackingError("Only the Cleaner test controller may stop location sharing.", 403);
    session.location = null;
    session.state = "stopped";
    session.stoppedAtMs ||= now();
    notify(session);
    return snapshotFor(session, role);
  }

  function destroy(token) {
    const { session, role } = findAccess(token);
    if (role !== "cleaner") throw trackingError("Only the Cleaner test controller may delete this test.", 403);
    session.location = null;
    session.state = "deleted";
    notify(session);
    sessions.delete(session.id);
    return Object.freeze({ reference: session.id, state: "deleted" });
  }

  function subscribe(token, listener) {
    if (typeof listener !== "function") throw new TypeError("A tracking-test subscriber must be a function.");
    const { session, role } = findAccess(token);
    if (session.subscribers.size >= maximumSubscribers) throw trackingError("Too many viewers are connected to this private test.", 429);
    const entry = { role, listener };
    session.subscribers.add(entry);
    listener(snapshotFor(session, role));
    return () => session.subscribers.delete(entry);
  }

  function close() {
    for (const session of sessions.values()) {
      session.location = null;
      session.state = "deleted";
      notify(session);
    }
    sessions.clear();
  }

  function activeSessionCount() {
    expireStaleSessions();
    return sessions.size;
  }

  return Object.freeze({ createSession, getSnapshot, updateLocation, stop, destroy, subscribe, close, activeSessionCount });
}

export { defaultPointTtlMs, defaultSessionTtlMs };
