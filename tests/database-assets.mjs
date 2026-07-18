import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDatabaseAssets } from "../db/migration-assets.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDatabaseDirectory = path.join(projectRoot, "db");
const tempBase = path.resolve(os.tmpdir());
const fixtureRoot = path.join(tempBase, `tideway-database-assets-test-${randomUUID()}`);
const fixtureDatabaseDirectory = path.join(fixtureRoot, "db");

function assertSafeFixturePath(candidate) {
  const resolved = path.resolve(candidate);
  assert.ok(resolved.startsWith(`${tempBase}${path.sep}`), "fixture must remain inside the system temp directory");
  assert.ok(path.basename(resolved).startsWith("tideway-database-assets-test-"), "fixture must use the expected disposable prefix");
}

async function freshFixture() {
  const resolvedDatabaseFixture = path.resolve(fixtureDatabaseDirectory);
  assert.ok(resolvedDatabaseFixture.startsWith(`${path.resolve(fixtureRoot)}${path.sep}`), "database fixture must remain inside its disposable root");
  await rm(fixtureDatabaseDirectory, { recursive: true, force: true });
  await cp(sourceDatabaseDirectory, fixtureDatabaseDirectory, { recursive: true });
}

try {
  const repositoryResult = await verifyDatabaseAssets();
  assert.equal(repositoryResult.ok, true, repositoryResult.errors.join("\n"));
  assert.equal(repositoryResult.postgresqlMajor, 16);
  assert.equal(repositoryResult.migrations.length, 60);
  assert.equal(repositoryResult.migrations.at(-1), "060_apple_sign_in_provider.sql");
  assert.deepEqual(repositoryResult.grantFiles.sort(), ["runtime-role-grants.sql", "worker-role-grants.sql"]);
  const deploymentVerifier = await readFile(path.join(sourceDatabaseDirectory, "integration", "deployment-verification.sql"), "utf8");
  const integrationRunner = await readFile(path.join(projectRoot, "tools", "postgres-integration-runner.mjs"), "utf8");
  const publicCleanerProfileBehaviour = await readFile(path.join(sourceDatabaseDirectory, "integration", "public-cleaner-profile-behaviour.sql"), "utf8");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 48\)'/, "Pre-upgrade verification must inspect the optional migration ledger dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 49\)'/, "Deployment verification must detect the pending-Cleaner scope handoff migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 50\)'/, "Deployment verification must detect the Administrator payment-operations migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 51\)'/, "Deployment verification must detect the booking-case payment-handoff migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 52\)'/, "Deployment verification must detect the Administrator booking-operations migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 53\)'/, "Deployment verification must detect the matching self-exclusion migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 54\)'/, "Deployment verification must detect private request live updates dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 55\)'/, "Deployment verification must detect the session-avatar projection dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 56\)'/, "Deployment verification must detect the booking minimum-contribution migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 57\)'/, "Deployment verification must detect the safe public Cleaner lookup migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 58\)'/, "Deployment verification must detect the automatic-dispatch customer-cap migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 59\)'/, "Deployment verification must detect the participant response-deadline migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 60\)'/, "Deployment verification must detect the Apple sign-in migration dynamically.");
  assert(deploymentVerifier.includes("A fully manual fresh install has no private migration ledger") && deploymentVerifier.includes("activate_my_workspace(user_role)") && deploymentVerifier.includes("recommend_cleaners_for_request_v2(uuid,integer)") && deploymentVerifier.includes("position('avatar_url' IN pg_get_function_result(procedure.oid))") && deploymentVerifier.includes("get_public_cleaner_profile(uuid)') IS NOT NULL"), "A ledger-free fresh install can still be mistaken for the historical migration-45 baseline instead of detecting its actual schema level.");
  const migration48VerificationStart = deploymentVerifier.indexOf("IF latest_migration_installed THEN");
  assert(migration48VerificationStart >= 0 && deploymentVerifier.indexOf("conname='bookings_distinct_participants'", migration48VerificationStart) >= 0, "Migration-48 verification must defer its new constraint check until after that locked migration is installed.");
  assert(deploymentVerifier.indexOf("selected_name := 'tideway_private.activate_my_workspace(user_role)'", migration48VerificationStart) >= 0, "Migration-48 verification must defer its workspace-function check until after that locked migration is installed.");
  assert(deploymentVerifier.includes("The pending-Cleaner checklist and photo-consent handoff is not installed") && deploymentVerifier.includes("actor_has_pending_invitation AND request_record.cleaner_preview_authorized"), "Migration-49 verification must prove checklist visibility without bypassing separate photo consent.");
  assert(deploymentVerifier.includes("list_administrator_payment_operations(text,integer,integer)") && deploymentVerifier.includes("has_function_privilege('tideway_app'") && deploymentVerifier.includes("provider_payment_id") && deploymentVerifier.includes("destination_account_id"), "Migration-50 verification must prove restricted execution and provider-reference privacy for the Administrator payment queue.");
  assert(deploymentVerifier.includes("get_administrator_booking_payment_operation(uuid)") && deploymentVerifier.includes("payment.booking_id=selected_booking_id") && deploymentVerifier.includes("booking-case payment handoff"), "Migration-51 verification must prove exact-booking scope, restricted execution and provider-reference privacy.");
  assert(deploymentVerifier.includes("list_administrator_booking_operations(text,integer,integer)") && deploymentVerifier.includes("privacy-minimised boundary") && deploymentVerifier.includes("access_instructions"), "Migration-52 verification must prove restricted execution and personal-data minimisation.");
  assert(deploymentVerifier.includes("recommend_cleaners_for_request_v2(uuid,integer)") && deploymentVerifier.includes("candidate.cleaner_id<>request_landlord_id") && deploymentVerifier.includes("Automatic dispatch bypasses"), "Migration-53 verification must prove shared self-exclusion for interactive and automatic matching.");
  assert(deploymentVerifier.includes("get_cleaning_request_realtime_snapshot(uuid,bigint,integer)") && deploymentVerifier.includes("Cleaning-request live events lack RLS") && deploymentVerifier.includes("lookup_session(bytea)") && deploymentVerifier.includes("avatar_url"), "Migration-54/55 verification must prove the private request stream and account-avatar session projection.");
  assert(deploymentVerifier.includes("target_contribution_pence") && deploymentVerifier.includes("planned_contribution<proposed_target_contribution_pence"), "Migration-56 verification must prove the frozen minimum-contribution boundary.");
  assert(deploymentVerifier.includes("get_public_cleaner_profile(uuid)") && deploymentVerifier.includes("Direct public Cleaner lookup is missing, unsafe or overexposed"), "Migration-57 verification must prove the privacy-safe public Cleaner lookup and restricted execution boundary.");
  assert(deploymentVerifier.includes("approved_maximum_customer_price_pence") && deploymentVerifier.includes("automatic-dispatch-price-cap-required") && deploymentVerifier.includes("Automatic dispatch does not enforce the Landlord-approved maximum total"), "Migration-58 verification must prove automatic dispatch cannot exceed or omit the Landlord-approved maximum total.");
  assert(deploymentVerifier.includes("participant-response-deadline-v1") && deploymentVerifier.includes("Participant booking summaries do not expose the pending response deadline safely"), "Migration-59 verification must prove the shared deadline remains participant-safe and Cleaner response authority remains isolated.");
  assert(deploymentVerifier.includes("Apple sign-in rate limits are missing or unsafe") && deploymentVerifier.includes("Apple provider connection does not require a verified provider email") && deploymentVerifier.includes("Apple provider removal or last-method protection is not installed"), "Migration-60 verification must prove Apple rate limiting, verified-email connection, step-up and last-method protection.");
  for (const normalizedNeedle of [
    "asserted_providerNOTIN(''google'',''apple'',''facebook'')",
    "asserted_providerIN(''google'',''apple'')",
    "selected_providerNOTIN(''google'',''apple'',''facebook'')",
    "identity.providerIN(''google'',''apple'',''facebook'')"
  ]) assert(deploymentVerifier.includes(`position('${normalizedNeedle}' IN replace`), `Migration-60 verification compares normalized function source against a non-normalized needle: ${normalizedNeedle}`);
  assert(integrationRunner.includes('publicCleanerProfile: "public-cleaner-profile-behaviour.sql"') && integrationRunner.includes('label: "Public Cleaner profile privacy test"') && publicCleanerProfileBehaviour.includes("get_public_cleaner_profile") && publicCleanerProfileBehaviour.includes("active, complete and public Cleaner profile") && publicCleanerProfileBehaviour.includes("email', 'phone', 'address") && publicCleanerProfileBehaviour.includes("account without a public Cleaner profile"), "The real PostgreSQL rehearsal must exercise the direct public Cleaner lookup, its projection and its visibility gates.");
  assert(deploymentVerifier.includes("active_invite_function := CASE WHEN minimum_contribution_migration_installed") && deploymentVerifier.includes("active_dispatch_function := CASE WHEN minimum_contribution_migration_installed"), "Pre-upgrade verification must select the booking function signatures installed at the current migration level.");
  assert(deploymentVerifier.includes("app_functions || ARRAY[active_invite_function]") && deploymentVerifier.includes("worker_functions || ARRAY[active_dispatch_function]"), "Runtime privilege verification must follow the migration-aware booking function signatures.");
  assert(deploymentVerifier.includes("IF minimum_contribution_migration_installed THEN") && deploymentVerifier.includes("Superseded minimum-contribution function is missing"), "Post-migration verification must still prove that the older booking signatures are revoked.");
  const onboardingRepair = await readFile(path.join(sourceDatabaseDirectory, "migrations", "047_fix_role_onboarding_column_ambiguity.sql"), "utf8");
  assert.match(onboardingRepair, /#variable_conflict error/, "Role onboarding must fail closed if a future PL\/pgSQL variable conflicts with a column.");
  assert.match(onboardingRepair, /ON CONFLICT ON CONSTRAINT cleaner_profiles_pkey DO NOTHING/, "Cleaner onboarding must name its conflict constraint explicitly.");
  assert.match(onboardingRepair, /ON CONFLICT ON CONSTRAINT landlord_profiles_pkey DO NOTHING/, "Landlord onboarding must name its conflict constraint explicitly.");
  assert.doesNotMatch(deploymentVerifier, /to_regclass\('tideway_private\.schema_migrations'\) IS NOT NULL\s+AND EXISTS/, "Pre-upgrade verification statically referenced a ledger that may not exist yet.");
  const appBlock = deploymentVerifier.slice(deploymentVerifier.indexOf("app_functions constant"), deploymentVerifier.indexOf("worker_functions constant"));
  const workerBlock = deploymentVerifier.slice(deploymentVerifier.indexOf("worker_functions constant"), deploymentVerifier.indexOf("BEGIN", deploymentVerifier.indexOf("worker_functions constant")));
  const advertisedAppChecks = Number(deploymentVerifier.match(/'appFunctionChecks',\s*(\d+)/)?.[1]);
  const advertisedWorkerChecks = Number(deploymentVerifier.match(/'workerFunctionChecks',\s*(\d+)/)?.[1]);
  assert.equal(advertisedAppChecks, [...appBlock.matchAll(/'tideway_private\./g)].length + 2, "deployment report must count core functions plus the migration-aware invitation and migration-48 workspace functions");
  assert.equal(advertisedWorkerChecks, [...workerBlock.matchAll(/'tideway_private\./g)].length + 1, "deployment report must count core worker functions plus the migration-aware automatic-dispatch function");

  await freshFixture();
  const tamperedPath = path.join(fixtureDatabaseDirectory, "migrations", "004_social_identity_and_onboarding.sql");
  await writeFile(tamperedPath, `${await readFile(tamperedPath, "utf8")}\nSELECT 1;\n`);
  const tampered = await verifyDatabaseAssets({ databaseDirectory: fixtureDatabaseDirectory });
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((error) => error.includes("004_social_identity_and_onboarding.sql does not match its locked SHA-256")));
  assert.ok(tampered.errors.some((error) => error.includes("must end with COMMIT")), "transaction-boundary tampering must also be visible");

  await freshFixture();
  await unlink(path.join(fixtureDatabaseDirectory, "migrations", "019_expired_session_purge.sql"));
  const missing = await verifyDatabaseAssets({ databaseDirectory: fixtureDatabaseDirectory });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.includes("Missing locked migrations: 019_expired_session_purge.sql")));

  await freshFixture();
  await writeFile(path.join(fixtureDatabaseDirectory, "migrations", "020_unapproved.sql"), "BEGIN;\nCOMMIT;\n");
  const unexpected = await verifyDatabaseAssets({ databaseDirectory: fixtureDatabaseDirectory });
  assert.equal(unexpected.ok, false);
  assert.ok(unexpected.errors.some((error) => error.includes("Unexpected unlocked migrations: 020_unapproved.sql")));

  await freshFixture();
  const lockPath = path.join(fixtureDatabaseDirectory, "migration-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.migrations[5].order = 7;
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const nonConsecutive = await verifyDatabaseAssets({ databaseDirectory: fixtureDatabaseDirectory });
  assert.equal(nonConsecutive.ok, false);
  assert.ok(nonConsecutive.errors.some((error) => error.includes("Migration position 6 must have order 6")));

  console.log("Database asset tests passed: locked order, checksums, transaction boundaries, missing/unexpected migration detection and role grants.");
} finally {
  assertSafeFixturePath(fixtureRoot);
  await rm(fixtureRoot, { recursive: true, force: true });
}
