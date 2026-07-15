import { createCleanerProfileService, normalizedCleanerProfile, normalizedCleanerSearch, publicCleanerProjection } from "../src/marketplace/cleaner-profile.mjs";
import { createCleanerProfileRepository } from "../src/marketplace/cleaner-repository.mjs";
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function throws(operation, message) {
  try { operation(); } catch (error) { return String(error.message).includes(message); }
  return false;
}

const completeInput = {
  profilePhotoUrl: "https://images.example.com/cleaner.jpg",
  biography: "Careful residential and commercial cleaner with clear communication and reliable routines.",
  hourlyRatePence: 2400,
  fixedPriceOptions: [{ label: "Studio turnover", pricePence: 6500 }],
  travelRadiusKm: 12,
  yearsExperience: 4,
  languages: ["English", "Spanish"],
  equipmentSupplied: ["Vacuum cleaner"],
  productsSupplied: ["General cleaning products"],
  residentialPreference: true,
  commercialPreference: true,
  currentAvailabilityStatus: "available",
  services: [
    { serviceCode: "rental-turnovers", pricingModel: "fixed", pricePence: 6500 },
    { serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 2400 }
  ],
  serviceAreas: [{ outwardPostcode: "sw1a", latitude: 51.501, longitude: -0.142 }],
  isPublic: true
};
const completeProfile = normalizedCleanerProfile(completeInput);
assert(completeProfile.profileCompletionPercent === 100 && completeProfile.isPublic && completeProfile.serviceAreas[0].outwardPostcode === "SW1A" && completeProfile.services.length === 2, "A complete cleaner profile did not reach publishable canonical state.");
assert(throws(() => normalizedCleanerProfile({ biography: "Short", isPublic: true }), "Complete every required") && throws(() => normalizedCleanerProfile({ ...completeInput, services: [{ serviceCode: "invented", pricingModel: "quote" }] }), "supported and unique") && throws(() => normalizedCleanerProfile({ ...completeInput, serviceAreas: [{ outwardPostcode: "London" }] }), "Outward postcode"), "Incomplete, invented-service or vague-area cleaner data was accepted.");

const serviceCalls = [];
const publicRows = [{
  cleaner_id: "cleaner-public-id",
  public_slug: "careful-cleaner",
  display_name: "Careful Cleaner",
  profile_photo_url: "https://images.example.com/cleaner.jpg",
  biography: completeInput.biography,
  hourly_rate_pence: 2400,
  fixed_price_options: completeProfile.fixedPriceOptions,
  travel_radius_km: "12.00",
  years_experience: 4,
  languages: ["English"],
  equipment_supplied: ["Vacuum cleaner"],
  products_supplied: ["General cleaning products"],
  residential_preference: true,
  commercial_preference: true,
  average_rating: "4.80",
  review_count: 15,
  completed_job_count: 32,
  profile_completion_percent: 100,
  current_availability_status: "available",
  verified_badges: ["identity"],
  verified: true,
  distance_km: "3.25",
  services: [{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 2400 }],
  email: "private@example.com",
  phone: "07123456789",
  home_address: "Private address",
  acceptance_rate: 92
}];
const fakeServiceRepository = {
  async saveOwnProfile(actor, profile) { serviceCalls.push({ kind: "save", actor, profile }); return { profileCompletionPercent: profile.profileCompletionPercent }; },
  async searchPublicProfiles(filters) { serviceCalls.push({ kind: "search", filters }); return publicRows; }
};
const service = createCleanerProfileService(fakeServiceRepository);
const cleanerActor = { userId: "11111111-1111-4111-8111-111111111111", roles: ["cleaner"] };
await service.saveOwnProfile(cleanerActor, completeInput);
assert(throws(() => service.saveOwnProfile({ userId: "landlord", roles: ["landlord"] }, completeInput), "Cleaner account"), "A landlord could enter cleaner profile editing.");
const searchResults = await service.searchPublicProfiles({ outwardPostcode: "sw1a", serviceCode: "regular-domestic", startAt: "2026-07-20T09:00:00.000Z", endAt: "2026-07-20T12:00:00.000Z", minimumRating: 4, maximumPricePence: 3000, verifiedOnly: true, latitude: 51.5, longitude: -0.12, maximumDistanceKm: 10, limit: 10 });
const serialisedPublicResult = JSON.stringify(searchResults);
assert(serviceCalls[0].actor.userId === cleanerActor.userId && !Object.hasOwn(serviceCalls[0].profile, "userId") && serviceCalls[1].filters.outwardPostcode === "SW1A" && searchResults[0].distanceKm === 3.25 && searchResults[0].verified, "Cleaner ownership or search filter canonicalization failed.");
assert(!serialisedPublicResult.includes("private@example.com") && !serialisedPublicResult.includes("07123456789") && !serialisedPublicResult.includes("Private address") && !serialisedPublicResult.includes("acceptance_rate"), "Public cleaner projection exposed private contact, address or internal acceptance data.");
assert(throws(() => normalizedCleanerSearch({ startAt: "2026-07-20T09:00:00Z" }), "start and end") && throws(() => normalizedCleanerSearch({ maximumDistanceKm: 10 }), "requires search coordinates"), "Cleaner search accepted incomplete availability or distance filters.");

