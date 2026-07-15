const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function cursor(value) {
  if (value == null || value === "") return 0;
  if (!/^\d+$/.test(String(value))) throw new TypeError("A valid real-time event cursor is required.");
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new TypeError("A valid real-time event cursor is required.");
  return normalized;
}

function unavailable(cause) {
  return Object.assign(new Error("Real-time booking updates are temporarily unavailable."), { statusCode: 503, code: "realtime-unavailable", cause });
}

function snapshot(value) {
  const record = typeof value === "string" ? JSON.parse(value) : value;
  if (!record || typeof record !== "object" || !Array.isArray(record.events)) throw new Error("The real-time booking snapshot is unavailable.");
  return Object.freeze({
    bookingId: record.bookingId,
    status: record.status,
    currentVersion: Number(record.currentVersion) || 0,
    events: Object.freeze(record.events.map((event) => Object.freeze({ eventId: Number(event.eventId), kind: event.kind, actorUserId: event.actorUserId || null, createdAt: event.createdAt }))),
    resyncRequired: record.resyncRequired === true,
    tracking: record.tracking || null,
    progress: record.progress || null,
    messages: record.messages || { bookingId: record.bookingId, messages: [], hasMore: false, nextCursor: null }
  });
}

export function createRealtimeService(repository, signalSource, options = {}) {
  if (!repository || typeof repository.getSnapshot !== "function") throw new TypeError("A real-time snapshot repository is required.");
  if (!signalSource || typeof signalSource.subscribe !== "function") throw new TypeError("A PostgreSQL real-time signal source is required.");
  const heartbeatMs = Number.isInteger(options.heartbeatMs) ? Math.max(5000, options.heartbeatMs) : 20_000;
  const maximumPerUser = Number.isInteger(options.maximumPerUser) ? Math.max(1, options.maximumPerUser) : 3;
  const maximumConnections = Number.isInteger(options.maximumConnections) ? Math.max(1, options.maximumConnections) : 1000;
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;
  const setTimeoutFn = options.setTimeout || setTimeout;
  const clearTimeoutFn = options.clearTimeout || clearTimeout;
  const maximumStreamLifetimeMs = Number.isInteger(options.maximumStreamLifetimeMs) ? Math.max(60_000, options.maximumStreamLifetimeMs) : 15 * 60_000;
  const connections = new Map();
  const perUser = new Map();
  const latestSignals = new Map();
  const openingBookings = new Map();
  const pendingPerUser = new Map();
  let unsubscribe = null;
  let subscription = null;
  let closed = false;
  let totalConnections = 0;
  let pendingConnections = 0;

  function write(connection, chunk) {
    if (connection.closed) return false;
    try {
      if (connection.response.write(chunk) === false) { closeConnection(connection); return false; }
      return true;
    } catch { closeConnection(connection); return false; }
  }

  function sendSnapshot(connection, value) {
    connection.lastVersion = Math.max(connection.lastVersion, value.currentVersion);
    return write(connection, `id: ${value.currentVersion}\nevent: booking-snapshot\ndata: ${JSON.stringify(value)}\n\n`);
  }

  function closeConnection(connection) {
    if (!connection || connection.closed) return;
    connection.closed = true;
    clearIntervalFn(connection.heartbeat);
    clearTimeoutFn(connection.expiryTimer);
    connection.request.removeListener?.("close", connection.onClose);
    const bookingSet = connections.get(connection.bookingId);
    bookingSet?.delete(connection);
    if (bookingSet?.size === 0) connections.delete(connection.bookingId);
    if (!connections.has(connection.bookingId) && !openingBookings.has(connection.bookingId)) latestSignals.delete(connection.bookingId);
    const count = Math.max(0, (perUser.get(connection.actor.userId) || 1) - 1);
    if (count) perUser.set(connection.actor.userId, count); else perUser.delete(connection.actor.userId);
    totalConnections = Math.max(0, totalConnections - 1);
    try { connection.response.end(); } catch {}
  }

  async function refresh(connection) {
    if (connection.closed) return;
    if (connection.refreshing) { connection.refreshPending = true; return; }
    connection.refreshing = true;
    try {
      do {
        connection.refreshPending = false;
        const value = snapshot(await repository.getSnapshot(connection.actor, connection.bookingId, connection.lastVersion, 100));
        if (value.currentVersion > connection.lastVersion || value.resyncRequired) sendSnapshot(connection, value);
      } while (!connection.closed && connection.refreshPending);
    } catch {
      write(connection, "event: stream-error\ndata: {\"code\":\"realtime-refresh-failed\"}\n\n");
      closeConnection(connection);
    } finally { connection.refreshing = false; }
  }

  function onSignal(signal) {
    if (signal?.resyncAll === true) {
      for (const bookingSet of connections.values()) for (const connection of bookingSet) refresh(connection);
      return;
    }
    if (!signal || !uuidPattern.test(signal.bookingId || "") || !Number.isSafeInteger(signal.eventId)) return;
    const bookingId = signal.bookingId.toLowerCase();
    if (!connections.has(bookingId) && !openingBookings.has(bookingId)) return;
    latestSignals.set(bookingId, Math.max(latestSignals.get(bookingId) || 0, signal.eventId));
    for (const connection of connections.get(bookingId) || []) refresh(connection);
  }

  async function ensureSubscription() {
    if (closed) throw unavailable();
    if (unsubscribe) return;
    if (!subscription) subscription = Promise.resolve(signalSource.subscribe(onSignal)).then((release) => { if (typeof release !== "function") throw unavailable(); unsubscribe = release; }).catch((error) => { subscription = null; throw unavailable(error); });
    await subscription;
  }

  return Object.freeze({
    async openStream(actor, bookingId, request, response, lastEventId = 0, sessionExpiresAt = null) {
      if (!actor?.userId) throw new TypeError("An authenticated booking participant is required for real-time updates.");
      if (!request || typeof request.once !== "function" || !response || typeof response.writeHead !== "function" || typeof response.write !== "function") throw new TypeError("A streaming HTTP request and response are required.");
      const selectedBookingId = uuid(bookingId, "booking id");
      const selectedCursor = cursor(lastEventId);
      const sessionExpiryTime = sessionExpiresAt == null ? Date.now() + maximumStreamLifetimeMs : Date.parse(sessionExpiresAt);
      if (!Number.isFinite(sessionExpiryTime) || sessionExpiryTime <= Date.now()) throw Object.assign(new Error("The account session has expired."), { statusCode: 403, code: "session-expired" });
      const streamLifetimeMs = Math.min(maximumStreamLifetimeMs, sessionExpiryTime - Date.now());
      if (totalConnections + pendingConnections >= maximumConnections || (perUser.get(actor.userId) || 0) + (pendingPerUser.get(actor.userId) || 0) >= maximumPerUser) throw Object.assign(new Error("Too many real-time booking connections are open."), { statusCode: 429, code: "realtime-connection-limit" });
      pendingConnections += 1;
      pendingPerUser.set(actor.userId, (pendingPerUser.get(actor.userId) || 0) + 1);
      openingBookings.set(selectedBookingId, (openingBookings.get(selectedBookingId) || 0) + 1);
      let initial;
      try {
        await ensureSubscription();
        initial = snapshot(await repository.getSnapshot(actor, selectedBookingId, selectedCursor, 100));
      } finally {
        pendingConnections = Math.max(0, pendingConnections - 1);
        const userPending = Math.max(0, (pendingPerUser.get(actor.userId) || 1) - 1);
        if (userPending) pendingPerUser.set(actor.userId, userPending); else pendingPerUser.delete(actor.userId);
        const bookingPending = Math.max(0, (openingBookings.get(selectedBookingId) || 1) - 1);
        if (bookingPending) openingBookings.set(selectedBookingId, bookingPending); else openingBookings.delete(selectedBookingId);
        if (!bookingPending && !connections.has(selectedBookingId) && initial === undefined) latestSignals.delete(selectedBookingId);
      }
      response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      response.flushHeaders?.();
      const connection = { actor, bookingId: selectedBookingId, request, response, lastVersion: initial.currentVersion, closed: false, refreshing: false, refreshPending: false, heartbeat: null, expiryTimer: null, onClose: null };
      connection.onClose = () => closeConnection(connection);
      request.once("close", connection.onClose);
      if (!connections.has(selectedBookingId)) connections.set(selectedBookingId, new Set());
      connections.get(selectedBookingId).add(connection);
      perUser.set(actor.userId, (perUser.get(actor.userId) || 0) + 1);
      totalConnections += 1;
      connection.heartbeat = setIntervalFn(() => write(connection, `: heartbeat ${Date.now()}\n\n`), heartbeatMs);
      connection.heartbeat?.unref?.();
      connection.expiryTimer = setTimeoutFn(() => closeConnection(connection), streamLifetimeMs);
      connection.expiryTimer?.unref?.();
      write(connection, "retry: 3000\n\n");
      sendSnapshot(connection, initial);
      if ((latestSignals.get(selectedBookingId) || 0) > connection.lastVersion) refresh(connection);
      return Object.freeze({ close: () => closeConnection(connection) });
    },
    async close() {
      closed = true;
      for (const bookingSet of [...connections.values()]) for (const connection of [...bookingSet]) closeConnection(connection);
      try { unsubscribe?.(); } catch {}
      unsubscribe = null;
      await signalSource.close?.();
    },
    connectionCount() { return totalConnections; }
  });
}
