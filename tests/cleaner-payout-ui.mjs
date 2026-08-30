import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, script, sidebar, dashboardPage, dashboardScript, server, migration, grants, packageFile] = await Promise.all([
  readFile(new URL("../public/cleaner-payouts.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-payouts.js", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-sidebar.js", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/036_cleaner_payout_onboarding.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

// The page joined the Cleaner workspace, so its headline is a workspace heading
// rather than the marketing sentence it used to set at display size. The two
// promises that matter are asserted directly: bank details never reach Homle,
// and the next screen is Stripe's own domain.
assert(page.includes("Earnings and payouts") && page.includes("never enter bank details anywhere on Homle") && page.includes("connect.stripe.com") && page.includes("no real payment or payout") && page.includes("data-payout-action"), "The Cleaner payout screen is not a clear one-action, test-only handoff.");
// It is also the page whose static header told a signed-in Landlord their
// account was a Cleaner. The shared bootstrap confirms the workspace boundary
// before any of it is revealed.
assert(page.includes("homle-cleaner.css") && page.includes("data-cleaner-payout-gate") && script.includes('createCleanerPage("cleaner-payout"'), "The Cleaner payout page left the Cleaner workspace system or lost its role gate.");
assert(script.includes('destination.origin !== "https://connect.stripe.com"') && script.includes('"X-CSRF-Token"') && script.includes("history.replaceState") && !script.includes("innerHTML"), "The payout handoff lost exact Stripe destination, CSRF/session protection, callback cleanup or safe rendering.");
// Checked against the code that reads it, not a mention of the URL: the resume
// return from Stripe asks Stripe what it now holds rather than reopening the form.
assert(script.includes('.has("resume")') && script.includes("refreshStatus: resume"), "Expired Stripe payout links cannot resume through a fresh authenticated link.");
assert(sidebar.includes("dataset.cleanerPayoutLink") && dashboardScript.includes("loadOptionalPayoutStatus") && dashboardScript.includes('link.href = "/cleaner/payouts"') && dashboardScript.includes("payout && !payout.ready"), "The Cleaner dashboard does not surface payout setup as the next relevant action.");
assert(server.includes('"/cleaner/payouts": "cleaner-payouts.html"'), "The private Cleaner payout page route is missing.");
for (const name of ["get_my_cleaner_payout_onboarding", "begin_my_cleaner_payout_onboarding", "attach_my_cleaner_payout_account", "sync_my_cleaner_payout_account"]) assert(migration.includes(name) && grants.includes(name), `The restricted payout boundary omitted ${name}.`);
assert(migration.includes("pg_advisory_xact_lock") && migration.includes("payout-account-conflict") && migration.includes("REVOKE ALL ON TABLE tideway_private.cleaner_payout_onboarding") && migration.includes("audit_logs"), "Payout setup lost serialization, account ownership, table revocation or audit evidence.");
assert(packageFile.includes("tests/cleaner-payout-service.mjs") && packageFile.includes("tests/cleaner-payout-ui.mjs"), "Cleaner payout checks are not part of the project gate.");


console.log("Cleaner payout UI tests passed: one-action mobile handoff, exact Stripe destination, authenticated resume/return, private status and dashboard guidance.");
