// The platform's defence against moving a conversation off Homle: a landlord and a
// cleaner must not trade phone numbers, email addresses, links or messaging handles
// through a message body or a public review.
//
// It lives in one module because it was previously two byte-identical copies, one in
// `message-service.mjs` and one in `review-service.mjs`. Tightening a security filter
// in one place and silently leaving the other permissive is the failure this prevents.
const emailPattern = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;
const urlPattern = /(?:https?:\/\/|www\.)/i;
const ukPhonePattern = /(?:^|[^\d])(?:\+?44|0)(?:[\s().-]*\d){9,10}(?:[^\d]|$)/;
const outsideContactPattern = /\b(?:whats?app|telegram|signal|instagram|facebook|snapchat)\b/i;

// Named distinctly from `message-service`'s exported `containsDirectContactDetails`,
// which is a wider check: it round-trips a value through the whole message-body
// validator, so it also answers to length and control-character rules. That contract
// is relied on and is left exactly as it was.
export function hasOffPlatformContact(value) {
  const text = String(value || "");
  if (!text) return false;
  return emailPattern.test(text) || urlPattern.test(text) || ukPhonePattern.test(text) || outsideContactPattern.test(text);
}
