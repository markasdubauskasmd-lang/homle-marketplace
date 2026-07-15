import { readFile } from "node:fs/promises";
import { createJourneyRepository } from "../src/marketplace/journey-repository.mjs";
import { createJourneyService } from "../src/marketplace/journey-service.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }

const now = new Date("2026-07-20T08:30:00.000Z");
const bookingId = "55555555-5555-4555-8555-555555555555";
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
function tracking(overrides = {}) {
  return {
    bookingId,
    status: "cleaner-en-route",
    scheduledStartAt: "2026-07-20T09:00:00.000Z",
    scheduledEndAt: "2026-07-20T12:00:00.000Z",
    journeyStartedAt: now.toISOString(),
    arrivedAt: null,
    locationConsentAt: now.toISOString(),
    locationSharingStoppedAt: null,
    sharingState: "live",
    cleaner: { cleanerId: cleaner.userId, displayName: "Cleaner Example", profilePhotoUrl: null },
    location: { latitude: 51.501, longitude: -0.142, accuracyMetres: 8.5, estimatedArrivalAt: "2026-07-20T08:50:00.000Z", recordedAt: now.toISOString(), expiresAt: "2026-07-20T08:35:00.000Z" },
    ...overrides
  };
}
const calls = [];
const fakeRepository = {
  async getJourneyContext(actor, suppliedBookingId) { calls.push({ kind: "context", actor, suppliedBookingId }); return { scheduled_start_at: "2026-07-20T09:00:00.000Z", destination_latitude: "51.500000", destination_longitude: "-0.140000" }; },
  async startJourney(actor, suppliedBookingId, update) { calls.push({ kind: "start", actor, suppliedBookingId, update }); return tracking({ location: { ...tracking().location, latitude: update.latitude, longitude: update.longitude, accuracyMetres: update.accuracyMetres, estimatedArrivalAt: update.estimatedArrivalAt } }); },
  async updateLocation(actor, suppliedBookingId, update) { calls.push({ kind: "update", actor, suppliedBookingId, update }); return tracking({ location: { ...tracking().location, latitude: update.latitude, longitude: update.longitude, estimatedArrivalAt: update.estimatedArrivalAt } }); },
  async markArrived(actor, suppliedBookingId) { calls.push({ kind: "arrive", actor, suppliedBookingId }); return tracking({ status: "cleaner-arrived", arrivedAt: now.toISOString(), locationSharingStoppedAt: now.toISOString(), sharingState: "arrived", location: null }); },
  async getTracking(actor, suppliedBookingId) { calls.push({ kind: "read", actor, suppliedBookingId }); return tracking(); }
};
const etaProvider = { async estimateArrival(input) { calls.push({ kind: "eta", input }); return "2026-07-20T08:50:00.000Z"; } };
const service = createJourneyService(fakeRepository, { etaProvider, clock: () => new Date(now) });
const started = await service.startJourney(cleaner, bookingId, { consentGranted: true, latitude: 51.5010004, longitude: -0.1420004, accuracyMetres: 8.456, estimatedArrivalAt: "2099-01-01T00:00:00.000Z" });
assert(calls[0].kind === "context" && calls[1].kind === "eta" && calls[2].kind === "start" && calls[2].update.consentGranted === true && calls[2].update.latitude === 51.501 && calls[2].update.accuracyMetres === 8.46 && calls[2].update.estimatedArrivalAt === "2026-07-20T08:50:00.000Z" && started.etaAvailable, "Journey start did not require consent, normalize location or use only the trusted server ETA adapter.");
assert(!JSON.stringify(calls[2].update).includes("2099-01-01"), "A browser-supplied ETA entered trusted journey state.");
const updated = await service.updateLocation(cleaner, bookingId, { latitude: 51.502, longitude: -0.141 });
const arrived = await service.markArrived(cleaner, bookingId);
const landlordView = await service.getTracking(landlord, bookingId);
assert(updated.location.latitude === 51.502 && arrived.status === "cleaner-arrived" && arrived.location === null && arrived.sharingState === "arrived" && landlordView.cleaner.displayName === "Cleaner Example" && !Object.hasOwn(landlordView, "cleanerPayPence"), "Journey update, arrival stop or Landlord-safe tracking projection failed.");
assert(await rejects(() => service.startJourney(cleaner, bookingId, { latitude: 51.5, longitude: -0.1 }), "consent"), "A journey started without explicit location consent.");
assert(await rejects(() => service.startJourney(landlord, bookingId, { consentGranted: true, latitude: 51.5, longitude: -0.1 }), "Cleaner"), "A Landlord could start the Cleaner journey.");
assert(await rejects(() => service.updateLocation(cleaner, bookingId, { latitude: 91, longitude: 0 }), "Latitude"), "Out-of-range coordinates entered a journey update.");
const noEtaCalls = [];
const noEtaService = createJourneyService({ ...fakeRepository, async getJourneyContext() { noEtaCalls.push("context"); return null; }, async updateLocation(actor, id, update) { noEtaCalls.push(update); return tracking({ location: { ...tracking().location, estimatedArrivalAt: update.estimatedArrivalAt } }); } });
const noEta = await noEtaService.updateLocation(cleaner, bookingId, { latitude: 51.5, longitude: -0.1 });
assert(noEta.etaAvailable === false && noEta.location.estimatedArrivalAt === null && noEtaCalls.length === 1, "Missing ETA infrastructure did not degrade gracefully without exposing destination lookup.");

