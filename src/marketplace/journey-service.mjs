const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function boundedNumber(value, minimum, maximum, label, optional = false) {
  if (optional && (value == null || value === "")) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return number;
}

function location(input = {}) {
  return {
    latitude: Number(boundedNumber(input.latitude, -90, 90, "Latitude").toFixed(6)),
    longitude: Number(boundedNumber(input.longitude, -180, 180, "Longitude").toFixed(6)),
    accuracyMetres: input.accuracyMetres == null ? null : Number(boundedNumber(input.accuracyMetres, 0, 10000, "Location accuracy", true).toFixed(2))
  };
}

function snapshot(value) {
  const record = typeof value === "string" ? JSON.parse(value) : value;
  if (!record || typeof record !== "object") throw new Error("Tracking data is unavailable.");
  const current = record.location && typeof record.location === "object" ? {
    latitude: Number(record.location.latitude),
    longitude: Number(record.location.longitude),
    accuracyMetres: record.location.accuracyMetres == null ? null : Number(record.location.accuracyMetres),
    estimatedArrivalAt: record.location.estimatedArrivalAt || null,
    recordedAt: record.location.recordedAt,
    expiresAt: record.location.expiresAt
  } : null;
  return {
    bookingId: record.bookingId,
    status: record.status,
    scheduledStartAt: record.scheduledStartAt,
    scheduledEndAt: record.scheduledEndAt,
    journeyStartedAt: record.journeyStartedAt || null,
    arrivedAt: record.arrivedAt || null,
    sharingState: record.sharingState,
    locationConsentAt: record.locationConsentAt || null,
    locationSharingStoppedAt: record.locationSharingStoppedAt || null,
    cleaner: {
      cleanerId: record.cleaner?.cleanerId,
      displayName: record.cleaner?.displayName,
      profilePhotoUrl: record.cleaner?.profilePhotoUrl || null
    },
    location: current,
    etaAvailable: Boolean(current?.estimatedArrivalAt)
  };
}

export function createJourneyService(repository, options = {}) {
  if (!repository || !["getJourneyContext", "startJourney", "updateLocation", "markArrived", "getTracking"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete journey repository is required.");
  const etaProvider = options.etaProvider || null;
  const clock = options.clock || (() => new Date());

  async function estimatedArrival(actor, bookingId, origin, suppliedContext = undefined) {
    if (!etaProvider || typeof etaProvider.estimateArrival !== "function") return null;
    try {
      const context = suppliedContext === undefined ? await repository.getJourneyContext(actor, bookingId) : suppliedContext;
      if (context?.destination_latitude == null || context?.destination_longitude == null) return null;
      const result = await etaProvider.estimateArrival({
        origin,
        destination: { latitude: Number(context.destination_latitude), longitude: Number(context.destination_longitude) },
        scheduledStartAt: context.scheduled_start_at
      });
      const eta = result instanceof Date ? result : new Date(result);
      const now = clock();
      if (!(now instanceof Date) || Number.isNaN(now.getTime()) || Number.isNaN(eta.getTime()) || eta.getTime() < now.getTime() || eta.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return null;
      return eta.toISOString();
    } catch {
      return null;
    }
  }

  return Object.freeze({
    async startJourney(actor, bookingId, input = {}) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("cleaner")) throw new TypeError("A Cleaner account is required to start a journey.");
      if (input.consentGranted !== true) throw new TypeError("Explicit location-sharing consent is required before starting the journey.");
      const selectedBookingId = uuid(bookingId, "booking id");
      const current = location(input);
      const context = await repository.getJourneyContext(actor, selectedBookingId);
      if (context && context.payment_authorized !== true) throw Object.assign(new Error("The Landlord must authorize the current booking total before this journey can start."), { statusCode: 409, code: "payment-authorization-required" });
      const eta = await estimatedArrival(actor, selectedBookingId, current, context);
      return snapshot(await repository.startJourney(actor, selectedBookingId, { ...current, consentGranted: true, estimatedArrivalAt: eta }));
    },
    async updateLocation(actor, bookingId, input = {}) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("cleaner")) throw new TypeError("A Cleaner account is required to update journey location.");
      const selectedBookingId = uuid(bookingId, "booking id");
      const current = location(input);
      const eta = await estimatedArrival(actor, selectedBookingId, current);
      return snapshot(await repository.updateLocation(actor, selectedBookingId, { ...current, estimatedArrivalAt: eta }));
    },
    async markArrived(actor, bookingId) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("cleaner")) throw new TypeError("A Cleaner account is required to record arrival.");
      return snapshot(await repository.markArrived(actor, uuid(bookingId, "booking id")));
    },
    async getTracking(actor, bookingId) {
      if (!actor?.userId) throw new TypeError("An authenticated booking participant is required for tracking.");
      return snapshot(await repository.getTracking(actor, uuid(bookingId, "booking id")));
    }
  });
}
