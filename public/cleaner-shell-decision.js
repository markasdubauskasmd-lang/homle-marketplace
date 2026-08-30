// Whether a page may show the Cleaner sidebar, as a pure decision.
//
// The sidebar states an identity — a "CLEANER" pill, five Cleaner destinations,
// an Account group and an unread count — so getting this wrong tells somebody
// their account is something it is not. It has been wrong twice: once as static
// markup in nineteen files, and once as a renderer that trusted a per-tab
// marker instead of asking.
//
// It lives here, separate from the renderer, so a test can run the real
// decision rather than a reimplementation of it. `cleaner-sidebar.js` touches
// `document` at module load and cannot be imported outside a browser, and a
// test that copies the logic proves only that the copy is self-consistent.
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";

/**
 * Three answers, not two. The middle one is the one that keeps getting missed.
 *
 *   "reveal" — this account holds a Cleaner workspace.
 *   "remove" — it does not, and the sidebar must leave the DOM entirely rather
 *              than merely hide, so nothing reads it out to assistive
 *              technology and no later script can reveal it.
 *   "leave"  — we do not know. A network error, a 5xx or an unreadable body is
 *              not a verdict in either direction. Removing on one would strand
 *              a real Cleaner with no navigation, because revealing cannot put
 *              back a node that was removed.
 *
 * `result` is what the account read produced:
 *   { failed: true }                  the request threw
 *   { status, account }               it answered
 *   { status, malformed: true }       it answered with a body we could not read
 */
export function cleanerShellVerdict(result) {
  if (!result || result.failed === true) return "leave";
  // 401 and 403 are answers: this reader does not have the workspace here.
  if (result.status === 401 || result.status === 403) return "remove";
  if (!(result.status >= 200 && result.status < 300)) return "leave";
  if (result.malformed === true) return "leave";
  return dashboardWorkspaceAccess(result.account, "cleaner").ready ? "reveal" : "remove";
}
