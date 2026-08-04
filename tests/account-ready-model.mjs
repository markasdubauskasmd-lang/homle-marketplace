import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountReadyPresentation, availableAccountMethodLabel } from "../public/account-ready-model.js";

const cleaner = { selectedRole: "cleaner", roles: ["cleaner"] };
const landlord = { selectedRole: "landlord", roles: ["landlord"] };

assert.deepEqual(
  accountReadyPresentation(cleaner, false),
  {
    role: "cleaner",
    title: "Your Cleaner profile is created.",
    copy: "Your secure Cleaner account and role are saved for your next sign-in. Open the private Cleaner dashboard to continue setup and review service readiness.",
    actionHref: "/cleaner/dashboard",
    actionLabel: "Open Cleaner dashboard"
  },
  "A gated Cleaner account does not return to its single private dashboard."
);
assert.equal(accountReadyPresentation(landlord, false)?.actionHref, "/landlord/dashboard", "A gated Landlord account does not return to its single private dashboard.");
assert.match(accountReadyPresentation(landlord, false)?.copy || "", /saved for your next sign-in/i, "The gated Landlord handoff does not explain that account setup succeeded and can be resumed later.");
assert.equal(accountReadyPresentation(cleaner, true)?.actionHref, "/cleaner/dashboard", "A ready Cleaner workspace does not open its separate dashboard.");
assert.equal(accountReadyPresentation(landlord, true)?.actionHref, "/landlord/dashboard", "A ready Landlord workspace does not open its separate dashboard.");
assert.equal(accountReadyPresentation({ selectedRole: "cleaner", roles: ["landlord"] }, false), null, "A mismatched selected role can receive another workspace's action.");

assert.equal(availableAccountMethodLabel({ google: true }), "Google", "A Google-only deployment advertised unavailable sign-in methods.");
assert.equal(availableAccountMethodLabel({ google: true, emailPassword: true }), "Google or verified email", "Two available account methods were not phrased clearly.");
assert.equal(availableAccountMethodLabel({ google: true, apple: true, facebook: true, emailPassword: true }), "Google, Apple, Facebook or verified email", "The complete account-method list is unclear.");
assert.equal(availableAccountMethodLabel({ google: false, apple: false, facebook: false, emailPassword: false }), "", "Unavailable providers appeared in account-entry copy.");

const accountScript = await readFile(new URL("../public/auth-entry.js", import.meta.url), "utf8");
const logoutStart = accountScript.indexOf("async function logoutReadyAccount()");
const logoutEnd = accountScript.indexOf("async function submitAccountForm", logoutStart);
const logoutFlow = accountScript.slice(logoutStart, logoutEnd);
assert(logoutStart >= 0 && logoutEnd > logoutStart, "The account-ready sign-out flow could not be inspected.");
assert(!logoutFlow.includes('kind === "onboarding"'), "A failed account-ready sign-out still reads the unrelated form-only kind variable and can leave its button stuck.");
assert(logoutFlow.includes('showFeedback(error.message, "error")') && logoutFlow.includes("accountReadyLogout.disabled = false"), "A failed account-ready sign-out does not explain the failure and re-enable a safe retry.");
assert(accountScript.includes("availableAccountMethodLabel(providers)") && !accountScript.includes("Continue with Google, Apple or Facebook") && !accountScript.includes("Use Google, Apple, Facebook"), "Account entry still advertises provider methods that the running deployment may not offer.");
// The guarantee is that nothing on the page claims a verdict before the
// providers response arrives — not that the loading copy uses one exact
// sentence. The headline is now the design's "Opening your workspace.", which
// the lead qualifies with "once Homle confirms this browser is signed in", and
// the readiness line beneath states plainly that the check is still running.
// What must never happen is an unavailable or ready claim on first paint, so
// this asserts both verdict strings appear only inside the branches that run
// after the fetch resolves.
const loadTimeCopy = accountScript.slice(0, accountScript.indexOf('fetch("/api/auth/providers"'));
assert(accountScript.includes('title.textContent = "Opening your workspace."'), "Account entry no longer sets neutral loading copy while it checks live provider capabilities.");
assert(!loadTimeCopy.includes("Account access is safely unavailable.") && !loadTimeCopy.includes("Secure account access is ready."), "Account entry states a readiness verdict before the provider check resolves, so it can flash a false unavailable or ready state.");
const staticMarkup = await readFile(new URL("../public/account.html", import.meta.url), "utf8");
assert(staticMarkup.includes("Checking secure account access"), "The served account page does not say that the capability check is still running.");
assert(!staticMarkup.includes('<header class="site-header">'), "The retired account-page header returned.");
assert(/<article class="ae-panel">[\s\S]*?<a class="ae-logo" href="\/" aria-label="Return to Homle home"><img src="\/homle-logo-192-c8defd4b\.png"/.test(staticMarkup), "The compact Homle logo is not inside the account panel where the decorative tile used to be.");
assert(!staticMarkup.includes('class="ae-pulse"'), "The green decorative pulse still occupies the account panel logo position.");
assert(!staticMarkup.includes("data-pilot-actions") && !staticMarkup.includes("or go straight to a workspace") && !staticMarkup.includes('href="/cleaner/dashboard"') && !staticMarkup.includes('href="/landlord/dashboard"'), "Unsigned account entry still offers protected or cross-role dashboard shortcuts instead of one focused sign-in journey.");
assert(!accountScript.includes("pilotActions"), "The removed cross-role account shortcuts left dead controller logic behind.");

console.log("Account-ready handoff tests passed: exact live provider copy, neutral capability loading, role-safe destinations and recoverable sign-out.");