const databaseCalls = [];
let failure = null;
const database = { async withUserTransaction(actor, operation) { return operation({ async query(text, values) { databaseCalls.push({ actor, text, values }); if (failure) throw failure; if (text.startsWith("SELECT booking.scheduled_start_at")) return { rows: [{ scheduled_start_at: "2026-07-20T09:00:00.000Z", destination_latitude: "51.5", destination_longitude: "-0.1" }] }; return { rows: [{ snapshot: tracking() }] }; } }); } };
const repository = createJourneyRepository(database);
await repository.getJourneyContext(cleaner, bookingId);
await repository.startJourney(cleaner, bookingId, { consentGranted: true, latitude: 51.5, longitude: -0.1, accuracyMetres: 10, estimatedArrivalAt: null });
await repository.updateLocation(cleaner, bookingId, { latitude: 51.51, longitude: -0.11, accuracyMetres: null, estimatedArrivalAt: null });
await repository.markArrived(cleaner, bookingId);
await repository.getTracking(landlord, bookingId);
assert(databaseCalls[0].text.includes("booking.cleaner_user_id=$2::uuid") && databaseCalls[1].text.includes("start_cleaner_journey") && databaseCalls[1].values.length === 6 && databaseCalls[2].text.includes("update_cleaner_location") && databaseCalls[3].text.includes("mark_cleaner_arrived") && databaseCalls[4].text.includes("get_booking_tracking"), "Journey repository bypassed actor-bound context and restricted parameterized transition functions.");
failure = new Error("location-sharing-inactive");
assert(await rejects(() => repository.updateLocation(cleaner, bookingId, { latitude: 51.5, longitude: -0.1, accuracyMetres: null, estimatedArrivalAt: null }), "Start the journey"), "Inactive location sharing did not map to an actionable conflict.");

const migration = await readFile(new URL("../db/migrations/012_live_journey_tracking.sql", import.meta.url), "utf8");
const runtimeGrants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const workerGrants = await readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8");
for (const required of ["consent_granted IS NOT TRUE", "booking.cleaner_user_id = actor_id", "booking.landlord_user_id = actor_id", "status = 'cleaner-en-route'", "ON CONFLICT (booking_id) DO UPDATE", "now() + interval '5 minutes'", "cleaner_is_near_booking", "cleaner-nearby", "mark_cleaner_arrived", "DELETE FROM cleaner_locations", "bookings_stop_location_after_status", "purge_expired_cleaner_locations", "FOR UPDATE SKIP LOCKED"]) assert(migration.includes(required), `Live journey migration omitted ${required}.`);
assert(runtimeGrants.includes("start_cleaner_journey") && runtimeGrants.includes("get_booking_tracking") && runtimeGrants.includes("REVOKE INSERT, UPDATE, DELETE ON bookings") && runtimeGrants.includes("cleaner_locations") && workerGrants.includes("purge_expired_cleaner_locations(integer)"), "Journey/location mutations bypass restricted functions or expired current locations lack a separate worker purge.");

console.log("Journey tests passed: explicit consent, Cleaner-only start/update/arrival, trusted optional ETA, participant-safe current tracking, nearby event, automatic stop and expiring current-only location privacy.");
