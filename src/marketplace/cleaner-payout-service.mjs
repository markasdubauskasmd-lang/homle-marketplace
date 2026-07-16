import { randomUUID } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accountPattern = /^acct_[A-Za-z0-9_]{3,250}$/;

function object(value) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return null; } }
  return value;
}

function requireCleaner(actor) {
  if (!uuidPattern.test(actor?.userId || "") || !Array.isArray(actor?.roles) || !actor.roles.includes("cleaner")) throw Object.assign(new Error("A Cleaner account is required to manage payouts."), { statusCode: 403, code: "cleaner-required" });
}

function requestRecord(value) {
  const record = object(value);
  if (!record || typeof record !== "object" || record.provider !== "stripe") throw new Error("Payout setup is unavailable.");
  const requestId = record.requestId == null ? null : String(record.requestId).toLowerCase();
  const destinationAccountId = record.destinationAccountId == null ? null : String(record.destinationAccountId);
  if ((requestId != null && !uuidPattern.test(requestId)) || (destinationAccountId != null && !accountPattern.test(destinationAccountId))) throw new Error("Payout setup returned an invalid account reference.");
  return Object.freeze({
    requestId,
    provider: "stripe",
    destinationAccountId,
    chargesEnabled: record.chargesEnabled === true,
    payoutsEnabled: record.payoutsEnabled === true,
    detailsSubmitted: record.detailsSubmitted === true,
    updatedAt: typeof record.updatedAt === "string" && Number.isFinite(Date.parse(record.updatedAt)) ? new Date(record.updatedAt).toISOString() : null
  });
}

function providerAccount(value, expectedAccountId) {
  if (!value || value.id !== expectedAccountId || !accountPattern.test(value.id || "") || value.testMode !== true) throw new Error("Stripe returned an invalid test payout account.");
  const remainingRequirements = Number.isInteger(value.remainingRequirements) && value.remainingRequirements >= 0 && value.remainingRequirements <= 100 ? value.remainingRequirements : 0;
  return Object.freeze({
    destinationAccountId: value.id,
    chargesEnabled: value.chargesEnabled === true,
    payoutsEnabled: value.payoutsEnabled === true,
    detailsSubmitted: value.detailsSubmitted === true,
    remainingRequirements
  });
}

function publicStatus(record, remainingRequirements = null) {
  const ready = record.destinationAccountId != null && record.payoutsEnabled && record.detailsSubmitted;
  const started = record.requestId != null;
  return Object.freeze({
    status: ready ? "ready" : started ? "action-required" : "not-started",
    ready,
    detailsSubmitted: record.detailsSubmitted,
    payoutsEnabled: record.payoutsEnabled,
    remainingRequirements: Number.isInteger(remainingRequirements) ? remainingRequirements : null,
    updatedAt: record.updatedAt
  });
}

function onboardingLink(value) {
  const url = new URL(value?.url || "");
  if (url.protocol !== "https:" || url.origin !== "https://connect.stripe.com" || !Number.isInteger(value?.expiresAt) || value.expiresAt * 1000 <= Date.now()) throw new Error("Stripe returned an invalid or expired payout setup link.");
  return { url: url.toString(), expiresAt: new Date(value.expiresAt * 1000).toISOString() };
}

export function createCleanerPayoutService(repository, provider, options = {}) {
  if (!repository || !["get", "begin", "attach", "sync"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete Cleaner payout repository is required.");
  if (!provider || provider.name !== "stripe" || !["createPayoutAccount", "retrievePayoutAccount", "createPayoutOnboardingLink"].every((method) => typeof provider[method] === "function")) throw new TypeError("A complete Stripe payout provider is required.");
  const appOrigin = String(options.appOrigin || "").replace(/\/$/, "");
  const origin = new URL(appOrigin);
  if (origin.origin !== appOrigin || origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) throw new TypeError("Cleaner payout onboarding requires the exact public HTTPS origin.");
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;

  async function synchronize(actor, record) {
    if (!record.destinationAccountId) return { record, remainingRequirements: null };
    const account = providerAccount(await provider.retrievePayoutAccount({ accountId: record.destinationAccountId }), record.destinationAccountId);
    const synced = requestRecord(await repository.sync(actor, record.destinationAccountId, account));
    return { record: synced, remainingRequirements: account.remainingRequirements };
  }

  return Object.freeze({
    async getStatus(actor) {
      requireCleaner(actor);
      return publicStatus(requestRecord(await repository.get(actor)));
    },
    async refreshStatus(actor) {
      requireCleaner(actor);
      const result = await synchronize(actor, requestRecord(await repository.get(actor)));
      return publicStatus(result.record, result.remainingRequirements);
    },
    async beginOnboarding(actor) {
      requireCleaner(actor);
      let record = requestRecord(await repository.begin(actor, String(createId()).toLowerCase()));
      if (!record.requestId) throw new Error("Payout setup did not create a safe retry reference.");
      if (!record.destinationAccountId) {
        const created = await provider.createPayoutAccount({
          idempotencyKey: `tideway_cleaner_payout_${record.requestId}`,
          requestId: record.requestId
        });
        const account = providerAccount(created, created?.id);
        record = requestRecord(await repository.attach(actor, record.requestId, account.destinationAccountId));
      }
      const synchronized = await synchronize(actor, record);
      const link = onboardingLink(await provider.createPayoutOnboardingLink({
        accountId: synchronized.record.destinationAccountId,
        refreshUrl: `${appOrigin}/cleaner/payouts?resume=1`,
        returnUrl: `${appOrigin}/cleaner/payouts?returned=1`
      }));
      return Object.freeze({ ...publicStatus(synchronized.record, synchronized.remainingRequirements), onboardingUrl: link.url, expiresAt: link.expiresAt });
    }
  });
}
