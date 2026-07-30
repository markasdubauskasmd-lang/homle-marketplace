const mappedErrors = Object.freeze({
  "landlord-required": [403, "landlord-required", "A Landlord account is required."],
  "administrator-required": [403, "administrator-required", "A Homle Administrator account is required."],
  "account-inactive": [403, "account-inactive", "This account is not active."],
  "invalid-support-request": [422, "invalid-support-request", "The support request is invalid or contains information that must not be stored here."],
  "invalid-support-status": [422, "invalid-support-status", "Choose a valid support status."],
  "invalid-support-category": [422, "invalid-support-category", "Choose a valid support category."],
  "invalid-support-page": [422, "invalid-support-page", "The support-request page is invalid."],
  "invalid-support-review": [422, "invalid-support-review", "The support review is incomplete or contains information that must not be stored here."],
  "support-request-limit": [409, "support-request-limit", "Resolve an existing support request before opening another."],
  "support-request-not-found": [404, "support-request-not-found", "The support request was not found."],
  "support-request-already-final": [409, "support-request-already-final", "This support request already has a final response."]
});

function mapError(error) {
  const selected = mappedErrors[error?.message];
  return selected
    ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error })
    : error;
}

export function createSupportRequestRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  async function call(actor, queryText, values) {
    return database.withUserTransaction(actor, async (client) => {
      try { return (await client.query(queryText, values)).rows[0]?.result; }
      catch (error) { throw mapError(error); }
    });
  }
  return Object.freeze({
    create(actor, input) {
      return call(actor, "SELECT tideway_private.create_landlord_support_request($1::uuid,$2::uuid,$3::text,$4::text,$5::text) AS result", [
        input.supportRequestId,
        input.clientRequestId,
        input.category,
        input.subject,
        input.description
      ]);
    },
    listOwn(actor, input) {
      return call(actor, "SELECT tideway_private.list_my_landlord_support_requests($1::integer,$2::integer) AS result", [input.limit, input.offset]);
    },
    listForAdministrator(actor, input) {
      return call(actor, "SELECT tideway_private.list_administrator_support_requests($1::text,$2::text,$3::integer,$4::integer) AS result", [
        input.status,
        input.category,
        input.limit,
        input.offset
      ]);
    },
    review(actor, supportRequestId, input) {
      return call(actor, "SELECT tideway_private.review_landlord_support_request($1::uuid,$2::text,$3::text) AS result", [
        supportRequestId,
        input.status,
        input.resolutionSummary
      ]);
    }
  });
}
