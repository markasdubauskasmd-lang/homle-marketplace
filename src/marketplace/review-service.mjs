import { randomUUID } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;
const urlPattern = /(?:https?:\/\/|www\.)/i;
const ukPhonePattern = /(?:^|[^\d])(?:\+?44|0)(?:[\s().-]*\d){9,10}(?:[^\d]|$)/;
const outsideContactPattern = /\b(?:whats?app|telegram|signal|instagram|facebook|snapchat)\b/i;

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function timestamp(value, label, nullable = false) {
  if (nullable && (value == null || value === "")) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new TypeError(`A valid ${label} is required.`);
  return new Date(value).toISOString();
}

function rating(value, label, optional = true) {
  if (optional && (value == null || value === "")) return null;
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < 1 || selected > 5) throw new TypeError(`${label} must be from 1 to 5.`);
  return selected;
}

function integer(value, minimum, maximum, fallback, label) {
  if (value == null || value === "") return fallback;
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return selected;
}

function text(value, maximum, label, required = false) {
  const normalized = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) throw new TypeError(`${label} is invalid.`);
  return normalized || null;
}

function publicText(value, maximum, label, required = false) {
  const normalized = text(value, maximum, label, required);
  if (normalized && (emailPattern.test(normalized) || urlPattern.test(normalized) || ukPhonePattern.test(normalized) || outsideContactPattern.test(normalized))) throw new TypeError(`${label} must not contain phone numbers, email addresses, links or outside-messaging handles.`);
  return normalized;
}

function role(actor, requiredRole, action) {
  if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes(requiredRole)) throw new TypeError(`A ${requiredRole === "administrator" ? "Homle Administrator" : requiredRole === "landlord" ? "Landlord" : "Cleaner"} account is required to ${action}.`);
}

function authenticated(actor) {
  if (!actor?.userId) throw new TypeError("An authenticated booking participant is required to view this review.");
}

function object(value) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return null; } }
  return value;
}

function review(value, { publicView = false } = {}) {
  const record = object(value);
  if (record == null) return null;
  if (typeof record !== "object") throw new Error("The review is unavailable.");
  const projected = {
    reviewId: uuid(record.reviewId, "review id"),
    rating: rating(record.rating, "Overall rating", false),
    qualityRating: rating(record.qualityRating, "Quality rating"),
    punctualityRating: rating(record.punctualityRating, "Punctuality rating"),
    communicationRating: rating(record.communicationRating, "Communication rating"),
    professionalismRating: rating(record.professionalismRating, "Professionalism rating"),
    writtenReview: text(record.writtenReview, 3000, "Written review"),
    cleanerResponse: text(record.cleanerResponse, 2000, "Cleaner response"),
    cleanerRespondedAt: timestamp(record.cleanerRespondedAt, "Cleaner response time", true),
    createdAt: timestamp(record.createdAt, "review creation time")
  };
  if (!publicView) {
    if (!["pending", "approved", "rejected"].includes(record.moderationStatus)) throw new Error("The review moderation status is unavailable.");
    projected.bookingId = uuid(record.bookingId, "review booking id");
    projected.cleanerId = uuid(record.cleanerId, "review Cleaner id");
    projected.moderationStatus = record.moderationStatus;
    projected.moderationNote = text(record.moderationNote, 2000, "Moderation note");
  }
  return Object.freeze(projected);
}

function completion(value) {
  const record = object(value);
  if (!record || record.status !== "completed") throw new Error("The booking completion result is unavailable.");
  return Object.freeze({ bookingId: uuid(record.bookingId, "booking id"), status: "completed", completedAt: timestamp(record.completedAt, "booking completion time") });
}

function publicPage(value) {
  const record = object(value);
  if (!record || !Array.isArray(record.reviews)) throw new Error("Public Cleaner reviews are unavailable.");
  const nextCursor = record.nextCursor ? Object.freeze({ beforeCreatedAt: timestamp(record.nextCursor.beforeCreatedAt, "review cursor time"), beforeReviewId: uuid(record.nextCursor.beforeReviewId, "review cursor id") }) : null;
  if ((record.hasMore === true) !== (nextCursor !== null)) throw new Error("The public review page cursor is inconsistent.");
  return Object.freeze({ cleanerId: uuid(record.cleanerId, "Cleaner id"), reviews: Object.freeze(record.reviews.map((item) => review(item, { publicView: true }))), hasMore: record.hasMore === true, nextCursor });
}

export function createReviewService(repository, options = {}) {
  if (!repository || !["confirmCompletion", "submitReview", "getBookingReview", "getPublicReviews", "respondToReview", "moderateReview"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete booking-review repository is required.");
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;
  return Object.freeze({
    async confirmCompletion(actor, bookingId) {
      role(actor, "landlord", "confirm a cleaning visit is complete");
      return completion(await repository.confirmCompletion(actor, uuid(bookingId, "booking id")));
    },
    async submitReview(actor, bookingId, input = {}) {
      role(actor, "landlord", "review a completed booking");
      return review(await repository.submitReview(actor, {
        bookingId: uuid(bookingId, "booking id"),
        reviewId: uuid(createId(), "generated review id"),
        rating: rating(input.rating, "Overall rating", false),
        qualityRating: rating(input.qualityRating, "Quality rating"),
        punctualityRating: rating(input.punctualityRating, "Punctuality rating"),
        communicationRating: rating(input.communicationRating, "Communication rating"),
        professionalismRating: rating(input.professionalismRating, "Professionalism rating"),
        writtenReview: publicText(input.writtenReview, 3000, "Written review")
      }));
    },
    async getBookingReview(actor, bookingId) {
      authenticated(actor);
      return review(await repository.getBookingReview(actor, uuid(bookingId, "booking id")));
    },
    async getPublicReviews(cleanerId, input = {}) {
      const beforeCreatedAt = timestamp(input.beforeCreatedAt, "review cursor time", true);
      const beforeReviewId = input.beforeReviewId == null || input.beforeReviewId === "" ? null : uuid(input.beforeReviewId, "review cursor id");
      if ((beforeCreatedAt === null) !== (beforeReviewId === null)) throw new TypeError("Review cursor time and id must be supplied together.");
      return publicPage(await repository.getPublicReviews(uuid(cleanerId, "Cleaner id"), { beforeCreatedAt, beforeReviewId, limit: integer(input.limit, 1, 50, 20, "Review page size") }));
    },
    async respondToReview(actor, bookingId, input = {}) {
      role(actor, "cleaner", "respond to this review");
      return review(await repository.respondToReview(actor, uuid(bookingId, "booking id"), publicText(input.response, 2000, "Cleaner response", true)));
    },
    async moderateReview(actor, reviewId, input = {}) {
      role(actor, "administrator", "moderate this review");
      const decision = input.decision;
      if (!["approved", "rejected"].includes(decision)) throw new TypeError("Review moderation decision must be approved or rejected.");
      return review(await repository.moderateReview(actor, uuid(reviewId, "review id"), { decision, note: text(input.note, 2000, "Moderation note", decision === "rejected") }));
    }
  });
}
