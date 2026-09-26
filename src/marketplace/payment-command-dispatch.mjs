import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { canDispatchCommand } from "./payment-command-recovery.mjs";

function recoveryIdentity(command) {
  const identity = command.requestIdentity || {};
  return { ...identity, commandId: command.commandId, paymentId: command.paymentId, bookingId: command.bookingId,
    kind: command.kind, amountPence: command.amountPence, currency: command.currency,
    providerPaymentId: command.providerPaymentId, providerCommandId: command.providerCommandId || null,
    ...(command.kind === "transfer" && !command.requestIdentity ? { destinationAccountId: null, sourceChargeId: null } : {}) };
}

export async function recoverPersistedPaymentCommand({ actor, command, repository, provider, reason = null }) {
  let discovery;
  try {
    discovery = reason ? { outcome: "operator-required", reason } : await provider.discoverCommandObject(recoveryIdentity(command));
  } catch {
    discovery = { outcome: "operator-required", reason: "provider-recovery-unavailable" };
  }
  const recorded = await repository.recordCommandRecovery(actor, command.commandId, discovery);
  return Object.freeze({ commandId: command.commandId, paymentId: command.paymentId, kind: command.kind,
    status: recorded?.status, recoveryRequired: recorded?.recoveryRequired,
    recoveryReason: recorded?.recoveryReason ?? null, signedEventsReplayed: recorded?.signedEventsReplayed });
}

export async function dispatchPersistedPaymentCommand({ actor, prepared, kind, request, repository, provider, normalizeProviderCommand }) {
  const persisted = await repository.getCommandAttempt(actor, prepared.commandId);
  if (!persisted || persisted.commandId !== prepared.commandId || persisted.paymentId !== prepared.paymentId
    || persisted.kind !== kind) throw new Error("The persisted payment action is unavailable.");
  // Original arguments must be read before looking up current bank settings or
  // latest charge. A retry cannot silently replace the reserved transfer source.
  if (persisted.legacyUnknown || persisted.providerCommandId || persisted.status === "reconciled") {
    return recoverPersistedPaymentCommand({ actor, command: persisted, repository, provider });
  }
  let identity = persisted.requestIdentity;
  if (!identity) {
    if (persisted.hasAttemptWindow) return recoverPersistedPaymentCommand({ actor, command: persisted, repository, provider, reason: "original-request-unavailable" });
    if (kind === "transfer") {
      try { request = await provider.prepareCommandAttempt({ ...request, destinationAccountId: prepared.destinationAccountId }); }
      catch { return recoverPersistedPaymentCommand({ actor, command: persisted, repository, provider, reason: "transfer-source-unavailable" }); }
    }
    identity = Object.freeze({ ...request, kind });
  }
  const requestHash = createHash("sha256").update(JSON.stringify(identity, Object.keys(identity).sort())).digest();
  const requestedAt = performance.now();
  const grant = await repository.claimCommandAttempt(actor, prepared.commandId, { requestHash, identity });
  if (grant?.action === "not-sent") {
    return Object.freeze({ commandId: prepared.commandId, paymentId: prepared.paymentId, kind,
      status: "provider-failed", recoveryRequired: false, recoveryReason: "superseded-before-dispatch", signedEventsReplayed: 0 });
  }
  if (canDispatchCommand(grant, requestedAt)) {
    try {
      const result = normalizeProviderCommand(await provider[kind]({ ...grant.requestIdentity, postDeadline: requestedAt + grant.remainingMs }));
      // Await inside this boundary: a lost database write after Stripe accepted
      // the request is just as indeterminate as a lost provider response.
      return await repository.recordCommand(actor, prepared.commandId, result);
    } catch (error) {
      if (error?.code !== "payment-attempt-deadline") {
        return recoverPersistedPaymentCommand({ actor, command: { ...persisted, requestIdentity: identity }, repository, provider,
          reason: "provider-command-outcome-unknown" });
      }
    }
  }
  return recoverPersistedPaymentCommand({ actor, command: { ...persisted,
    requestIdentity: grant?.requestIdentity || identity, providerCommandId: grant?.providerCommandId || persisted.providerCommandId },
    repository, provider, reason: grant?.recoveryReason || null });
}
