import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, script, dashboardPage, dashboardScript, server, migration, grants, packageFile] = await Promise.all([
  readFile(new URL("../public/cleaner-payouts.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-payouts.js", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/036_cleaner_payout_onboarding.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

assert(page.includes("Get paid without sharing bank details with Tideway") && page.includes("connect.stripe.com") && page.includes("no real payment or payout") && page.includes("data-payout-action"), "The Cleaner payout screen is not a clear one-action, test-only handoff.");
assert(script.includes('destination.origin !== "https://connect.stripe.com"') && script.includes('"X-CSRF-Token"') && script.includes('credentials: "same-origin"') && script.includes("history.replaceState") && !script.includes("innerHTML"), "The payout handoff lost exact Stripe destination, CSRF/session protection, callback cleanup or safe rendering.");
assert(script.includes("?resume=1") || script.includes('query.get("resume")'), "Expired Stripe payout links cannot resume through a fresh authenticated link.");
assert(dashboardPage.includes("data-cleaner-payout-link") && dashboardScript.includes("loadOptionalPayoutStatus") && dashboardScript.includes('link.href = "/cleaner/payouts"') && dashboardScript.includes("payout && !payout.ready"), "The Cleaner dashboard does not surface payout setup as the next relevant action.");
assert(server.includes('"/cleaner/payouts": "cleaner-payouts.html"'), "The private Cleaner payout page route is missing.");
for (const name of ["get_my_cleaner_payout_onboarding", "begin_my_cleaner_payout_onboarding", "attach_my_cleaner_payout_account", "sync_my_cleaner_payout_account"]) assert(migration.includes(name) && grants.includes(name), `The restricted payout boundary omitted ${name}.`);
assert(migration.includes("pg_advisory_xact_lock") && migration.includes("payout-account-conflict") && migration.includes("REVOKE ALL ON TABLE tideway_private.cleaner_payout_onboarding") && migration.includes("audit_logs"), "Payout setup lost serialization, account ownership, table revocation or audit evidence.");
assert(packageFile.includes("tests/cleaner-payout-service.mjs") && packageFile.includes("tests/cleaner-payout-ui.mjs"), "Cleaner payout checks are not part of the project gate.");

console.log("Cleaner payout UI tests passed: one-action mobile handoff, exact Stripe destination, authenticated resume/return, private status and dashboard guidance.");
