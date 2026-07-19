const serviceCodes = Object.freeze(["regular-domestic", "rental-turnovers", "end-of-tenancy", "workplaces", "communal-areas", "deep-cleans"]);
const pricingModels = Object.freeze(["hourly", "fixed", "quote"]);
const availabilityStatuses = Object.freeze(["available", "limited", "unavailable"]);
const outwardPostcodePattern = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timezoneIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function boundedText(value, maximum, label, minimum = 0) {
  const normalized = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
  if (normalized.length < minimum || normalized.length > maximum) throw new TypeError(`${label} must contain ${minimum} to ${maximum} characters.`);
  return normalized;
}

function optionalInteger(value, minimum, maximum, label) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return number;
}

function optionalNumber(value, minimum, maximum, label) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return number;
}

function stringList(value, maximumItems, maximumLength, label) {
  if (!Array.isArray(value)) return [];
  const items = [...new Set(value.map((item) => boundedText(item, maximumLength, label, 1)))];
  if (items.length > maximumItems) throw new TypeError(`${label} has too many entries.`);
  return items;
}

function fixedPriceOptions(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 12) throw new TypeError("Too many fixed-price options.");
  return value.map((option) => {
    const pricePence = optionalInteger(option?.pricePence, 1, 1_000_000, "Fixed price");
    if (pricePence == null) throw new TypeError("Fixed-price options require a price.");
    return { label: boundedText(option?.label, 80, "Fixed-price label", 1), pricePence };
  });
}

function cleanerServices(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > serviceCodes.length) throw new TypeError("Too many cleaner services.");
  const seen = new Set();
  return value.map((service) => {
    const serviceCode = boundedText(service?.serviceCode, 80, "Service code", 1);
    if (!serviceCodes.includes(serviceCode) || seen.has(serviceCode)) throw new TypeError("Cleaner services must be supported and unique.");
    seen.add(serviceCode);
    const pricingModel = boundedText(service?.pricingModel, 20, "Pricing model", 1);
    if (!pricingModels.includes(pricingModel)) throw new TypeError("A supported pricing model is required.");
    const pricePence = optionalInteger(service?.pricePence, 1, 1_000_000, "Service price");
    if (pricingModel !== "quote" && pricePence == null) throw new TypeError("Hourly and fixed services require a price.");
    return { serviceCode, pricingModel, pricePence };
  });
}

function serviceAreas(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 50) throw new TypeError("Too many service areas.");
  const seen = new Set();
  return value.map((area) => {
    const outwardPostcode = boundedText(area?.outwardPostcode, 4, "Outward postcode", 2).toUpperCase().replace(/\s/g, "");
    if (!outwardPostcodePattern.test(outwardPostcode) || seen.has(outwardPostcode)) throw new TypeError("Service areas must use unique UK outward postcodes.");
    seen.add(outwardPostcode);
    const latitude = optionalNumber(area?.latitude, -90, 90, "Service-area latitude");
    const longitude = optionalNumber(area?.longitude, -180, 180, "Service-area longitude");
    if ((latitude == null) !== (longitude == null)) throw new TypeError("Service-area coordinates must be supplied together.");
    return { outwardPostcode, latitude, longitude };
  });
}

