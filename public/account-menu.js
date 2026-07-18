const buttons = [...document.querySelectorAll("[data-account-sign-out]")];

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
