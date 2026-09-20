import { createCleanerProfileService, editableCleanerProjection, normalizedAvailabilityWindow, normalizedCleanerProfile, normalizedCleanerSearch, publicCleanerProjection } from "../src/marketplace/cleaner-profile.mjs";
import { createCleanerProfileRepository } from "../src/marketplace/cleaner-repository.mjs";
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function throws(operation, message) {
  try { operation(); } catch (error) { return String(error.message).includes(message); }
  return false;
}

async function rejects(operation, message) {
  try { await operation(); } catch (error) { return String(error.message).includes(message); }
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
assert(completeProfile.profileCompletionPercent === 100 && completeProfile.isPublic && completeProfile.serviceAreas[0].outwardPostcode === "SW1A" && completeProfile.services.length === 2 && !Object.hasOwn(completeProfile, "currentAvailabilityStatus") && !Object.hasOwn(completeProfile, "profilePhotoUrl"), "A complete cleaner profile did not reach publishable canonical state or retained a client-controlled availability/photo field.");
assert(throws(() => normalizedCleanerProfile({ biography: "Short", isPublic: true }), "Complete every required") && throws(() => normalizedCleanerProfile({ ...completeInput, services: [{ serviceCode: "invented", pricingModel: "quote" }] }), "supported and unique") && throws(() => normalizedCleanerProfile({ ...completeInput, serviceAreas: [{ outwardPostcode: "London" }] }), "Outward postcode"), "Incomplete, invented-service or vague-area cleaner data was accepted.");

const serviceCalls = [];
const publicRows = [{
  cleaner_id: "22222222-2222-4222-8222-222222222222",
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
  async getOwnProfile(actor) { serviceCalls.push({ kind: "get-own", actor }); return { ...publicRows[0], cleaner_id: actor.userId, user_id: actor.userId, is_public: true, service_areas: [{ outwardPostcode: "SW1A", latitude: 51.501, longitude: -0.142 }] }; },
  async saveOwnProfile(actor, profile) { serviceCalls.push({ kind: "save", actor, profile }); return { profileCompletionPercent: profile.profileCompletionPercent }; },
  async searchPublicProfiles(filters) { serviceCalls.push({ kind: "search", filters }); return publicRows; },
  async getPublicProfile(cleanerId) { serviceCalls.push({ kind: "get-public", cleanerId }); return publicRows.find((row) => row.cleaner_id === cleanerId) || null; },
  async listOwnAvailability(actor, currentTime) { serviceCalls.push({ kind: "availability-list", actor, currentTime }); return [{ id: "33333333-3333-4333-8333-333333333333", starts_at: "2026-07-20T09:00:00.000Z", ends_at: "2026-07-20T17:00:00.000Z", status: "available" }]; },
  async createOwnAvailability(actor, availability) { serviceCalls.push({ kind: "availability-create", actor, availability }); return { id: "44444444-4444-4444-8444-444444444444", starts_at: availability.startAt, ends_at: availability.endAt, status: "available" }; },
  async withdrawOwnAvailability(actor, availabilityId, currentTime) { serviceCalls.push({ kind: "availability-withdraw", actor, availabilityId, currentTime }); return { id: availabilityId, starts_at: "2026-07-20T09:00:00.000Z", ends_at: "2026-07-20T17:00:00.000Z", status: "withdrawn" }; }
};
const service = createCleanerProfileService(fakeServiceRepository, { now: () => new Date("2026-07-16T12:00:00.000Z") });
const cleanerActor = { userId: "11111111-1111-4111-8111-111111111111", roles: ["cleaner"] };
const ownProfile = await service.getOwnProfile(cleanerActor);
await service.saveOwnProfile(cleanerActor, completeInput);
assert(await rejects(() => service.saveOwnProfile({ userId: "landlord", roles: ["landlord"] }, completeInput), "Cleaner account"), "A landlord could enter cleaner profile editing.");
const searchResults = await service.searchPublicProfiles({ outwardPostcode: "sw1a", serviceCode: "regular-domestic", startAt: "2026-07-20T09:00:00.000Z", endAt: "2026-07-20T12:00:00.000Z", minimumRating: 4, maximumPricePence: 3000, verifiedOnly: true, latitude: 51.5, longitude: -0.12, maximumDistanceKm: 10, limit: 10 });
const publicProfile = await service.getPublicProfile(publicRows[0].cleaner_id);
const serialisedPublicResult = JSON.stringify(searchResults);
assert(ownProfile.cleanerId === cleanerActor.userId && ownProfile.isPublic === true && ownProfile.averageRating === 4.8 && ownProfile.reviewCount === 15 && ownProfile.completedJobCount === 32 && ownProfile.serviceAreas[0].outwardPostcode === "SW1A" && serviceCalls[1].actor.userId === cleanerActor.userId && !Object.hasOwn(serviceCalls[1].profile, "userId") && serviceCalls[2].filters.outwardPostcode === "SW1A" && searchResults[0].distanceKm === 3.25 && searchResults[0].verified, "Cleaner ownership, private reputation summary, editable projection or search filter canonicalization failed.");
assert(!JSON.stringify(ownProfile).includes("private@example.com") && await rejects(() => service.getOwnProfile({ userId: "landlord", roles: ["landlord"] }), "Cleaner account"), "The owner profile read leaked private account fields or accepted another role.");

// Service-area geocoding: outward postcodes resolve to coordinates on save so
// matching can rank by real distance. Isolated repository to avoid disturbing
// the shared serviceCalls ordering above.
{
  const outcodeCalls = [];
  let savedProfile;
  let searchedFilters;
  const geoRepo = {
    ...fakeServiceRepository,
    async saveOwnProfile(actor, profile) { savedProfile = profile; return { profileCompletionPercent: profile.profileCompletionPercent }; },
    async searchPublicProfiles(filters) { searchedFilters = filters; return publicRows; }
  };
  const resolvingGeocoder = {
    async geocodeOutcode(outcode) { outcodeCalls.push(outcode); return outcode === "SW1A" ? { latitude: 51.5, longitude: -0.14 } : { latitude: 51.52, longitude: -0.06 }; }
  };
  const geoService = createCleanerProfileService(geoRepo, { now: () => new Date("2026-07-16T12:00:00.000Z"), geocoder: resolvingGeocoder });
  const twoAreas = { ...completeInput, serviceAreas: [{ outwardPostcode: "sw1a" }, { outwardPostcode: "e1", latitude: 51.51, longitude: -0.05 }] };
  await geoService.saveOwnProfile(cleanerActor, twoAreas);
  const bySw1a = savedProfile.serviceAreas.find((area) => area.outwardPostcode === "SW1A");
  const byE1 = savedProfile.serviceAreas.find((area) => area.outwardPostcode === "E1");
  assert(bySw1a.latitude === 51.5 && bySw1a.longitude === -0.14, "A service area without coordinates was not geocoded from its outward postcode.");
  assert(byE1.latitude === 51.51 && byE1.longitude === -0.05 && !outcodeCalls.includes("E1"), "A Cleaner-supplied service-area coordinate was overwritten or geocoded unnecessarily.");
  await geoService.searchPublicProfiles({ outwardPostcode: "sw1a", serviceCode: "regular-domestic" });
  assert(searchedFilters.outwardPostcode === "SW1A" && searchedFilters.latitude === 51.5 && searchedFilters.longitude === -0.14 && searchedFilters.maximumDistanceKm === 500, "A public outward-postcode search was not converted into travel-radius-aware nearby matching with its declared-area fallback preserved.");

  const failingGeocoder = { async geocodeOutcode() { return null; } };
  const failService = createCleanerProfileService(geoRepo, { now: () => new Date("2026-07-16T12:00:00.000Z"), geocoder: failingGeocoder });
  await failService.saveOwnProfile(cleanerActor, { ...completeInput, serviceAreas: [{ outwardPostcode: "sw1a" }] });
  assert(savedProfile.serviceAreas[0].latitude == null && savedProfile.serviceAreas[0].outwardPostcode === "SW1A", "An unresolved service-area geocode did not fail safe with null coordinates.");
  await failService.searchPublicProfiles({ outwardPostcode: "sw1a" });
  assert(searchedFilters.outwardPostcode === "SW1A" && searchedFilters.latitude == null && searchedFilters.maximumDistanceKm == null, "An unresolved public postcode search did not fall back to the exact outward area safely.");

  const throwingService = createCleanerProfileService(geoRepo, { geocoder: { async geocodeOutcode() { throw new Error("provider unavailable"); } } });
  await throwingService.searchPublicProfiles({ outwardPostcode: "sw1a" });
  assert(searchedFilters.outwardPostcode === "SW1A" && searchedFilters.latitude == null, "A failed public geocoder blocked the directory instead of using its exact-area fallback.");

  const malformedService = createCleanerProfileService(geoRepo, { geocoder: { async geocodeOutcode() { return { latitude: "private", longitude: 500 }; } } });
  await malformedService.searchPublicProfiles({ outwardPostcode: "sw1a" });
  assert(searchedFilters.outwardPostcode === "SW1A" && searchedFilters.latitude == null, "Malformed provider coordinates reached public matching instead of using the exact-area fallback.");
}
assert(!serialisedPublicResult.includes("private@example.com") && !serialisedPublicResult.includes("07123456789") && !serialisedPublicResult.includes("Private address") && !serialisedPublicResult.includes("acceptance_rate"), "Public cleaner projection exposed private contact, address or internal acceptance data.");
assert(publicProfile.cleanerId === publicRows[0].cleaner_id && publicProfile.displayName === "Careful Cleaner" && !JSON.stringify(publicProfile).includes("private@example.com") && serviceCalls.at(-1).kind === "get-public" && await rejects(() => service.getPublicProfile("invalid"), "valid Cleaner profile") && await rejects(() => service.getPublicProfile("33333333-3333-4333-8333-333333333333"), "no longer publicly available"), "A direct public Cleaner lookup accepted an invalid/unavailable profile or exposed private account data.");
assert(throws(() => normalizedCleanerSearch({ startAt: "2026-07-20T09:00:00Z" }), "start and end") && throws(() => normalizedCleanerSearch({ maximumDistanceKm: 10 }), "requires search coordinates"), "Cleaner search accepted incomplete availability or distance filters.");
const availabilityInput = normalizedAvailabilityWindow({ startAt: "2026-07-20T09:00:00+01:00", endAt: "2026-07-20T17:00:00+01:00" }, new Date("2026-07-16T12:00:00.000Z"));
const ownAvailability = await service.listOwnAvailability(cleanerActor);
const createdAvailability = await service.createOwnAvailability(cleanerActor, { startAt: "2026-07-21T09:00:00+01:00", endAt: "2026-07-21T17:00:00+01:00" });
const withdrawnAvailability = await service.withdrawOwnAvailability(cleanerActor, "44444444-4444-4444-8444-444444444444");
assert(availabilityInput.startAt === "2026-07-20T08:00:00.000Z" && ownAvailability[0].availabilityId === "33333333-3333-4333-8333-333333333333" && createdAvailability.status === "available" && withdrawnAvailability.status === "withdrawn", "Cleaner availability was not normalized, owner-projected or lifecycle-safe.");
assert(throws(() => normalizedAvailabilityWindow({ startAt: "2026-07-20T09:00", endAt: "2026-07-20T17:00" }, new Date("2026-07-16T12:00:00.000Z")), "timezone") && throws(() => normalizedAvailabilityWindow({ startAt: "2026-07-16T12:01:00Z", endAt: "2026-07-16T13:00:00Z" }, new Date("2026-07-16T12:00:00.000Z")), "five minutes") && await rejects(() => service.createOwnAvailability({ userId: "landlord", roles: ["landlord"] }, availabilityInput), "Cleaner account"), "Availability accepted ambiguous local time, an immediate window or a non-Cleaner actor.");

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
await repository.getOwnProfile(cleanerActor);
await repository.saveOwnProfile(cleanerActor, completeProfile);
await repository.searchPublicProfiles(normalizedCleanerSearch({ outwardPostcode: "SW1A", limit: 20 }));
await repository.getPublicProfile(publicRows[0].cleaner_id);
assert(databaseCalls[0].text.includes("WHERE profile.user_id=$1::uuid") && databaseCalls[0].text.includes("cleaner_service_areas") && databaseCalls[0].values[0] === cleanerActor.userId && databaseCalls.slice(0, 6).every((call) => call.boundary === "user") && databaseCalls.filter((call) => call.boundary === "public").some((call) => call.text.includes("search_cleaner_directory")) && databaseCalls.at(-1).boundary === "public" && databaseCalls.at(-1).text.includes("get_public_cleaner_profile") && databaseCalls.at(-1).values[0] === publicRows[0].cleaner_id && databaseCalls.every((call) => call.text.includes("$1") && !call.text.includes("current_availability_status=$") && !call.text.includes("profile_photo_url=$")), "Cleaner repository accepted a target profile id, allowed profile editing to overwrite server-owned schedule/photo state, omitted owner detail, left the safe public lookup boundary or used non-parameterized queries.");

const availabilityQueries = [];
const availabilityDatabase = {
  async withUserTransaction(actor, operation) {
    return operation({ async query(text, values) {
      availabilityQueries.push({ actor, text, values });
      if (text.startsWith("SELECT id, starts_at")) return { rows: [{ id: "33333333-3333-4333-8333-333333333333", starts_at: "2026-07-20T09:00:00.000Z", ends_at: "2026-07-20T17:00:00.000Z", status: "available" }] };
      if (text.startsWith("SELECT 1 FROM cleaner_availability") && text.includes("tstzrange")) return { rows: [] };
      if (text.startsWith("INSERT INTO cleaner_availability")) return { rows: [{ id: "44444444-4444-4444-8444-444444444444", starts_at: values[1], ends_at: values[2], status: "available" }] };
      return { rows: [] };
    } });
  },
  async withAuthenticationTransaction() { throw new Error("Public boundary not expected."); }
};
const availabilityRepository = createCleanerProfileRepository(availabilityDatabase);
await availabilityRepository.listOwnAvailability(cleanerActor, "2026-07-16T12:00:00.000Z");
await availabilityRepository.createOwnAvailability(cleanerActor, availabilityInput);
assert(availabilityQueries.every((call) => call.actor.userId === cleanerActor.userId && call.text.includes("$1")) && availabilityQueries.some((call) => call.text.includes("pg_advisory_xact_lock")) && availabilityQueries.some((call) => call.text.includes("tstzrange")) && availabilityQueries.some((call) => call.text.includes("current_availability_status='available'")), "Exact availability did not remain owner-bound, parameterized, serialized, overlap-safe and reflected in matching status.");

const projection = publicCleanerProjection(publicRows[0]);
assert(Object.keys(projection).every((key) => !["email", "phone", "homeAddress", "acceptanceRate", "latitude", "longitude"].includes(key)), "Cleaner public projection contains a forbidden field name.");
const editableProjection = editableCleanerProjection({ ...publicRows[0], user_id: cleanerActor.userId, service_areas: [{ outwardPostcode: "SW1A", latitude: 51.5, longitude: -0.1 }] });
assert(editableProjection.serviceAreas.length === 1 && !Object.hasOwn(editableProjection, "email") && !Object.hasOwn(editableProjection, "phone"), "Editable Cleaner projection omitted owner data or exposed account contact details.");

const rlsSql = await readFile(new URL("../db/migrations/002_marketplace_row_level_security.sql", import.meta.url), "utf8");
const directorySql = await readFile(new URL("../db/migrations/006_cleaner_directory.sql", import.meta.url), "utf8");
const directoryFallbackSql = await readFile(new URL("../db/migrations/064_public_cleaner_distance_fallback.sql", import.meta.url), "utf8");
const publicLookupSql = await readFile(new URL("../db/migrations/057_public_cleaner_profile_lookup.sql", import.meta.url), "utf8");
const runtimeGrantsSql = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const returnedColumns = directorySql.slice(directorySql.indexOf("RETURNS TABLE"), directorySql.indexOf("LANGUAGE sql"));
assert(!rlsSql.includes("CREATE POLICY public_cleaner_areas") && !rlsSql.includes("cleaner_service_areas FOR SELECT USING (true)"), "Cleaner service-area coordinates remain directly public under RLS.");
assert(directorySql.includes("candidate_outward_postcode") && directorySql.includes("candidate_service_code") && directorySql.includes("candidate_start_at") && directorySql.includes("candidate_minimum_rating") && directorySql.includes("candidate_maximum_price_pence") && directorySql.includes("candidate_verified_only") && directorySql.includes("candidate_maximum_distance_km") && directorySql.includes("profile_completion_percent = 100"), "Cleaner directory omitted a required public discovery filter or completeness gate.");
assert(directoryFallbackSql.includes("public-cleaner-distance-fallback-v1") && directoryFallbackSql.includes("CREATE OR REPLACE FUNCTION tideway_private.search_cleaner_directory") && directoryFallbackSql.includes("candidate_latitude IS NOT NULL AND candidate_longitude IS NOT NULL") && directoryFallbackSql.includes("csa.latitude IS NULL") && directoryFallbackSql.includes("csa.longitude IS NULL") && directoryFallbackSql.includes("csa.outward_postcode = replace(upper(btrim(candidate_outward_postcode)), ' ', '')") && directoryFallbackSql.includes("REVOKE ALL ON FUNCTION tideway_private.search_cleaner_directory") && directoryFallbackSql.includes("TO tideway_app"), "Nearby Cleaner search does not preserve its restricted exact-area fallback for profiles awaiting coordinates.");
assert(!returnedColumns.includes("email") && !returnedColumns.includes("phone") && !returnedColumns.includes("latitude") && !returnedColumns.includes("longitude") && runtimeGrantsSql.includes("search_cleaner_directory(text, text, timestamptz"), "Cleaner directory returns private location/contact data or lacks its restricted grant.");
assert(publicLookupSql.includes("SECURITY DEFINER") && publicLookupSql.includes("account.account_status = 'active'") && publicLookupSql.includes("profile.is_public") && publicLookupSql.includes("profile.profile_completion_percent = 100") && publicLookupSql.includes("service.is_active") && publicLookupSql.includes("REVOKE ALL ON FUNCTION tideway_private.get_public_cleaner_profile(uuid) FROM PUBLIC") && !publicLookupSql.includes("account.email") && !publicLookupSql.includes("phone") && runtimeGrantsSql.includes("get_public_cleaner_profile(uuid)"), "Direct public Cleaner lookup lacks active/public/completion gates, leaks private contact data or is executable outside the restricted application role.");

console.log("Cleaner profile tests passed: validated ownership-only editing, deterministic completion, exact future availability, publish gating, privacy-safe projections, requested discovery filters and non-public service-area coordinates.");

for (const role of ['primary','secondary','excluded']) {
  const p=normalizedCleanerProfile({...completeInput,isPublic:false,serviceAreas:[{outwardPostcode:'SW1A',role}]});
  assert(p.serviceAreas[0].role === role,'Work-area roles must survive normalization');
  if(role === 'excluded') assert(p.profileCompletionPercent < 100,'Excluded-only coverage cannot make a profile complete');
}
assert(throws(()=>normalizedCleanerProfile({...completeInput,serviceAreas:[{outwardPostcode:'SW1A',role:'unknown'}]}),'valid work-area role'),'Invalid roles must fail');

// Every field profileCompletionPercent requires must be reachable from the
// product. Four of the nine were passed through unchanged by every page that
// wrote the profile — biography, a price, languages and the property-type
// preference — so completion was capped near 56%, `isPublic` could never be
// accepted, and the public Cleaner directory stayed permanently empty. That was
// read as a recruitment problem for weeks.
const registrationPage = await readFile(new URL("../public/cleaner-registration.html", import.meta.url), "utf8");
const experienceScript = await readFile(new URL("../public/cleaner-experience.js", import.meta.url), "utf8");
for (const control of ['name="biography"', 'name="hourlyRate"', 'name="languages"', 'name="residentialPreference"', 'name="commercialPreference"']) {
  assert(registrationPage.includes(control), `Cleaner onboarding cannot collect ${control}, so a profile can never reach 100% and never be published.`);
}
assert(/minlength="40"/.test(registrationPage), "The biography control does not state the 40-character minimum the completion check enforces.");
// Reading the controls is what matters; a field that exists but is never read
// leaves completion exactly where it was.
for (const read of ["form.elements.biography", "ratePenceFrom", "selectedLanguages", "propertyTypePreferences"]) {
  assert(experienceScript.includes(read), `The experience form does not read ${read} into the saved profile.`);
}
assert(!/biography: currentProfile\.biography \|\| ""[\s\S]{0,40}hourlyRatePence: currentProfile\.hourlyRatePence/.test(experienceScript), "The experience form is passing the profile straight through again, which is what capped completion.");
// Pounds in, pence stored, rounded rather than truncated so £12.50 does not
// become £12.49 through a floating-point remainder.
assert(experienceScript.includes("Math.round(pounds * 100)"), "The hourly rate is not converted to whole pence safely.");

// A profile that reaches 100% must actually be publishable from the product.
const profilePreviewPage = await readFile(new URL("../public/cleaner-public-profile.html", import.meta.url), "utf8");
const profilePreviewScript = await readFile(new URL("../public/cleaner-public-profile.js", import.meta.url), "utf8");
assert(!profilePreviewPage.includes("aria-readonly"), "The publish switch is still marked read-only, so it cannot be operated.");
assert(profilePreviewScript.includes("togglePublished") && /method: "PUT"/.test(profilePreviewScript) && profilePreviewScript.includes("storedCsrf()"), "The publish switch does not send an authenticated profile update, so publishing remains impossible.");
assert(profilePreviewScript.includes("isPublic: next"), "The publish switch does not change the published state.");
// The endpoint replaces the profile, so sending a bare flag would blank
// everything else the Cleaner has filled in.
assert(/\{ \.\.\.currentProfile, isPublic: next \}/.test(profilePreviewScript), "Publishing sends a partial profile and would erase the Cleaner's other answers.");
// Keyboard operation, because a span is not a button.
assert(profilePreviewScript.includes('addEventListener("keydown"') && profilePreviewScript.includes('event.key !== " " && event.key !== "Enter"'), "The publish switch cannot be operated from the keyboard.");
// Below 100% the server refuses. The control must say so rather than failing on use.
assert(profilePreviewScript.includes('aria-disabled') && profilePreviewScript.includes("Finish every profile section to publish"), "An unpublishable profile shows an enabled switch that will fail when used.");

console.log("Cleaner publish-path tests passed: every completion field is collected and read, pounds convert to exact pence, and the publish switch performs an authenticated whole-profile update it can be operated to reach.");

// Available hours are the only input matching reads. The POST endpoint behind
// them was written, validated and granted, then never called from anywhere in
// the product — so every Cleaner was unmatchable regardless of how many were
// recruited, and the page built for it had been redirected away.
const schedulePage = await readFile(new URL("../public/cleaner-schedule.html", import.meta.url), "utf8");
const scheduleScript = await readFile(new URL("../public/cleaner-schedule.js", import.meta.url), "utf8");
assert(/method: "POST"[\s\S]{0,200}cleaner\/availability|cleaner\/availability"[\s\S]{0,200}method: "POST"/.test(scheduleScript), "Nothing in the product creates an availability window, so no Cleaner can be matched.");
assert(scheduleScript.includes('method: "DELETE"') && scheduleScript.includes("cleaner/availability/"), "A Cleaner cannot withdraw hours they can no longer work.");
assert(scheduleScript.includes("storedCsrf()"), "Availability changes are sent without the session CSRF token and will be refused.");
for (const control of ['name="availabilityDate"', 'name="availabilityStart"', 'name="availabilityEnd"']) {
  assert(schedulePage.includes(control), `The schedule page cannot collect ${control}.`);
}
// An overnight shift is ordinary in commercial cleaning; rejecting it as
// "ends before it starts" would quietly exclude that whole market.
assert(scheduleScript.includes("24 * 60 * 60_000") && /if \(endAt <= startAt\) endAt = new Date/.test(scheduleScript), "An overnight availability window is rejected instead of rolling into the next morning.");
// The client bounds must not contradict normalizedAvailabilityWindow, or a
// Cleaner gets a server error for something the form accepted.
assert(scheduleScript.includes("30 * 60_000") && scheduleScript.includes("5 * 60_000") && scheduleScript.includes("366 * 24 * 60 * 60_000"), "The availability form does not mirror the server's duration, lead-time and horizon limits.");
// A held window belongs to a booking and the server refuses to withdraw it.
assert(scheduleScript.includes('window_.status === "held"') && scheduleScript.includes("Booked"), "A booked window offers a remove button the server will refuse.");

// Holiday mode is stored in the onboarding blob and enforced nowhere. It must
// not claim otherwise. This is the false-trust-claim limit in CLAUDE.md.
assert(!schedulePage.includes("Homle will not offer new jobs on this date"), "The schedule page promises holiday enforcement that nothing performs.");
assert(!/Holiday mode &mdash; pause all new job offers/.test(schedulePage), "Holiday mode still claims to pause offers it cannot pause.");
assert(schedulePage.includes("remove your available hours"), "The time-off section does not point at the control that actually stops offers.");

console.log("Cleaner availability tests passed: hours can be added and withdrawn against the real endpoint, overnight shifts survive, client bounds mirror the server, booked windows are not offered for removal, and holiday mode no longer claims an enforcement it does not have.");
