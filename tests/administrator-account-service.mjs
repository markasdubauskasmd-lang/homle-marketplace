import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAdministratorAccountService } from "../src/marketplace/administrator-account-service.mjs";
import { createAdministratorAccountRepository } from "../src/marketplace/administrator-account-repository.mjs";

const admin = { userId: "44444444-4444-4444-8444-444444444444", roles: ["administrator"] };
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const accountId = "22222222-2222-4222-8222-222222222222";

function repository(overrides = {}) {
  const calls = [];
  return {
    calls,
    async find(actor, identifier) {
      calls.push({ kind: "find", actor, identifier });
      return {
        accountId, email: "cleaner@example.com", displayName: "A Cleaner", accountStatus: "active",
        emailVerifiedAt: "2026-07-01T10:00:00.000Z", createdAt: "2026-06-01T10:00:00.000Z",
        roles: ["cleaner"], liveBookings: 2, ...overrides.find
      };
    },
    async setStatus(actor, input) {
      calls.push({ kind: "set", actor, input });
      if (typeof overrides.setStatus === "function") return overrides.setStatus(input);
      return { accountId, accountStatus: input.accountStatus, previousStatus: "active", changed: true, revokedSessions: 3, liveBookings: 2 };
    }
  };
}

async function rejects(operation, fragment) {
  try { await operation(); return false; } catch (error) { return String(error.code || error.message).includes(fragment); }
}

/* ── Only an Administrator ─────────────────────────────────────────────── */

{
  const service = createAdministratorAccountService(repository());
  assert.ok(await rejects(() => service.find(landlord, "cleaner@example.com"), "administrator-required"), "A Landlord searched for an account.");
  assert.ok(await rejects(() => service.setStatus(landlord, accountId, { accountStatus: "suspended", reason: "A landlord attempting a suspension." }), "administrator-required"),
    "A Landlord suspended an account.");
  assert.ok(await rejects(() => service.find({ roles: ["administrator"] }, "cleaner@example.com"), "administrator-required"),
    "An actor with no user id was accepted.");
}

/* ── The search is a lookup, not a directory ───────────────────────────── */

{
  const store = repository();
  const service = createAdministratorAccountService(store);
  const found = await service.find(admin, "  cleaner@example.com  ");
  assert.equal(store.calls[0].identifier, "cleaner@example.com", "The identifier was not trimmed before the lookup.");
  assert.equal(found.accountStatus, "active");
  assert.deepEqual(found.roles, ["cleaner"]);
  // Shown so the decision is made with it in view: suspending a Cleaner who
  // has a job tomorrow leaves a customer expecting somebody who will not come.
  assert.equal(found.liveBookings, 2);
  // A control surface, not a customer record viewer.
  const serialised = JSON.stringify(found);
  assert.ok(!/address|postcode|phone|payment|booking[A-Z]/.test(serialised), `The account projection carried unrelated personal data: ${serialised}`);
  for (const attempt of ["", "  ", "ab", "x".repeat(321)]) {
    assert.ok(await rejects(() => service.find(admin, attempt), "exact email"), `An unusable identifier was accepted: ${JSON.stringify(attempt)}`);
  }
}

/* ── A reason is required, and deletion is out of reach ────────────────── */

{
  const store = repository();
  const service = createAdministratorAccountService(store);
  for (const status of ["deleted", "deletion-pending", "", "banned", "ACTIVE-ISH"]) {
    assert.ok(await rejects(() => service.setStatus(admin, accountId, { accountStatus: status, reason: "A perfectly adequate reason." }), "active or suspended"),
      `An unsupported account status was accepted: ${status}`);
  }
  for (const reason of [undefined, "", "   ", "too short", "x".repeat(1001)]) {
    assert.ok(await rejects(() => service.setStatus(admin, accountId, { accountStatus: "suspended", reason }), "Record why"),
      `A suspension was accepted without a usable reason: ${JSON.stringify(reason)}`);
  }
  assert.ok(!store.calls.some((call) => call.kind === "set"), "A refused suspension still reached the database.");
}

/* ── The outcome is reported as it happened ────────────────────────────── */

{
  const store = repository();
  const service = createAdministratorAccountService(store);
  const suspended = await service.setStatus(admin, accountId.toUpperCase(), { accountStatus: "SUSPENDED", reason: "  Reported conduct in a customer home.  " });
  assert.equal(store.calls[0].input.accountStatus, "suspended");
  assert.equal(store.calls[0].input.reason, "Reported conduct in a customer home.", "The reason was not trimmed before being recorded.");
  assert.equal(suspended.changed, true);
  assert.equal(suspended.revokedSessions, 3, "The revoked session count was lost.");

  // Repeating is not an error and must not look like a change either.
  const unchanged = createAdministratorAccountService(repository({
    setStatus: (input) => ({ accountId, accountStatus: input.accountStatus, previousStatus: "suspended", changed: false, revokedSessions: 0, liveBookings: 0 })
  }));
  const again = await unchanged.setStatus(admin, accountId, { accountStatus: "suspended", reason: "Repeating the same decision." });
  assert.equal(again.changed, false);
  assert.equal(again.revokedSessions, 0);
}

// An impossible outcome is refused rather than reported as a success.
for (const broken of [
  null,
  { accountId, accountStatus: "deleted", changed: true, revokedSessions: 0, liveBookings: 0 },
  { accountId, accountStatus: "suspended", changed: "yes", revokedSessions: 0, liveBookings: 0 },
  { accountId, accountStatus: "suspended", changed: true, revokedSessions: -1, liveBookings: 0 },
  { accountId: "not-a-uuid", accountStatus: "suspended", changed: true, revokedSessions: 0, liveBookings: 0 }
]) {
  const service = createAdministratorAccountService(repository({ setStatus: () => broken }));
  // Refused on any ground — an unreadable outcome and a malformed id are both
  // reasons not to tell an Administrator their decision landed.
  assert.ok(await rejects(() => service.setStatus(admin, accountId, { accountStatus: "suspended", reason: "A perfectly adequate reason." }), ""),
    `An impossible status outcome was accepted: ${JSON.stringify(broken)}`);
}

