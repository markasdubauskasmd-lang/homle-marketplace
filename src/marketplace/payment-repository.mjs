const mappedErrors = Object.freeze({
  "booking-not-found": [404, "booking-not-found", "The booking was not found."],
  "payment-not-found": [404, "payment-not-found", "The payment was not found."],
  "payment-command-not-found": [404, "payment-command-not-found", "The payment action was not found."],
  "booking-not-authorizable": [409, "booking-not-authorizable", "This booking is not ready for a new payment authorization."],
  "booking-payment-exists": [409, "booking-payment-exists", "This booking already has a payment authorization."],
  "payment-idempotency-conflict": [409, "payment-idempotency-conflict", "This payment retry key belongs to another request."],
  "payment-command-idempotency-conflict": [409, "payment-command-idempotency-conflict", "This payment-action retry key belongs to another request."],
  "provider-payment-conflict": [409, "provider-payment-conflict", "The payment provider reference does not match the existing authorization."],
  "provider-command-conflict": [409, "provider-command-conflict", "The provider action does not match the existing payment action."],
  "payment-state-conflict": [409, "payment-state-conflict", "The payment state changed before this action completed."],
  "payment-provider-missing": [409, "payment-provider-missing", "The payment provider authorization is not ready."],
  "payment-not-capturable": [409, "payment-not-capturable", "Payment can be captured only after the completed booking is authorized."],
  "payment-not-cancellable": [409, "payment-not-cancellable", "This payment authorization can no longer be cancelled through this action."],
  "payment-not-refundable": [409, "payment-not-refundable", "The requested refund is not available for this payment."],
  "payment-not-transferable": [409, "payment-not-transferable", "Cleaner funds are not ready for transfer."],
  "cleaner-payout-unavailable": [409, "cleaner-payout-unavailable", "The Cleaner does not have an approved payout destination."],
  "administrator-required": [403, "administrator-required", "Administrator approval is required for this payment action."],
  "landlord-required": [403, "landlord-required", "A Landlord account is required for this payment action."],
  "payment-role-required": [403, "payment-role-required", "You are not allowed to perform this payment action."]
});

function mapError(error) {
  const selected = mappedErrors[error?.message];
  if (!selected) return error;
  return Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error });
}

function paymentRecord(row) {
  if (!row) return null;
  return Object.freeze({
    paymentId: row.id,
    bookingId: row.booking_id,
    status: row.status,
    amountPence: Number(row.amount_pence),
    currency: row.currency,
    amountCapturedPence: Number(row.amount_captured_pence || 0),
    amountRefundedPence: Number(row.amount_refunded_pence || 0),
    providerPaymentId: row.provider_payment_id || null
  });
}

function commandRecord(row) {
  if (!row) return null;
  return Object.freeze({
    commandId: row.command_id,
    paymentId: row.payment_id,
    bookingId: row.booking_id,
    kind: row.kind,
    status: row.status,
    amountPence: Number(row.amount_pence),
    currency: row.currency,
    providerPaymentId: row.provider_payment_id,
    providerCommandId: row.provider_command_id || null,
    destinationAccountId: row.destination_account_id || null
  });
}

function recordedCommand(row) {
  if (!row) return null;
  return Object.freeze({ commandId: row.command_id, paymentId: row.payment_id, kind: row.kind, status: row.status });
}

export function createPaymentRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function" || typeof database.withAuthenticationTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    beginAuthorization(actor, input) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT (tideway_private.begin_booking_payment_authorization($1::uuid,$2::uuid,$3::text,$4::bytea)).*", [input.paymentId, input.bookingId, input.provider, input.idempotencyKeyHash]);
          return paymentRecord(result.rows[0]);
        } catch (error) { throw mapError(error); }
      });
    },
    recordAuthorization(actor, paymentId, input) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT (tideway_private.record_booking_payment_authorization($1::uuid,$2::text,$3::text)).*", [paymentId, input.providerPaymentId, input.status]);
          return paymentRecord(result.rows[0]);
        } catch (error) { throw mapError(error); }
      });
    },
    beginCommand(actor, input) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT * FROM tideway_private.begin_booking_payment_command($1::uuid,$2::uuid,$3::text,$4::integer,$5::bytea)", [input.commandId, input.paymentId, input.kind, input.amountPence, input.idempotencyKeyHash]);
          return commandRecord(result.rows[0]);
        } catch (error) { throw mapError(error); }
      });
    },
    recordCommand(actor, commandId, input) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT * FROM tideway_private.record_booking_payment_command($1::uuid,$2::text,$3::text)", [commandId, input.providerCommandId, input.status]);
          return recordedCommand(result.rows[0]);
        } catch (error) { throw mapError(error); }
      });
    },
    reconcileEvent(input) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query(
          "SELECT tideway_private.reconcile_payment_provider_event($1::text,$2::text,$3::text,$4::text,$5::uuid,$6::uuid,$7::integer,$8::character(3),$9::timestamptz,$10::character(64)) AS result",
          [input.provider, input.providerEventId, input.kind, input.providerObjectId, input.paymentId, input.commandId, input.amountPence, input.currency, input.occurredAt, input.payloadHash]
        );
        return Object.freeze(result.rows[0]?.result || { accepted: false, duplicate: false });
      });
    }
  });
}
