import { createCleanerPage } from "./cleaner-page.js?v=20260729-11";
import { createRequestJson } from "./request-json.js";

const draftKey = "homle-cleaner-personal-details-draft-v1";
const draftLifetimeMs = 8 * 60 * 60 * 1000;
const activePrivacyStatuses = new Set(["requested", "verifying", "processing"]);
const mutationJson = createRequestJson({
  failureMessage: "Your account settings could not be updated.",
  timeoutMs: 30_000
});
let pendingDeletionId = "";

function text(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function showStatus(message, kind = "info") {
  const node = document.querySelector("[data-cleaner-settings-feedback]");
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
  node.hidden = !message;
}

function showDialogStatus(message) {
  const node = document.querySelector("[data-settings-dialog-feedback]");
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function saveCsrf(value) {
  try {
    if (value) sessionStorage.setItem("tideway_csrf", value);
  } catch {}
}

async function recoverCsrf() {
  const existing = storedCsrf();
  if (existing) return existing;
  const result = await mutationJson("/api/marketplace/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!result.csrfToken) throw new Error("Your secure session could not be refreshed. Sign in again.");
  saveCsrf(result.csrfToken);
  return result.csrfToken;
}

function tabDraftMobile() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(draftKey) || "{}");
    if (!parsed || typeof parsed !== "object" || Date.now() - Number(parsed.savedAt || 0) > draftLifetimeMs) return "";
    return String(parsed.fields?.mobileNumber || "").trim().slice(0, 40);
  } catch {
    return "";
  }
}

function activeDeletion(records) {
  return (Array.isArray(records) ? records : []).find((record) =>
    record?.requestType === "deletion" && activePrivacyStatuses.has(record.status)
  );
}

function bindSecurityActions(privacyRecords) {
  const logoutAll = document.querySelector("[data-settings-logout-all]");
  const deactivate = document.querySelector("[data-settings-deactivate]");
  const dialog = document.querySelector("[data-settings-deletion-dialog]");
  const form = document.querySelector("[data-settings-deletion-form]");
  const cancel = document.querySelector("[data-settings-deletion-cancel]");
  const submit = document.querySelector("[data-settings-deletion-submit]");
  let currentDeletion = activeDeletion(privacyRecords);

  if (currentDeletion && deactivate) {
    deactivate.disabled = true;
    deactivate.textContent = "Deactivation requested";
  }

  logoutAll?.addEventListener("click", async () => {
    const confirmed = window.confirm("Sign out this Cleaner account on every device, including this one?");
    if (!confirmed) return;
    logoutAll.disabled = true;
    logoutAll.textContent = "Signing out securely…";
    showStatus("");
    try {
      const csrf = await recoverCsrf();
      await mutationJson("/api/marketplace/auth/logout-all", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: "{}"
      });
      try { sessionStorage.removeItem("tideway_csrf"); } catch {}
      location.assign("/login?intent=work");
    } catch (error) {
      logoutAll.disabled = false;
      logoutAll.textContent = "Sign out of all other devices";
      showStatus(`${error.message} Nothing was changed.`, "error");
    }
  });

  deactivate?.addEventListener("click", () => {
    if (currentDeletion) return;
    form?.reset();
    showDialogStatus("");
    if (typeof dialog?.showModal === "function") dialog.showModal();
    else if (dialog) dialog.hidden = false;
  });

  cancel?.addEventListener("click", () => {
    if (typeof dialog?.close === "function") dialog.close();
    else if (dialog) dialog.hidden = true;
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const requestId = pendingDeletionId || crypto.randomUUID();
    pendingDeletionId = requestId;
    submit.disabled = true;
    cancel.disabled = true;
    submit.textContent = "Sending privately…";
    showDialogStatus("");
    try {
      const csrf = await recoverCsrf();
      const result = await mutationJson("/api/marketplace/privacy-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ requestId, requestType: "deletion" })
      });
      pendingDeletionId = "";
      currentDeletion = result.privacyRequest;
      deactivate.disabled = true;
      deactivate.textContent = "Deactivation requested";
      if (typeof dialog?.close === "function") dialog.close();
      else if (dialog) dialog.hidden = true;
      showStatus("Your deactivation request was received for private identity and account review.", "success");
    } catch (error) {
      showDialogStatus(`${error.message} Nothing was changed.`);
    } finally {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "Send private request";
    }
  });
}

createCleanerPage("cleaner-settings", async ({ account, requestJson }) => {
  text("[data-settings-email]", account.email || "No signed-in email available");

  const mobile = tabDraftMobile();
  text("[data-settings-mobile]", mobile || "Not added");
  text("[data-settings-mobile-state]", mobile ? "Tab draft" : "Not verified");

  const [providerResult, privacyResult] = await Promise.allSettled([
    requestJson("/api/marketplace/auth/provider-links"),
    requestJson("/api/marketplace/privacy-requests")
  ]);

  const passwordAction = document.querySelector("[data-settings-password-action]");
  const connected = providerResult.status === "fulfilled" && Array.isArray(providerResult.value.connected)
    ? providerResult.value.connected
    : [];
  const hasPassword = connected.some((method) => method?.provider === "password" || method === "password");
  if (!hasPassword && passwordAction) {
    passwordAction.href = "/settings";
    passwordAction.textContent = "Manage sign-in methods";
  }

  if (providerResult.status === "rejected" || privacyResult.status === "rejected") {
    showStatus("Some live account settings could not be loaded. Security actions remain protected and will re-check your session.", "error");
  }
  bindSecurityActions(privacyResult.status === "fulfilled" ? privacyResult.value.privacyRequests : []);
});
