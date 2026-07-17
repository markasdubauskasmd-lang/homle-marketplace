import { marketplaceActivationReadiness } from "../marketplace-activation-readiness.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const detached = marketplaceActivationReadiness({ privateDataStorageSafe: true, localDemosEnabled: true });
assert(detached.completed === 1 && detached.total === 6 && detached.ready === false, "A safe local data folder must not be mistaken for an activated marketplace.");
assert(detached.checks.privateDataStorage === true && detached.checks.marketplaceServices === false, "Detached activation checks are incorrect.");
assert(detached.next?.key === "accountAccess" && detached.next.action.includes("email delivery"), "The activation gate did not name the next account-service step.");

const accountsWithoutSocial = marketplaceActivationReadiness({
  privateDataStorageSafe: true,
  marketplaceEnabled: true,
  marketplaceReady: true,
  authenticationReady: true,
  providers: { emailPassword: true, emailVerification: true, passwordReset: true },
  paymentsReady: true,
  productionMode: true,
  localDemosEnabled: false
});
assert(accountsWithoutSocial.completed === 5 && accountsWithoutSocial.next?.key === "socialSignIn", "Email account attachment must not falsely prove a Google or Facebook provider attachment.");

const ready = marketplaceActivationReadiness({
  privateDataStorageSafe: true,
  marketplaceEnabled: true,
  marketplaceReady: true,
  authenticationReady: true,
  providers: { emailPassword: true, emailVerification: true, passwordReset: true, google: true, facebook: false },
  paymentsReady: true,
  productionMode: true,
  localDemosEnabled: false
});
assert(ready.ready === true && ready.completed === 6 && ready.next === null, "A completely proven environment did not pass every activation check.");
assert(Object.values(ready.missing).every((items) => items.length === 0), "A ready environment retained stale missing actions.");

console.log("Marketplace activation readiness tests passed.");
