export const marketplaceRoles = Object.freeze(["cleaner", "landlord", "administrator"]);

export const bookingStatuses = Object.freeze([
  "draft",
  "searching-for-cleaner",
  "cleaner-invited",
  "pending-cleaner-acceptance",
  "confirmed",
  "cleaner-en-route",
  "cleaner-arrived",
  "cleaning-in-progress",
  "awaiting-review",
  "completed",
  "cancelled",
  "disputed"
]);

export const taskStatuses = Object.freeze(["not-started", "in-progress", "completed", "skipped", "issue-reported"]);

const transitions = Object.freeze({
  draft: new Set(["searching-for-cleaner", "cancelled"]),
  "searching-for-cleaner": new Set(["cleaner-invited", "cancelled"]),
  "cleaner-invited": new Set(["pending-cleaner-acceptance", "searching-for-cleaner", "cancelled"]),
  "pending-cleaner-acceptance": new Set(["confirmed", "searching-for-cleaner", "cancelled"]),
  confirmed: new Set(["cleaner-en-route", "cleaner-arrived", "cancelled", "disputed"]),
  "cleaner-en-route": new Set(["cleaner-arrived", "cancelled", "disputed"]),
  "cleaner-arrived": new Set(["cleaning-in-progress", "disputed"]),
  "cleaning-in-progress": new Set(["awaiting-review", "disputed"]),
  "awaiting-review": new Set(["completed", "disputed"]),
  completed: new Set(["disputed"]),
  cancelled: new Set([]),
  disputed: new Set(["completed", "cancelled"])
});

const cleanerTransitions = new Set([
  "cleaner-invited:pending-cleaner-acceptance",
  "pending-cleaner-acceptance:confirmed",
  "pending-cleaner-acceptance:searching-for-cleaner",
  "confirmed:cleaner-en-route",
  "confirmed:cleaner-arrived",
  "cleaner-en-route:cleaner-arrived",
  "cleaner-arrived:cleaning-in-progress",
  "cleaning-in-progress:awaiting-review",
  "confirmed:disputed",
  "cleaner-en-route:disputed",
  "cleaner-arrived:disputed",
  "cleaning-in-progress:disputed"
]);

const landlordTransitions = new Set([
  "draft:searching-for-cleaner",
  "draft:cancelled",
  "searching-for-cleaner:cancelled",
  "cleaner-invited:cancelled",
  "pending-cleaner-acceptance:cancelled",
  "confirmed:cancelled",
  "awaiting-review:completed",
  "confirmed:disputed",
  "cleaner-en-route:disputed",
  "cleaner-arrived:disputed",
  "cleaning-in-progress:disputed",
  "awaiting-review:disputed",
  "completed:disputed"
]);

const locationShareStatuses = new Set(["confirmed", "cleaner-en-route"]);
const progressUpdateStatuses = new Set(["cleaner-arrived", "cleaning-in-progress"]);
const protectedPropertyStatuses = new Set(["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "disputed"]);

function actorRoles(actor) {
  return new Set(Array.isArray(actor?.roles) ? actor.roles.filter((role) => marketplaceRoles.includes(role)) : []);
}

export function isMarketplaceRole(role) {
  return marketplaceRoles.includes(role);
}

export function isBookingStatus(status) {
  return bookingStatuses.includes(status);
}

export function isTaskStatus(status) {
  return taskStatuses.includes(status);
}

export function isBookingParticipant(actor, booking) {
  if (!actor?.userId || !booking) return false;
  return actor.userId === booking.cleanerUserId || actor.userId === booking.landlordUserId;
}

export function canAccessBooking(actor, booking) {
  return actorRoles(actor).has("administrator") || isBookingParticipant(actor, booking);
}

export function canAccessProtectedPropertyInstructions(actor, booking) {
  if (!canAccessBooking(actor, booking) || !protectedPropertyStatuses.has(booking?.status)) return false;
  const roles = actorRoles(actor);
  return roles.has("administrator") || (roles.has("cleaner") && actor.userId === booking.cleanerUserId) || (roles.has("landlord") && actor.userId === booking.landlordUserId);
}

export function canTransitionBooking(actor, booking, nextStatus) {
  if (!canAccessBooking(actor, booking) || !isBookingStatus(nextStatus) || !transitions[booking?.status]?.has(nextStatus)) return false;
  const roles = actorRoles(actor);
  if (roles.has("administrator")) return true;
  const transition = `${booking.status}:${nextStatus}`;
  if (roles.has("cleaner") && actor.userId === booking.cleanerUserId && cleanerTransitions.has(transition)) return true;
  return roles.has("landlord") && actor.userId === booking.landlordUserId && landlordTransitions.has(transition);
}

export function canUpdateCleanerLocation(actor, booking, consentGranted) {
  const roles = actorRoles(actor);
  return consentGranted === true && roles.has("cleaner") && actor?.userId === booking?.cleanerUserId && locationShareStatuses.has(booking?.status);
}

export function shouldStopLocationSharing(status) {
  return !locationShareStatuses.has(status);
}

export function canUpdateCleaningTask(actor, booking) {
  const roles = actorRoles(actor);
  return roles.has("cleaner") && actor?.userId === booking?.cleanerUserId && progressUpdateStatuses.has(booking?.status);
}

export function canReviewCompletedBooking(actor, booking) {
  const roles = actorRoles(actor);
  return roles.has("landlord") && actor?.userId === booking?.landlordUserId && booking?.status === "completed";
}

export function allowedBookingTransitions(status) {
  return isBookingStatus(status) ? [...transitions[status]] : [];
}
