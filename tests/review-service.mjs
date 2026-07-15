import { readFile } from "node:fs/promises";
import { createReviewRepository } from "../src/marketplace/review-repository.mjs";
import { createReviewService } from "../src/marketplace/review-service.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).toLowerCase().includes(fragment.toLowerCase()); } return false; }

const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const administrator = { userId: "33333333-3333-4333-8333-333333333333", roles: ["administrator"] };
const bookingId = "55555555-5555-4555-8555-555555555555";
const reviewId = "77777777-7777-4777-8777-777777777777";
const calls = [];
const storedReview = {
  reviewId,
  bookingId,
  cleanerId: cleaner.userId,
  rating: 5,
  qualityRating: 5,
  punctualityRating: 4,
  communicationRating: 5,
  professionalismRating: 5,
  writtenReview: "Clear and professional.",
  moderationStatus: "pending",
  moderationNote: null,
  cleanerResponse: null,
  cleanerRespondedAt: null,
  createdAt: "2026-07-15T19:00:00.000Z"
};
const repository = {
  async confirmCompletion(actor, id) { calls.push({ kind: "complete", actor, id }); return { bookingId: id, status: "completed", completedAt: "2026-07-15T18:55:00.000Z" }; },
  async submitReview(actor, input) { calls.push({ kind: "submit", actor, input }); return { ...storedReview, reviewId: input.reviewId, rating: input.rating, qualityRating: input.qualityRating, punctualityRating: input.punctualityRating, communicationRating: input.communicationRating, professionalismRating: input.professionalismRating, writtenReview: input.writtenReview }; },
  async getBookingReview(actor, id) { calls.push({ kind: "get", actor, id }); return actor.userId === cleaner.userId ? null : storedReview; },
  async getPublicReviews(id, input) { calls.push({ kind: "public", id, input }); return { cleanerId: id, reviews: [{ ...storedReview, moderationStatus: undefined, bookingId: undefined, cleanerId: undefined, cleanerResponse: "Thank you.", cleanerRespondedAt: "2026-07-15T20:00:00.000Z", privateLandlordId: landlord.userId }], hasMore: true, nextCursor: { beforeCreatedAt: storedReview.createdAt, beforeReviewId: reviewId } }; },
  async respondToReview(actor, id, response) { calls.push({ kind: "respond", actor, id, response }); return { ...storedReview, moderationStatus: "approved", cleanerResponse: response, cleanerRespondedAt: "2026-07-15T20:00:00.000Z" }; },
  async moderateReview(actor, id, input) { calls.push({ kind: "moderate", actor, id, input }); return { ...storedReview, reviewId: id, moderationStatus: input.decision, moderationNote: input.note }; }
};
const service = createReviewService(repository, { createId: () => reviewId });

const completion = await service.confirmCompletion(landlord, bookingId);
const submitted = await service.submitReview(landlord, bookingId, { rating: 5, qualityRating: 5, punctualityRating: 4, communicationRating: 5, professionalismRating: 5, writtenReview: "  Clear and professional.  " });
assert(completion.status === "completed" && submitted.reviewId === reviewId && calls[1].input.reviewId === reviewId && calls[1].input.writtenReview === "Clear and professional.", "Landlord completion/review lost actor-bound booking IDs, ratings or normalized text.");
assert(await rejects(() => service.submitReview(landlord, bookingId, { rating: 6 }), "1 to 5") && await rejects(() => service.submitReview(cleaner, bookingId, { rating: 5 }), "Landlord") && await rejects(() => service.confirmCompletion(cleaner, bookingId), "Landlord"), "Review/completion validation accepted an invalid score or wrong role.");
assert(await rejects(() => service.submitReview(landlord, bookingId, { rating: 5, writtenReview: "Call me on 07123 456789" }), "must not contain") && await rejects(() => service.respondToReview(cleaner, bookingId, { response: "Visit https://example.com" }), "must not contain"), "Public review text accepted direct contact details or links.");
const pendingForCleaner = await service.getBookingReview(cleaner, bookingId);
assert(pendingForCleaner === null, "A pending or rejected review was exposed to the Cleaner before approval.");

const publicPage = await service.getPublicReviews(cleaner.userId, { limit: "10" });
assert(publicPage.reviews.length === 1 && publicPage.hasMore && publicPage.nextCursor.beforeReviewId === reviewId && !Object.hasOwn(publicPage.reviews[0], "bookingId") && !Object.hasOwn(publicPage.reviews[0], "cleanerId") && !Object.hasOwn(publicPage.reviews[0], "moderationStatus") && !JSON.stringify(publicPage).includes(landlord.userId), "Public reviews leaked booking, moderation or Landlord identity data.");
assert(await rejects(() => service.getPublicReviews(cleaner.userId, { beforeCreatedAt: storedReview.createdAt }), "supplied together") && await rejects(() => service.getPublicReviews(cleaner.userId, { limit: 51 }), "outside"), "Public review pagination accepted an incomplete cursor or excessive page.");

