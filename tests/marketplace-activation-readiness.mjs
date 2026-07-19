import { marketplaceActivationReadiness } from "../marketplace-activation-readiness.mjs";
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const detached = marketplaceActivationReadiness({ privateDataStorageSafe: true, localDemosEnabled: true });
assert(detached.completed === 1 && detached.total === 11 && detached.ready === false, "A safe local data folder must not be mistaken for an activated marketplace.");
assert(detached.checks.privateDataStorage === true && detached.checks.marketplaceServices === false, "Detached activation checks are incorrect.");
assert(detached.next?.key === "accountAccess" && detached.next.action.includes("email delivery"), "The activation gate did not name the next account-service step.");

const accountsWithoutSocial = marketplaceActivationReadiness({
  privateDataStorageSafe: true,
  marketplaceEnabled: true,
  marketplaceReady: true,
  emailReady: true,
  mediaReady: true,
  realtimeReady: true,
  geocodingReady: true,
  matchingReady: true,
  authenticationReady: true,
  providers: { emailPassword: true, emailVerification: true, passwordReset: true },
  paymentsReady: true,
  productionMode: true,
  localDemosEnabled: false
});
assert(accountsWithoutSocial.completed === 10 && accountsWithoutSocial.next?.key === "socialSignIn", "Email account attachment must not falsely prove a Google or Facebook provider attachment.");

const restrictedCoreOnly = marketplaceActivationReadiness({
  privateDataStorageSafe: true,
  marketplaceEnabled: true,
  marketplaceReady: true,
  authenticationReady: true,
  providers: { google: true },
  matchingReady: true,
  paymentsReady: true,
  productionMode: true,
  localDemosEnabled: false
});
assert(restrictedCoreOnly.ready === false && restrictedCoreOnly.completed === 7 && restrictedCoreOnly.next?.key === "privateMedia", "A restricted database-only staging core falsely proved private media, email and real-time launch readiness.");

const servicesWithoutPricing = marketplaceActivationReadiness({
  privateDataStorageSafe: true,
  marketplaceEnabled: true,
  marketplaceReady: true,
  emailReady: true,
  mediaReady: true,
  realtimeReady: true,
  geocodingReady: true,
  authenticationReady: true,
  providers: { emailPassword: true, emailVerification: true, passwordReset: true, google: true },
  paymentsReady: true,
  productionMode: true,
  localDemosEnabled: false
});
assert(servicesWithoutPricing.ready === false && servicesWithoutPricing.completed === 10 && servicesWithoutPricing.next?.key === "matchingPricing" && servicesWithoutPricing.next.action.includes("pricing policy"), "Managed storage/database health falsely proved that Homle can price and match a Cleaner.");

const servicesWithoutGeocoding = marketplaceActivationReadiness({
  privateDataStorageSafe: true,
  marketplaceEnabled: true,
  marketplaceReady: true,
  emailReady: true,
  mediaReady: true,
  realtimeReady: true,
  matchingReady: true,
  authenticationReady: true,
  providers: { google: true },
  paymentsReady: true,
  productionMode: true,
  localDemosEnabled: false
});
assert(servicesWithoutGeocoding.ready === false && servicesWithoutGeocoding.completed === 10 && servicesWithoutGeocoding.next?.key === "postcodeGeocoding" && servicesWithoutGeocoding.next.action.includes("real-distance"), "Configured pricing falsely proved real-distance Cleaner matching readiness.");

const ready = marketplaceActivationReadiness({
  privateDataStorageSafe: true,
  marketplaceEnabled: true,
  marketplaceReady: true,
  emailReady: true,
  mediaReady: true,
  realtimeReady: true,
  geocodingReady: true,
  matchingReady: true,
  authenticationReady: true,
  providers: { emailPassword: true, emailVerification: true, passwordReset: true, google: true, facebook: false },
  paymentsReady: true,
  productionMode: true,
  localDemosEnabled: false
});
assert(ready.ready === true && ready.completed === 11 && ready.next === null, "A completely proven environment did not pass every activation check.");
assert(Object.values(ready.missing).every((items) => items.length === 0), "A ready environment retained stale missing actions.");

const [adminPage, adminScript, server] = await Promise.all([
  readFile(new URL("../public/admin.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);
for (const key of ["privateMedia", "transactionalEmail", "realtimeUpdates", "postcodeGeocoding", "matchingPricing"]) assert(adminPage.includes(`data-activation-check="${key}"`), `The Administrator activation panel omitted ${key}.`);
assert(adminPage.includes('id="technical-readiness-score">0/11'), "The Administrator activation panel retained the old bundled score.");
for (const binding of ["emailReady: marketplaceAttachment.emailReady", "mediaReady: marketplaceAttachment.mediaReady", "realtimeReady: marketplaceAttachment.realtimeReady", "geocodingReady: marketplaceAttachment.geocodingReady", "matchingReady: marketplaceAttachment.matchingReady"]) assert(server.includes(binding), `The Administrator readiness response omitted ${binding}.`);
assert(adminScript.includes("technical service and matching checks"), "The Administrator completed state lost its separate technical-evidence boundary.");

console.log("Marketplace activation readiness tests passed.");
