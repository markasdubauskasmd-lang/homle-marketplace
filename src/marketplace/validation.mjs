// Input shapes shared across the marketplace services and repositories.
//
// The UUID pattern was declared identically in 30 modules and the guard below was
// byte-identical in 17 of them. One owner means an id accepted in one service cannot
// be rejected in another.
//
// `uuid` throws TypeError deliberately: `errorResponse` maps TypeError to
// 422 validation-failed, which is the honest answer for a malformed id a caller sent.
// A plain Error would fall through to 500. Two modules keep their own guard on
// purpose — `auth-repository` words its message differently, and
// `administrator-booking-service` validates values coming *back* from the database,
// where a failure is a server fault and must stay a 500.
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

// The exact-origin rule was written out seven times, once per module that accepts an
// application origin from configuration. Six copies were byte-identical and the seventh
// (Apple sign-in) added an HTTPS requirement. Seven copies of a security check is seven
// chances for one of them to drift, and this one decides which origin OAuth redirects and
// sign-in callbacks are allowed to target — the exact place a subtle divergence is worth
// most to an attacker.
//
// What it enforces, and why each clause is there:
//   - `new URL(value)` must parse at all.
//   - `url.origin` must equal the supplied string, so a value carrying a path, query or
//     fragment is rejected rather than silently truncated to its origin.
//   - no username or password, so credentials cannot be smuggled into a redirect target.
//
// The trailing-slash strip is what makes "https://homle.example/" acceptable while
// "https://homle.example/callback" is not: `URL.origin` never includes a trailing slash.
//
// The message is passed in rather than derived, so every call site keeps naming its own
// subject — an operator reading a boot failure learns which setting is wrong.
export function exactOrigin(value, message, { requireHttps = false } = {}) {
  try {
    const url = new URL(value);
    if (requireHttps && url.protocol !== "https:") throw new Error();
    if (url.origin !== String(value).replace(/\/$/, "") || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    throw new TypeError(message);
  }
}