export function profileCompletionPercent(profile) {
  const checks = [
    profile.biography.length >= 40,
    profile.services.length > 0,
    profile.hourlyRatePence != null || profile.fixedPriceOptions.length > 0 || profile.services.some((service) => service.pricePence != null),
    profile.travelRadiusKm != null,
    profile.serviceAreas.length > 0,
    profile.yearsExperience != null,
    profile.languages.length > 0,
    profile.equipmentSupplied.length + profile.productsSupplied.length > 0,
    profile.residentialPreference || profile.commercialPreference
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function normalizedCleanerProfile(input = {}) {
  const normalized = {
    biography: boundedText(input.biography, 1200, "Biography"),
    hourlyRatePence: optionalInteger(input.hourlyRatePence, 1, 1_000_000, "Hourly rate"),
    fixedPriceOptions: fixedPriceOptions(input.fixedPriceOptions),
    travelRadiusKm: optionalNumber(input.travelRadiusKm, 0.1, 500, "Travel radius"),
    yearsExperience: optionalInteger(input.yearsExperience, 0, 80, "Years of experience"),
    languages: stringList(input.languages, 20, 60, "Language"),
    equipmentSupplied: stringList(input.equipmentSupplied, 30, 100, "Equipment"),
    productsSupplied: stringList(input.productsSupplied, 30, 100, "Product"),
    residentialPreference: input.residentialPreference === true,
    commercialPreference: input.commercialPreference === true,
    fixedPriceOptionsRaw: input.fixedPriceOptions,
    services: cleanerServices(input.services),
    serviceAreas: serviceAreas(input.serviceAreas)
  };
  delete normalized.fixedPriceOptionsRaw;
  normalized.profileCompletionPercent = profileCompletionPercent(normalized);
  normalized.isPublic = input.isPublic === true;
  if (normalized.isPublic && normalized.profileCompletionPercent !== 100) throw new TypeError("Complete every required profile section before publishing.");
  return normalized;
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export function publicCleanerProjection(record = {}) {
  return {
    cleanerId: record.cleaner_id,
    publicSlug: record.public_slug,
    displayName: record.display_name,
    profilePhotoUrl: record.profile_photo_url || null,
    biography: record.biography || "",
    hourlyRatePence: record.hourly_rate_pence == null ? null : Number(record.hourly_rate_pence),
    fixedPriceOptions: jsonArray(record.fixed_price_options),
    travelRadiusKm: record.travel_radius_km == null ? null : Number(record.travel_radius_km),
    yearsExperience: record.years_experience == null ? null : Number(record.years_experience),
    languages: Array.isArray(record.languages) ? record.languages : [],
    equipmentSupplied: Array.isArray(record.equipment_supplied) ? record.equipment_supplied : [],
    productsSupplied: Array.isArray(record.products_supplied) ? record.products_supplied : [],
    residentialPreference: record.residential_preference === true,
    commercialPreference: record.commercial_preference === true,
    averageRating: Number(record.average_rating) || 0,
    reviewCount: Number(record.review_count) || 0,
    completedJobCount: Number(record.completed_job_count) || 0,
    profileCompletionPercent: Number(record.profile_completion_percent) || 0,
    currentAvailabilityStatus: record.current_availability_status,
    verifiedBadges: Array.isArray(record.verified_badges) ? record.verified_badges : [],
    verified: record.verified === true,
    distanceKm: record.distance_km == null ? null : Number(record.distance_km),
    services: jsonArray(record.services)
  };
}

export function editableCleanerProjection(record = {}) {
  return {
    cleanerId: record.cleaner_id || record.user_id,
    publicSlug: record.public_slug,
    profilePhotoUrl: record.profile_photo_url || null,
    biography: record.biography || "",
    hourlyRatePence: record.hourly_rate_pence == null ? null : Number(record.hourly_rate_pence),
    fixedPriceOptions: jsonArray(record.fixed_price_options),
    travelRadiusKm: record.travel_radius_km == null ? null : Number(record.travel_radius_km),
    yearsExperience: record.years_experience == null ? null : Number(record.years_experience),
    languages: Array.isArray(record.languages) ? record.languages : [],
    equipmentSupplied: Array.isArray(record.equipment_supplied) ? record.equipment_supplied : [],
    productsSupplied: Array.isArray(record.products_supplied) ? record.products_supplied : [],
    residentialPreference: record.residential_preference === true,
    commercialPreference: record.commercial_preference === true,
    averageRating: Number(record.average_rating) || 0,
    reviewCount: Number(record.review_count) || 0,
    completedJobCount: Number(record.completed_job_count) || 0,
    profileCompletionPercent: Number(record.profile_completion_percent) || 0,
    currentAvailabilityStatus: record.current_availability_status || "unavailable",
    isPublic: record.is_public === true,
    services: jsonArray(record.services),
    serviceAreas: jsonArray(record.service_areas)
  };
}

export function normalizedCleanerSearch(filters = {}) {
  const outwardPostcode = filters.outwardPostcode == null || filters.outwardPostcode === "" ? null : boundedText(filters.outwardPostcode, 4, "Outward postcode", 2).toUpperCase().replace(/\s/g, "");
  if (outwardPostcode && !outwardPostcodePattern.test(outwardPostcode)) throw new TypeError("Search location must use a UK outward postcode.");
  const serviceCode = filters.serviceCode == null || filters.serviceCode === "" ? null : boundedText(filters.serviceCode, 80, "Service code", 1);
  if (serviceCode && !serviceCodes.includes(serviceCode)) throw new TypeError("Search service is not supported.");
  const startAt = filters.startAt ? new Date(filters.startAt) : null;
  const endAt = filters.endAt ? new Date(filters.endAt) : null;
  if ((startAt == null) !== (endAt == null) || (startAt && (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt))) throw new TypeError("Search availability requires a valid start and end.");
  const latitude = optionalNumber(filters.latitude, -90, 90, "Search latitude");
  const longitude = optionalNumber(filters.longitude, -180, 180, "Search longitude");
  if ((latitude == null) !== (longitude == null)) throw new TypeError("Search coordinates must be supplied together.");
  const maximumDistanceKm = optionalNumber(filters.maximumDistanceKm, 0.1, 500, "Maximum distance");
  if (maximumDistanceKm != null && latitude == null) throw new TypeError("Distance filtering requires search coordinates.");
  return {
    outwardPostcode,
    serviceCode,
    startAt: startAt?.toISOString() || null,
    endAt: endAt?.toISOString() || null,
    minimumRating: optionalNumber(filters.minimumRating, 0, 5, "Minimum rating"),
    maximumPricePence: optionalInteger(filters.maximumPricePence, 1, 1_000_000, "Maximum price"),
    verifiedOnly: filters.verifiedOnly === true,
    latitude,
    longitude,
    maximumDistanceKm,
    limit: optionalInteger(filters.limit ?? 20, 1, 50, "Result limit"),
    offset: optionalInteger(filters.offset ?? 0, 0, 10_000, "Result offset")
  };
}

export function normalizedAvailabilityWindow(input = {}, now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) throw new TypeError("The current time is invalid.");
  const suppliedStart = typeof input.startAt === "string" ? input.startAt.trim() : "";
  const suppliedEnd = typeof input.endAt === "string" ? input.endAt.trim() : "";
  if (!timezoneIsoPattern.test(suppliedStart) || !timezoneIsoPattern.test(suppliedEnd)) throw new TypeError("Availability needs a start and end time with a timezone.");
  const startAt = new Date(suppliedStart);
  const endAt = new Date(suppliedEnd);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) throw new TypeError("Availability must end after it starts.");
  const durationMs = endAt.getTime() - startAt.getTime();
  if (startAt.getTime() < current.getTime() + 5 * 60_000) throw new TypeError("Availability must start at least five minutes from now.");
  if (startAt.getTime() > current.getTime() + 366 * 24 * 60 * 60_000) throw new TypeError("Availability can be added up to one year ahead.");
  if (durationMs < 30 * 60_000 || durationMs > 24 * 60 * 60_000) throw new TypeError("An availability window must be between 30 minutes and 24 hours.");
  return Object.freeze({ startAt: startAt.toISOString(), endAt: endAt.toISOString() });
}

export function editableAvailabilityProjection(record = {}) {
  return Object.freeze({
    availabilityId: record.id,
    startAt: new Date(record.starts_at).toISOString(),
    endAt: new Date(record.ends_at).toISOString(),
    status: ["available", "held", "withdrawn"].includes(record.status) ? record.status : "available"
  });
}

export function createCleanerProfileService(repository, options = {}) {
  if (!repository || !["getOwnProfile", "saveOwnProfile", "searchPublicProfiles", "getPublicProfile", "listOwnAvailability", "createOwnAvailability", "withdrawOwnAvailability"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete cleaner profile repository is required.");
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const geocoder = options.geocoder && typeof options.geocoder.geocodeOutcode === "function" ? options.geocoder : null;
  function requireCleaner(actor, action) {
    if (!actor?.userId || !actor.roles?.includes("cleaner")) throw new TypeError(`A Cleaner account is required to ${action}.`);
  }

  // Resolve each service area's outward postcode to coordinates so matching can
  // rank by real distance. Best-effort per area: a Cleaner-supplied coordinate
  // is preserved, and an unresolved outcode leaves that area on the existing
  // outward-postcode fallback. Never blocks a save.
  async function geocodedProfile(profile) {
    if (!geocoder || !Array.isArray(profile.serviceAreas) || profile.serviceAreas.length === 0) return profile;
    const serviceAreas = await Promise.all(profile.serviceAreas.map(async (area) => {
      if (area.latitude != null || area.longitude != null) return area;
      const coordinates = await geocoder.geocodeOutcode(area.outwardPostcode);
      return coordinates ? { ...area, latitude: coordinates.latitude, longitude: coordinates.longitude } : area;
    }));
    return { ...profile, serviceAreas };
  }
  return {
    async getOwnProfile(actor) {
      requireCleaner(actor, "view this profile");
      const record = await repository.getOwnProfile(actor);
      if (!record) throw Object.assign(new Error("Cleaner profile was not found."), { statusCode: 404 });
      return editableCleanerProjection(record);
    },
    async saveOwnProfile(actor, input) {
      requireCleaner(actor, "edit this profile");
      const profile = await geocodedProfile(normalizedCleanerProfile(input));
      const saved = await repository.saveOwnProfile(actor, profile);
      return { cleanerId: saved.user_id || actor.userId, publicSlug: saved.public_slug || null, ...profile, profilePhotoUrl: saved.profile_photo_url || null, averageRating: Number(saved.average_rating) || 0, reviewCount: Number(saved.review_count) || 0, completedJobCount: Number(saved.completed_job_count) || 0, currentAvailabilityStatus: saved.current_availability_status || "unavailable" };
    },
    async listOwnAvailability(actor) {
      requireCleaner(actor, "view availability");
      const current = now();
      const rows = await repository.listOwnAvailability(actor, current.toISOString());
      return rows.map(editableAvailabilityProjection);
    },
    async createOwnAvailability(actor, input) {
      requireCleaner(actor, "add availability");
      const current = now();
      const availability = normalizedAvailabilityWindow(input, current);
      return editableAvailabilityProjection(await repository.createOwnAvailability(actor, availability));
    },
    async withdrawOwnAvailability(actor, availabilityId) {
      requireCleaner(actor, "change availability");
      if (!uuidPattern.test(availabilityId || "")) throw new TypeError("A valid availability window is required.");
      return editableAvailabilityProjection(await repository.withdrawOwnAvailability(actor, availabilityId.toLowerCase(), now().toISOString()));
    },
    async searchPublicProfiles(filters) {
      const rows = await repository.searchPublicProfiles(normalizedCleanerSearch(filters));
      return rows.map(publicCleanerProjection);
    },
    async getPublicProfile(cleanerId) {
      if (!uuidPattern.test(cleanerId || "")) throw new TypeError("A valid Cleaner profile is required.");
      const record = await repository.getPublicProfile(cleanerId.toLowerCase());
      if (!record) throw Object.assign(new Error("This Cleaner profile is no longer publicly available."), { statusCode: 404, code: "cleaner-profile-unavailable" });
      return publicCleanerProjection(record);
    }
  };
}

export { availabilityStatuses, outwardPostcodePattern, pricingModels, serviceCodes };
