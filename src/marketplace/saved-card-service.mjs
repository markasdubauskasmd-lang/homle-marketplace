import { createHash, randomUUID } from "node:crypto";
import { uuid } from "./validation.mjs";

/**
 * Pay at booking for a clean more than five days away (PROGRESS M4).
 *
 * The customer saves a card when they book; the platform authorizes the frozen
 * total with it once the payment window opens. Off by default
 * (SAVED_CARD_AUTHORIZATION_ENABLED), Stripe test mode only, like every other
 * payment path here.
 *
 * The authorization itself is an ordinary ledger payment: it is recorded with
 * the same `recordAuthorization` the Landlord's own payment uses, and every
 * later step (webhooks, capture, refund, transfer) is the existing one.
 */

export function savedCardAuthorizationEnabled(env = process.env) {
  return String(env.SAVED_CARD_AUTHORIZATION_ENABLED || "").trim().toLowerCase() === "true";
}

function requireRole(actor, ...roles) {
  if (!actor?.userId || !Array.isArray(actor.roles) || !roles.some((role) => actor.roles.includes(role))) {
    throw Object.assign(new Error("This account cannot use saved cards for this booking."), { statusCode: 403, code: "saved-card-role-required" });
  }
}

const cardStatuses = new Set(["creating", "requires-customer-action", "saved", "failed", "authorizing", "action-required", "authorized", "withdrawn"]);

function publicCard(record, clientSecret = null) {
  if (!record) return null;
  if (!cardStatuses.has(record.status) || !Number.isInteger(record.amountPence) || record.currency !== "gbp") throw new Error("The saved card record is invalid.");
  return Object.freeze({
    bookingId: uuid(record.bookingId, "booking id"),
    status: record.status,
    amountPence: record.amountPence,
    currency: "gbp",
    consentedAt: record.consentedAt,
    requiresCustomerAction: record.status === "requires-customer-action",
    clientSecret: record.status === "requires-customer-action" && typeof clientSecret === "string" && clientSecret.length <= 512 ? clientSecret : null
  });
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest();
}

