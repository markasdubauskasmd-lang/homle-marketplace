function mappedDatabaseError(error) {
  const messages = {
    "request-not-found": [404, "request-not-found", "The cleaning request was not found."],
    "property-not-found": [409, "property-not-found", "The request property is no longer available."],
    "booking-not-found": [404, "booking-not-found", "The booking invitation was not found."],
    "request-not-matchable": [409, "request-not-matchable", "This cleaning request is no longer available for matching."],
    "cleaner-not-eligible": [409, "cleaner-not-eligible", "This cleaner is not currently eligible for invitations."],
    "cleaner-account-inactive": [409, "cleaner-not-eligible", "This cleaner is not currently eligible for invitations."],
    "cleaner-property-mismatch": [409, "property-mismatch", "This cleaner does not support the request property type."],
    "cleaner-outside-service-area": [409, "outside-service-area", "This property is outside the cleaner's declared service area."],
    "cleaner-services-mismatch": [409, "services-mismatch", "The cleaner no longer offers every required service."],
    "cleaner-price-changed": [409, "cleaner-price-changed", "The cleaner's service price changed before the invitation was created."],
    "cleaner-unavailable": [409, "cleaner-unavailable", "The cleaner is no longer available for this time."],
    "cleaner-has-overlapping-invitation": [409, "schedule-conflict", "The cleaner already has an overlapping invitation or booking."],
    "invitation-expired": [409, "invitation-expired", "This invitation has expired."],
    "invitation-not-pending": [409, "invitation-not-pending", "This invitation has already been answered or closed."],
    "booking-scope-changed": [409, "scope-changed", "The cleaning scope changed after this invitation was created."],
    "cleaner-schedule-conflict": [409, "schedule-conflict", "Another confirmed job now overlaps this booking."],
    "invalid-booking-economics": [409, "invalid-booking-economics", "The private booking terms do not satisfy the approved budget and margin rules."],
    "invalid-response-window": [409, "invalid-response-window", "The cleaner response window is no longer valid."],
    "booking-participant-required": [403, "booking-participant-required", "A Cleaner or Landlord account is required to view booking summaries."],
    "invalid-booking-summary-limit": [400, "invalid-booking-summary-limit", "The booking summary limit is outside the supported range."]
  };
  const selected = messages[error?.message] || (error?.code === "23P01" ? messages["cleaner-schedule-conflict"] : null);
  if (!selected) return error;
  return Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error });
}

export function createBookingRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    listParticipantBookings(actor, maximumResults) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.list_my_booking_summaries($1::integer) AS bookings", [maximumResults]);
          return result.rows[0]?.bookings ?? [];
        } catch (error) { throw mappedDatabaseError(error); }
      });
    },
    getInvitationCandidate(actor, requestId, cleanerId) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          `SELECT request.id, request.requested_start_at, request.requested_end_at, request.required_services,
                  request.budget_pence, coverage.distance_km,
                  COALESCE(jsonb_agg(jsonb_build_object('serviceCode', service.service_code, 'pricingModel', service.pricing_model, 'pricePence', service.price_pence) ORDER BY service.service_code) FILTER (WHERE service.id IS NOT NULL), '[]'::jsonb) AS services
             FROM cleaning_requests request
             JOIN properties property ON property.id=request.property_id AND property.archived_at IS NULL
             JOIN cleaner_profiles profile ON profile.user_id=$2::uuid AND profile.is_public
             CROSS JOIN LATERAL (
               SELECT round(MIN(
                 CASE WHEN property.latitude IS NOT NULL AND property.longitude IS NOT NULL
                           AND area.latitude IS NOT NULL AND area.longitude IS NOT NULL
                   THEN 6371 * acos(LEAST(1, GREATEST(-1,
                     sin(radians(property.latitude::double precision)) * sin(radians(area.latitude::double precision)) +
                     cos(radians(property.latitude::double precision)) * cos(radians(area.latitude::double precision)) *
                     cos(radians(area.longitude::double precision - property.longitude::double precision))
                   ))) END
               )::numeric, 2) AS distance_km
                 FROM cleaner_service_areas area WHERE area.cleaner_user_id=profile.user_id
             ) coverage
             LEFT JOIN cleaner_services service ON service.cleaner_user_id=profile.user_id AND service.is_active
            WHERE request.id=$1::uuid AND request.landlord_user_id=$3::uuid AND profile.user_id<>request.landlord_user_id AND request.status='searching-for-cleaner'
            GROUP BY request.id, coverage.distance_km`,
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
