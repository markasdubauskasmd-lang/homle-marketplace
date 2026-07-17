import {
  allowedBookingTransitions,
  bookingStatuses,
  canAccessBooking,
  canAccessProtectedPropertyInstructions,
  canReviewCompletedBooking,
  canTransitionBooking,
  canUpdateCleanerLocation,
  canUpdateCleaningTask,
  isMarketplaceRole,
  shouldStopLocationSharing,
  taskStatuses
} from "../src/marketplace/domain.mjs";
import "./staging-account-access.mjs";
import "./authentication-attachment.mjs";
import { marketplaceEnvironment, publicAuthenticationCapabilities, validateMarketplaceEnvironment } from "../src/marketplace/config.mjs";
import { createMarketplaceDatabase, postgresPoolOptions, postgresTransportSecurity, realtimePostgresPoolOptions } from "../src/marketplace/database.mjs";
import { createAuthenticationRepository, normalizedEmail } from "../src/marketplace/auth-repository.mjs";
import { clearSessionCookie, createSessionMaterial, csrfMatches, hashPassword, hashPurposeToken, parseCookies, sessionCookie, sessionTokenFromRequest, verifyPassword } from "../src/marketplace/session.mjs";
import { readFile } from "node:fs/promises";
import nodeAssert from "node:assert/strict";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const landlord = { userId: "user-landlord", roles: ["landlord"] };
const cleaner = { userId: "user-cleaner", roles: ["cleaner"] };
const unrelatedCleaner = { userId: "user-other", roles: ["cleaner"] };
const administrator = { userId: "user-admin", roles: ["administrator"] };
const booking = { landlordUserId: landlord.userId, cleanerUserId: cleaner.userId, status: "confirmed" };

assert(isMarketplaceRole("cleaner") && isMarketplaceRole("landlord") && isMarketplaceRole("administrator") && !isMarketplaceRole("owner"), "Marketplace roles are not closed to the three supported account roles.");
assert(bookingStatuses.length === 12 && bookingStatuses.includes("cleaner-en-route") && bookingStatuses.includes("disputed"), "Booking lifecycle is incomplete.");
assert(taskStatuses.length === 5 && taskStatuses.includes("issue-reported"), "Cleaning-task lifecycle is incomplete.");
assert(canAccessBooking(landlord, booking) && canAccessBooking(cleaner, booking) && canAccessBooking(administrator, booking), "A booking participant or administrator could not access the booking.");
assert(!canAccessBooking(unrelatedCleaner, booking), "An unrelated cleaner could access a booking.");
assert(canAccessProtectedPropertyInstructions(cleaner, booking) && canAccessProtectedPropertyInstructions(landlord, { ...booking, status: "draft" }) && !canAccessProtectedPropertyInstructions(cleaner, { ...booking, status: "pending-cleaner-acceptance" }) && !canAccessProtectedPropertyInstructions(cleaner, { ...booking, status: "completed" }) && !canAccessProtectedPropertyInstructions(unrelatedCleaner, booking), "Sensitive property instructions were not limited to the owner or an assigned cleaner during the active booking window.");
assert(canTransitionBooking(cleaner, booking, "cleaner-en-route") && !canTransitionBooking(landlord, booking, "cleaner-en-route") && canTransitionBooking(administrator, booking, "cancelled"), "Booking transitions were not role-authorised.");
assert(!canTransitionBooking(cleaner, booking, "completed") && allowedBookingTransitions("confirmed").includes("cleaner-en-route"), "A cleaner could skip the audited booking lifecycle.");
assert(canUpdateCleanerLocation(cleaner, booking, true) && !canUpdateCleanerLocation(cleaner, booking, false) && !canUpdateCleanerLocation(unrelatedCleaner, booking, true), "Live location was not bound to cleaner consent and booking participation.");
assert(!shouldStopLocationSharing("cleaner-en-route") && shouldStopLocationSharing("cleaner-arrived") && shouldStopLocationSharing("cancelled") && shouldStopLocationSharing("completed"), "Location sharing did not stop at the required terminal boundaries.");
assert(canUpdateCleaningTask(cleaner, { ...booking, status: "cleaning-in-progress" }) && !canUpdateCleaningTask(cleaner, booking) && !canUpdateCleaningTask(unrelatedCleaner, { ...booking, status: "cleaning-in-progress" }), "Cleaning progress was not limited to the assigned cleaner during an active clean.");
assert(canReviewCompletedBooking(landlord, { ...booking, status: "completed" }) && !canReviewCompletedBooking(landlord, booking) && !canReviewCompletedBooking(unrelatedCleaner, { ...booking, status: "completed" }), "Review eligibility was not limited to the completed booking's landlord.");

