// What an Administrator must affirm before closing somebody's booking case.
//
// Version 2. Version 1 required the Administrator to confirm that the decision
// performed "no payment or external action", because the case desk genuinely
// could not move money: resolving a case and refunding a customer were two
// screens, and the second one was easy to forget. That is a poor way to run a
// dispute — the decision and the money it implies should not be separated by an
// act of memory — so the case desk can now issue the refund that its own
// decision calls for.
//
// The attestation had to change with it. "This performs no payment action"
// stops being true the moment a refund can be issued here, and an attestation
// that is routinely untrue is worse than none: people learn to tick it. It is
// now the narrower, checkable claim that nothing happened OTHER than what is
// written down — and a refund is only accepted alongside a separate, explicit
// authorisation of that exact amount.
//
// The version string is the mechanism that makes this safe. A client still
// sending v1 is refused rather than silently reinterpreted, so an old page
// cannot resolve a case under a promise that no longer means what it did.
export const caseResponsePolicyVersion = "tideway-case-response-v2";

// Bounded well below any plausible clean. The database is the real authority --
// it refuses a refund larger than the amount captured and not yet refunded --
// but a typo should be caught in front of the customer's money, not behind it.
export const maximumCaseRefundPence = 1_000_000;

function confirmed(value, label) {
  if (value !== true) throw new TypeError(`${label} must be confirmed before resolving a booking case.`);
  return true;
}

/**
 * The refund this resolution issues, or null.
 *
 * Absent and zero are deliberately different things. Absent means the decision
 * moves no money. A supplied amount must be a whole number of pence and must be
 * authorised on its own, so that refunding is never something that happens by
 * leaving a field filled in.
 */
export function caseRefundInstruction(input = {}) {
  const supplied = input.refundAmountPence;
  if (supplied == null || supplied === "") return null;
  // A number, not something that parses as one. `"4500"` and `" 45 "` both
  // survive `Number()`, and a refund amount is the last field in this codebase
  // that should be accepted on the strength of a coercion.
  if (typeof supplied !== "number" || !Number.isInteger(supplied) || supplied < 1 || supplied > maximumCaseRefundPence) {
    throw new TypeError("A case refund must be a whole number of pence within the supported range.");
  }
  const amountPence = supplied;
  confirmed(input.refundAuthorised, `A refund of ${amountPence} pence`);
  return Object.freeze({ amountPence });
}

export function caseResolutionAssurance(input = {}) {
  if (input.policyVersion !== caseResponsePolicyVersion) throw new TypeError("The current booking-case handling standard must be acknowledged before resolving the case.");
  return Object.freeze({
    policyVersion: caseResponsePolicyVersion,
    evidenceReviewed: confirmed(input.evidenceReviewed, "Relevant booking evidence"),
    sensitiveDataMinimised: confirmed(input.sensitiveDataMinimised, "Sensitive-data minimisation"),
    // The replacement for v1's `noExternalActionConfirmed`. Deliberately a new
    // name rather than the old one with a new meaning: a reader of an audit
    // record should be able to tell which promise was actually made.
    noUnrecordedActionConfirmed: confirmed(input.noUnrecordedActionConfirmed, "The boundary that nothing happened beyond what is recorded here"),
    refund: caseRefundInstruction(input)
  });
}
