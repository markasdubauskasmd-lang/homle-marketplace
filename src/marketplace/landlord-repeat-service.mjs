import { uuid } from "./validation.mjs";
import { serviceCodes } from "./cleaner-profile.mjs";

function unavailable() {
  return Object.assign(new Error("The previous approved scope is unavailable. Start a new request and review its tasks."), { statusCode: 409, code: "repeat-scope-unavailable" });
}
function text(value, maximum, required = false) {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) throw unavailable();
  return value;
}
export function createLandlordRepeatService(database) {
  if (typeof database?.withUserTransaction !== "function") throw new TypeError("A private database boundary is required.");
  return Object.freeze({
    async getScope(actor, bookingId) {
      if (!actor?.roles?.includes("landlord")) throw Object.assign(new Error("A Landlord account is required."), { statusCode: 403 });
      const ownerId = uuid(actor.userId, "Landlord id");
      const id = uuid(bookingId, "booking id");
      const row = await database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT booking.id, booking.landlord_user_id, booking.property_id, booking.cleaner_user_id, booking.status, booking.scope_snapshot FROM bookings booking JOIN properties property ON property.id=booking.property_id AND property.landlord_user_id=booking.landlord_user_id AND property.archived_at IS NULL WHERE booking.id=$1::uuid AND booking.landlord_user_id=$2::uuid AND booking.status='completed'",
          [id, ownerId]
        );
        return result.rows[0];
      });
      if (!row || row.landlord_user_id !== ownerId || row.status !== "completed") throw Object.assign(new Error("This completed booking is not available for a repeat request."), { statusCode: 404, code: "repeat-booking-not-found" });
      const scope = typeof row.scope_snapshot === "string" ? JSON.parse(row.scope_snapshot) : row.scope_snapshot;
      if (!scope || !Array.isArray(scope.tasks) || !scope.tasks.length || scope.tasks.length > 200 || !serviceCodes.includes(scope.cleaningType)) throw unavailable();
      if (!Array.isArray(scope.requiredServices) || !scope.requiredServices.length || scope.requiredServices.some(code => !serviceCodes.includes(code))) throw unavailable();
      const tasks = scope.tasks.map(task => Object.freeze({ roomName: text(task?.roomName, 120, true), description: text(task?.description, 1000, true) }));
      const minutes = (Date.parse(scope.requestedEndAt) - Date.parse(scope.requestedStartAt)) / 60000;
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw unavailable();
      return Object.freeze({
        sourceBookingId: id,
        propertyId: uuid(row.property_id, "property id"),
        cleanerId: uuid(row.cleaner_user_id, "Cleaner id"),
        cleaningType: scope.cleaningType,
        requiredServices: Object.freeze([...scope.requiredServices]),
        specialInstructions: scope.specialInstructions == null ? "" : text(scope.specialInstructions, 5000),
        tasks: Object.freeze(tasks),
        requestedMinutes: minutes,
        frequency: "one-time"
      });
    }
  });
}
