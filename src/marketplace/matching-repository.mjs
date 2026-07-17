function mapMatchingError(error) {
  const errors = {
    "request-not-found": [404, "request-not-found", "The cleaning request was not found."],
    "property-not-found": [409, "property-not-found", "The request property is no longer available."],
    "request-not-matchable": [409, "request-not-matchable", "This cleaning request is no longer open for matching."],
    "invalid-match-limit": [422, "invalid-match-limit", "The requested match limit is invalid."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createMatchingRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    recommendForRequest(actor, requestId, limit) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT * FROM tideway_private.recommend_cleaners_for_request_v2($1::uuid, $2::integer)", [requestId, limit]);
          return result.rows;
        } catch (error) { throw mapMatchingError(error); }
      });
    }
  });
}
