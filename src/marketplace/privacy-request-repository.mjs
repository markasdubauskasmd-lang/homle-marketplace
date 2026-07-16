function mapPrivacyRequestError(error) {
  const errors = {
    "not-authenticated": [401, "not-authenticated", "Sign in before managing your Tideway data."],
    "account-not-active": [403, "account-not-active", "This account cannot create a new privacy request."],
    "invalid-privacy-request": [422, "invalid-privacy-request", "Choose a valid account privacy request."],
    "privacy-request-id-reused": [409, "privacy-request-id-reused", "This privacy request could not be safely retried."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createPrivacyRequestRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  async function privateCall(actor, queryText, values = []) {
    return database.withUserTransaction(actor, async (client) => {
      try { return (await client.query(queryText, values)).rows[0]?.result; }
      catch (error) { throw mapPrivacyRequestError(error); }
    });
  }
  return Object.freeze({
    list(actor) {
      return privateCall(actor, "SELECT tideway_private.get_my_privacy_requests() AS result");
    },
    request(actor, input) {
      return privateCall(actor, "SELECT tideway_private.request_my_privacy_action($1::uuid,$2::text) AS result", [input.requestId, input.requestType]);
    }
  });
}