const emptyEnvironment = marketplaceEnvironment({});
assert(!emptyEnvironment.databaseConfigured && !emptyEnvironment.capabilities.google && !emptyEnvironment.capabilities.emailPassword && !emptyEnvironment.payments.requested && !emptyEnvironment.payments.stripeConfigured, "Unconfigured authentication or payments appeared enabled.");
const partialGoogle = validateMarketplaceEnvironment({ GOOGLE_CLIENT_ID: "client-only" });
assert(!partialGoogle.ok && partialGoogle.errors.some((error) => error.includes("GOOGLE_CLIENT_SECRET")), "Partial Google OAuth configuration did not fail closed.");
const partialFacebook = validateMarketplaceEnvironment({ FACEBOOK_APP_ID: "app", FACEBOOK_APP_SECRET: "secret" });
assert(!partialFacebook.ok && partialFacebook.errors.some((error) => error.includes("FACEBOOK_GRAPH_API_VERSION")), "Facebook configuration passed without an explicit Graph API version.");
const invalidFacebookVersion = validateMarketplaceEnvironment({ FACEBOOK_APP_ID: "app", FACEBOOK_APP_SECRET: "secret", FACEBOOK_GRAPH_API_VERSION: "latest" });
assert(!invalidFacebookVersion.ok && invalidFacebookVersion.errors.some((error) => error.includes("vN.N")), "Facebook configuration accepted a floating Graph API version.");
const invalidStorageOrigin = validateMarketplaceEnvironment({ OBJECT_STORAGE_ENDPOINT: "https://objects.example.com/private/path" });
assert(!invalidStorageOrigin.ok && invalidStorageOrigin.errors.some((error) => error.includes("exact HTTPS origin")), "Private object storage accepted a path-bearing origin that cannot be safely allowlisted for active-job media.");
assert(publicAuthenticationCapabilities({ GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" }).google === false, "OAuth client credentials enabled a provider without the database, session and exact-origin boundary.");
const partialStripe = validateMarketplaceEnvironment({ STRIPE_SECRET_KEY: `sk_test_${"a".repeat(32)}` });
assert(!partialStripe.ok && partialStripe.errors.some((error) => error.includes("STRIPE_WEBHOOK_SECRET")), "Partial Stripe configuration did not fail closed.");
const liveStripe = validateMarketplaceEnvironment({ PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: `sk_live_${"a".repeat(32)}`, STRIPE_PUBLISHABLE_KEY: `pk_test_${"c".repeat(32)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}` });
assert(!liveStripe.ok && liveStripe.errors.some((error) => error.includes("live keys are prohibited")), "The reviewed test-only payment adapter accepted a live key.");
const livePublishableStripe = validateMarketplaceEnvironment({ PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: `sk_test_${"a".repeat(32)}`, STRIPE_PUBLISHABLE_KEY: `pk_live_${"c".repeat(32)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}` });
assert(!livePublishableStripe.ok && livePublishableStripe.errors.some((error) => error.includes("STRIPE_PUBLISHABLE_KEY") && error.includes("live keys are prohibited")), "The reviewed test checkout accepted a live publishable key.");
assert(!validateMarketplaceEnvironment({ PAYMENTS_ENABLED: "sometimes" }).ok, "An ambiguous payment feature switch was accepted.");
const stagedStripe = marketplaceEnvironment({ PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: `sk_test_${"a".repeat(32)}`, STRIPE_PUBLISHABLE_KEY: `pk_test_${"c".repeat(32)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}` });
assert(stagedStripe.payments.requested && stagedStripe.payments.stripeConfigured && !JSON.stringify(stagedStripe).includes("sk_test_"), "Test payment readiness was not represented safely or exposed its secret.");
const weakSession = validateMarketplaceEnvironment({ SESSION_SECRET: "too-short" });
assert(!weakSession.ok && weakSession.errors.some((error) => error.includes("32 characters")), "A weak session secret passed validation.");
const reusedSecret = validateMarketplaceEnvironment({ SESSION_SECRET: "x".repeat(32), AUTH_TOKEN_SECRET: "x".repeat(32) });
assert(!reusedSecret.ok && reusedSecret.errors.some((error) => error.includes("different from SESSION_SECRET")), "Authentication tokens reused the session-secret trust boundary.");
const reusedEncryptionSecret = validateMarketplaceEnvironment({ SESSION_SECRET: "x".repeat(32), AUTH_TOKEN_SECRET: "y".repeat(32), DATA_ENCRYPTION_KEY: "x".repeat(32) });
assert(!reusedEncryptionSecret.ok && reusedEncryptionSecret.errors.some((error) => error.includes("DATA_ENCRYPTION_KEY must be different")), "Property encryption reused an authentication trust boundary.");
const pilotProduction = validateMarketplaceEnvironment({ NODE_ENV: "production", MARKETPLACE_ENABLED: "false", PAYMENTS_ENABLED: "false", APP_ORIGIN: "https://tideway.example.com" });
assert(pilotProduction.ok, "A production public-site deployment could not stay safely detached from unfinished marketplace infrastructure.");
const incompleteProduction = validateMarketplaceEnvironment({ NODE_ENV: "production", MARKETPLACE_ENABLED: "true", APP_ORIGIN: "http://example.com" });
assert(!incompleteProduction.ok && incompleteProduction.errors.some((error) => error.includes("DATABASE_URL")) && incompleteProduction.errors.some((error) => error.includes("AUTH_TOKEN_SECRET")) && incompleteProduction.errors.some((error) => error.includes("HTTPS")), "Production marketplace configuration passed without its database, token-secret, encryption or HTTPS boundary.");
assert(!validateMarketplaceEnvironment({ MARKETPLACE_ENABLED: "false", PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: `sk_test_${"a".repeat(32)}`, STRIPE_PUBLISHABLE_KEY: `pk_test_${"c".repeat(32)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}` }).ok, "Payments could be requested while the marketplace remained detached.");
const insecurePayoutOrigin = validateMarketplaceEnvironment({ MARKETPLACE_ENABLED: "true", PAYMENTS_ENABLED: "true", APP_ORIGIN: "http://127.0.0.1:4173", STRIPE_SECRET_KEY: `sk_test_${"a".repeat(32)}`, STRIPE_PUBLISHABLE_KEY: `pk_test_${"c".repeat(32)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}` });
assert(!insecurePayoutOrigin.ok && insecurePayoutOrigin.errors.some((error) => error.includes("Cleaner payout onboarding")), "Payment mode accepted an HTTP origin that Stripe cannot use for secure payout return and refresh links.");
const validProduction = {
  NODE_ENV: "production",
  MARKETPLACE_ENABLED: "true",
  STAGING_ACCOUNTS_ONLY: "true",
  APP_ORIGIN: "https://tideway.example.com",
  DATABASE_URL: "postgresql://tideway:secret@db.example.com/tideway",
  REALTIME_DATABASE_URL: "postgresql://tideway:secret@db-direct.example.com/tideway",
  SESSION_SECRET: "s".repeat(32),
  AUTH_TOKEN_SECRET: "t".repeat(32),
  DATA_ENCRYPTION_KEY: "e".repeat(32),
  SMTP_URL: "smtps://mail.example.com",
  EMAIL_FROM: "Homle <hello@example.com>",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret"
};
assert(validateMarketplaceEnvironment(validProduction).ok, "A complete production foundation configuration was rejected.");
const publicMarketplaceApprovals = {
  PUBLIC_MARKETPLACE_APPROVED: "true",
  LEGAL_BUSINESS_READY: "true",
  INSURANCE_READY: "true",
  CLEANER_SUPPLY_READY: "true",
  PRICING_POLICY_APPROVED: "true",
  CUSTOMER_SUPPORT_READY: "true",
  CUSTOMER_TERMS_READY: "true"
};
const publicPaymentApprovals = {
  PUBLIC_PAYMENTS_APPROVED: "true",
  PAYMENT_ACCOUNT_VERIFIED: "true",
  REFUND_PROCESS_READY: "true"
};
const unapprovedPublicMarketplace = validateMarketplaceEnvironment({ ...validProduction, STAGING_ACCOUNTS_ONLY: "false" });
assert(!unapprovedPublicMarketplace.ok && unapprovedPublicMarketplace.errors.some((error) => error.includes("PUBLIC_MARKETPLACE_APPROVED")) && unapprovedPublicMarketplace.errors.some((error) => error.includes("INSURANCE_READY")) && unapprovedPublicMarketplace.errors.some((error) => error.includes("CUSTOMER_TERMS_READY")), "A public production marketplace opened without explicit business, insurance and customer-terms approval.");
const approvedPublicMarketplace = validateMarketplaceEnvironment({ ...validProduction, STAGING_ACCOUNTS_ONLY: "false", ...publicMarketplaceApprovals });
assert(approvedPublicMarketplace.ok && approvedPublicMarketplace.state.launchApproval.publicMarketplaceReady && !approvedPublicMarketplace.state.launchApproval.stagingAccountsRestricted, "An explicitly approved public production marketplace was rejected.");
const publicPayments = {
  ...validProduction,
  STAGING_ACCOUNTS_ONLY: "false",
  ...publicMarketplaceApprovals,
  PAYMENTS_ENABLED: "true",
  STRIPE_SECRET_KEY: `sk_test_${"a".repeat(32)}`,
  STRIPE_PUBLISHABLE_KEY: `pk_test_${"b".repeat(32)}`,
  STRIPE_WEBHOOK_SECRET: `whsec_${"c".repeat(32)}`
};
const unapprovedPublicPayments = validateMarketplaceEnvironment(publicPayments);
assert(!unapprovedPublicPayments.ok && unapprovedPublicPayments.errors.some((error) => error.includes("PUBLIC_PAYMENTS_APPROVED")) && unapprovedPublicPayments.errors.some((error) => error.includes("REFUND_PROCESS_READY")), "Public payment acceptance opened without explicit account and refund-process approval.");
const approvedPublicPayments = validateMarketplaceEnvironment({ ...publicPayments, ...publicPaymentApprovals });
assert(approvedPublicPayments.ok && approvedPublicPayments.state.launchApproval.publicPaymentsReady, "Explicitly approved public test-payment staging was rejected.");
const ambiguousLaunchApproval = validateMarketplaceEnvironment({ ...validProduction, STAGING_ACCOUNTS_ONLY: "false", ...publicMarketplaceApprovals, LEGAL_BUSINESS_READY: "yes" });
assert(!ambiguousLaunchApproval.ok && ambiguousLaunchApproval.errors.some((error) => error.includes("LEGAL_BUSINESS_READY must be true or false")), "An ambiguous legal-readiness attestation was accepted.");
assert(!JSON.stringify(approvedPublicMarketplace.state.launchApproval).includes("google-secret") && Object.values(approvedPublicMarketplace.state.launchApproval).every((value) => typeof value === "boolean"), "Launch readiness exposed configuration evidence or secrets instead of safe boolean outcomes.");
assert(publicAuthenticationCapabilities(validProduction).google === false && publicAuthenticationCapabilities(validProduction).emailPassword === false, "Configured credentials were exposed before the HTTP authentication runtime was composed.");
const publicCapabilities = publicAuthenticationCapabilities(validProduction, { emailPassword: true, passwordReset: true, emailVerification: true });
assert(publicCapabilities.google === false && publicCapabilities.emailPassword === true && publicCapabilities.passwordReset === true && publicCapabilities.apple === false && !JSON.stringify(publicCapabilities).includes("google-secret") && !JSON.stringify(publicCapabilities).includes("SESSION_SECRET"), "Public authentication capabilities exposed secrets or advertised an unattached provider.");

const sessionSecret = "test-session-secret-with-more-than-32-characters";
const sessionMaterial = createSessionMaterial(sessionSecret, new Date("2026-07-15T12:00:00.000Z"), 3600);
assert(sessionMaterial.token.length >= 43 && sessionMaterial.tokenHash.length === 32 && sessionMaterial.csrfHash.length === 32 && sessionMaterial.expiresAt === "2026-07-15T13:00:00.000Z" && csrfMatches(sessionMaterial.csrfToken, sessionMaterial.csrfHash, sessionSecret) && !csrfMatches(`${sessionMaterial.csrfToken}x`, sessionMaterial.csrfHash, sessionSecret), "Opaque session or CSRF material was weak, incorrectly bounded or unverifiable.");
assert(!hashPurposeToken(sessionMaterial.token, "email-verification", sessionSecret).equals(hashPurposeToken(sessionMaterial.token, "password-reset", sessionSecret)), "Purpose-bound authentication tokens produced interchangeable stored hashes.");
const productionCookie = sessionCookie(sessionMaterial.token, 3600, true);
const developmentCookie = sessionCookie(sessionMaterial.token, 3600, false);
assert(productionCookie.startsWith("__Host-tideway_session=") && productionCookie.includes("HttpOnly") && productionCookie.includes("SameSite=Lax") && productionCookie.includes("; Secure") && developmentCookie.startsWith("tideway_session_dev=") && !developmentCookie.includes("; Secure") && clearSessionCookie(true).includes("Max-Age=0"), "Session cookies did not preserve the production host-prefix or safe development boundary.");
assert(parseCookies("one=1; encoded=hello%20world; one=ignored").encoded === "hello world" && parseCookies("one=1; encoded=hello%20world; one=ignored").one === "1" && sessionTokenFromRequest({ headers: { cookie: developmentCookie.split(";", 1)[0] } }) === sessionMaterial.token, "Cookie parsing accepted duplicate overrides or lost the opaque session.");
const passwordHash = await hashPassword("Correct horse battery staple");
assert(passwordHash.startsWith("$scrypt$32768$8$1$") && await verifyPassword("Correct horse battery staple", passwordHash) && !await verifyPassword("incorrect password", passwordHash) && !await verifyPassword("Correct horse battery staple", "$scrypt$1$1$1$bad$bad"), "Password hashing did not use the bounded scrypt format or failed constant-format verification.");

function fakePool(failInside = false) {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (failInside && text === "SELECT protected") throw new Error("test transaction failure");
      return { rows: [{ ok: true }] };
    },
    release() { calls.push({ text: "RELEASE" }); }
  };
  return { calls, pool: { async connect() { calls.push({ text: "CONNECT" }); return client; } } };
}

const successfulPool = fakePool();
const database = createMarketplaceDatabase(successfulPool.pool);
const transactionResult = await database.withUserTransaction({ userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] }, async (client) => (await client.query("SELECT protected")).rows[0]);
assert(transactionResult.ok && successfulPool.calls.map((call) => call.text).join("|") === "CONNECT|BEGIN|SELECT set_config('app.user_id', $1, true), set_config('app.user_roles', $2, true)|SELECT protected|COMMIT|RELEASE" && successfulPool.calls[2].values.join("|") === "11111111-1111-4111-8111-111111111111|landlord", "Database work did not set transaction-local RLS identity before querying or cleanly commit/release.");
const authenticationPool = fakePool();
await createMarketplaceDatabase(authenticationPool.pool).withAuthenticationTransaction(async (client) => client.query("SELECT auth_lookup"));
assert(authenticationPool.calls[2].values[0] === "" && authenticationPool.calls[2].values[1] === "", "Pre-authentication lookups accidentally inherited a user or role context.");
const onboardingPool = fakePool();
await createMarketplaceDatabase(onboardingPool.pool).withAccountTransaction({ userId: "66666666-6666-4666-8666-666666666666", roles: [] }, async (client) => client.query("SELECT onboarding"));
assert(onboardingPool.calls[2].values[0] === "66666666-6666-4666-8666-666666666666" && onboardingPool.calls[2].values[1] === "", "An authenticated first-time account could not enter onboarding before selecting a role.");
const provisioningPool = fakePool();
await createMarketplaceDatabase(provisioningPool.pool).withProvisioningTransaction("22222222-2222-4222-8222-222222222222", async (client) => client.query("SELECT provision"));
assert(provisioningPool.calls[2].values[0] === "22222222-2222-4222-8222-222222222222" && provisioningPool.calls[2].values[1] === "", "First-account provisioning did not bind writes to the new user while keeping roles ungranted.");
const failingPool = fakePool(true);
let rolledBack = false;
try {
  await createMarketplaceDatabase(failingPool.pool).withUserTransaction({ userId: "33333333-3333-4333-8333-333333333333", roles: ["cleaner"] }, async (client) => client.query("SELECT protected"));
} catch { rolledBack = true; }
assert(rolledBack && failingPool.calls.map((call) => call.text).includes("ROLLBACK") && failingPool.calls.at(-1).text === "RELEASE" && !failingPool.calls.map((call) => call.text).includes("COMMIT"), "A failed authenticated database operation was not rolled back and released.");
assert(postgresPoolOptions({}) === null && postgresPoolOptions({ DATABASE_URL: "postgresql://localhost/tideway", DATABASE_POOL_MAX: "100", NODE_ENV: "production" }).max === 50 && postgresPoolOptions({ DATABASE_URL: "postgresql://localhost/tideway", NODE_ENV: "production" }).ssl.rejectUnauthorized === true, "PostgreSQL pool configuration was not disabled when absent or safely bounded for production.");
assert(realtimePostgresPoolOptions({}) === null && realtimePostgresPoolOptions({ REALTIME_DATABASE_URL: "postgresql://localhost/tideway", NODE_ENV: "production" }).max === 1 && realtimePostgresPoolOptions({ REALTIME_DATABASE_URL: "postgresql://localhost/tideway", NODE_ENV: "production" }).ssl.rejectUnauthorized === true, "The dedicated real-time PostgreSQL pool was absent, unbounded or missing production TLS.");
const renderPrivateDatabaseEnvironment = { NODE_ENV: "production", RENDER: "true", RENDER_SERVICE_TYPE: "web" };
const renderPrivateDatabaseUrl = "postgresql://tideway_app:private@dpg-d9csr9b7uimc73f0m8d0-a:5432/acme_homle_staging";
assert(JSON.stringify(postgresTransportSecurity(renderPrivateDatabaseUrl, renderPrivateDatabaseEnvironment)) === JSON.stringify({ mode: "render-private-network", ssl: false }), "A same-platform Render internal database did not select its documented private-network transport.");
nodeAssert.equal(postgresPoolOptions({ ...renderPrivateDatabaseEnvironment, DATABASE_URL: renderPrivateDatabaseUrl }).ssl, false);
nodeAssert.throws(() => postgresTransportSecurity("postgresql://tideway_app:private@database.example/acme_homle_staging?sslmode=disable", { NODE_ENV: "production" }), /requires verified TLS/);
nodeAssert.equal(postgresTransportSecurity("postgresql://tideway_app:private@dpg-d9csr9b7uimc73f0m8d0-a/acme_homle_staging", { NODE_ENV: "production" }).mode, "verified-tls", "An arbitrary non-Render runtime claimed the private transport exemption.");

