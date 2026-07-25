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
