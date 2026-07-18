import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHostingerRelease,
  inspectZipEntries,
  readZipEntry,
  selectReleaseFiles,
  validateReleaseEntries
} from "../tools/build-hostinger-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedFiles = await selectReleaseFiles(root);

for (const required of [
  "server.mjs",
  "travel-coverage.mjs",
  "authentication-activation-readiness.mjs",
  "public/index.html",
  "public/account-menu.js",
  "src/marketplace/runtime.mjs",
  "db/migration-lock.json",
  "db/migrations/038_facebook_data_deletion_callback.sql",
  "db/migrations/039_unexpected_task_frozen_terms.sql",
  "db/migrations/040_payment_reconciliation_ordering.sql",
  "db/migrations/041_due_payment_readiness_notifications.sql",
  "db/migrations/042_booking_payment_window_summary.sql",
  "db/migrations/043_two_stage_payment_reminders.sql",
  "db/migrations/044_confirmed_visit_reminders.sql",
  "db/migrations/045_owner_request_withdrawal.sql",
  "db/migrations/046_fix_social_identity_column_ambiguity.sql",
  "db/migrations/047_fix_role_onboarding_column_ambiguity.sql",
  "db/migrations/048_multi_workspace_accounts.sql",
  "db/migrations/049_pending_cleaner_scope_handoff.sql",
  "db/migrations/050_administrator_payment_operations.sql",
  "db/migrations/051_administrator_case_payment_handoff.sql",
  "db/migrations/052_administrator_booking_operations.sql",
  "db/migrations/053_matching_self_exclusion.sql",
  "db/migrations/054_cleaning_request_realtime_events.sql",
  "db/migrations/055_session_avatar_projection.sql",
  "db/migrations/056_booking_minimum_contribution.sql",
  "db/migrations/057_public_cleaner_profile_lookup.sql",
  "db/migrations/058_automatic_dispatch_customer_cap.sql",
  "db/migrations/059_participant_response_deadline.sql",
  "db/migrations/060_apple_sign_in_provider.sql",
  "db/migrations/061_fix_missing_rate_limit_scopes.sql",
  "db/runtime-role-grants.sql",
  "db/worker-role-grants.sql",
  "db/bootstrap/assert-empty-staging.sql",
  "db/integration/deployment-verification.sql",
  "scripts/marketplace-worker.mjs",
  "tools/check-dependency-lock.mjs",
  "tools/domain-readiness.mjs",
  "tools/production-preflight.mjs",
  "tools/authentication-preflight.mjs",
  "tools/bootstrap-staging-database.mjs",
  "tools/staging-service-probe.mjs",
  "tools/staging-evidence-runner.mjs",
  "tools/build-hostinger-release.mjs"
]) {
  assert(expectedFiles.includes(required), `Release selection omitted ${required}.`);
}
for (const forbidden of [
  ".env",
  "data/cleaning-requests.ndjson",
  "tests/hostinger-release-builder.mjs",
  "docs/HOSTINGER_DEPLOYMENT.md",
  "public/tracking-test.html",
  "public/tracking-test.js"
]) {
  assert(!expectedFiles.includes(forbidden), `Release selection included private or non-runtime file ${forbidden}.`);
}

assert.throws(() => inspectZipEntries(Buffer.from("not a zip")), /valid ZIP/i, "Corrupt archives were accepted.");
assert.throws(
  () => validateReleaseEntries([{ name: "../secret", directory: false }], ["../secret"]),
  /unsafe path/i,
  "Archive traversal paths were accepted."
);
assert.throws(
  () => validateReleaseEntries([{ name: ".env.production", directory: false }], [".env.production"]),
  /environment-secret/i,
  "Environment-secret files were accepted."
);

