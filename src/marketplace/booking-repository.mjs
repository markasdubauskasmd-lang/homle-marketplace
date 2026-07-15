function mappedDatabaseError(error) {
  const messages = {
    "request-not-found": [404, "request-not-found", "The cleaning request was not found."],
    "booking-not-found": [404, "booking-not-found", "The booking invitation was not found."],
    "request-not-matchable": [409, "request-not-matchable", "This cleaning request is no longer available for matching."],
    "cleaner-not-eligible": [409, "cleaner-not-eligible", "This cleaner is not currently eligible for invitations."],
    "cleaner-services-mismatch": [409, "services-mismatch", "The cleaner no longer offers every required service."],
    "cleaner-unavailable": [409, "cleaner-unavailable", "The cleaner is no longer available for this time."],
    "invitation-expired": [409, "invitation-expired", "This invitation has expired."],
    "invitation-not-pending": [409, "invitation-not-pending", "This invitation has already been answered or closed."],
    "booking-scope-changed": [409, "scope-changed", "The cleaning scope changed after this invitation was created."],
    "cleaner-schedule-conflict": [409, "schedule-conflict", "Another confirmed job now overlaps this booking."],
    "invalid-booking-economics": [409, "invalid-booking-economics", "The private booking terms do not satisfy the approved budget and margin rules."],
    "invalid-response-window": [409, "invalid-response-window", "The cleaner response window is no longer valid."]
  };
  const selected = messages[error?.message] || (error?.code === "23P01" ? messages["cleaner-schedule-conflict"] : null);
  if (!selected) return error;
  return Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error });
}

export function createBookingRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    getInvitationCandidate(actor, requestId, cleanerId) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT request.id, request.requested_start_at, request.requested_end_at, request.required_services, request.budget_pence, COALESCE(jsonb_agg(jsonb_build_object('serviceCode', service.service_code, 'pricingModel', service.pricing_model, 'pricePence', service.price_pence) ORDER BY service.service_code) FILTER (WHERE service.id IS NOT NULL), '[]'::jsonb) AS services FROM cleaning_requests request JOIN cleaner_profiles profile ON profile.user_id=$2::uuid AND profile.is_public LEFT JOIN cleaner_services service ON service.cleaner_user_id=profile.user_id AND service.is_active WHERE request.id=$1::uuid AND request.landlord_user_id=$3::uuid AND request.status='searching-for-cleaner' GROUP BY request.id",
          [requestId, cleanerId, actor.userId]
        );
        return result.rows[0] || null;
      });
    },
    inviteCleaner(actor, invitation) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT (tideway_private.invite_cleaner($1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5::integer, $6::integer, $7::integer, $8::integer, $9::integer, $10::integer, $11::integer, $12::integer)).*",
            [invitation.bookingId, invitation.requestId, invitation.cleanerId, invitation.responseDeadline, invitation.customerPricePence, invitation.cleanerPayPence, invitation.labourOnCostPence, invitation.paymentFeePence, invitation.travelCostPence, invitation.suppliesCostPence, invitation.otherCostPence, invitation.targetMarginBasisPoints]
          );
          return result.rows[0];
        } catch (error) { throw mappedDatabaseError(error); }
      });
    },
    respondToInvitation(actor, bookingId, response) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT (tideway_private.respond_to_cleaner_invitation($1::uuid, $2::text, $3::text)).*", [bookingId, response.decision, response.reason]);
          return result.rows[0];
        } catch (error) { throw mappedDatabaseError(error); }
      });
    }
  });
}
