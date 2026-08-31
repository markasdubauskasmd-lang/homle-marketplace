// Where a 404 should send the reader, decided from the account alone.
//
// A generic "Go to Homle" is right for a visitor and wrong for everybody who is
// signed in. Measured against the running app, a signed-in administrator who
// mistyped a desk URL was offered the marketing site and a help link to
// /landlord/help — a page that then refuses them, because they hold no Landlord
// workspace. An error page whose only two exits are the wrong site and a second
// error is not a recovery.
//
// Kept separate from `not-found.js` so a test can run the real decision:
// `not-found.js` touches `document` at module load and cannot be imported
// outside a browser.
import { workspaceShell } from "./workspace-shell-model.js";

/**
 * Returns `{ href, label, helpHref }`.
 *
 * `helpHref` is null when there is no support page this reader may actually
 * open. The caller hides the help line rather than linking a dead end.
 */
export function notFoundDestination(account) {
  const shell = workspaceShell(account);
  if (shell.role) {
    return {
      href: shell.home,
      label: `Back to your ${shell.label} workspace`,
      helpHref: shell.role === "cleaner" ? "/cleaner/help-centre" : "/landlord/help"
    };
  }
  const roles = Array.isArray(account?.roles) ? account.roles : [];
  // Staff, with no marketplace workspace of their own.
  if (roles.includes("administrator")) {
    return { href: "/admin", label: "Back to the Administrator desks", helpHref: null };
  }
  // Signed in, but no workspace chosen yet. Onboarding is where the account
  // menu already sends this account, so the 404 agrees with it rather than
  // offering a third answer.
  if (account) {
    return { href: "/onboarding", label: "Continue setting up your account", helpHref: "/landlord/help" };
  }
  return { href: "/", label: "Go to Homle", helpHref: "/landlord/help" };
}
