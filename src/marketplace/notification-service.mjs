const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventTypePattern = /^[a-z][a-z0-9-]{0,79}$/;
const safePayloadKeys = Object.freeze(["bookingId", "responseDeadline", "matchingReopened", "taskId", "decision", "photoId", "messageId", "senderRole", "eventId"]);

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function timestamp(value, label, nullable = false) {
  if (nullable && (value == null || value === "")) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError(`A valid ${label} is required.`);
  return new Date(value).toISOString();
}

function integer(value, minimum, maximum, fallback, label) {
  if (value == null || value === "") return fallback;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return normalized;
}

function authenticated(actor) {
  if (!actor?.userId) throw new TypeError("An authenticated account is required to view notifications.");
}

function object(value) {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function safePayload(value) {
  const source = object(value);
  if (!source || typeof source !== "object" || Array.isArray(source)) return Object.freeze({});
  const result = {};
  for (const key of safePayloadKeys) {
    const selected = source[key];
    if (selected == null) continue;
    if (["bookingId", "taskId", "photoId", "messageId"].includes(key) && uuidPattern.test(selected)) result[key] = String(selected).toLowerCase();
    else if (key === "responseDeadline" && typeof selected === "string" && Number.isFinite(Date.parse(selected))) result[key] = new Date(selected).toISOString();
    else if (key === "matchingReopened" && typeof selected === "boolean") result[key] = selected;
    else if (["decision", "senderRole"].includes(key) && typeof selected === "string" && /^[a-z][a-z0-9-]{0,49}$/.test(selected)) result[key] = selected;
    else if (key === "eventId" && /^\d{1,20}$/.test(String(selected))) result[key] = String(selected);
  }
  return Object.freeze(result);
}

function notification(value) {
  const record = object(value);
  if (!record || typeof record !== "object") throw new Error("The notification is unavailable.");
  if (!eventTypePattern.test(record.eventType || "")) throw new Error("The notification type is unavailable.");
  const payload = safePayload(record.payload);
  const bookingId = record.bookingId == null ? null : uuid(record.bookingId, "notification booking id");
  if (payload.bookingId && payload.bookingId !== bookingId) throw new Error("The notification booking reference is inconsistent.");
  return Object.freeze({
    notificationId: uuid(record.notificationId, "notification id"),
    bookingId,
    eventType: record.eventType,
    payload,
    createdAt: timestamp(record.createdAt, "notification creation time"),
    readAt: timestamp(record.readAt, "notification read time", true)
  });
}

function page(value) {
  const record = object(value);
  if (!record || typeof record !== "object" || !Array.isArray(record.notifications)) throw new Error("Notifications are unavailable.");
  const unreadCount = Number(record.unreadCount);
  if (!Number.isSafeInteger(unreadCount) || unreadCount < 0) throw new Error("The notification unread count is unavailable.");
  const nextCursor = record.nextCursor ? Object.freeze({
    beforeCreatedAt: timestamp(record.nextCursor.beforeCreatedAt, "next notification cursor time"),
    beforeNotificationId: uuid(record.nextCursor.beforeNotificationId, "next notification cursor id")
  }) : null;
  if ((record.hasMore === true) !== (nextCursor !== null)) throw new Error("The notification page cursor is inconsistent.");
  return Object.freeze({
    notifications: Object.freeze(record.notifications.map(notification)),
    unreadCount,
    hasMore: record.hasMore === true,
    nextCursor
  });
}

function readResult(value) {
  const record = object(value);
  if (!record || typeof record !== "object") throw new Error("The notification read result is unavailable.");
  return Object.freeze({ notificationId: uuid(record.notificationId, "notification id"), readAt: timestamp(record.readAt, "notification read time") });
}

function readAllResult(value) {
  const record = object(value);
  const markedRead = Number(record?.markedRead);
  if (!Number.isSafeInteger(markedRead) || markedRead < 0) throw new Error("The notification read-all result is unavailable.");
  return Object.freeze({ markedRead, cutoffCreatedAt: timestamp(record.cutoffCreatedAt, "notification cutoff time") });
}

export function createNotificationService(repository, options = {}) {
  if (!repository || !["listNotifications", "markNotificationRead", "markAllNotificationsRead"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete notification repository is required.");
  const now = typeof options.now === "function" ? options.now : () => new Date();
  return Object.freeze({
    async listNotifications(actor, input = {}) {
      authenticated(actor);
      const beforeCreatedAt = timestamp(input.beforeCreatedAt, "notification cursor time", true);
      const beforeNotificationId = input.beforeNotificationId == null || input.beforeNotificationId === "" ? null : uuid(input.beforeNotificationId, "notification cursor id");
      if ((beforeCreatedAt === null) !== (beforeNotificationId === null)) throw new TypeError("Notification cursor time and id must be supplied together.");
      return page(await repository.listNotifications(actor, { beforeCreatedAt, beforeNotificationId, limit: integer(input.limit, 1, 100, 30, "Notification page size") }));
    },
    async markNotificationRead(actor, notificationId) {
      authenticated(actor);
      return readResult(await repository.markNotificationRead(actor, uuid(notificationId, "notification id")));
    },
    async markAllNotificationsRead(actor, input = {}) {
      authenticated(actor);
      const supplied = input.cutoffCreatedAt == null || input.cutoffCreatedAt === "" ? now().toISOString() : input.cutoffCreatedAt;
      return readAllResult(await repository.markAllNotificationsRead(actor, timestamp(supplied, "notification cutoff time")));
    }
  });
}

export { safePayloadKeys };
