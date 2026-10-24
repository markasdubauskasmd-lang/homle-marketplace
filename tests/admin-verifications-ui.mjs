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

/* ── The evidence behind a vetting decision is reachable ───────────────── */

// Approving a Cleaner is what puts a stranger in a customer's home. The screen
// showed a name and two status strings; these pin the review path that makes
// the decision an informed one, and the honesty of what it claims to show.
{
  const source = await readFile(new URL("../public/admin-verifications.js", import.meta.url), "utf8");
  assert(source.includes("/application`"), "The vetting screen cannot open a submitted application.");
  // Behind a button, not loaded with the queue: every read is audited against
  // the Administrator's name, and opening a page must not record them as
  // having examined twenty people's identity documents.
  assert(source.includes("Review submitted application") && source.includes('reveal.addEventListener("click"'),
    "The application review is no longer an explicit, per-cleaner action.");
  assert(!/loadQueue[\s\S]{0,400}\/application/.test(source),
    "Opening the queue fetches applications, which would audit an Administrator as reading every one of them.");
  // A section that cannot be decrypted is shown as unreadable, never hidden:
  // an incomplete application must not be able to look complete.
  assert(source.includes("could not be decrypted and must not be treated as submitted evidence"),
    "An undecryptable application section would be presented as if it were fine.");
  // And the screen must not imply the Administrator has seen a document when
  // it has only shown them its filename.
  assert(source.includes("File contents are not shown here"),
    "The review screen implies document contents were reviewed when only metadata is shown.");
  assert(!source.includes("innerHTML"), "The application review renders untrusted applicant text as markup.");
}
console.log("Cleaner application review UI checks passed: explicit per-cleaner read, no queue-wide auditing, undecryptable sections surfaced, and no claim to show document contents.");
