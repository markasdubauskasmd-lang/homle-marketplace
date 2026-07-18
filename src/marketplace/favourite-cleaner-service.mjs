const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireLandlord(actor) {
  if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to manage favourite Cleaners.");
}

function services(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function projection(record) {
  return Object.freeze({
    cleanerId: record.cleaner_id,
    publicSlug: record.public_slug,
    displayName: record.display_name,
    profilePhotoUrl: record.profile_photo_url || null,
    currentAvailabilityStatus: record.current_availability_status || "unavailable",
    averageRating: Number(record.average_rating) || 0,
    reviewCount: Number(record.review_count) || 0,
    completedJobCount: Number(record.completed_job_count) || 0,
    services: services(record.services),
    savedAt: new Date(record.created_at).toISOString()
  });
}

export function createFavouriteCleanerService(repository) {
  if (!repository || !["listOwn", "setOwn"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete favourite-Cleaner repository is required.");
  return Object.freeze({
    async listOwn(actor) {
      requireLandlord(actor);
      return (await repository.listOwn(actor)).map(projection);
    },
    async setOwn(actor, cleanerId, input = {}) {
      requireLandlord(actor);
      if (!uuidPattern.test(cleanerId || "")) throw new TypeError("A valid Cleaner profile is required.");
      if (cleanerId.toLowerCase() === actor.userId.toLowerCase()) throw Object.assign(new Error("Your Cleaner workspace cannot be saved as your own favourite."), { statusCode: 409, code: "self-favourite-not-allowed" });
      if (typeof input.favourite !== "boolean") throw new TypeError("Choose whether to save this Cleaner.");
      const result = await repository.setOwn(actor, cleanerId.toLowerCase(), input.favourite);
      return Object.freeze({ cleanerId: result.cleaner_id, favourite: result.favourite === true });
    }
  });
}
