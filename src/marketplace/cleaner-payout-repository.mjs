function mapPayoutError(error) {
  const errors = {
    "cleaner-required": [403, "cleaner-required", "A Cleaner account is required to manage payouts."],
    "cleaner-account-unavailable": [403, "cleaner-account-unavailable", "Complete Cleaner onboarding before setting up payouts."],
    "invalid-payout-onboarding": [422, "invalid-payout-onboarding", "The payout setup request was invalid."],
    "payout-onboarding-id-reused": [409, "payout-onboarding-id-reused", "Payout setup could not be safely retried."],
    "payout-onboarding-not-found": [409, "payout-onboarding-not-found", "Start payout setup again from your Cleaner account."],
    "payout-account-conflict": [409, "payout-account-conflict", "This payout account cannot be connected to this Cleaner account."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createCleanerPayoutRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  async function call(actor, queryText, values = []) {
    return database.withUserTransaction(actor, async (client) => {
      try { return (await client.query(queryText, values)).rows[0]?.result ?? null; }
      catch (error) { throw mapPayoutError(error); }
    });
  }
  return Object.freeze({
    get(actor) {
      return call(actor, "SELECT tideway_private.get_my_cleaner_payout_onboarding() AS result");
    },
    begin(actor, requestId) {
      return call(actor, "SELECT tideway_private.begin_my_cleaner_payout_onboarding($1::uuid) AS result", [requestId]);
    },
    attach(actor, requestId, destinationAccountId) {
      return call(actor, "SELECT tideway_private.attach_my_cleaner_payout_account($1::uuid,$2::text) AS result", [requestId, destinationAccountId]);
    },
    sync(actor, destinationAccountId, status) {
      return call(actor, "SELECT tideway_private.sync_my_cleaner_payout_account($1::text,$2::boolean,$3::boolean,$4::boolean) AS result", [destinationAccountId, status.chargesEnabled, status.payoutsEnabled, status.detailsSubmitted]);
    }
  });
}
