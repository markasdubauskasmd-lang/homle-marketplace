import {
  allowedBookingTransitions,
  bookingStatuses,
  canAccessBooking,
  canAccessProtectedPropertyInstructions,
  canReviewCompletedBooking,
  canTransitionBooking,
  canUpdateCleanerLocation,
  canUpdateCleaningTask,
  isMarketplaceRole,
  shouldStopLocationSharing,
  taskStatuses
} from "../src/marketplace/domain.mjs";
import { marketplaceEnvironment, publicAuthenticationCapabilities, validateMarketplaceEnvironment } from "../src/marketplace/config.mjs";
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const landlord = { userId: "user-landlord", roles: ["landlord"] };
const cleaner = { userId: "user-cleaner", roles: ["cleaner"] };
const unrelatedCleaner = { userId: "user-other", roles: ["cleaner"] };
const administrator = { userId: "user-admin", roles: ["administrator"] };
const booking = { landlordUserId: landlord.userId, cleanerUserId: cleaner.userId, status: "confirmed" };

assert(isMarketplaceRole("cleaner") && isMarketplaceRole("landlord") && isMarketplaceRole("administrator") && !isMarketplaceRole("owner"), "Marketplace roles are not closed to the three supported account roles.");
assert(bookingStatuses.length === 12 && bookingStatuses.includes("cleaner-en-route") && bookingStatuses.includes("disputed"), "Booking lifecycle is incomplete.");
assert(taskStatuses.length === 5 && taskStatuses.includes("issue-reported"), "Cleaning-task lifecycle is incomplete.");
assert(canAccessBooking(landlord, booking) && canAccessBooking(cleaner, booking) && canAccessBooking(administrator, booking), "A booking participant or administrator could not access the booking.");
assert(!canAccessBooking(unrelatedCleaner, booking), "An unrelated cleaner could access a booking.");
assert(canAccessProtectedPropertyInstructions(cleaner, booking) && !canAccessProtectedPropertyInstructions(cleaner, { ...booking, status: "pending-cleaner-acceptance" }) && !canAccessProtectedPropertyInstructions(unrelatedCleaner, booking), "Sensitive property instructions were not limited to an accepted booking participant.");
assert(canTransitionBooking(cleaner, booking, "cleaner-en-route") && !canTransitionBooking(landlord, booking, "cleaner-en-route") && canTransitionBooking(administrator, booking, "cancelled"), "Booking transitions were not role-authorised.");
assert(!canTransitionBooking(cleaner, booking, "completed") && allowedBookingTransitions("confirmed").includes("cleaner-en-route"), "A cleaner could skip the audited booking lifecycle.");
assert(canUpdateCleanerLocation(cleaner, booking, true) && !canUpdateCleanerLocation(cleaner, booking, false) && !canUpdateCleanerLocation(unrelatedCleaner, booking, true), "Live location was not bound to cleaner consent and booking participation.");
assert(!shouldStopLocationSharing("cleaner-en-route") && shouldStopLocationSharing("cleaner-arrived") && shouldStopLocationSharing("cancelled") && shouldStopLocationSharing("completed"), "Location sharing did not stop at the required terminal boundaries.");
assert(canUpdateCleaningTask(cleaner, { ...booking, status: "cleaning-in-progress" }) && !canUpdateCleaningTask(cleaner, booking) && !canUpdateCleaningTask(unrelatedCleaner, { ...booking, status: "cleaning-in-progress" }), "Cleaning progress was not limited to the assigned cleaner during an active clean.");
assert(canReviewCompletedBooking(landlord, { ...booking, status: "completed" }) && !canReviewCompletedBooking(landlord, booking) && !canReviewCompletedBooking(unrelatedCleaner, { ...booking, status: "completed" }), "Review eligibility was not limited to the completed booking's landlord.");