const repositoryCalls = [];
const repositoryDatabase = {
  async withAuthenticationTransaction(operation) {
    return operation({ async query(text, values) { repositoryCalls.push({ kind: "authentication", text, values }); return { rows: [{ user_id: "account-id", ...(text.includes("begin_pending_social_identity") ? { state: "pending" } : {}) }] }; } });
  },
  async withAccountTransaction(actor, operation) {
    return operation({ async query(text, values) { repositoryCalls.push({ kind: "user", actor, text, values }); return { rows: [{ id: "session-id" }], rowCount: 1 }; } });
  }
};
const authenticationRepository = createAuthenticationRepository(repositoryDatabase);
assert(normalizedEmail(" Landlord@Example.COM ") === "landlord@example.com", "Authentication email canonicalization was inconsistent.");
await authenticationRepository.registerPasswordAccount({ email: "landlord@example.com", displayName: "Landlord", passwordHash, verificationHash: sessionMaterial.tokenHash, verificationExpiresAt: "2026-07-16T12:00:00.000Z" });
await authenticationRepository.consumeEmailVerification(sessionMaterial.tokenHash);
await authenticationRepository.recordPasswordAttempt("77777777-7777-4777-8777-777777777777", false);
await authenticationRepository.issuePasswordReset("landlord@example.com", sessionMaterial.tokenHash, "2026-07-15T13:00:00.000Z");
await authenticationRepository.consumePasswordReset(sessionMaterial.tokenHash, passwordHash);
await authenticationRepository.resolveSocialIdentity("google", { subject: "provider-subject", email: "landlord@example.com", emailVerified: true, displayName: "Landlord", avatarUrl: "https://images.example.com/landlord.jpg", profile: { locale: "en-GB" } });
await authenticationRepository.findExistingSocialIdentity("facebook", "facebook-subject");
await authenticationRepository.beginPendingSocialIdentity({ provider: "facebook", subject: "facebook-subject", email: "landlord@example.com", displayName: "Landlord", avatarUrl: "https://images.example.com/landlord.jpg", profile: {}, verificationHash: sessionMaterial.tokenHash, expiresAt: "2026-07-15T13:00:00.000Z" });
await authenticationRepository.consumePendingSocialIdentity(sessionMaterial.tokenHash);
await authenticationRepository.completeRoleOnboarding({ userId: "44444444-4444-4444-8444-444444444444", roles: [] }, "landlord");
await authenticationRepository.findPasswordAccount(" Landlord@Example.COM ");
await authenticationRepository.findSession(sessionMaterial.tokenHash);
await authenticationRepository.findVerifiedAccountByEmail("landlord@example.com");
const repositoryActor = { userId: "44444444-4444-4444-8444-444444444444", roles: ["landlord"] };
await authenticationRepository.createSession(repositoryActor, sessionMaterial);
await authenticationRepository.revokeSession(repositoryActor, "55555555-5555-4555-8555-555555555555");
await authenticationRepository.revokeAllSessions(repositoryActor);
const authenticationFunctionCalls = ["register_password_account", "consume_email_verification", "record_password_attempt", "issue_password_reset", "consume_password_reset", "resolve_social_identity", "lookup_existing_social_identity", "begin_pending_social_identity", "consume_pending_social_identity"];
assert(repositoryCalls.length === 16 && repositoryCalls.slice(0, 9).every((call) => call.kind === "authentication") && authenticationFunctionCalls.every((name, index) => repositoryCalls[index].text.includes(name)) && repositoryCalls[9].kind === "user" && repositoryCalls[9].text.includes("complete_role_onboarding") && repositoryCalls.slice(10, 13).every((call) => call.kind === "authentication") && repositoryCalls.slice(13).every((call) => call.kind === "user") && repositoryCalls[5].values[0] === "google" && repositoryCalls[10].values[0] === "landlord@example.com" && repositoryCalls.every((call) => call.text.includes("$1")), "Authentication repository bypassed its pre-authenticated/authenticated boundaries or used non-parameterized calls.");

