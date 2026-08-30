/*
 * Points the 404 page's actions at somewhere the reader can actually go.
 *
 * A generic "Go to Homle" is right for a visitor and wrong for a signed-in
 * Landlord who mistyped a workspace URL — they want the workspace, not the
 * marketing site. The account lookup is best-effort: if it fails, or nobody is
 * signed in, the marketing home stays as the answer.
 */

import { readSignedInAccount } from "./account-menu.js?v=20260830-1";
import { workspaceShell } from "./workspace-shell-model.js";

const primary = document.querySelector("[data-not-found-primary]");
const back = document.querySelector("[data-not-found-back]");
const help = document.querySelector("[data-not-found-help]");

// "Go back" is only offered when there is somewhere to go back to. A 404 opened
// from a bookmark or a pasted link has no history entry, and a button that
// silently does nothing is worse than no button.
if (back) {
  if (history.length > 1) back.addEventListener("click", () => history.back());
  else back.hidden = true;
}

try {
  const account = (await readSignedInAccount())?.account || null;
  const shell = workspaceShell(account);
  if (shell.role && primary) {
    primary.href = shell.home;
    primary.textContent = `Back to your ${shell.label} workspace`;
  }
  if (help) help.href = shell.role === "cleaner" ? "/cleaner/help-centre" : "/landlord/help";
} catch {
  // Signed out, or the account service is unavailable. The marketing home the
  // markup already carries is the right destination for both.
}
