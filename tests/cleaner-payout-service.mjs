import assert from "node:assert/strict";
import { createCleanerPayoutService } from "../src/marketplace/cleaner-payout-service.mjs";

const cleaner = { userId: "11111111-1111-4111-8111-111111111111", roles: ["cleaner"] };
const landlord = { userId: "22222222-2222-4222-8222-222222222222", roles: ["landlord"] };
const requestId = "33333333-3333-4333-8333-333333333333";
const accountId = "acct_test_cleaner";
const calls = [];
let record = { requestId: null, provider: "stripe", destinationAccountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, updatedAt: null };

const repository = {
  async get(actor) { calls.push({ kind: "get", actor }); return record; },
  async begin(actor, proposedRequestId) {
    calls.push({ kind: "begin", actor, proposedRequestId });
    if (!record.requestId) record = { ...record, requestId: proposedRequestId };
    return record;
  },
  async attach(actor, selectedRequestId, destinationAccountId) {
    calls.push({ kind: "attach", actor, selectedRequestId, destinationAccountId });
    record = { ...record, destinationAccountId };
    return record;
  },
  async sync(actor, destinationAccountId, status) {
    calls.push({ kind: "sync", actor, destinationAccountId, status });
    record = { ...record, ...status, updatedAt: "2026-07-16T17:00:00.000Z" };
    return record;
  }
};

const provider = {
  name: "stripe",
  async createPayoutAccount(input) { calls.push({ kind: "provider-create", input }); return { id: accountId, testMode: true, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, remainingRequirements: 3 }; },
  async retrievePayoutAccount(input) { calls.push({ kind: "provider-retrieve", input }); return { id: accountId, testMode: true, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true, remainingRequirements: 1 }; },
  async createPayoutOnboardingLink(input) { calls.push({ kind: "provider-link", input }); return { url: "https://connect.stripe.com/setup/c/acct_test_cleaner/secret", expiresAt: Math.floor(Date.now() / 1000) + 300 }; }
};

const service = createCleanerPayoutService(repository, provider, { appOrigin: "https://tideway.example", createId: () => requestId });
assert.deepEqual(await service.getStatus(cleaner), { status: "not-started", ready: false, detailsSubmitted: false, payoutsEnabled: false, remainingRequirements: null, updatedAt: null });
await assert.rejects(service.getStatus(landlord), (error) => error.code === "cleaner-required");

const onboarding = await service.beginOnboarding(cleaner);
assert.equal(onboarding.status, "action-required");
assert.equal(onboarding.onboardingUrl, "https://connect.stripe.com/setup/c/acct_test_cleaner/secret");
assert.equal(onboarding.remainingRequirements, 1);
assert(!Object.hasOwn(onboarding, "destinationAccountId"), "The Cleaner-facing payout response exposed the provider account reference as application data.");
const create = calls.find((call) => call.kind === "provider-create");
assert.deepEqual(create.input, { idempotencyKey: `tideway_cleaner_payout_${requestId}`, requestId });
const link = calls.find((call) => call.kind === "provider-link");
assert.deepEqual(link.input, { accountId, refreshUrl: "https://tideway.example/cleaner/payouts?resume=1", returnUrl: "https://tideway.example/cleaner/payouts?returned=1" });

const createsBeforeRetry = calls.filter((call) => call.kind === "provider-create").length;
await service.beginOnboarding(cleaner);
assert.equal(calls.filter((call) => call.kind === "provider-create").length, createsBeforeRetry, "Retrying payout onboarding created a second provider account.");

provider.retrievePayoutAccount = async (input) => { calls.push({ kind: "provider-retrieve-ready", input }); return { id: accountId, testMode: true, chargesEnabled: false, payoutsEnabled: true, detailsSubmitted: true, remainingRequirements: 0 }; };
const ready = await service.refreshStatus(cleaner);
assert.deepEqual(ready, { status: "ready", ready: true, detailsSubmitted: true, payoutsEnabled: true, remainingRequirements: 0, updatedAt: "2026-07-16T17:00:00.000Z" });
assert(!Object.hasOwn(ready, "chargesEnabled") && !JSON.stringify(ready).includes(accountId), "The public payout status exposed unnecessary provider facts.");

assert.throws(() => createCleanerPayoutService(repository, provider, { appOrigin: "http://127.0.0.1:4173" }), /HTTPS origin/);
const unsafeProvider = { ...provider, async createPayoutOnboardingLink() { return { url: "https://attacker.example/setup", expiresAt: Math.floor(Date.now() / 1000) + 300 }; } };
const unsafeService = createCleanerPayoutService(repository, unsafeProvider, { appOrigin: "https://tideway.example", createId: () => requestId });
await assert.rejects(unsafeService.beginOnboarding(cleaner), /invalid or expired payout setup link/);

console.log("Cleaner payout service tests passed: role-bound setup, stable provider idempotency, exact Stripe redirect, private account reference and verified readiness refresh.");
