function mapDatabaseError(error) {
  const known = {
    "invalid-facebook-deletion-request": [422, "invalid-facebook-deletion-request", "Facebook supplied an invalid deletion request."],
    "facebook-deletion-request-id-reused": [409, "facebook-deletion-request-id-reused", "The deletion request could not be safely retried."]
  };
  const selected = known[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createFacebookDataDeletionRepository(database) {
  if (!database || typeof database.withAuthenticationTransaction !== "function") throw new TypeError("The marketplace authentication database boundary is required.");
  return Object.freeze({
    request(input) {
      return database.withAuthenticationTransaction(async (client) => {
        try {
          return (await client.query(
            "SELECT tideway_private.request_facebook_data_deletion($1::uuid,$2::text,$3::bytea,$4::bytea) AS result",
            [input.requestId, input.subject, input.subjectHash, input.confirmationCodeHash]
          )).rows[0]?.result;
        } catch (error) { throw mapDatabaseError(error); }
      });
    },
    status(confirmationCodeHash) {
      return database.withAuthenticationTransaction(async (client) => (
        await client.query("SELECT tideway_private.get_facebook_data_deletion_status($1::bytea) AS result", [confirmationCodeHash])
      ).rows[0]?.result ?? null);
    }
  });
}
