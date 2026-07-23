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
    copy: "Your secure Cleaner account and role are saved for your next sign-in. Professional profile tools will open after Homle's private booking services pass staging. Today, you can submit or update a separate Cleaner pilot application.",
    actionHref: "/join",
    actionLabel: "Apply for the Cleaner pilot"
  },
  "A gated Cleaner account still links into unavailable marketplace profile tools."
);
assert.equal(accountReadyPresentation(landlord, false)?.actionHref, "/request", "A gated Landlord account still links into an unavailable dashboard.");
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
assert(accountScript.includes('title.textContent = "Checking secure account access"') && accountScript.includes("Homle is confirming the sign-in methods available on this deployment."), "Account entry still flashes a false unavailable state while checking its live provider capabilities.");

console.log("Account-ready handoff tests passed: exact live provider copy, neutral capability loading, role-safe destinations and recoverable sign-out.");
