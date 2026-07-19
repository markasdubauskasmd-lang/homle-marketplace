import assert from "node:assert/strict";
import { createAdministratorVerificationService } from "../src/marketplace/administrator-verification-service.mjs";

const cleanerId = "22222222-2222-4222-8222-222222222222";
const admin = { userId: "44444444-4444-4444-8444-444444444444", roles: ["administrator"] };
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };

const calls = [];
const repository = {
  async listQueue(actor, input) { calls.push({ kind: "list", actor, input }); return { cleaners: [{ cleanerId, displayName: "Test Cleaner", identityCheckStatus: "pending", backgroundCheckStatus: "not-checked", isPublic: false, updatedAt: "2026-07-19T10:00:00.000Z" }], limit: input.limit, offset: input.offset }; },
  async setVerification(actor, input) { calls.push({ kind: "set", actor, input }); return { cleanerId, identityCheckStatus: input.identityCheckStatus || "pending", backgroundCheckStatus: input.backgroundCheckStatus || "not-checked" }; }
};
const service = createAdministratorVerificationService(repository);

async function rejects(operation, codeOrFragment) {
  try { await operation(); return false; } catch (error) { return String(error.code || error.message).includes(codeOrFragment); }
}

// Administrator lists the queue with a validated view and pagination.
const page = await service.list(admin, { view: "awaiting", limit: "25", offset: "0" });
assert(page.cleaners.length === 1 && page.cleaners[0].cleanerId === cleanerId && page.cleaners[0].identityCheckStatus === "pending" && Object.isFrozen(page.cleaners), "The verification queue projection was not validated and frozen.");
assert(calls[0].input.view === "awaiting" && calls[0].input.limit === 25, "The view or page size was not canonicalised for the repository.");

// Non-administrators are refused on both operations.
assert(await rejects(() => service.list(landlord, {}), "administrator-required"), "A landlord could read the verification queue.");
assert(await rejects(() => service.set(landlord, cleanerId, { identityCheckStatus: "verified" }), "administrator-required"), "A landlord could set a verification status.");

// An Administrator sets a status; invalid statuses and empty changes are rejected.
const set = await service.set(admin, cleanerId, { identityCheckStatus: "verified", backgroundCheckStatus: "not-required", note: "Reviewed passport and DBS." });
assert(set.identityCheckStatus === "verified" && set.backgroundCheckStatus === "not-required" && calls.at(-1).input.cleanerId === cleanerId && calls.at(-1).input.note.includes("passport"), "A valid Administrator verification was not passed through to the repository.");
assert(await rejects(() => service.set(admin, cleanerId, {}), "identity or background"), "An empty verification change was accepted.");
assert(await rejects(() => service.set(admin, cleanerId, { identityCheckStatus: "invented" }), "supported identity"), "An invalid identity status was accepted.");
assert(await rejects(() => service.set(admin, cleanerId, { backgroundCheckStatus: "invented" }), "supported background"), "An invalid background status was accepted.");
assert(await rejects(() => service.set(admin, "not-a-uuid", { identityCheckStatus: "verified" }), "valid cleaner"), "A malformed cleaner id was accepted.");

// A long note is bounded before it reaches the repository.
await service.set(admin, cleanerId, { identityCheckStatus: "pending", note: "x".repeat(900) });
assert(calls.at(-1).input.note.length === 500, "The verification note was not bounded to 500 characters.");

assert.throws(() => createAdministratorVerificationService({}), /complete Administrator verification repository/);

console.log("Administrator verification service tests passed: administrator-only access, validated statuses, bounded note and canonical queue projection.");
