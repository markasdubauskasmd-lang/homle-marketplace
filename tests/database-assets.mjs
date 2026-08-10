import assert from "node:assert/strict";

const t71Payment = (source) => source.includes("payment_commands has no (payment_id, command_kind, created_at) index");
const t71Directory = (source) => source.includes("cleaner_profiles has no public-directory index");
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
  assert.equal(repositoryResult.migrations.length, 95);
  assert.equal(repositoryResult.migrations.at(-1), "095_request_platform_quote.sql");
  assert.deepEqual(repositoryResult.grantFiles.sort(), ["runtime-role-grants.sql", "worker-role-grants.sql"]);
  const deploymentVerifier = await readFile(path.join(sourceDatabaseDirectory, "integration", "deployment-verification.sql"), "utf8");
  const structuredScanMigration = await readFile(path.join(sourceDatabaseDirectory, "migrations", "073_structured_room_scans.sql"), "utf8");
  const roomMeasurementMigration = await readFile(path.join(sourceDatabaseDirectory, "migrations", "074_room_scan_measurements.sql"), "utf8");
  const bookingChangeMigration = await readFile(path.join(sourceDatabaseDirectory, "migrations", "088_landlord_booking_change_requests.sql"), "utf8");
  const onboardingDocumentMigration = await readFile(path.join(sourceDatabaseDirectory, "migrations", "089_cleaner_onboarding_document_storage.sql"), "utf8");
  const bookingClientNamesMigration = await readFile(path.join(sourceDatabaseDirectory, "migrations", "090_booking_client_conversation_names.sql"), "utf8");
  const bookingSummaryVerificationMigration = await readFile(path.join(sourceDatabaseDirectory, "migrations", "091_booking_summary_verification_markers.sql"), "utf8");
  const rightToWorkBirthCertificateMigration = await readFile(path.join(sourceDatabaseDirectory, "migrations", "093_right_to_work_birth_certificate.sql"), "utf8");
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
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 61\)'/, "Deployment verification must detect the missing rate-limit scope migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 62\)'/, "Deployment verification must detect the Cleaner verification-authority migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 67\)'/, "Deployment verification must detect the Apple Administrator-bootstrap migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 68\)'/, "Deployment verification must detect paid matching payout readiness dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 69\)'/, "Deployment verification must detect the Cleaner verification queue pagination repair dynamically.");
  // 069 replaces a function rather than adding one, so a deployed database cannot be
  // checked by signature — only the repaired body distinguishes it. Without this, a
  // database still carrying migration 063's aggregate-then-slice function would verify
  // clean while its Administrator queue returned one unpaginated page and nothing after.
  assert(deploymentVerifier.includes("The Administrator Cleaner verification queue does not paginate, or lost its Administrator-only boundary") && deploymentVerifier.includes("list_cleaner_verification_queue(text,integer,integer)"), "Migration-69 verification must prove the Cleaner verification queue slices before aggregating and stays Administrator-only.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 70\)'/, "Deployment verification must detect the bookings(cleaning_request_id) index dynamically.");
  // The pre-existing partial unique index on this column also filters on status, so the
  // dispatch lookups that must count cancelled attempts cannot use it. A replacement that
  // reintroduced a status predicate would look present and still scan the table.
  assert(deploymentVerifier.includes("bookings(cleaning_request_id) has no general index") && deploymentVerifier.includes("carries a status predicate"), "Migration-70 verification must prove a general, status-free index exists on bookings(cleaning_request_id).");
  // Both of these were dismissed in migration 70's commit as already covered. They were
  // not: the check behind each dismissal read the wrong function. Pinned so the
  // correction cannot be lost again.
  assert(t71Payment(deploymentVerifier) && t71Directory(deploymentVerifier), "Migration-71 verification must prove the Administrator payment page and the unauthenticated Cleaner directory both have an index that their query shape can actually use.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 72\)'/, "Deployment verification must detect account notification real-time signals dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 73\)'/, "Deployment verification must detect the structured room-scan migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 92\)'/, "Deployment verification must detect the final Cleaner submission migration dynamically.");
  assert(deploymentVerifier.includes("IF cleaner_final_submission_installed AND NOT EXISTS") && deploymentVerifier.includes("Cleaner onboarding final review submission is not an allowed encrypted section") && deploymentVerifier.includes("position('review' IN pg_get_constraintdef(oid))>0"), "Deployment verification must allow the supported pre-upgrade schema and prove the upgraded encrypted onboarding table accepts the final review submission record.");
  // The structured scan's only participant boundary is the SECURITY DEFINER
  // projection. A deployment that grants the runtime role direct table access
  // has no boundary left, so the check has to run on every deployment rather
  // than once in CI.
  assert(deploymentVerifier.includes("bypassing the participant-aware projection") && deploymentVerifier.includes("room_scan_object_corrections"), "Migration-73 verification must prove the runtime role cannot reach structured room scans directly.");
  assert(deploymentVerifier.includes("restricted to the owning Landlord and an Administrator") && deploymentVerifier.includes("position('cleaner_user_id'"), "Migration-73 verification must prove the detailed structured scan cannot become a Cleaner-facing projection.");
  for (const [name, source] of [["migration 73", structuredScanMigration], ["migration 74", roomMeasurementMigration]]) {
    const createMarker = source.includes("CREATE OR REPLACE FUNCTION tideway_private.get_room_scan")
      ? "CREATE OR REPLACE FUNCTION tideway_private.get_room_scan"
      : "CREATE FUNCTION tideway_private.get_room_scan";
    const projection = source.slice(source.indexOf(createMarker));
    assert(projection.includes("request_record.landlord_user_id = actor_id") && projection.includes("has_role('administrator')"), `${name} must keep the detailed room-scan projection owner/Admin-only.`);
    assert(!projection.includes("cleaner_preview_authorized") && !projection.includes("booking.cleaner_user_id"), `${name} must not reintroduce detailed scanner data into Cleaner access.`);
  }
  assert(deploymentVerifier.includes("one structured scan, so a retried save can duplicate every room"), "Migration-73 verification must prove a cleaning request cannot carry two structured scans.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 74\)'/, "Deployment verification must detect the room-measurement migration dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 80\)'/, "Deployment verification must detect private Landlord support dynamically.");
  assert(deploymentVerifier.includes("create_landlord_support_request(uuid,uuid,text,text,text)") && deploymentVerifier.includes("create_landlord_booking_change_request(uuid,uuid,uuid,text,timestamp with time zone,text)") && deploymentVerifier.includes("review_landlord_support_request(uuid,text,text)") && deploymentVerifier.includes("'support_requests'"), "Deployment verification must prove the private support table and role-isolated functions are installed.");
  assert(deploymentVerifier.includes("IF landlord_support_installed THEN")
    && deploymentVerifier.includes("rls_tables := rls_tables || ARRAY['support_requests']")
    && deploymentVerifier.includes("app_functions := app_functions || ARRAY["),
  "Pre-upgrade verification must not require migration-80 objects until migration 080 is installed.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 81\)'/, "Deployment verification must detect the Administrator coverage report dynamically.");
  assert(deploymentVerifier.includes("get_administrator_coverage_report(integer,boolean)")
    && deploymentVerifier.includes("Administrator coverage report is missing, overprivileged or does not use the eligibility matcher"),
  "Deployment verification must prove the privacy-minimal coverage report, shared matcher and restricted runtime execution boundary.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 82\)'/, "Deployment verification must detect owner property archiving dynamically.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 89\)'/, "Deployment verification must detect encrypted Cleaner document storage dynamically.");
  assert(onboardingDocumentMigration.includes("content_ciphertext bytea") && onboardingDocumentMigration.includes("save_my_cleaner_onboarding_document") && onboardingDocumentMigration.includes("cleaner-onboarding-document-saved"), "Migration 89 must store encrypted Cleaner document bytes through an audited owner-only function.");
  assert(rightToWorkBirthCertificateMigration.includes("rightToWorkPassport") && rightToWorkBirthCertificateMigration.includes("rightToWorkBirthCertificate") && rightToWorkBirthCertificateMigration.includes("cleaner-onboarding-document-saved"), "Migration 93 must admit both Right to Work evidence types without weakening the encrypted audited writer.");
  assert.match(deploymentVerifier, /migration_order = 93/, "Deployment verification must detect encrypted Right to Work alternative evidence support.");
  assert(deploymentVerifier.includes("Right-to-work passport or birth-certificate storage is missing from the encrypted document boundary"), "Deployment verification must prove both Right to Work evidence types remain inside encrypted document storage.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 90\)'/, "Deployment verification must detect privacy-limited Cleaner client names dynamically.");
  assert(bookingClientNamesMigration.includes("booking-client-conversation-names-v1") && bookingClientNamesMigration.includes("split_part(btrim(landlord_user.display_name), ' ', 1)") && deploymentVerifier.includes("Cleaner booking conversations lost their privacy-limited client name projection"), "Migration 90 must expose only an organisation or first-name label for confirmed Cleaner conversations and verify the deployed function body.");
  assert(bookingSummaryVerificationMigration.includes("participant-response-deadline-v1") && bookingSummaryVerificationMigration.includes("booking-client-conversation-names-v1") && bookingSummaryVerificationMigration.includes("booking-summary-verification-markers-v1"), "Migration 91 must preserve both independently verified booking-summary contracts without rewriting an applied migration.");
  assert(deploymentVerifier.includes("position('participant-response-deadline-v1' IN COALESCE(selected_source,''))=0") && deploymentVerifier.includes("position('booking-client-conversation-names-v1' IN COALESCE(selected_source,''))=0") && deploymentVerifier.includes("WHEN booking.status = ''pending-cleaner-acceptance'' THEN booking.cleaner_response_deadline"), "Pre-upgrade verification must recognise migration 090 by its exact response-deadline behaviour while migration 091 restores both markers.");
  assert(deploymentVerifier.includes("archive_my_property(uuid)") && deploymentVerifier.includes("Owner property archiving lost its active-work guard or audit evidence"), "Deployment verification must prove property archiving keeps active work and history protected.");
  assert(deploymentVerifier.includes("restore_my_property(uuid)") && deploymentVerifier.includes("Owner property restoration lost its archived-owner guard or audit evidence"), "Deployment verification must prove property restoration remains owner-bound, archived-only and audited.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 84\)'/, "Deployment verification must detect encrypted Cleaner onboarding records dynamically.");
  assert(deploymentVerifier.includes("Cleaner onboarding payloads are missing encrypted byte storage or expose plaintext JSON") && deploymentVerifier.includes("Cleaner onboarding persistence lost its Cleaner-only or audit boundary"), "Deployment verification must prove Cleaner onboarding records are encrypted, owner-bound and audited.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 85\)'/, "Deployment verification must detect the Cleaner address-lookup rate limit dynamically.");
  assert(deploymentVerifier.includes("Shared rate limiter is missing the Cleaner address-lookup policy") && deploymentVerifier.includes("Shared rate-limit scope CHECK constraint does not admit Cleaner address lookup"), "Deployment verification must prove the metered address provider has a shared bounded allowance.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 87\)'/, "Deployment verification must detect the Administrator funnel report dynamically.");
  assert(deploymentVerifier.includes("get_administrator_funnel_report(integer)") && deploymentVerifier.includes("Administrator funnel report is missing, overprivileged or exposes a private field"), "Deployment verification must prove the privacy-minimal funnel report, maturity boundary and restricted runtime execution boundary.");
  assert.match(deploymentVerifier, /EXECUTE 'SELECT EXISTS \(SELECT 1 FROM tideway_private\.schema_migrations WHERE migration_order = 88\)'/, "Deployment verification must detect structured Landlord booking-change intake dynamically.");
  assert(deploymentVerifier.includes("Landlord booking-change intake lost its owner, confirmed-booking, uniqueness or audit boundary") && deploymentVerifier.includes("support_requests_one_open_booking_change_idx"), "Deployment verification must prove booking-change intake remains owner-bound, confirmed-only, unique and audited.");
  assert(bookingChangeMigration.includes("ON CONFLICT ON CONSTRAINT support_requests_retry_idempotency DO NOTHING") && bookingChangeMigration.includes("interval '365 days'"), "Booking-change intake must keep concurrent retries idempotent and use the same bounded scheduling horizon as the service and browser.");
  assert(!/\bUPDATE\s+bookings\b/i.test(bookingChangeMigration) && !/\bDELETE\s+FROM\s+bookings\b/i.test(bookingChangeMigration), "Creating a booking-change request must not mutate or delete the booking it references.");
  // Under the web-only decision nothing a browser produces is exact. A stored
  // measurement with no band would read as exact for ever after.
  assert(deploymentVerifier.includes("room_scan_measurements_estimate_has_band"), "Migration-74 verification must prove an estimated measurement cannot be stored looking exact.");
  assert(deploymentVerifier.includes("claim an accuracy no browser delivers"), "Migration-74 verification must prove a web client cannot store a sensor measurement.");
  assert(deploymentVerifier.includes("The account notification real-time trigger is missing or unsafe") && deploymentVerifier.includes("account_notification_realtime_after_insert"), "Migration-72 verification must prove the notification trigger is commit-bound, internal-only and safe.");
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
  assert(deploymentVerifier.includes("Shared rate limiter is missing the session-recovery, public Cleaner profile or Apple sign-in policy") && deploymentVerifier.includes("Shared rate-limit scope CHECK constraint does not admit the session-recovery or public Cleaner profile scope"), "Migration-61 verification must prove the session-recovery and public Cleaner profile rate-limit policies and scope CHECK constraint are installed.");
  assert(deploymentVerifier.includes("Cleaner verification-authority trigger is missing") && deploymentVerifier.includes("cleaner_verification_admin_only") && deploymentVerifier.includes("enforce_cleaner_verification_authority()"), "Migration-62 verification must prove the Cleaner verification-authority trigger and guard are installed.");
  assert(deploymentVerifier.includes("Administrator bootstrap does not admit verified Apple identities") && deploymentVerifier.includes("provision_bootstrap_administrator(citext,uuid,text,text)") && deploymentVerifier.includes("password'',''google'',''apple'',''facebook"), "Migration-67 verification must prove Apple-only verified accounts remain eligible for the owner-only Administrator bootstrap.");
  assert(deploymentVerifier.includes("Paid matching does not enforce the private payout-readiness boundary") && deploymentVerifier.includes("recommend_cleaners_for_request_v3(uuid,integer,boolean)") && deploymentVerifier.includes("Direct paid Cleaner invitation payout check is missing, overprivileged or not actor-bound") && deploymentVerifier.includes("cleaner_payout_ready_for_paid_booking(uuid)") && deploymentVerifier.includes("Paid automatic dispatch can bypass payout-ready Cleaner filtering"), "Migration-68 verification must prove matched, directly selected and automatically dispatched paid Cleaners exclude payout-unready accounts without exposing provider records.");
  for (const normalizedNeedle of [
    "asserted_providerNOTIN(''google'',''apple'',''facebook'')",
    "asserted_providerIN(''google'',''apple'')",
    "selected_providerNOTIN(''google'',''apple'',''facebook'')",
    "identity.providerIN(''google'',''apple'',''facebook'')"
  ]) assert(deploymentVerifier.includes(`position('${normalizedNeedle}' IN replace`), `Migration-60 verification compares normalized function source against a non-normalized needle: ${normalizedNeedle}`);
  assert(integrationRunner.includes('publicCleanerProfile: "public-cleaner-profile-behaviour.sql"') && integrationRunner.includes('label: "Public Cleaner profile privacy test"') && publicCleanerProfileBehaviour.includes("get_public_cleaner_profile") && publicCleanerProfileBehaviour.includes("active, complete and public Cleaner profile") && publicCleanerProfileBehaviour.includes("email', 'phone', 'address") && publicCleanerProfileBehaviour.includes("account without a public Cleaner profile") && publicCleanerProfileBehaviour.includes("Exact declared outward coverage disappeared"), "The real PostgreSQL rehearsal must exercise the direct public Cleaner lookup, its projection, visibility gates and safe coordinate-migration fallback.");
  assert(integrationRunner.includes('administratorFunnelSetup: "administrator-funnel-owner-setup.sql"') && integrationRunner.includes('administratorFunnel: "administrator-funnel-behaviour.sql"') && integrationRunner.includes('administratorFunnelCleanup: "administrator-funnel-owner-cleanup.sql"') && integrationRunner.includes('label: "Administrator funnel privacy and cohort test"'), "The real PostgreSQL rehearsal must prepare mature fixtures as the owner while exercising the Administrator funnel through the restricted runtime role.");
  assert(deploymentVerifier.includes("active_invite_function := CASE WHEN minimum_contribution_migration_installed") && deploymentVerifier.includes("active_dispatch_function := CASE WHEN minimum_contribution_migration_installed"), "Pre-upgrade verification must select the booking function signatures installed at the current migration level.");
  assert(deploymentVerifier.includes("app_functions || ARRAY[active_invite_function]") && deploymentVerifier.includes("worker_functions || ARRAY[active_dispatch_function]"), "Runtime privilege verification must follow the migration-aware booking function signatures.");
  assert(deploymentVerifier.includes("IF minimum_contribution_migration_installed THEN") && deploymentVerifier.includes("Superseded minimum-contribution function is missing"), "Post-migration verification must still prove that the older booking signatures are revoked.");
  const onboardingRepair = await readFile(path.join(sourceDatabaseDirectory, "migrations", "047_fix_role_onboarding_column_ambiguity.sql"), "utf8");
  assert.match(onboardingRepair, /#variable_conflict error/, "Role onboarding must fail closed if a future PL\/pgSQL variable conflicts with a column.");
  assert.match(onboardingRepair, /ON CONFLICT ON CONSTRAINT cleaner_profiles_pkey DO NOTHING/, "Cleaner onboarding must name its conflict constraint explicitly.");
  assert.match(onboardingRepair, /ON CONFLICT ON CONSTRAINT landlord_profiles_pkey DO NOTHING/, "Landlord onboarding must name its conflict constraint explicitly.");
  assert.doesNotMatch(deploymentVerifier, /to_regclass\('tideway_private\.schema_migrations'\) IS NOT NULL\s+AND EXISTS/, "Pre-upgrade verification statically referenced a ledger that may not exist yet.");
  const appBlock = deploymentVerifier.slice(deploymentVerifier.indexOf("app_functions text[]"), deploymentVerifier.indexOf("worker_functions constant"));
  const workerBlock = deploymentVerifier.slice(deploymentVerifier.indexOf("worker_functions constant"), deploymentVerifier.indexOf("BEGIN", deploymentVerifier.indexOf("worker_functions constant")));
  const advertisedWorkerChecks = Number(deploymentVerifier.match(/'workerFunctionChecks',\s*(\d+)/)?.[1]);
  assert.doesNotMatch(workerBlock, /get_automatic_dispatch_candidates\(uuid,uuid,integer,boolean\)/, "Pre-upgrade verification required migration 68's paid-dispatch function before the locked migration could be applied.");
  assert.equal(48, [...appBlock.matchAll(/'tideway_private\./g)].length + 3, "deployment report must count core functions plus the migration-aware invitation, migration-48 workspace and paid direct-invitation checks");
  assert(deploymentVerifier.includes("'appFunctionChecks', 48")
    && deploymentVerifier.includes("+ CASE WHEN to_regclass('public.support_requests') IS NULL THEN 0 ELSE 4 END")
    && deploymentVerifier.includes("+ CASE WHEN to_regprocedure('tideway_private.create_landlord_booking_change_request(uuid,uuid,uuid,text,timestamp with time zone,text)') IS NULL THEN 0 ELSE 1 END")
    && deploymentVerifier.includes("+ CASE WHEN to_regprocedure('tideway_private.get_administrator_coverage_report(integer,boolean)') IS NULL THEN 0 ELSE 1 END")
    && deploymentVerifier.includes("+ CASE WHEN to_regprocedure('tideway_private.get_administrator_funnel_report(integer)') IS NULL THEN 0 ELSE 1 END")
    && deploymentVerifier.includes("+ CASE WHEN to_regprocedure('tideway_private.archive_my_property(uuid)') IS NULL THEN 0 ELSE 1 END")
    && deploymentVerifier.includes("+ CASE WHEN to_regprocedure('tideway_private.restore_my_property(uuid)') IS NULL THEN 0 ELSE 1 END")
    && deploymentVerifier.includes("+ CASE WHEN to_regprocedure('tideway_private.save_my_cleaner_onboarding_section(text,bytea,text,smallint)') IS NULL THEN 0 ELSE 2 END")
    && deploymentVerifier.includes("+ CASE WHEN to_regprocedure('tideway_private.save_my_cleaner_onboarding_document(text,text,bytea,text,text,integer,text,bytea)') IS NULL THEN 0 ELSE 4 END")
    && deploymentVerifier.includes("+ CASE WHEN to_regclass('public.cleaner_onboarding_sections') IS NULL THEN 0 ELSE 2 END"),
  "deployment report must distinguish the verified pre-upgrade schema from migration-80 support through migration-88 booking-change intake");
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
