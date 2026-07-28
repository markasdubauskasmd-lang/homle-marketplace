import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";

const publicDirectory = new URL("../public/", import.meta.url);
const [server, migration, providerSecurityMigration, appleMigration, privacyMigration, grants, publicEntries] = await Promise.all([
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/027_authenticated_provider_connections.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/032_social_provider_step_up_and_removal.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/060_apple_sign_in_provider.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/035_account_privacy_request_intake.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8"),
  readdir(publicDirectory, { withFileTypes: true })
]);

await assert.rejects(access(new URL("../public/settings.html", import.meta.url)), "The removed settings page still exists.");
await assert.rejects(access(new URL("../public/settings.js", import.meta.url)), "The removed settings script still exists.");
assert.ok(!server.includes('"/settings": "settings.html"'), "The removed settings page is still reachable through its canonical route.");

const publicNavigationSources = await Promise.all(
  publicEntries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".html") || entry.name.endsWith(".js")))
    .map((entry) => readFile(new URL(entry.name, publicDirectory), "utf8"))
);
const publicNavigation = publicNavigationSources.join("\n");
assert.ok(!/href=["']\/settings(?:["'#?])/.test(publicNavigation), "A public page still links to the removed settings route.");
assert.ok(!publicNavigation.includes('href: "/settings"'), "A public navigation model still links to the removed settings route.");

assert.ok(migration.includes("tideway_private.current_user_id()") && migration.includes("provider-identity-already-connected") && migration.includes("authentication-provider-connected") && grants.includes("REVOKE SELECT, INSERT, UPDATE, DELETE ON authentication_identities FROM tideway_app"), "Removing the page also removed the actor-bound provider security boundary.");
assert.ok(providerSecurityMigration.includes("verify_my_social_identity") && providerSecurityMigration.includes("provider_subject = asserted_subject") && providerSecurityMigration.includes("identity_count <= 1") && providerSecurityMigration.includes("UPDATE sessions SET revoked_at") && providerSecurityMigration.includes("authentication-provider-disconnected") && grants.includes("disconnect_my_social_identity(authentication_provider)"), "Removing the page also removed exact-subject, last-method-safe provider protections.");
assert.ok(appleMigration.includes("'apple-start','apple-callback'") && appleMigration.includes("asserted_provider NOT IN ('google','apple','facebook')") && appleMigration.includes("identity.provider IN ('google','apple','facebook')") && appleMigration.includes("WHEN 'apple' THEN 2"), "Removing the page also removed Apple provider security support.");
assert.ok(privacyMigration.includes("privacy_requests_one_active_type_per_user_idx") && privacyMigration.includes("privacy-request.created") && grants.includes("REVOKE SELECT, INSERT, UPDATE, DELETE ON privacy_requests"), "Removing the page also removed the protected privacy-request backend.");

console.log("Account settings removal tests passed: route, assets and navigation are gone while the protected provider and privacy backends remain intact.");