/* ── The repository maps the database's refusals ───────────────────────── */

{
  const failures = [
    ["cannot-suspend-self", 409],
    ["last-administrator-protected", 409],
    ["account-not-found", 404],
    ["account-status-reason-required", 422],
    ["invalid-account-status", 422],
    ["administrator-required", 403]
  ];
  for (const [message, statusCode] of failures) {
    const store = createAdministratorAccountRepository({
      withUserTransaction: async (actor, run) => run({ query: async () => { throw new Error(message); } })
    });
    let mapped = null;
    try { await store.setStatus(admin, { accountId, accountStatus: "suspended", reason: "A perfectly adequate reason." }); }
    catch (error) { mapped = error; }
    assert.equal(mapped?.code, message, `The database refusal ${message} reached the caller unmapped.`);
    assert.equal(mapped?.statusCode, statusCode, `The database refusal ${message} carried the wrong status code.`);
    assert.ok(!/tideway_private|SELECT /.test(mapped.message), `A database refusal leaked its query: ${mapped.message}`);
  }
}

/* ── The guards live in the database, not here ─────────────────────────── */

// Every rule that makes suspension safe is enforced in migration 129 and
// executed by db/integration/account-status-verification.sql. This asserts the
// application layer has not grown a second, drifting copy of them.
{
  const migration = await readFile(new URL("../db/migrations/129_administrator_account_status.sql", import.meta.url), "utf8");
  for (const guard of ["cannot-suspend-self", "last-administrator-protected", "account-status-reason-required", "DELETE FROM sessions", "audit_logs"]) {
    assert.ok(migration.includes(guard), `Migration 129 lost the ${guard} guard.`);
  }
  const service = await readFile(new URL("../src/marketplace/administrator-account-service.mjs", import.meta.url), "utf8");
  assert.ok(!/last-administrator|suspend-self|DELETE FROM/i.test(service),
    "The service re-implements a guard the database owns, which is how the two drift apart.");
}

console.log("Administrator account control checks passed: administrator-only, exact-identifier lookup, recorded reason, deletion out of reach, honest outcomes, mapped refusals and guards left in the database.");

/* ── The screen only offers what the code can do ───────────────────────── */

{
  const { accountStatusLabel, accountStatusPayload, suspensionWarning } = await import("../public/admin-accounts-model.js");

  assert.deepEqual(accountStatusPayload("SUSPENDED", "  Reported conduct in a customer home.  "),
    { accountStatus: "suspended", reason: "Reported conduct in a customer home." });
  // Deletion is not offered here: it is irreversible, it is a reviewed
  // data-protection operation, and a screen that offers both invites the
  // wrong one.
  for (const status of ["deleted", "deletion-pending", "", "banned"]) {
    assert.throws(() => accountStatusPayload(status, "A perfectly adequate reason."), /active or suspended/, `The screen offered ${status}.`);
  }
  for (const reason of ["", "   ", "too short", "x".repeat(1001)]) {
    assert.throws(() => accountStatusPayload("suspended", reason), /Record why|under 1,000/, `A suspension was accepted with reason ${JSON.stringify(reason)}.`);
  }
  // Readable but not settable, so an Administrator can see the account is
  // already on its way out.
  assert.equal(accountStatusLabel("deletion-pending"), "Deletion pending");
  assert.equal(accountStatusLabel("nonsense"), "Unknown");

  // The live-booking warning appears BEFORE the decision, and only where it
  // means something.
  assert.match(suspensionWarning({ accountStatus: "active", liveBookings: 2 }), /2 live bookings[\s\S]*does not cancel/);
  assert.match(suspensionWarning({ accountStatus: "active", liveBookings: 1 }), /1 live booking\b/);
  assert.equal(suspensionWarning({ accountStatus: "active", liveBookings: 0 }), "");
  assert.equal(suspensionWarning({ accountStatus: "suspended", liveBookings: 5 }), "", "A restore was warned about cancelling bookings.");

  const page = await readFile(new URL("../public/admin-accounts.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/admin-accounts.js", import.meta.url), "utf8");
  // The page must not claim to do things it does not do.
  assert.ok(page.includes("It does not cancel their bookings, refund anyone or delete anything"),
    "The account page no longer states what suspension leaves untouched.");
  assert.ok(page.includes("Suspension is reversible. Deletion is not offered here."),
    "The account page lost its deletion boundary.");
  assert.ok(page.includes("not a directory"), "The page no longer says it will not browse accounts.");
  assert.ok(page.includes('name="identifier"') && !/data-admin-accounts-list/.test(page),
    "The account page grew a browsable list instead of an exact lookup.");
  assert.ok(page.includes('content="noindex,nofollow"') && page.includes('data-admin-accounts-workspace hidden'),
    "The account page is indexable or does not fail closed.");
  assert.ok(script.includes('"X-CSRF-Token": csrf') && script.includes("storedCsrf()"),
    "Account changes lost their CSRF binding.");
  assert.ok(!script.includes("innerHTML"), "The account page renders account text as markup.");
}
console.log("Account control UI checks passed: suspension only, recorded reason, live bookings warned before the decision, exact lookup, fail-closed workspace and CSRF-bound writes.");