const response = await service.respondToReview(cleaner, bookingId, { response: "  Thank you.  " });
const moderation = await service.moderateReview(administrator, reviewId, { decision: "rejected", note: "  Contains personal information.  " });
assert(response.cleanerResponse === "Thank you." && calls.at(-2).response === "Thank you." && moderation.moderationStatus === "rejected" && calls.at(-1).input.note === "Contains personal information.", "Cleaner response or Administrator moderation lost one-time normalized content.");
assert(await rejects(() => service.respondToReview(landlord, bookingId, { response: "Attempt" }), "Cleaner") && await rejects(() => service.moderateReview(landlord, reviewId, { decision: "approved" }), "Administrator") && await rejects(() => service.moderateReview(administrator, reviewId, { decision: "rejected" }), "note"), "Review response/moderation accepted the wrong role or an unexplained rejection.");

const databaseCalls = [];
let databaseFailure = null;
const database = {
  async withUserTransaction(actor, operation) { return operation({ async query(queryText, values) { databaseCalls.push({ boundary: "private", actor, queryText, values }); if (databaseFailure) throw databaseFailure; return { rows: [{ result: storedReview }] }; } }); },
  async withAuthenticationTransaction(operation) { return operation({ async query(queryText, values) { databaseCalls.push({ boundary: "public", queryText, values }); if (databaseFailure) throw databaseFailure; return { rows: [{ result: { cleanerId: cleaner.userId, reviews: [], hasMore: false, nextCursor: null } }] }; } }); }
};
const reviewRepository = createReviewRepository(database);
await reviewRepository.submitReview(landlord, { bookingId, reviewId, rating: 5, qualityRating: null, punctualityRating: null, communicationRating: null, professionalismRating: null, writtenReview: null });
await reviewRepository.getPublicReviews(cleaner.userId, { beforeCreatedAt: null, beforeReviewId: null, limit: 20 });
assert(databaseCalls[0].queryText.includes("submit_booking_review") && databaseCalls[0].values[0] === bookingId && databaseCalls[0].actor.userId === landlord.userId && databaseCalls[1].boundary === "public" && databaseCalls[1].queryText.includes("get_public_cleaner_reviews") && databaseCalls.every((call) => !call.queryText.includes(landlord.userId)), "Review repository bypassed its private/public functions or interpolated actor data.");
databaseFailure = new Error("review-already-submitted");
assert(await rejects(() => reviewRepository.submitReview(landlord, { bookingId }), "already has"), "A duplicate different review did not receive a safe conflict.");

const schema = await readFile(new URL("../db/migrations/001_marketplace_schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../db/migrations/018_verified_booking_reviews.sql", import.meta.url), "utf8");
const grants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
assert(schema.includes("booking_id uuid NOT NULL UNIQUE") && schema.includes("moderation_status = 'approved'") && schema.includes("round(avg(rating)::numeric, 2)") && schema.includes("reviews_refresh_cleaner_rating"), "Base review schema lacks one-per-booking uniqueness or approved-only aggregate recalculation.");
for (const required of ["confirm_booking_completion", "status='completed'", "completed_at=now()", "submit_booking_review", "review-requires-completed-booking", "review-already-submitted", "get_public_cleaner_reviews", "moderation_status='approved'", "respond_to_booking_review", "review-response-final", "moderate_booking_review", "administrator-required", "reviews_moderation_evidence_check", "reviews_response_evidence_check", "refresh_cleaner_completed_job_count", "public_review_text_allowed", "review-submitted"]) assert(migration.includes(required), `Verified review migration omitted ${required}.`);
assert(migration.includes("booking.landlord_user_id=actor_id") && migration.includes("booking.cleaner_user_id=actor_id") && migration.includes("review.cleaner_user_id=target_cleaner_id") && !migration.includes("displayName") && !migration.includes("landlordUserId"), "Review functions lost participant ownership or exposed reviewer identity publicly.");
for (const required of ["confirm_booking_completion", "submit_booking_review", "get_booking_review", "get_public_cleaner_reviews", "respond_to_booking_review", "moderate_booking_review", "REVOKE SELECT, INSERT, UPDATE, DELETE ON reviews"]) assert(grants.includes(required), `Review runtime grants omitted ${required}.`);

console.log("Review tests passed: completed-only one-per-booking reviews, participant privacy, approved-only public pages, exact aggregates, moderation and one Cleaner response.");
