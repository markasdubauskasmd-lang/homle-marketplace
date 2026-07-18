import { marketplaceActivationReadiness } from "../marketplace-activation-readiness.mjs";
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const detached = marketplaceActivationReadiness({ privateDataStorageSafe: true, localDemosEnabled: true });
assert(detached.completed === 1 && detached.total === 7 && detached.ready === false, "A safe local data folder must not be mistaken for an activated marketplace.");
assert(detached.checks.privateDataStorage === true && detached.checks.marketplaceServices === false, "Detached activation checks are incorrect.");
assert(detached.next?.key === "accountAccess" && detached.next.action.includes("email delivery"), "The activation gate did not name the next account-service step.");

const accountsWithoutSocial = marketplaceActivationReadiness({
  privateDataStorageSafe: true,
  marketplaceEnabled: true,
  marketplaceReady: true,
  matchingReady: true,
  authenticationReady: true,
  providers: { emailPassword: true, emailVerification: true, passwordReset: true },
  paymentsReady: true,
  productionMode: true,
  localDemosEnabled: false
});
assert(accountsWithoutSocial.completed === 6 && accountsWithoutSocial.next?.key === "socialSignIn", "Email account attachment must not falsely prove a Google or Facebook provider attachment.");

const servicesWithoutPricing = marketplaceActivationReadiness({
  privateDataStorageSafe: true,
  marketplaceEnabled: true,
  marketplaceReady: true,
  authenticationReady: true,
  providers: { emailPassword: true, emailVerification: true, passwordReset: true, google: true },
  paymentsReady: true,
  productionMode: true,
  localDemosEnabled: false
});
assert(servicesWithoutPricing.ready === false && servicesWithoutPricing.completed === 6 && servicesWithoutPricing.next?.key === "matchingPricing" && servicesWithoutPricing.next.action.includes("pricing policy"), "Managed storage/database health falsely proved that Homle can price and match a Cleaner.");

const ready = marketplaceActivationReadiness({
  privateDataStorageSafe: true,
  marketplaceEnabled: true,
  marketplaceReady: true,
  matchingReady: true,
  authenticationReady: true,
  providers: { emailPassword: true, emailVerification: true, passwordReset: true, google: true, facebook: false },
  paymentsReady: true,
  productionMode: true,
  localDemosEnabled: false
});
assert(ready.ready === true && ready.completed === 7 && ready.next === null, "A completely proven environment did not pass every activation check.");
assert(Object.values(ready.missing).every((items) => items.length === 0), "A ready environment retained stale missing actions.");

const [adminPage, adminScript, server] = await Promise.all([
  readFile(new URL("../public/admin.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);
assert(adminPage.includes('data-activation-check="matchingPricing"') && adminPage.includes('id="technical-readiness-score">0/7'), "The Administrator activation panel omitted the matching/pricing gate or retained the old score.");
assert(adminScript.includes("technical service and matching checks") && server.includes("matchingReady: marketplaceAttachment.matchingReady"), "The Administrator readiness response or completed state is not bound to the actual runtime matching capability.");

console.log("Marketplace activation readiness tests passed.");