const emptyEnvironment = marketplaceEnvironment({});
assert(!emptyEnvironment.databaseConfigured && !emptyEnvironment.capabilities.google && !emptyEnvironment.capabilities.emailPassword, "Unconfigured authentication appeared enabled.");
const partialGoogle = validateMarketplaceEnvironment({ GOOGLE_CLIENT_ID: "client-only" });
assert(!partialGoogle.ok && partialGoogle.errors.some((error) => error.includes("GOOGLE_CLIENT_SECRET")), "Partial Google OAuth configuration did not fail closed.");
const weakSession = validateMarketplaceEnvironment({ SESSION_SECRET: "too-short" });
assert(!weakSession.ok && weakSession.errors.some((error) => error.includes("32 characters")), "A weak session secret passed validation.");
const incompleteProduction = validateMarketplaceEnvironment({ NODE_ENV: "production", APP_ORIGIN: "http://example.com" });
assert(!incompleteProduction.ok && incompleteProduction.errors.some((error) => error.includes("DATABASE_URL")) && incompleteProduction.errors.some((error) => error.includes("HTTPS")), "Production marketplace configuration passed without its database, encryption or HTTPS boundary.");
const validProduction = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://tideway.example.com",
  DATABASE_URL: "postgresql://tideway:secret@db.example.com/tideway",
  SESSION_SECRET: "s".repeat(32),
  DATA_ENCRYPTION_KEY: "e".repeat(32),
  SMTP_URL: "smtps://mail.example.com",
  EMAIL_FROM: "Tideway <hello@example.com>",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret"
};
assert(validateMarketplaceEnvironment(validProduction).ok, "A complete production foundation configuration was rejected.");
const publicCapabilities = publicAuthenticationCapabilities(validProduction);
assert(publicCapabilities.google === true && publicCapabilities.emailPassword === true && publicCapabilities.apple === false && !JSON.stringify(publicCapabilities).includes("google-secret") && !JSON.stringify(publicCapabilities).includes("SESSION_SECRET"), "Public authentication capabilities exposed secrets or misreported provider readiness.");

const schemaSql = await readFile(new URL("../db/migrations/001_marketplace_schema.sql", import.meta.url), "utf8");
const rlsSql = await readFile(new URL("../db/migrations/002_marketplace_row_level_security.sql", import.meta.url), "utf8");
for (const table of ["users", "authentication_identities", "cleaner_profiles", "landlord_profiles", "properties", "cleaning_requests", "bookings", "booking_status_history", "cleaning_tasks", "task_updates", "job_photos", "cleaner_locations", "conversations", "messages", "reviews", "notifications", "disputes", "audit_logs"]) {
  assert(schemaSql.includes(`CREATE TABLE ${table} (`), `Marketplace migration omitted ${table}.`);
}
assert(schemaSql.includes("UNIQUE (provider, provider_subject)") && schemaSql.includes("UNIQUE (user_id, provider)"), "OAuth identities lack provider subject or per-account provider uniqueness.");
assert(schemaSql.includes("access_instructions_ciphertext bytea") && !schemaSql.includes("access_instructions text"), "Sensitive property access instructions are not stored behind an encryption boundary.");
assert(schemaSql.includes("EXCLUDE USING gist") && schemaSql.includes("bookings_no_cleaner_overlap") && schemaSql.includes("tstzrange(scheduled_start_at, scheduled_end_at, '[)')"), "PostgreSQL migration lacks its transactional overlapping-booking constraint.");
assert(schemaSql.includes("booking_id uuid NOT NULL UNIQUE REFERENCES bookings") && schemaSql.includes("Reviews require a completed booking") && schemaSql.includes("reviews_refresh_cleaner_rating"), "Completed-only unique reviews or aggregate recalculation are missing.");
assert(schemaSql.includes("booking_id uuid PRIMARY KEY REFERENCES bookings") && schemaSql.includes("expires_at timestamptz NOT NULL"), "Current-only expiring cleaner location storage is missing.");
assert(rlsSql.includes("ALTER TABLE cleaner_locations ENABLE ROW LEVEL SECURITY") && rlsSql.includes("location_assigned_cleaner_write") && rlsSql.includes("booking_participant") && rlsSql.includes("completed_booking_landlord_reviews"), "Row-level booking, location or review authorization policies are missing.");

console.log("Marketplace foundation tests passed: role-based booking access, transition authority, protected property instructions, consent-bound live location, cleaning-progress ownership, completed-booking review eligibility and fail-closed authentication configuration.");
