export const caseResponsePolicyVersion = "tideway-case-response-v1";

function confirmed(value, label) {
  if (value !== true) throw new TypeError(`${label} must be confirmed before resolving a booking case.`);
  return true;
}

export function caseResolutionAssurance(input = {}) {
  if (input.policyVersion !== caseResponsePolicyVersion) throw new TypeError("The current booking-case handling standard must be acknowledged before resolving the case.");
  return Object.freeze({
    policyVersion: caseResponsePolicyVersion,
    evidenceReviewed: confirmed(input.evidenceReviewed, "Relevant booking evidence"),
    sensitiveDataMinimised: confirmed(input.sensitiveDataMinimised, "Sensitive-data minimisation"),
    noExternalActionConfirmed: confirmed(input.noExternalActionConfirmed, "The no-payment and no-external-action boundary")
  });
}
