import { readFile } from "node:fs/promises";
import { createFavouriteCleanerService } from "../src/marketplace/favourite-cleaner-service.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejects(action, fragment) {
  try { await action(); } catch (error) { return String(error.message).includes(fragment); }
  return false;
}

const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const cleanerId = "33333333-3333-4333-8333-333333333333";
const calls = [];
const service = createFavouriteCleanerService({
  async listOwn(actor) {
    calls.push({ kind: "list", actor });
    return [{ cleaner_id: cleanerId, public_slug: "careful-cleaner", display_name: "Careful Cleaner", profile_photo_url: null, current_availability_status: "available", average_rating: "4.75", review_count: "8", completed_job_count: "14", services: JSON.stringify([{ serviceCode: "regular-domestic", pricingModel: "hourly", pricePence: 2500 }]), created_at: "2026-07-18T00:00:00.000Z", email: "must-not-leak@example.com" }];
  },
  async setOwn(actor, selectedCleanerId, favourite) {
    calls.push({ kind: "set", actor, selectedCleanerId, favourite });
    return { cleaner_id: selectedCleanerId, favourite };
  }
});

const listed = await service.listOwn(landlord);
assert(listed.length === 1 && listed[0].cleanerId === cleanerId && listed[0].averageRating === 4.75 && listed[0].services[0].pricePence === 2500 && !Object.hasOwn(listed[0], "email"), "Favourite Cleaner projection omitted public evidence or leaked private account data.");
const saved = await service.setOwn(landlord, cleanerId.toUpperCase(), { favourite: true, landlordUserId: cleaner.userId });
const removed = await service.setOwn(landlord, cleanerId, { favourite: false });
assert(saved.cleanerId === cleanerId && saved.favourite && !removed.favourite && calls.at(-2).actor.userId === landlord.userId && calls.at(-2).selectedCleanerId === cleanerId, "Favourite state did not bind the authenticated Landlord or normalize the Cleaner identifier.");
assert(await rejects(() => service.listOwn(cleaner), "Landlord account") && await rejects(() => service.setOwn(landlord, landlord.userId, { favourite: true }), "cannot be saved") && await rejects(() => service.setOwn(landlord, cleanerId, { favourite: "yes" }), "Choose whether") && await rejects(() => service.setOwn(landlord, "invalid", { favourite: true }), "valid Cleaner"), "Favourite Cleaner service accepted the wrong role, self-favourite, invalid state or invalid identifier.");

const [repository, rls, publicLookup] = await Promise.all([
  readFile(new URL("../src/marketplace/favourite-cleaner-repository.mjs", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/002_marketplace_row_level_security.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/057_public_cleaner_profile_lookup.sql", import.meta.url), "utf8")
]);
assert(repository.includes("withUserTransaction(actor") && repository.includes("WHERE favourite.landlord_user_id=$1::uuid") && repository.includes("JOIN LATERAL tideway_private.get_public_cleaner_profile(favourite.cleaner_user_id)") && repository.includes("SELECT 1 FROM tideway_private.get_public_cleaner_profile($1::uuid)") && repository.includes("ON CONFLICT (landlord_user_id,cleaner_user_id) DO NOTHING") && repository.includes("DELETE FROM favourite_cleaners WHERE landlord_user_id=$1::uuid") && !repository.includes("JOIN users account") && !repository.includes("account.email"), "Favourite persistence is not owner-bound, safe-public-profile-only, idempotent or privacy-minimised.");
assert(publicLookup.includes("account.account_status = 'active'") && publicLookup.includes("profile.is_public") && publicLookup.includes("profile.profile_completion_percent = 100") && publicLookup.includes("REVOKE ALL ON FUNCTION tideway_private.get_public_cleaner_profile(uuid) FROM PUBLIC") && !publicLookup.includes("account.email") && !publicLookup.includes("phone"), "Favourite Cleaner visibility is not backed by an active, complete, public and privacy-minimal Cleaner projection.");
assert(rls.includes("ALTER TABLE favourite_cleaners ENABLE ROW LEVEL SECURITY") && rls.includes("CREATE POLICY favourite_owner") && rls.includes("landlord_user_id = tideway_private.current_user_id()") && rls.includes("WITH CHECK (landlord_user_id = tideway_private.current_user_id()"), "Favourite Cleaners lack owner row-level security and write checks.");

console.log("Favourite Cleaner service tests passed: Landlord-only ownership, public projection, self-save prevention, idempotent persistence and database row security.");
