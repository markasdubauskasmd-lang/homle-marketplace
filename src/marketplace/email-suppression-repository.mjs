function resultValue(result) {
  const value = result?.rows?.[0]?.result;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Email suppression persistence returned an invalid result.");
  return Object.freeze({
    accepted: value.accepted === true,
    duplicate: value.duplicate === true,
    ignored: value.ignored === true,
    matched: value.matched === true
  });
}

export function createEmailSuppressionRepository(database) {
  if (!database || typeof database.withAuthenticationTransaction !== "function") throw new TypeError("Email suppression requires the restricted authentication database boundary.");
  return Object.freeze({
    record(input) {
      return database.withAuthenticationTransaction(async (client) => resultValue(await client.query(
        `SELECT tideway_private.record_resend_email_suppression(
          $1::text,$2::citext,$3::text,$4::text,$5::timestamptz,$6::bytea
        ) AS result`,
        [
          input.providerEventId,
          input.recipientEmail,
          input.providerMessageId,
          input.reason,
          input.occurredAt,
          input.payloadSha256
        ]
      )));
    }
  });
}
