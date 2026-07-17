import { readFile } from "node:fs/promises";
import { createBookingPricingPolicy } from "../src/marketplace/booking-workflow.mjs";
import { createMatchingRepository } from "../src/marketplace/matching-repository.mjs";
import { createMatchingService } from "../src/marketplace/matching-service.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }

const now = new Date("2026-07-15T10:00:00.000Z");
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const requestId = "66666666-6666-4666-8666-666666666666";
const common = {
  requested_start_at: "2026-07-20T09:00:00.000Z",
  requested_end_at: "2026-07-20T12:00:00.000Z",
  required_services: ["regular-domestic"],
  budget_pence: 20000,
  average_rating: "4.80",
  review_count: 12,
  completed_job_count: 30,
  years_experience: 6,
  languages: ["English"],
  equipment_supplied: ["Vacuum"],
  products_supplied: ["General products"],
  verified_badges: ["Identity"],
  identity_verified: true,
  current_availability_status: "available",
  previous_completed_jobs: 0
};
const candidates = [
  { ...common, cleaner_id: landlord.userId, public_slug: "own-cleaner-workspace", display_name: "Same account", profile_photo_url: null, biography: "Must not be a counterparty", distance_km: "0.00", exact_postcode_area: true, base_match_score: "99", services: [{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 1000 }] },
  { ...common, cleaner_id: "33333333-3333-4333-8333-333333333333", public_slug: "premium-cleaner", display_name: "Premium Cleaner", profile_photo_url: null, biography: "Careful premium work", distance_km: "1.20", exact_postcode_area: false, base_match_score: "62", services: [{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 2500 }] },
  { ...common, cleaner_id: cleaner.userId, public_slug: "returning-cleaner", display_name: "Returning Cleaner", profile_photo_url: "https://images.example/cleaner.jpg", biography: "Reliable local cleaner", distance_km: "0.00", exact_postcode_area: true, previous_completed_jobs: 2, base_match_score: "60", services: [{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 2000 }] },
  { ...common, cleaner_id: "77777777-7777-4777-8777-777777777777", public_slug: "far-same-rate", display_name: "Far Same Rate", profile_photo_url: null, biography: "Same rate with longer travel", distance_km: "15.00", exact_postcode_area: false, base_match_score: "60", services: [{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 2000 }] },
  { ...common, cleaner_id: "44444444-4444-4444-8444-444444444444", public_slug: "over-budget", display_name: "Over Budget", profile_photo_url: null, biography: "Outside budget", distance_km: "2.00", exact_postcode_area: false, base_match_score: "74", budget_pence: 8000, services: [{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 3000 }] },
  { ...common, cleaner_id: "55555555-5555-4555-8555-555555555555", public_slug: "manual-quote", display_name: "Manual Quote", profile_photo_url: null, biography: "Needs review", distance_km: "3.00", exact_postcode_area: false, base_match_score: "75", services: [{ serviceCode: "regular-domestic", pricingModel: "quote", pricePence: null }] }
];
const calls = [];
const repository = { async recommendForRequest(actor, suppliedRequestId, limit) { calls.push({ actor, suppliedRequestId, limit }); return candidates; } };
const pricingPolicy = createBookingPricingPolicy({ targetMarginBasisPoints: 2000, labourOnCostBasisPoints: 1000, paymentFeeBasisPoints: 300, paymentFeeFixedPence: 20, travelCostPence: 500, travelCostPerKmPence: 35, travelDistanceMultiplierBasisPoints: 20000, suppliesCostPence: 250, otherCostPence: 0, invitationTtlMinutes: 180 });
const service = createMatchingService(repository, { pricingPolicy, clock: () => new Date(now) });
const result = await service.recommendForRequest(landlord, requestId);
assert(calls[0].actor.userId === landlord.userId && calls[0].suppliedRequestId === requestId && calls[0].limit === 25, "Matching did not bind the authenticated Landlord and bounded request query.");
assert(result.generatedAt === now.toISOString() && result.candidates.length === 3 && result.candidates[0].cleanerId === cleaner.userId && result.candidates[0].rank === 1 && result.candidates[0].estimatedCustomerPricePence < result.candidates.find((candidate) => candidate.publicSlug === "far-same-rate").estimatedCustomerPricePence, "Matching did not exclude unpriceable/out-of-budget Cleaners or charge and rank the same Cleaner rate using frozen travel distance.");
assert(result.candidates.every((candidate) => candidate.cleanerId !== landlord.userId), "A dual-workspace Landlord was shown their own Cleaner profile as a match.");
assert(result.candidates[0].matchReasons.some((reason) => reason.includes("previous")) && result.candidates[0].matchReasons.some((reason) => reason.includes("postcode")), "Safe match explanations omitted prior relationship or declared coverage.");
const publicJson = JSON.stringify(result);
assert(!publicJson.includes("acceptance_rate") && !publicJson.includes("base_match_score") && !publicJson.includes("cleanerPayPence") && !publicJson.includes("labourOnCost") && !publicJson.includes("latitude") && !publicJson.includes("longitude"), "Matching projection exposed internal ranking, Cleaner pay, costs or private coordinates.");
assert(await rejects(() => service.recommendForRequest(cleaner, requestId), "Landlord"), "A Cleaner could run Landlord request matching.");
assert(await rejects(() => service.recommendForRequest(landlord, "not-a-request"), "valid cleaning request"), "Matching accepted an invalid request identifier.");
const disabled = createMatchingService(repository);
assert(await rejects(() => disabled.recommendForRequest(landlord, requestId), "pricing policy"), "Matching did not fail closed without private profitability inputs.");

