import assert from "node:assert/strict";
import { accountReadyPresentation } from "../public/account-ready-model.js";

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

console.log("Account-ready handoff tests passed: gated accounts retain honest role-specific pilot actions and ready accounts open only their own workspace.");
