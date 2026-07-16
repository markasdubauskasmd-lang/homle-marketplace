import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, script, styles, server, migration, providerSecurityMigration, privacyMigration, grants] = await Promise.all([
  readFile(new URL("../public/settings.html", import.meta.url), "utf8"),
  readFile(new URL("../public/settings.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/027_authenticated_provider_connections.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/032_social_provider_step_up_and_removal.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/035_account_privacy_request_intake.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8")
]);

assert.match(page, /data-connect-provider="google" hidden/);
assert.match(page, /data-connect-provider="facebook" hidden/);
assert.match(page, /data-password-field[^>]*>Current Tideway password<input[^>]+autocomplete="current-password"/);
assert.ok(page.includes("data-settings-content hidden") && page.includes("data-provider-actions hidden") && page.includes('data-step-up-provider="google" hidden') && page.includes('data-step-up-provider="facebook" hidden'), "Settings exposed account controls before authenticated capability discovery.");
assert.ok(script.includes('requestJson("/api/marketplace/auth/provider-links")') && script.includes("/api/marketplace/auth/provider-links/${selectedProvider}/start") && script.includes("/api/marketplace/auth/provider-links/${provider}/step-up/start") && script.includes('method: "DELETE"') && script.includes('"X-CSRF-Token": csrf') && script.includes('credentials: "same-origin"'), "Settings is not bound to authenticated, CSRF-protected provider connection, step-up and removal routes.");
assert.ok(script.includes('connected.has("password")') && script.includes("result.recentStepUp?.provider") && script.includes("recentStepUpProvider !== identity.provider") && script.includes("methodCount > 1"), "Social-only connection or removal omitted recent-provider verification, remaining-provider proof or last-method protection.");
assert.ok(script.includes("sessionStorage.getItem(\"tideway_csrf\")") && script.indexOf("history.replaceState") < script.indexOf('requestJson("/api/marketplace/auth/provider-links")'), "Settings lost the tab-bound CSRF token or retained callback fragments during its first request.");
assert.ok(script.includes('url.origin === "https://accounts.google.com"') && script.includes('url.origin === "https://www.facebook.com"') && script.includes("url.searchParams.get(\"redirect_uri\") !== callback") && script.includes("location.assign(safeProviderLocation"), "The browser would navigate to an unvalidated provider response.");
assert.ok(!script.includes("innerHTML") && script.includes("textContent") && script.includes("replaceChildren"), "Provider state is rendered with an unsafe HTML sink.");
assert.ok(styles.includes(".settings-provider-list") && styles.includes(".settings-step-up") && styles.includes(".settings-remove-provider") && styles.includes(".settings-dialog::backdrop") && styles.includes(".settings-provider-actions .button, .settings-dialog-actions .button { width: 100%; }"), "Account settings omitted the responsive one-hand mobile step-up/removal layout.");
assert.ok(server.includes('"/settings": "settings.html"'), "The private settings page has no canonical route.");
assert.ok(migration.includes("tideway_private.current_user_id()") && migration.includes("provider-identity-already-connected") && migration.includes("authentication-provider-connected") && grants.includes("REVOKE SELECT, INSERT, UPDATE, DELETE ON authentication_identities FROM tideway_app"), "Provider connections are not actor-bound, collision-safe, audited and function-only.");
assert.ok(providerSecurityMigration.includes("verify_my_social_identity") && providerSecurityMigration.includes("provider_subject = asserted_subject") && providerSecurityMigration.includes("identity_count <= 1") && providerSecurityMigration.includes("UPDATE sessions SET revoked_at") && providerSecurityMigration.includes("authentication-provider-disconnected") && grants.includes("disconnect_my_social_identity(authentication_provider)"), "Provider step-up/removal is not exact-subject, last-method-safe, session-revoking, audited and function-only.");
assert.ok(page.includes('data-privacy-action="export"') && page.includes('data-privacy-action="deletion"') && page.includes("does not instantly delete your account") && page.includes("data-deletion-confirmation hidden"), "Settings omitted the honest export/deletion intake and explicit deletion acknowledgement.");
assert.ok(script.includes('requestJson("/api/marketplace/privacy-requests")') && script.includes('"X-CSRF-Token": csrf') && script.includes("pendingPrivacyIds") && script.includes("crypto.randomUUID()") && !script.includes("innerHTML"), "Privacy intake lost authenticated reads, CSRF, stable retry identity or safe rendering.");
assert.ok(styles.includes(".settings-privacy-card") && styles.includes(".settings-privacy-actions") && styles.includes(".settings-confirmation") && styles.includes(".settings-privacy-status"), "Privacy intake omitted its mobile-safe review history and confirmation treatment.");
assert.ok(privacyMigration.includes("privacy_requests_one_active_type_per_user_idx") && privacyMigration.includes("privacy-request.created") && grants.includes("REVOKE SELECT, INSERT, UPDATE, DELETE ON privacy_requests"), "Privacy intake is not concurrency-safe, audited and function-only.");

console.log("Account settings UI tests passed: fail-closed provider controls, password/social step-up, lockout-safe removal, CSRF, validated navigation, safe rendering, mobile layout and function-only storage.");
