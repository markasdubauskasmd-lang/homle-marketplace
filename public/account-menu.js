import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { createRequestJson } from "./request-json.js";

const buttons = [...document.querySelectorAll("[data-account-sign-out]")];
const accountMenus = [...document.querySelectorAll("[data-account-menu]")];
const signInLinks = [...document.querySelectorAll("[data-account-sign-in]")];
const signupMenus = [...document.querySelectorAll("[data-signup-menu]")];
let signedInAccountRequest;

function savedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function saveCsrf(value) {
  try {
    if (value) sessionStorage.setItem("tideway_csrf", value);
    else sessionStorage.removeItem("tideway_csrf");
  } catch {}
}

const requestJson = createRequestJson({ failureMessage: "Account action failed.", timeoutMs: 15_000, timeoutMessage: "Sign out took too long. It may have completed; reload before trying again." });

function workspaceFor(account) {
  const roles = Array.isArray(account?.roles) ? account.roles : [];
  const selectedRole = ["cleaner", "landlord"].includes(account?.selectedRole) && roles.includes(account.selectedRole)
    ? account.selectedRole
    : "";
  return selectedRole
    ? { role: selectedRole, label: selectedRole === "cleaner" ? "Cleaner" : "Landlord", href: `/${selectedRole}/dashboard` }
    : { role: "", label: "Account", href: "/onboarding" };
}

export function readSignedInAccount() {
  if (!signedInAccountRequest) {
    signedInAccountRequest = requestJson("/api/marketplace/account", {}, 10_000).catch((error) => {
      signedInAccountRequest = null;
      throw error;
    });
  }
  return signedInAccountRequest;
}

async function hydrateAccountMenu() {
  if (!accountMenus.length && !signInLinks.length) return;
  try {
    const result = await readSignedInAccount();
    const workspace = workspaceFor(result.account);
    renderAccountAvatar(result.account);
    for (const link of signInLinks) link.hidden = true;
    for (const link of document.querySelectorAll("[data-account-entry]")) link.hidden = true;
    for (const menu of signupMenus) {
      menu.open = false;
      menu.hidden = true;
    }
    for (const node of document.querySelectorAll("[data-account-role]")) node.textContent = workspace.label;
    for (const link of document.querySelectorAll("[data-account-dashboard]")) {
      link.href = workspace.href;
      link.textContent = workspace.role ? `Open ${workspace.label} dashboard` : "Finish account setup";
    }
    document.documentElement.dataset.accountState = "signed-in";
    window.dispatchEvent(new CustomEvent("homle:account-ready", { detail: { account: result.account, workspace } }));
    return result;
  } catch (error) {
    if (error?.status === 401) {
      for (const menu of accountMenus) menu.hidden = true;
      for (const link of signInLinks) link.hidden = false;
      for (const menu of signupMenus) menu.hidden = false;
      document.documentElement.dataset.accountState = "signed-out";
    }
    return null;
  }
}

async function recoverCsrf() {
  const current = savedCsrf();
  if (current) return current;
  const result = await requestJson("/api/marketplace/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!result.csrfToken) throw new Error("Your secure session could not be refreshed.");
  saveCsrf(result.csrfToken);
  return result.csrfToken;
}

function showStatus(button, message) {
  const status = button.closest("[data-account-menu], [data-account-group]")?.querySelector("[data-account-sign-out-status]");
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}

async function signOut(button) {
  if (button.disabled) return;
  if (!navigator.onLine) {
    showStatus(button, "Reconnect before signing out securely.");
    return;
  }
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Signing out…";
  showStatus(button, "");
  try {
    const csrf = await recoverCsrf();
    await requestJson("/api/marketplace/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: "{}"
    });
    saveCsrf("");
    location.assign(button.dataset.signOutDestination || "/login");
  } catch (error) {
    showStatus(button, error?.message || "Homle could not sign you out. Please try again.");
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

/**
 * Binds a sign-out control that was not in the document when this module ran.
 *
 * The list above is taken once, at load. That is correct for the pages whose
 * header is static markup, and wrong for any page whose chrome is rendered —
 * workspace-shell.js builds its account menu after this module has already
 * evaluated, and without this its Sign out button would be a button that does
 * nothing.
 */
export function bindAccountSignOut(button) {
  if (!button || button.dataset.signOutBound === "true") return;
  button.dataset.signOutBound = "true";
  button.addEventListener("click", () => signOut(button));
}

for (const button of buttons) bindAccountSignOut(button);
void hydrateAccountMenu();
