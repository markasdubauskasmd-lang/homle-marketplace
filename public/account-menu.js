import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";

const buttons = [...document.querySelectorAll("[data-account-sign-out]")];
const accountMenus = [...document.querySelectorAll("[data-account-menu]")];
const signInLinks = [...document.querySelectorAll("[data-account-sign-in]")];

function savedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function saveCsrf(value) {
  try {
    if (value) sessionStorage.setItem("tideway_csrf", value);
    else sessionStorage.removeItem("tideway_csrf");
  } catch {}
}

async function requestJson(path, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: controller.signal, ...options });
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || "Account action failed."), { status: response.status });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("Sign out took too long. It may have completed; reload before trying again."), { code: "request-timeout" });
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function workspaceFor(account) {
  const roles = Array.isArray(account?.roles) ? account.roles : [];
  const selectedRole = ["cleaner", "landlord"].includes(account?.selectedRole) && roles.includes(account.selectedRole)
    ? account.selectedRole
    : "";
  return selectedRole
    ? { role: selectedRole, label: selectedRole === "cleaner" ? "Cleaner" : "Landlord", href: `/${selectedRole}/dashboard` }
    : { role: "", label: "Account", href: "/onboarding" };
}

async function hydrateAccountMenu() {
  if (!accountMenus.length && !signInLinks.length) return;
  try {
    const result = await requestJson("/api/marketplace/account", {}, 10_000);
    const workspace = workspaceFor(result.account);
    renderAccountAvatar(result.account);
    for (const link of signInLinks) link.hidden = true;
    for (const link of document.querySelectorAll("[data-account-entry]")) link.hidden = true;
    for (const node of document.querySelectorAll("[data-account-role]")) node.textContent = workspace.label;
    for (const link of document.querySelectorAll("[data-account-dashboard]")) {
      link.href = workspace.href;
      link.textContent = workspace.role ? `Open ${workspace.label} dashboard` : "Finish account setup";
    }
    document.documentElement.dataset.accountState = "signed-in";
    window.dispatchEvent(new CustomEvent("homle:account-ready", { detail: { account: result.account, workspace } }));
  } catch (error) {
    if (error?.status === 401) {
      for (const menu of accountMenus) menu.hidden = true;
      for (const link of signInLinks) link.hidden = false;
      document.documentElement.dataset.accountState = "signed-out";
    }
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
  const status = button.closest("[data-account-menu]")?.querySelector("[data-account-sign-out-status]");
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

for (const button of buttons) button.addEventListener("click", () => signOut(button));
void hydrateAccountMenu();
