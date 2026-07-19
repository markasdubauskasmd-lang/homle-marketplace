const mapped = Object.freeze({
  "administrator-required": [403, "administrator-required", "A Homle Administrator account is required."],
  "invalid-verification-view": [422, "invalid-verification-view", "Choose a valid cleaner verification view."],
  "invalid-verification-page": [422, "invalid-verification-page", "The cleaner verification page is invalid."],
  "cleaner-required": [422, "cleaner-required", "A cleaner is required."],
  "invalid-identity-check-status": [422, "invalid-identity-check-status", "Choose a supported identity check status."],
  "invalid-background-check-status": [422, "invalid-background-check-status", "Choose a supported background check status."],
  "no-verification-change-supplied": [422, "no-verification-change-supplied", "Supply an identity or background check status to change."],
  "cleaner-profile-not-found": [404, "cleaner-profile-not-found", "That cleaner profile was not found."]
});

function mapError(error) {
  const selected = mapped[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createAdministratorVerificationRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    listQueue(actor, input) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.list_cleaner_verification_queue($1::text,$2::integer,$3::integer) AS result", [input.view, input.limit, input.offset]);
          return result.rows[0]?.result;
        } catch (error) { throw mapError(error); }
      });
    },
    setVerification(actor, input) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.set_cleaner_verification($1::uuid,$2::text,$3::text,$4::text) AS result", [input.cleanerId, input.identityCheckStatus, input.backgroundCheckStatus, input.note]);
          return result.rows[0]?.result;
        } catch (error) { throw mapError(error); }
      });
    }
  });
}
