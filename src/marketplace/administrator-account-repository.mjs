const mapped = Object.freeze({
  "administrator-required": [403, "administrator-required", "A Homle Administrator account is required."],
  "invalid-account-status": [422, "invalid-account-status", "Choose whether the account is active or suspended."],
  "invalid-account-identifier": [422, "invalid-account-identifier", "Search by the account's exact email address or id."],
  "account-status-reason-required": [422, "account-status-reason-required", "Record why this account is being suspended or restored."],
  "account-not-found": [404, "account-not-found", "No account matches that email address or id."],
  "account-status-not-changeable": [409, "account-status-not-changeable", "This account is already being deleted and cannot be changed here."],
  "cannot-suspend-self": [409, "cannot-suspend-self", "You cannot suspend your own Administrator account."],
  "last-administrator-protected": [409, "last-administrator-protected", "This is the last active Administrator account and cannot be suspended."]
});

function mapError(error) {
  const selected = mapped[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

/**
 * Database boundary for Administrator account control.
 *
 * Every guard that makes suspension safe -- the recorded reason, the refusal to
 * suspend yourself or the last Administrator, the session revocation, the audit
 * row -- lives in the database function, not here. This module only carries the
 * call, so there is no second place for those rules to drift to.
 */
export function createAdministratorAccountRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    find(actor, identifier) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.find_account_for_administrator($1::text) AS result", [identifier]);
          return result.rows[0]?.result;
        } catch (error) { throw mapError(error); }
      });
    },
    setStatus(actor, input) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.set_account_status_as_administrator($1::uuid,$2::text,$3::text) AS result",
            [input.accountId, input.accountStatus, input.reason]
          );
          return result.rows[0]?.result;
        } catch (error) { throw mapError(error); }
      });
    }
  });
}
