function mapRows(result) {
  return (result?.rows || []).map((row) => Object.freeze({
    notificationId: row.notification_id,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    eventType: row.event_type,
    bookingId: row.booking_id,
    payload: row.payload,
    attemptNumber: row.attempt_number
  }));
}

export function createEmailNotificationRepository(pool) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A dedicated Tideway worker PostgreSQL pool is required.");
  return Object.freeze({
    async claimDue(leaseToken, batchLimit, leaseSeconds) {
      return Object.freeze(mapRows(await pool.query(
        "SELECT * FROM tideway_private.claim_due_email_notifications($1::uuid,$2::integer,$3::integer)",
        [leaseToken, batchLimit, leaseSeconds]
      )));
    },
    async complete(notificationId, leaseToken, outcome, errorCode = null) {
      await pool.query(
        "SELECT tideway_private.complete_email_notification($1::uuid,$2::uuid,$3::text,$4::text)",
        [notificationId, leaseToken, outcome, errorCode]
      );
    }
  });
}
