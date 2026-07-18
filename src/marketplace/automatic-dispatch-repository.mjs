const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const expectedErrors = Object.freeze({
  "automatic-dispatch-lease-not-found": ["dispatch-lease-lost", "The automatic-matching lease is no longer active."],
  "automatic-dispatch-attempt-limit": ["dispatch-attempt-limit", "The automatic-matching attempt limit was reached."],
  "automatic-dispatch-cleaner-already-tried": ["cleaner-already-tried", "This Cleaner was already invited for the request."],
  "request-not-matchable": ["request-not-matchable", "The cleaning request is no longer open for matching."],
  "cleaner-not-eligible": ["candidate-stale", "The Cleaner is no longer eligible."],
  "cleaner-account-inactive": ["candidate-stale", "The Cleaner is no longer eligible."],
  "cleaner-property-mismatch": ["candidate-stale", "The Cleaner no longer supports the property type."],
  "cleaner-outside-service-area": ["candidate-stale", "The property is outside the Cleaner service area."],
  "cleaner-services-mismatch": ["candidate-stale", "The Cleaner no longer offers every required service."],
  "cleaner-price-changed": ["candidate-stale", "The Cleaner price changed before invitation."],
  "cleaner-unavailable": ["candidate-stale", "The Cleaner is no longer available."],
  "cleaner-has-overlapping-invitation": ["candidate-stale", "The Cleaner now has overlapping work."],
  "invalid-booking-economics": ["candidate-stale", "The invitation no longer satisfies pricing controls."],
  "invalid-response-window": ["candidate-stale", "The invitation response window is no longer valid."]
});

function mappedError(error) {
  const selected = expectedErrors[error?.message] || (error?.code === "23P01" ? expectedErrors["cleaner-has-overlapping-invitation"] : null);
  if (!selected) return Object.assign(new Error("Automatic matching could not complete safely."), { code: "dispatch-database-failure", cause: error });
  return Object.assign(new Error(selected[1]), { code: selected[0], cause: error });
}

function jsonValue(row, preferredName) {
  if (!row || typeof row !== "object") throw new Error("Automatic matching returned an invalid database response.");
  return row[preferredName] ?? Object.values(row)[0];
}

function candidateValue(row) {
  const value = jsonValue(row, "get_automatic_dispatch_candidates");
  if (!value || typeof value !== "object" || Array.isArray(value) || !uuidPattern.test(value.cleaner_id || "")) throw new Error("Automatic matching returned an invalid candidate.");
  return value;
}

export function createAutomaticDispatchRepository(pool) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A dedicated Homle worker PostgreSQL pool is required.");
  return Object.freeze({
    async claimDue(leaseToken, batchLimit, leaseSeconds) {
      try {
        const result = await pool.query("SELECT * FROM tideway_private.claim_due_automatic_dispatch($1::uuid,$2::integer,$3::integer)", [leaseToken, batchLimit, leaseSeconds]);
        return Object.freeze((result?.rows || []).map((row) => Object.freeze({ cleaningRequestId: row.cleaning_request_id, leaseExpiresAt: new Date(row.lease_expires_at).toISOString() })));
      } catch (error) { throw mappedError(error); }
    },
    async getCandidates(cleaningRequestId, leaseToken, resultLimit) {
      try {
        const result = await pool.query("SELECT * FROM tideway_private.get_automatic_dispatch_candidates($1::uuid,$2::uuid,$3::integer)", [cleaningRequestId, leaseToken, resultLimit]);
        return Object.freeze((result?.rows || []).map(candidateValue));
      } catch (error) { throw mappedError(error); }
    },
    async complete(input) {
      try {
        const result = await pool.query(
          "SELECT tideway_private.complete_automatic_dispatch($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::timestamptz,$6::integer,$7::integer,$8::integer,$9::integer,$10::integer,$11::integer,$12::integer,$13::integer,$14::integer) AS dispatch",
          [input.cleaningRequestId, input.leaseToken, input.bookingId, input.cleanerId, input.responseDeadline, input.customerPricePence, input.cleanerPayPence, input.labourOnCostPence, input.paymentFeePence, input.travelCostPence, input.suppliesCostPence, input.otherCostPence, input.targetMarginBasisPoints, input.targetContributionPence]
        );
        const value = jsonValue(result?.rows?.[0], "dispatch");
        if (!value || typeof value !== "object" || !uuidPattern.test(value.bookingId || "")) throw new Error("Automatic matching returned an invalid invitation.");
        return Object.freeze(value);
      } catch (error) { if (error?.message?.startsWith("Automatic matching returned")) throw error; throw mappedError(error); }
    },
    async release(cleaningRequestId, leaseToken, outcome, retryAt) {
      try {
        const result = await pool.query("SELECT tideway_private.release_automatic_dispatch_lease($1::uuid,$2::uuid,$3::text,$4::timestamptz) AS release", [cleaningRequestId, leaseToken, outcome, retryAt]);
        return Object.freeze(jsonValue(result?.rows?.[0], "release"));
      } catch (error) { throw mappedError(error); }
    }
  });
}
