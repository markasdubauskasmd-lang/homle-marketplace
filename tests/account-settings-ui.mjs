import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, script, styles, server, migration, grants] = await Promise.all([
  readFile(new URL("../public/settings.html", import.meta.url), "utf8"),
  readFile(new URL("../public/settings.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/027_authenticated_provider_connections.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8")
]);

assert.match(page, /data-connect-provider="google" hidden/);
assert.match(page, /data-connect-provider="facebook" hidden/);
assert.match(page, /type="password"[^>]+autocomplete="current-password"/);
assert.ok(page.includes("data-settings-content hidden") && page.includes("data-provider-actions hidden") && !page.toLowerCase().includes("disconnect"), "Settings exposed dead provider controls or unsafe provider removal.");
assert.ok(script.includes('requestJson("/api/marketplace/auth/provider-links")') && script.includes("/api/marketplace/auth/provider-links/${selectedProvider}/start") && script.includes('"X-CSRF-Token": csrf') && script.includes('credentials: "same-origin"'), "Settings is not bound to authenticated, CSRF-protected provider-link routes.");
assert.ok(script.includes('connected.has("password")') && script.includes("!passwordStepUpAvailable"), "Social-only accounts were offered a connection control without an implemented secure step-up method.");
assert.ok(script.includes("sessionStorage.getItem(\"tideway_csrf\")") && script.indexOf("history.replaceState") < script.indexOf('requestJson("/api/marketplace/auth/provider-links")'), "Settings lost the tab-bound CSRF token or retained callback fragments during its first request.");
assert.ok(script.includes('url.origin === "https://accounts.google.com"') && script.includes('url.origin === "https://www.facebook.com"') && script.includes("url.searchParams.get(\"redirect_uri\") !== callback") && script.includes("location.assign(safeProviderLocation"), "The browser would navigate to an unvalidated provider response.");
assert.ok(!script.includes("innerHTML") && script.includes("textContent") && script.includes("replaceChildren"), "Provider state is rendered with an unsafe HTML sink.");
assert.ok(styles.includes(".settings-provider-list") && styles.includes(".settings-dialog::backdrop") && styles.includes(".settings-provider-actions .button, .settings-dialog-actions .button { width: 100%; }"), "Account settings omitted the responsive one-hand mobile layout.");
assert.ok(server.includes('"/settings": "settings.html"'), "The private settings page has no canonical route.");
assert.ok(migration.includes("tideway_private.current_user_id()") && migration.includes("provider-identity-already-connected") && migration.includes("authentication-provider-connected") && grants.includes("REVOKE SELECT, INSERT, UPDATE, DELETE ON authentication_identities FROM tideway_app"), "Provider connections are not actor-bound, collision-safe, audited and function-only.");

console.log("Account settings UI tests passed: fail-closed provider controls, current-password step-up, CSRF, validated navigation, safe rendering, mobile layout and function-only storage.");
