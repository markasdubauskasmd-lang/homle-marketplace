// Whether a page may show the Administrator navigation, as a pure decision.
//
// The strip names all eleven internal operator desks and states an identity —
// "Administrator account" — so getting it wrong tells somebody their account is
// something it is not, and hands them a map of the back office.
//
// It lives here, separate from the renderer, so a test can run the real
// decision rather than a reimplementation of it. `admin-navigation.js` touches
// `document` at module load and cannot be imported outside a browser, and a
// test that copies the logic proves only that the copy is self-consistent.

/**
 * Three answers, not two, for the same reason the Cleaner shell needs three:
 *
 *   "reveal" — this account holds the Administrator role.
 *   "remove" — it does not, so the strip leaves the DOM rather than merely
 *              hiding, and nothing reads eleven internal desk names out to
 *              assistive technology.
 *   "leave"  — we do not know. A network error, a 5xx or an unreadable body is
 *              not a verdict in either direction, and the strip stays hidden.
 *
 * `result` is what the account read produced:
 *   { failed: true }              the request threw
 *   { status, account }           it answered
 *   { status, malformed: true }   it answered with a body we could not read
 */
export function adminNavigationVerdict(result) {
  if (!result || result.failed === true) return "leave";
  // 401 and 403 are answers: this reader is not an administrator here.
  if (result.status === 401 || result.status === 403) return "remove";
  if (!(result.status >= 200 && result.status < 300)) return "leave";
  if (result.malformed === true) return "leave";
  return Array.isArray(result.account?.roles) && result.account.roles.includes("administrator") ? "reveal" : "remove";
}
