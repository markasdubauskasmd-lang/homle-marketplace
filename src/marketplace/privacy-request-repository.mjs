import { AccountHttpError } from "./account-security.mjs";

// Built as AccountHttpError rather than a bare Error carrying a statusCode:
// `errorResponse` recognises the class by type, so a 401 here is answered as a 401.
// A plain Error with `statusCode: 401` was falling past the echoed-status whitelist
// and reaching the caller as a generic 500 — a signed-out person managing their own
// data was told the server had broken instead of being asked to sign in.
function mapPrivacyRequestError(error) {
  const errors = {
    "not-authenticated": [401, "not-authenticated", "Sign in before managing your Homle data."],
    "account-not-active": [403, "account-not-active", "This account cannot create a new privacy request."],
    "invalid-privacy-request": [422, "invalid-privacy-request", "Choose a valid account privacy request."],
    "privacy-request-id-reused": [409, "privacy-request-id-reused", "This privacy request could not be safely retried."],
    "administrator-required": [403, "administrator-required", "An Administrator account is required to manage data-protection requests."],
    "invalid-privacy-view": [422, "invalid-privacy-view", "Choose a valid data-protection queue view."],
    "invalid-privacy-page": [422, "invalid-privacy-page", "That data-protection queue page is outside the supported range."],
    "invalid-privacy-status": [422, "invalid-privacy-status", "Choose a valid data-protection request status."],
    "privacy-rejection-reason-required": [422, "privacy-rejection-reason-required", "Record why this data-protection request is being refused."],
    "privacy-request-not-found": [404, "privacy-request-not-found", "That data-protection request was not found."],
    "privacy-request-already-closed": [409, "privacy-request-already-closed", "That data-protection request is already closed. Reopening it would restart a statutory clock that has been answered."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new AccountHttpError(selected[0], selected[1], selected[2]), { cause: error }) : error;
}

export function createPrivacyRequestRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  async function privateCall(actor, queryText, values = []) {
    return database.withUserTransaction(actor, async (client) => {
      try { return (await client.query(queryText, values)).rows[0]?.result; }
      catch (error) { throw mapPrivacyRequestError(error); }
    });
  }
  return Object.freeze({
    list(actor) {
      return privateCall(actor, "SELECT tideway_private.get_my_privacy_requests() AS result");
    },
    request(actor, input) {
      return privateCall(actor, "SELECT tideway_private.request_my_privacy_action($1::uuid,$2::text) AS result", [input.requestId, input.requestType]);
    },
    listForAdministrator(actor, input) {
      return privateCall(actor, "SELECT tideway_private.list_privacy_requests_for_administrator($1::text,$2::integer,$3::integer) AS result", [input.view, input.limit, input.offset]);
    },
    recordProgress(actor, input) {
      return privateCall(actor, "SELECT tideway_private.record_privacy_request_progress($1::uuid,$2::text,$3::text) AS result", [input.requestId, input.status, input.note]);
    }
  });
}
