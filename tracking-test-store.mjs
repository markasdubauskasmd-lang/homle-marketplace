import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const defaultSessionTtlMs = 30 * 60 * 1000;
const defaultPointTtlMs = 2 * 60 * 1000;
const sampleCleaningTasks = Object.freeze([
  Object.freeze({ id: "kitchen", room: "Kitchen", task: "Clean worktops, sink and visible surfaces" }),
  Object.freeze({ id: "bathroom", room: "Bathroom", task: "Clean basin, toilet and shower or bath" }),
  Object.freeze({ id: "main-bedroom", room: "Main bedroom", task: "Dust accessible surfaces and vacuum the floor" }),
  Object.freeze({ id: "living-room", room: "Living room", task: "Dust accessible surfaces and vacuum the floor" })
]);

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
    const tasks = sampleCleaningTasks.map((definition) => {
      const update = session.taskUpdates.get(definition.id);
      return Object.freeze({
        ...definition,
        status: update?.status || "pending",
        updatedAt: update ? new Date(update.updatedAtMs).toISOString() : null
      });
    });
    const completedTasks = tasks.filter((task) => task.status === "completed").length;
    const issueTasks = tasks.filter((task) => task.status === "issue").length;
    return Object.freeze({
      reference: session.id,
      role,
      state,
      createdAt: new Date(session.createdAtMs).toISOString(),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      stoppedAt: session.stoppedAtMs ? new Date(session.stoppedAtMs).toISOString() : null,
      arrivedAt: session.arrivedAtMs ? new Date(session.arrivedAtMs).toISOString() : null,
      location: locationCurrent ? Object.freeze({
        latitude: session.location.latitude,
        longitude: session.location.longitude,
        accuracyMetres: session.location.accuracyMetres,
        recordedAt: new Date(session.location.recordedAtMs).toISOString(),
        expiresAt: new Date(session.location.expiresAtMs).toISOString()
      }) : null,
      job: Object.freeze({
        phase: session.jobPhase,
        startedAt: session.cleaningStartedAtMs ? new Date(session.cleaningStartedAtMs).toISOString() : null,
        finishedAt: session.cleaningFinishedAtMs ? new Date(session.cleaningFinishedAtMs).toISOString() : null,
        totalTasks: tasks.length,
        completedTasks,
        issueTasks,
        percent: Math.round(completedTasks / tasks.length * 100),
        tasks: Object.freeze(tasks)
      })
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
      arrivedAtMs: null,
      cleaningStartedAtMs: null,
      cleaningFinishedAtMs: null,
      jobPhase: "not-started",
      taskUpdates: new Map(),
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
    if (!["waiting", "live"].includes(session.state)) throw trackingError("Location sharing is no longer available after stopping or arriving.", 409);
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

  function arrive(token) {
    const { session, role } = findAccess(token);
    if (role !== "cleaner") throw trackingError("Only the Cleaner test controller may confirm arrival.", 403);
    if (session.state !== "live") throw trackingError("Start the journey and share a current point before confirming arrival.", 409);
    session.location = null;
    session.state = "arrived";
    session.arrivedAtMs = now();
    session.stoppedAtMs = session.arrivedAtMs;
    notify(session);
    return snapshotFor(session, role);
  }

  function startCleaning(token) {
    const { session, role } = findAccess(token);
    if (role !== "cleaner") throw trackingError("Only the Cleaner test controller may start cleaning.", 403);
    if (session.state !== "arrived" || session.jobPhase !== "not-started") throw trackingError("Cleaning can start once, after the Cleaner has arrived.", 409);
    session.jobPhase = "in-progress";
    session.cleaningStartedAtMs = now();
    notify(session);
    return snapshotFor(session, role);
  }

  function updateTask(token, input = {}) {
    const { session, role } = findAccess(token);
    if (role !== "cleaner") throw trackingError("Only the Cleaner test controller may update cleaning tasks.", 403);
    if (session.jobPhase !== "in-progress") throw trackingError("Tasks can be updated only while cleaning is in progress.", 409);
    const taskId = String(input.taskId || "");
    if (!sampleCleaningTasks.some((task) => task.id === taskId)) throw trackingError("Cleaning task is invalid.", 422);
    const status = String(input.status || "");
    if (!["pending", "completed", "issue"].includes(status)) throw trackingError("Cleaning task status is invalid.", 422);
    if (status === "pending") session.taskUpdates.delete(taskId);
    else session.taskUpdates.set(taskId, { status, updatedAtMs: now() });
    notify(session);
    return snapshotFor(session, role);
  }

  function finishCleaning(token) {
    const { session, role } = findAccess(token);
    if (role !== "cleaner") throw trackingError("Only the Cleaner test controller may finish cleaning.", 403);
    if (session.jobPhase !== "in-progress") throw trackingError("Cleaning is not currently in progress.", 409);
    const unresolved = sampleCleaningTasks.filter((task) => session.taskUpdates.get(task.id)?.status !== "completed");
    if (unresolved.length) throw trackingError(`Resolve all ${unresolved.length} remaining task${unresolved.length === 1 ? "" : "s"} before finishing.`, 409);
    session.jobPhase = "finished";
    session.cleaningFinishedAtMs = now();
    session.state = "finished";
    session.location = null;
    notify(session);
    return snapshotFor(session, role);
  }

  function stop(token) {
    const { session, role } = findAccess(token);
    if (role !== "cleaner") throw trackingError("Only the Cleaner test controller may stop location sharing.", 403);
    if (!["waiting", "live", "stopped"].includes(session.state)) throw trackingError("Location sharing already ended when the Cleaner arrived.", 409);
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

  return Object.freeze({ createSession, getSnapshot, updateLocation, arrive, startCleaning, updateTask, finishCleaning, stop, destroy, subscribe, close, activeSessionCount });
}

export { defaultPointTtlMs, defaultSessionTtlMs, sampleCleaningTasks };