const schemaSql = await readFile(new URL("../db/migrations/001_marketplace_schema.sql", import.meta.url), "utf8");
const rlsSql = await readFile(new URL("../db/migrations/002_marketplace_row_level_security.sql", import.meta.url), "utf8");
const authSql = await readFile(new URL("../db/migrations/003_authentication_lookup_functions.sql", import.meta.url), "utf8");
const runtimeGrantsSql = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
for (const table of ["users", "authentication_identities", "cleaner_profiles", "landlord_profiles", "properties", "cleaning_requests", "bookings", "booking_status_history", "cleaning_tasks", "task_updates", "job_photos", "cleaner_locations", "conversations", "messages", "reviews", "notifications", "disputes", "audit_logs"]) {
  assert(schemaSql.includes(`CREATE TABLE ${table} (`), `Marketplace migration omitted ${table}.`);
}
assert(schemaSql.includes("UNIQUE (provider, provider_subject)") && schemaSql.includes("UNIQUE (user_id, provider)"), "OAuth identities lack provider subject or per-account provider uniqueness.");
assert(schemaSql.includes("access_instructions_ciphertext bytea") && !schemaSql.includes("access_instructions text"), "Sensitive property access instructions are not stored behind an encryption boundary.");
assert(schemaSql.includes("EXCLUDE USING gist") && schemaSql.includes("bookings_no_cleaner_overlap") && schemaSql.includes("tstzrange(scheduled_start_at, scheduled_end_at, '[)')"), "PostgreSQL migration lacks its transactional overlapping-booking constraint.");
assert(schemaSql.includes("booking_id uuid NOT NULL UNIQUE REFERENCES bookings") && schemaSql.includes("Reviews require a completed booking") && schemaSql.includes("reviews_refresh_cleaner_rating"), "Completed-only unique reviews or aggregate recalculation are missing.");
assert(schemaSql.includes("booking_id uuid PRIMARY KEY REFERENCES bookings") && schemaSql.includes("expires_at timestamptz NOT NULL"), "Current-only expiring cleaner location storage is missing.");
assert(rlsSql.includes("ALTER TABLE cleaner_locations ENABLE ROW LEVEL SECURITY") && rlsSql.includes("ALTER TABLE password_credentials ENABLE ROW LEVEL SECURITY") && rlsSql.includes("ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY") && rlsSql.includes("ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY") && rlsSql.includes("location_assigned_cleaner_write") && rlsSql.includes("booking_participant") && rlsSql.includes("completed_booking_landlord_reviews"), "Row-level credential, booking, location or review authorization policies are missing.");
assert(authSql.includes("SECURITY DEFINER SET search_path = public, pg_temp") && authSql.includes("lookup_password_account") && authSql.includes("lookup_session") && authSql.includes("lookup_verified_email") && (authSql.match(/REVOKE ALL ON FUNCTION/g) || []).length === 3 && authSql.includes("GRANT EXECUTE ON FUNCTION"), "Authentication lookup functions are missing, publicly executable or lack an explicit restricted-role grant path.");
assert(runtimeGrantsSql.includes("rolbypassrls") && runtimeGrantsSql.includes("rolsuper") && runtimeGrantsSql.includes("GRANT USAGE ON SCHEMA public, tideway_private TO tideway_app") && (runtimeGrantsSql.match(/GRANT EXECUTE ON FUNCTION tideway_private\.lookup_/g) || []).length === 4, "The runtime database role can bypass row-level security or lacks its explicit authentication-function grants.");

console.log("Marketplace foundation tests passed: role-based booking access, transition authority, protected property instructions, consent-bound live location, cleaning-progress ownership, completed-booking review eligibility and fail-closed authentication configuration.");