const databaseCalls = [];
let failure = null;
const database = { async withUserTransaction(actor, operation) { return operation({ async query(text, values) { databaseCalls.push({ actor, text, values }); if (failure) throw failure; return { rows: candidates }; } }); } };
const databaseRepository = createMatchingRepository(database);
const rows = await databaseRepository.recommendForRequest(landlord, requestId, 25);
assert(rows.length === candidates.length && databaseCalls[0].text.includes("tideway_private.recommend_cleaners_for_request_v2($1::uuid, $2::integer)") && databaseCalls[0].values[0] === requestId && databaseCalls[0].values[1] === 25, "Matching repository bypassed the hardened request-specific function or interpolation-safe parameters.");
failure = new Error("request-not-matchable");
assert(await rejects(() => databaseRepository.recommendForRequest(landlord, requestId, 25), "no longer open"), "Closed requests did not map to a safe matching conflict.");

const migration = await readFile(new URL("../db/migrations/010_request_cleaner_matching.sql", import.meta.url), "utf8");
const selfExclusionMigration = await readFile(new URL("../db/migrations/053_matching_self_exclusion.sql", import.meta.url), "utf8");
const grants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
for (const required of ["SECURITY DEFINER", "request.landlord_user_id = actor_id", "profile.profile_completion_percent = 100", "account.account_status = 'active'", "service.pricing_model <> 'quote'", "availability.status = 'available'", "tstzrange(occupied.scheduled_start_at", "coverage.distance_km <= profile.travel_radius_km", "previous_completed_jobs", "profile.acceptance_rate", "request_record.budget_pence"]) assert(migration.includes(required), `Request-specific matching omitted ${required}.`);
assert(grants.includes("recommend_cleaners_for_request(uuid, integer)"), "The restricted runtime role cannot execute request-specific matching.");
assert(grants.includes("recommend_cleaners_for_request_v2(uuid, integer)") && selfExclusionMigration.includes("candidate.cleaner_id<>request_landlord_id") && selfExclusionMigration.includes("LEAST(result_limit + 1,50)") && selfExclusionMigration.includes("LIMIT result_limit") && selfExclusionMigration.includes("recommend_cleaners_for_request_v2(request_record.id,50)"), "Administrator and automatic-dispatch matching do not share bounded database-enforced self-exclusion.");

console.log("Matching tests passed: owner-only request ranking, dual-workspace self-exclusion, full eligibility/availability/coverage filters, profitable budget-aware pricing, prior-relationship scoring, safe explanations and private-factor projection.");