const outputDirectory = await mkdtemp(path.join(tmpdir(), "homle-release-test-"));
try {
  const release = await buildHostingerRelease({ root, outputDirectory, requireClean: false });
  assert.match(release.sourceCommit, /^[0-9a-f]{8}$/);
  assert.match(release.sha256, /^[0-9A-F]{64}$/);
  assert.equal(release.privateMaterialIncluded, false);
  assert.equal(release.requiredRuntimeFilesVerified, true);
  assert.equal(release.databaseAssetsVerified, true);
  assert.equal(release.migrationCount, 61);
  assert(release.entryCount >= release.fileCount && release.fileCount === expectedFiles.length + 1);

  const archive = await readFile(release.archivePath);
  const entries = inspectZipEntries(archive);
  assert.equal(entries.some((entry) => entry.name === "homle-release.json"), true, "Built release omitted its runtime deployment identity.");
  assert.equal(entries.some((entry) => entry.name === "public/account-menu.js"), true, "Built release omitted secure dashboard sign-out.");
  const identity = JSON.parse(readZipEntry(archive, "homle-release.json").toString("utf8"));
  assert.deepEqual(identity, { schemaVersion: 1, application: "Homle", sourceCommit: release.sourceCommit, builtAt: release.generatedAt, migrationCount: 61 });
  assert.equal(entries.some((entry) => entry.name === "travel-coverage.mjs"), true, "Built release omitted the server's travel coverage dependency.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/038_facebook_data_deletion_callback.sql"), true, "Built release omitted the locked Facebook data-deletion migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/039_unexpected_task_frozen_terms.sql"), true, "Built release omitted the locked unexpected-task economics migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/040_payment_reconciliation_ordering.sql"), true, "Built release omitted the locked payment-ordering migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/041_due_payment_readiness_notifications.sql"), true, "Built release omitted the locked payment-readiness migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/042_booking_payment_window_summary.sql"), true, "Built release omitted the authoritative payment-window summary migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/043_two_stage_payment_reminders.sql"), true, "Built release omitted the two-stage payment reminder migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/044_confirmed_visit_reminders.sql"), true, "Built release omitted the confirmed-visit reminder migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/045_owner_request_withdrawal.sql"), true, "Built release omitted the owner request-withdrawal migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/046_fix_social_identity_column_ambiguity.sql"), true, "Built release omitted the social-identity ambiguity repair migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/047_fix_role_onboarding_column_ambiguity.sql"), true, "Built release omitted the role-onboarding ambiguity repair migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/048_multi_workspace_accounts.sql"), true, "Built release omitted the audited multi-workspace migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/049_pending_cleaner_scope_handoff.sql"), true, "Built release omitted the pending-Cleaner checklist handoff migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/050_administrator_payment_operations.sql"), true, "Built release omitted the Administrator payment-operations queue migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/051_administrator_case_payment_handoff.sql"), true, "Built release omitted the booking-case payment-handoff migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/052_administrator_booking_operations.sql"), true, "Built release omitted the Administrator booking-operations migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/053_matching_self_exclusion.sql"), true, "Built release omitted the shared matching self-exclusion migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/054_cleaning_request_realtime_events.sql"), true, "Built release omitted private Landlord request live updates.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/055_session_avatar_projection.sql"), true, "Built release omitted the account-avatar session projection.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/056_booking_minimum_contribution.sql"), true, "Built release omitted the booking minimum-contribution migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/057_public_cleaner_profile_lookup.sql"), true, "Built release omitted the privacy-safe public Cleaner lookup migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/058_automatic_dispatch_customer_cap.sql"), true, "Built release omitted the automatic-dispatch customer-cap migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/059_participant_response_deadline.sql"), true, "Built release omitted the participant response-deadline migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/060_apple_sign_in_provider.sql"), true, "Built release omitted the Apple sign-in migration.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/061_fix_missing_rate_limit_scopes.sql"), true, "Built release omitted the rate-limit scope repair migration.");
  assert.equal(entries.some((entry) => entry.name === "public/tracking-test.html"), false, "Built release exposed the local tracking lab.");
  validateReleaseEntries(entries, [...expectedFiles, "homle-release.json"]);

  const manifest = JSON.parse(await readFile(release.manifestPath, "utf8"));
  assert.equal(manifest.archive, path.basename(release.archivePath));
  assert.equal(manifest.sha256, release.sha256);
  assert.equal(manifest.fileCount, expectedFiles.length + 1);
  await assert.rejects(
    buildHostingerRelease({ root, outputDirectory, requireClean: false }),
    /already exists/i,
    "A release was overwritten without explicit permission."
  );
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

console.log("Hostinger release builder tests passed: dependency-complete allowlist, embedded runtime identity, ZIP integrity, private-material exclusion, manifest evidence and overwrite protection.");
