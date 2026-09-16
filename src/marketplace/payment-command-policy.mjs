// A deployment fence for settlement commands only. Authorizations, signed
// webhooks and Cleaner payout onboarding keep their existing configuration.
export function paymentCommandWritesPaused(env = {}) {
  const value = String(env.PAYMENT_COMMAND_WRITES_PAUSED ?? "false").trim().toLowerCase();
  if (!["true", "false"].includes(value)) throw new TypeError("PAYMENT_COMMAND_WRITES_PAUSED must be true or false.");
  return value === "true";
}
