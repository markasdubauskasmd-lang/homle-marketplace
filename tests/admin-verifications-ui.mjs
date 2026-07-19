import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { adminVerificationQueue, adminVerificationView, cleanerVerificationState, verificationChange, verificationStatusLabel } from "../public/admin-verifications-model.js";

assert.equal(adminVerificationView("awaiting"), "awaiting");
assert.equal(adminVerificationView(""), null);
assert.throws(() => adminVerificationView("everyone"), /valid cleaner verification view/);
assert.equal(verificationStatusLabel("not-checked"), "Not Checked");
assert.equal(verificationStatusLabel("not-required"), "Not Required");

assert.deepEqual(cleanerVerificationState({ identityCheckStatus: "verified", backgroundCheckStatus: "not-required" }), { fullyVerified: true, awaiting: false });
assert.deepEqual(cleanerVerificationState({ identityCheckStatus: "verified", backgroundCheckStatus: "pending" }), { fullyVerified: false, awaiting: true });
assert.deepEqual(cleanerVerificationState({ identityCheckStatus: "not-checked", backgroundCheckStatus: "verified" }), { fullyVerified: false, awaiting: true });

const queue = adminVerificationQueue({ cleaners: [{ cleanerId: "22222222-2222-4222-8222-222222222222", displayName: "Test Cleaner", identityCheckStatus: "pending", backgroundCheckStatus: "not-checked", isPublic: false, updatedAt: "2026-07-19T10:00:00.000Z" }], limit: 50, offset: 0 });
assert.equal(queue.cleaners.length, 1);
assert.throws(() => adminVerificationQueue({ cleaners: [{ identityCheckStatus: "invented", backgroundCheckStatus: "not-checked" }], limit: 50, offset: 0 }), /status is unavailable/);
assert.throws(() => adminVerificationQueue({ cleaners: "none", limit: 50, offset: 0 }), /queue is unavailable/);

const change = verificationChange("verified", "", "Passport and proof of address reviewed on a video call.");
assert.deepEqual(change, { identityCheckStatus: "verified", note: "Passport and proof of address reviewed on a video call." });
assert.throws(() => verificationChange("", "", "A note."), /identity or background/);
assert.throws(() => verificationChange("invented", "", "A note."), /supported identity/);
assert.throws(() => verificationChange("", "invented", "A note."), /supported background/);
assert.throws(() => verificationChange("verified", "", "   "), /evidence note/);
assert.equal(verificationChange("verified", "", `${"x".repeat(600)}`).note.length, 500, "The evidence note was not bounded to 500 characters.");

const [page, script, migration, grants, server] = await Promise.all([
  readFile(new URL("../public/admin-verifications.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-verifications.js", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/063_administrator_cleaner_verification.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);
assert(page.includes("Review documents outside this page, then record the outcome") && page.includes('name="referrer" content="no-referrer"') && page.includes("data-admin-verifications-awaiting") && page.includes("data-admin-verifications-verified"), "The vetting page lost its evidence boundary, referrer protection or review counters.");
assert(script.includes("/api/marketplace/admin/cleaner-verifications") && script.includes("X-CSRF-Token") && script.includes("/api/marketplace/auth/session") && script.includes("audit-logged") && !script.includes("innerHTML"), "The vetting UI lost the protected API, CSRF recovery, audit statement or safe DOM rendering.");
for (const forbidden of ["email", "phone", "postcode", "address_line", "home_address"]) assert(!migration.includes(forbidden), `The verification queue projection exposed forbidden ${forbidden}.`);
assert(migration.includes("SECURITY DEFINER") && migration.includes("administrator-required") && migration.includes("audit_logs"), "The verification functions lost Administrator enforcement or audit logging.");
assert(grants.includes("list_cleaner_verification_queue(text,integer,integer)") && grants.includes("set_cleaner_verification(uuid,text,text,text)") && server.includes('"/admin/verifications": "admin-verifications.html"'), "The restricted grants or protected page route are missing.");
console.log("Administrator verification UI tests passed: validated views and decisions, bounded evidence note, privacy-minimal projection and protected page route.");
