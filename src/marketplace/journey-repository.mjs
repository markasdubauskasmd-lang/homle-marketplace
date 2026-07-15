function mapJourneyError(error) {
  const errors = {
    "booking-not-found": [404, "booking-not-found", "The booking was not found."],
    "location-consent-required": [409, "location-consent-required", "Location sharing requires explicit Cleaner consent."],
    "invalid-location-update": [422, "invalid-location-update", "The supplied location update is invalid."],
    "journey-not-startable": [409, "journey-not-startable", "This confirmed booking cannot start a journey now."],
    "journey-outside-safe-window": [409, "journey-outside-safe-window", "Location sharing is outside the safe booking window."],
    "location-sharing-inactive": [409, "location-sharing-inactive", "Start the journey and grant location consent before sharing updates."],
    "arrival-not-allowed": [409, "arrival-not-allowed", "Arrival cannot be recorded from the current booking status."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createJourneyRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  async function call(actor, text, values) {
    return database.withUserTransaction(actor, async (client) => {
      try { return (await client.query(text, values)).rows[0]?.snapshot; }
      catch (error) { throw mapJourneyError(error); }
    });
  }
  return Object.freeze({
    getJourneyContext(actor, bookingId) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT booking.scheduled_start_at, property.latitude AS destination_latitude, property.longitude AS destination_longitude FROM bookings booking JOIN properties property ON property.id=booking.property_id WHERE booking.id=$1::uuid AND booking.cleaner_user_id=$2::uuid AND booking.status IN ('confirmed', 'cleaner-en-route')",
          [bookingId, actor.userId]
        );
        return result.rows[0] || null;
      });
    },
    startJourney(actor, bookingId, update) {
      return call(actor, "SELECT tideway_private.start_cleaner_journey($1::uuid, $2::boolean, $3::numeric, $4::numeric, $5::numeric, $6::timestamptz) AS snapshot", [bookingId, update.consentGranted, update.latitude, update.longitude, update.accuracyMetres, update.estimatedArrivalAt]);
    },
    updateLocation(actor, bookingId, update) {
      return call(actor, "SELECT tideway_private.update_cleaner_location($1::uuid, $2::numeric, $3::numeric, $4::numeric, $5::timestamptz) AS snapshot", [bookingId, update.latitude, update.longitude, update.accuracyMetres, update.estimatedArrivalAt]);
    },
    markArrived(actor, bookingId) {
      return call(actor, "SELECT tideway_private.mark_cleaner_arrived($1::uuid) AS snapshot", [bookingId]);
    },
    getTracking(actor, bookingId) {
      return call(actor, "SELECT tideway_private.get_booking_tracking($1::uuid) AS snapshot", [bookingId]);
    }
  });
}