const databaseCalls = [];
const database = {
  async withUserTransaction(actor, operation) {
    return operation({ async query(text, values) { databaseCalls.push({ boundary: "user", actor, text, values }); return text.startsWith("UPDATE cleaner_profiles") ? { rows: [{ user_id: actor.userId }] } : { rows: [] }; } });
  },
  async withAuthenticationTransaction(operation) {
    return operation({ async query(text, values) { databaseCalls.push({ boundary: "public", text, values }); return { rows: publicRows }; } });
  }
};
const repository = createCleanerProfileRepository(database);
await repository.saveOwnProfile(cleanerActor, completeProfile);
await repository.searchPublicProfiles(normalizedCleanerSearch({ outwardPostcode: "SW1A", limit: 20 }));
assert(databaseCalls[0].text.includes("WHERE user_id=$1::uuid") && databaseCalls[0].values[0] === cleanerActor.userId && databaseCalls.slice(0, 5).every((call) => call.boundary === "user") && databaseCalls.at(-1).boundary === "public" && databaseCalls.at(-1).text.includes("search_cleaner_directory") && databaseCalls.every((call) => call.text.includes("$1")), "Cleaner repository accepted a target profile id, left the RLS boundary or used non-parameterized queries.");

const projection = publicCleanerProjection(publicRows[0]);
assert(Object.keys(projection).every((key) => !["email", "phone", "homeAddress", "acceptanceRate", "latitude", "longitude"].includes(key)), "Cleaner public projection contains a forbidden field name.");

const rlsSql = await readFile(new URL("../db/migrations/002_marketplace_row_level_security.sql", import.meta.url), "utf8");
const directorySql = await readFile(new URL("../db/migrations/006_cleaner_directory.sql", import.meta.url), "utf8");
const runtimeGrantsSql = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const returnedColumns = directorySql.slice(directorySql.indexOf("RETURNS TABLE"), directorySql.indexOf("LANGUAGE sql"));
assert(!rlsSql.includes("CREATE POLICY public_cleaner_areas") && !rlsSql.includes("cleaner_service_areas FOR SELECT USING (true)"), "Cleaner service-area coordinates remain directly public under RLS.");
assert(directorySql.includes("candidate_outward_postcode") && directorySql.includes("candidate_service_code") && directorySql.includes("candidate_start_at") && directorySql.includes("candidate_minimum_rating") && directorySql.includes("candidate_maximum_price_pence") && directorySql.includes("candidate_verified_only") && directorySql.includes("candidate_maximum_distance_km") && directorySql.includes("profile_completion_percent = 100"), "Cleaner directory omitted a required public discovery filter or completeness gate.");
assert(!returnedColumns.includes("email") && !returnedColumns.includes("phone") && !returnedColumns.includes("latitude") && !returnedColumns.includes("longitude") && runtimeGrantsSql.includes("search_cleaner_directory(text, text, timestamptz"), "Cleaner directory returns private location/contact data or lacks its restricted grant.");

console.log("Cleaner profile tests passed: validated ownership-only editing, deterministic completion, publish gating, privacy-safe projections, requested discovery filters and non-public service-area coordinates.");
