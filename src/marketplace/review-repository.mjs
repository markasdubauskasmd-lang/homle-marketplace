function mapReviewError(error) {
  const errors = {
    "booking-not-found": [404, "booking-not-found", "The booking was not found."],
    "cleaner-not-found": [404, "cleaner-not-found", "The Cleaner profile was not found."],
    "review-not-found": [404, "review-not-found", "The review was not found."],
    "approved-review-not-found": [404, "approved-review-not-found", "An approved review is not available for this booking."],
    "booking-not-ready-for-completion": [409, "booking-not-ready-for-completion", "The Cleaner must finish the checklist before the visit can be confirmed complete."],
    "review-requires-completed-booking": [409, "review-requires-completed-booking", "A review can be submitted only after the booking is completed."],
    "review-already-submitted": [409, "review-already-submitted", "This completed booking already has a different review."],
    "review-response-final": [409, "review-response-final", "The Cleaner response has already been submitted."],
    "invalid-booking-review": [422, "invalid-booking-review", "The review ratings or written review are invalid."],
    "invalid-review-response": [422, "invalid-review-response", "The Cleaner response is invalid."],
    "invalid-review-moderation": [422, "invalid-review-moderation", "The review moderation decision is invalid."],
    "invalid-review-cursor": [422, "invalid-review-cursor", "The review page cursor is invalid."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createReviewRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function" || typeof database.withAuthenticationTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  async function privateCall(actor, queryText, values) {
    return database.withUserTransaction(actor, async (client) => {
      try { return (await client.query(queryText, values)).rows[0]?.result; }
      catch (error) { throw mapReviewError(error); }
    });
  }
  return Object.freeze({
    confirmCompletion(actor, bookingId) {
      return privateCall(actor, "SELECT tideway_private.confirm_booking_completion($1::uuid) AS result", [bookingId]);
    },
    submitReview(actor, input) {
      return privateCall(actor, "SELECT tideway_private.submit_booking_review($1::uuid,$2::uuid,$3::smallint,$4::smallint,$5::smallint,$6::smallint,$7::smallint,$8::text) AS result", [input.bookingId, input.reviewId, input.rating, input.qualityRating, input.punctualityRating, input.communicationRating, input.professionalismRating, input.writtenReview]);
    },
    getBookingReview(actor, bookingId) {
      return privateCall(actor, "SELECT tideway_private.get_booking_review($1::uuid) AS result", [bookingId]);
    },
    getPublicReviews(cleanerId, input) {
      return database.withAuthenticationTransaction(async (client) => {
        try { return (await client.query("SELECT tideway_private.get_public_cleaner_reviews($1::uuid,$2::timestamptz,$3::uuid,$4::integer) AS result", [cleanerId, input.beforeCreatedAt, input.beforeReviewId, input.limit])).rows[0]?.result; }
        catch (error) { throw mapReviewError(error); }
      });
    },
    respondToReview(actor, bookingId, response) {
      return privateCall(actor, "SELECT tideway_private.respond_to_booking_review($1::uuid,$2::text) AS result", [bookingId, response]);
    },
    moderateReview(actor, reviewId, input) {
      return privateCall(actor, "SELECT tideway_private.moderate_booking_review($1::uuid,$2::text,$3::text) AS result", [reviewId, input.decision, input.note]);
    }
  });
}