export function createSavedCardService({ repository, paymentRepository, provider, createId = randomUUID, onUnexpectedError = () => {} }) {
  for (const method of ["begin", "record", "get", "withdraw", "listDue", "beginAuthorization", "recordAuthorization"]) {
    if (typeof repository?.[method] !== "function") throw new TypeError("A complete saved-card repository is required.");
  }
  if (typeof paymentRepository?.recordAuthorization !== "function") throw new TypeError("The payment ledger repository is required.");
  for (const method of ["createSavedCardSetup", "retrieveSavedCardSetup", "detachSavedCard", "createSavedCardAuthorization", "retrieveAuthorization"]) {
    if (typeof provider?.[method] !== "function") throw new TypeError("The payment provider cannot save cards.");
  }

  async function refreshFromProvider(actor, bookingId, card) {
    const result = await provider.retrieveSavedCardSetup({ bookingId, setupId: card.providerSetupId, customerId: card.providerCustomerId });
    const recorded = await repository.record(actor, bookingId, result);
    return publicCard(recorded, result.clientSecret);
  }

  return Object.freeze({
    async get(actor, bookingId) {
      requireRole(actor, "landlord", "administrator");
      return publicCard(await repository.get(actor, uuid(bookingId, "booking id")));
    },

    // Consent is explicit: the customer is agreeing that Homle may place a
    // hold for this exact total on this card without them present.
    async begin(actor, input = {}) {
      requireRole(actor, "landlord");
      const bookingId = uuid(input.bookingId, "booking id");
      if (input.consent !== true) {
        throw Object.assign(new Error("Confirm that Homle may place a hold for this booking's total on the saved card when the payment window opens."), { statusCode: 422, code: "saved-card-consent-required" });
      }
      const card = await repository.begin(actor, bookingId);
      if (["saved", "authorizing", "action-required", "authorized"].includes(card.status)) return publicCard(card);
      if (card.providerSetupId) return refreshFromProvider(actor, bookingId, card);
      // One provider setup per consent. A retried request repeats the same
      // idempotency keys, so it cannot create a second Customer or setup.
      const attempt = createHash("sha256").update(String(card.consentedAt)).digest("hex").slice(0, 16);
      const result = await provider.createSavedCardSetup({
        bookingId,
        landlordHash: createHash("sha256").update(actor.userId).digest("hex"),
        idempotencyKey: `tideway_saved_card_${bookingId}_${attempt}`
      });
      const recorded = await repository.record(actor, bookingId, result);
      return publicCard(recorded, result.clientSecret);
    },

    // After the browser finishes the setup, the server reads the outcome back
    // from the provider. The browser's report is a prompt to look, not proof.
    async confirm(actor, input = {}) {
      requireRole(actor, "landlord");
      const bookingId = uuid(input.bookingId, "booking id");
      const card = await repository.get(actor, bookingId);
      if (!card || !card.providerSetupId) throw Object.assign(new Error("No card setup has been started for this booking."), { statusCode: 404, code: "saved-card-not-found" });
      if (!["creating", "requires-customer-action", "saved"].includes(card.status)) return publicCard(card);
      return refreshFromProvider(actor, bookingId, card);
    },

    async withdraw(actor, input = {}) {
      requireRole(actor, "landlord");
      const bookingId = uuid(input.bookingId, "booking id");
      const result = await repository.withdraw(actor, bookingId);
      if (result?.detachPaymentMethodId) {
        // The withdrawal already stands: the card can no longer be used by
        // Homle. Removing it from the provider is hygiene, so a failure is
        // reported rather than undoing the customer's decision.
        try { await provider.detachSavedCard({ paymentMethodId: result.detachPaymentMethodId }); }
        catch (error) { onUnexpectedError(Object.assign(new Error("A withdrawn saved card could not be removed at the provider."), { code: "saved-card-detach-failed", cause: error })); }
      }
      const { detachPaymentMethodId, ...card } = result;
      return publicCard(card);
    },

    // Platform only, inside the payment window, for the consented total.
    async authorizeDue(actor, bookingId) {
      requireRole(actor, "administrator");
      const selected = uuid(bookingId, "booking id");
      const prepared = await repository.beginAuthorization(actor, {
        bookingId: selected,
        paymentId: uuid(createId(), "generated payment id"),
        idempotencyKeyHash: sha256(`saved-card-authorization:${selected}`)
      });
      const request = {
        idempotencyKey: `tideway_payment_${prepared.paymentId}`,
        paymentId: prepared.paymentId,
        bookingId: prepared.bookingId,
        amountPence: prepared.amountPence,
        currency: prepared.currency,
        transferGroup: `tideway_booking_${prepared.bookingId}`,
        customerId: prepared.providerCustomerId,
        paymentMethodId: prepared.providerPaymentMethodId
      };
      const result = prepared.providerPaymentId
        ? await provider.retrieveAuthorization({ providerPaymentId: prepared.providerPaymentId })
        : await provider.createSavedCardAuthorization(request);
      if (!result || result.amountPence !== prepared.amountPence || result.currency !== prepared.currency
        || !["requires-customer-action", "processing", "authorized", "failed"].includes(result.status)) {
        throw new TypeError("The payment provider returned an invalid saved-card authorization.");
      }
      await paymentRepository.recordAuthorization(actor, prepared.paymentId, { providerPaymentId: result.id, status: result.status });
      await repository.recordAuthorization(actor, selected, result.status);
      return Object.freeze({ bookingId: selected, paymentId: prepared.paymentId, status: result.status });
    },

    listDue(actor, limit) {
      requireRole(actor, "administrator");
      return repository.listDue(actor, limit);
    }
  });
}

/**
 * Authorize every saved card whose payment window has opened. Runs in the web
 * process as the verified platform Administrator, behind the same gate as
 * settlement. One failure never stops the batch; a booking that fails stays
 * due and is retried under the same payment id.
 */
export function createSavedCardAuthorizationWorker({ savedCards, actor, batchLimit = 50, isPaused = () => false, onUnexpectedError = () => {} }) {
  if (typeof savedCards?.authorizeDue !== "function" || typeof savedCards?.listDue !== "function") throw new TypeError("The saved-card service is required.");
  if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("administrator")) throw new TypeError("Saved-card authorization requires a platform administrator actor.");
  return Object.freeze({
    async runOnce() {
      const outcome = { due: 0, authorized: 0, actionRequired: 0, failed: 0, paused: false };
      if (isPaused()) return Object.freeze({ ...outcome, paused: true });
      const due = await savedCards.listDue(actor, batchLimit);
      outcome.due = due.length;
      for (const bookingId of due) {
        try {
          const result = await savedCards.authorizeDue(actor, bookingId);
          if (result.status === "authorized" || result.status === "processing") outcome.authorized += 1;
          else outcome.actionRequired += 1;
        } catch (error) {
          outcome.failed += 1;
          onUnexpectedError(error);
        }
      }
      return Object.freeze(outcome);
    }
  });
}
