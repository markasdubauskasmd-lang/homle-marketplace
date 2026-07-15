function mapNotificationError(error) {
  const errors = {
    "notification-not-found": [404, "notification-not-found", "The notification was not found."],
    "invalid-notification-cursor": [422, "invalid-notification-cursor", "The notification page cursor is invalid."],
    "invalid-notification-cutoff": [422, "invalid-notification-cutoff", "The notification read cutoff is invalid."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createNotificationRepository(database) {
  if (!database || typeof database.withAccountTransaction !== "function") throw new TypeError("The marketplace account database boundary is required.");

  async function call(actor, queryText, values) {
    return database.withAccountTransaction(actor, async (client) => {
      try { return (await client.query(queryText, values)).rows[0]?.result; }
      catch (error) { throw mapNotificationError(error); }
    });
  }

  return Object.freeze({
    listNotifications(actor, input) {
      return call(actor, "SELECT tideway_private.get_my_notifications($1::timestamptz,$2::uuid,$3::integer) AS result", [input.beforeCreatedAt, input.beforeNotificationId, input.limit]);
    },
    markNotificationRead(actor, notificationId) {
      return call(actor, "SELECT tideway_private.mark_my_notification_read($1::uuid) AS result", [notificationId]);
    },
    markAllNotificationsRead(actor, cutoffCreatedAt) {
      return call(actor, "SELECT tideway_private.mark_all_my_notifications_read($1::timestamptz) AS result", [cutoffCreatedAt]);
    }
  });
}
