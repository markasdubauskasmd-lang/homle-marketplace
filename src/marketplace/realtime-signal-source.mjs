const channel = "tideway_booking_events";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable(cause) {
  return Object.assign(new Error("Real-time booking updates are temporarily unavailable."), { statusCode: 503, code: "realtime-unavailable", cause });
}

export function createPostgresRealtimeSignalSource(pool, options = {}) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A PostgreSQL pool is required for real-time signals.");
  const listeners = new Set();
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  let client = null;
  let starting = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let closed = false;

  function validSignal(notification) {
    if (notification?.channel !== channel || typeof notification.payload !== "string") return null;
    try {
      const value = JSON.parse(notification.payload);
      const eventId = Number(value.eventId);
      if (!uuidPattern.test(value.bookingId || "") || !Number.isSafeInteger(eventId) || eventId < 1 || typeof value.kind !== "string") return null;
      return Object.freeze({ bookingId: value.bookingId.toLowerCase(), eventId, kind: value.kind });
    } catch { return null; }
  }

  function detach(selected, error) {
    if (!selected) return;
    try { selected.removeListener?.("notification", onNotification); } catch {}
    try { selected.removeListener?.("error", onConnectionError); } catch {}
    try { selected.release?.(error); } catch {}
  }

  function onNotification(notification) {
    const signal = validSignal(notification);
    if (!signal) return;
    for (const listener of listeners) {
      try { listener(signal); } catch {}
    }
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer || listeners.size === 0) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
    reconnectAttempt += 1;
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      start().catch(() => scheduleReconnect());
    }, delay);
    reconnectTimer?.unref?.();
  }

  function onConnectionError(error) {
    const failed = client;
    client = null;
    starting = null;
    detach(failed, error);
    scheduleReconnect();
  }

  async function start() {
    if (closed) throw unavailable();
    if (client) return;
    if (starting) return starting;
    starting = (async () => {
      let selected;
      const reconnecting = reconnectAttempt > 0;
      try {
        selected = await pool.connect();
        if (!selected || typeof selected.query !== "function" || typeof selected.on !== "function") throw new Error("PostgreSQL notification client is incomplete.");
        selected.on("notification", onNotification);
        selected.on("error", onConnectionError);
        await selected.query(`LISTEN ${channel}`);
        client = selected;
        reconnectAttempt = 0;
        if (reconnecting) for (const listener of listeners) { try { listener(Object.freeze({ resyncAll: true })); } catch {} }
      } catch (error) {
        detach(selected, error);
        throw unavailable(error);
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  return Object.freeze({
    async subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("A real-time signal listener is required.");
      if (closed) throw unavailable();
      listeners.add(listener);
      try { await start(); } catch (error) { listeners.delete(listener); throw error; }
      let active = true;
      return () => { if (!active) return; active = false; listeners.delete(listener); };
    },
    async close() {
      closed = true;
      listeners.clear();
      if (reconnectTimer) clearTimer(reconnectTimer);
      reconnectTimer = null;
      const selected = client;
      client = null;
      if (selected) {
        try { await selected.query(`UNLISTEN ${channel}`); } catch {}
        detach(selected);
      }
    }
  });
}

export { channel as bookingRealtimeChannel };
