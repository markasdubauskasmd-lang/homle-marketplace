# Verified booking reviews

Tideway now has a source-complete review lifecycle for account-backed marketplace bookings. It remains detached from the local pilot until PostgreSQL migrations, authenticated UI and Administrator moderation are proven in staging.

## Lifecycle

1. The assigned Cleaner finishes every resolved checklist task. The existing cleaning transaction moves the booking to `awaiting-review`.
2. The booking Landlord uses `POST /api/marketplace/bookings/:bookingId/completion`. PostgreSQL rechecks ownership, the finished timestamp and exact status, then records the `awaiting-review` to `completed` history. This confirmation never moves money.
3. Only after that completed state can the same Landlord submit one review with `POST /api/marketplace/bookings/:bookingId/reviews`.
4. Overall rating is required from one to five. Quality, punctuality, communication and professionalism scores plus up to 3,000 characters of written feedback are optional.
5. A new review starts `pending`. It is visible to its Landlord and an authorized Administrator, but not to the Cleaner or public directory until approved.
6. An Administrator can approve or reject through `POST /api/marketplace/admin/reviews/:reviewId/moderation`. Rejection requires a private reason. Every moderation change is audited, so an approved review can later be removed from public aggregates if fraud or abuse evidence emerges.
7. The assigned Cleaner can post one professional response to an approved review through `POST /api/marketplace/bookings/:bookingId/reviews/response`. An identical network retry is safe; different later edits are rejected.

The unique booking key is the final concurrent one-review guard. Same-content retries return the original row, including after a racing insert; different content receives a conflict.

## Public and private reads

- `GET /api/marketplace/cleaners/:cleanerId/reviews` is public only for an active, public Cleaner profile and returns approved reviews with a bounded tuple cursor.
- Public rows include ratings, written feedback, the optional Cleaner response and timestamps. They never include the booking ID, Landlord user ID/name/contact details, moderation state/note or any property information.
- `GET /api/marketplace/bookings/:bookingId/reviews` is participant/Administrator-only. The Cleaner receives `null` until approval; the Landlord can see their pending/rejected state and private moderation note.
- The `tideway_app` role cannot select or mutate the raw `reviews` table. All access goes through narrow `SECURITY DEFINER` functions, in addition to RLS.

## Rating and completed-job integrity

The existing database trigger recalculates `average_rating` and `review_count` from approved rows only after every insert, moderation change, response update or deletion. The average uses PostgreSQL numeric arithmetic rounded to two decimals. Rejected and pending reviews contribute nothing.

A separate booking trigger recalculates `completed_job_count` from bookings with a recorded `completed_at`. Later dispute handling therefore does not erase evidence that a confirmed visit was completed. Direct browser-supplied counts or averages are never trusted.

Review, response and moderation audit entries include IDs/status/rating evidence only. Written review text, Cleaner response and moderation note are not copied into audit or notification payloads. Review notification emails contain no rating or content.

## Deployment and verification

Apply migration `018_verified_booking_reviews.sql`, then reapply runtime grants. Before exposing the routes:

- test two concurrent review submissions for one booking;
- prove a cancelled, active or merely `awaiting-review` booking cannot receive a review;
- prove another Landlord cannot complete or review the booking;
- prove the Cleaner cannot see pending/rejected content and cannot respond before approval;
- approve two known ratings and verify the exact average/count, then reject one and verify recalculation;
- prove public pages expose no reviewer or booking identity;
- prove the app role cannot select or update `reviews` directly;
- render review text with text-only DOM APIs and run stored-XSS/accessibility tests;
- test Administrator re-moderation and the one-response race.

Coverage is in `tests/review-service.mjs` and `tests/marketplace-http.mjs`. No review, rating, profile statistic, message, payment or live booking was created by this source checkpoint.
