const stateTitle = document.querySelector("[data-settings-title]");
const stateCopy = document.querySelector("[data-settings-copy]");
const feedback = document.querySelector("[data-settings-feedback]");
const content = document.querySelector("[data-settings-content]");
const providerList = document.querySelector("[data-provider-list]");
const providerActions = document.querySelector("[data-provider-actions]");
const actionCopy = document.querySelector("[data-provider-action-copy]");
const connectButtons = [...document.querySelectorAll("[data-connect-provider]")];
const stepUpActions = document.querySelector("[data-step-up-actions]");
const stepUpButtons = [...document.querySelectorAll("[data-step-up-provider]")];
const dialog = document.querySelector("[data-link-dialog]");
const form = document.querySelector("[data-link-form]");
const dialogTitle = document.querySelector("[data-link-title]");
const dialogCopy = document.querySelector("[data-link-copy]");
const dialogFeedback = document.querySelector("[data-link-feedback]");
const passwordField = document.querySelector("[data-password-field]");
const passwordInput = form.elements.password;
const cancel = document.querySelector("[data-link-cancel]");
const submit = document.querySelector("[data-link-submit]");
const privacyContent = document.querySelector("[data-privacy-content]");
const privacyFeedback = document.querySelector("[data-privacy-feedback]");
const privacyHistory = document.querySelector("[data-privacy-history]");
const privacyList = document.querySelector("[data-privacy-list]");
const privacyButtons = [...document.querySelectorAll("[data-privacy-action]")];
const privacyDialog = document.querySelector("[data-privacy-dialog]");
const privacyForm = document.querySelector("[data-privacy-form]");
const privacyDialogTitle = document.querySelector("[data-privacy-dialog-title]");
const privacyDialogCopy = document.querySelector("[data-privacy-dialog-copy]");
const privacyDialogFeedback = document.querySelector("[data-privacy-dialog-feedback]");
const deletionConfirmation = document.querySelector("[data-deletion-confirmation]");
const deletionCheckbox = privacyForm.elements.confirmDeletion;
const privacyCancel = document.querySelector("[data-privacy-cancel]");
const privacySubmit = document.querySelector("[data-privacy-submit]");
const providerLabels = Object.freeze({ password: "Email and password", google: "Google", facebook: "Facebook" });
let selectedProvider = "";
let selectedAction = "";
let passwordStepUpAvailable = false;
let recentStepUpProvider = "";
let privacyRecords = [];
let selectedPrivacyType = "";
const pendingPrivacyIds = new Map();

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());
const fragment = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, "", `${location.pathname}${location.search}`);

function showFeedback(target, message, kind = "error") {
  target.textContent = message;
  target.dataset.kind = kind;
  target.hidden = !message;
}

function csrfToken() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || "Account settings could not be updated."), { status: response.status, code: result.code || "" });
  return result;
}

function safeProviderLocation(value, provider) {
  let url;
  try { url = new URL(value); } catch { throw new Error("The provider returned an unsafe connection address."); }
  const google = provider === "google" && url.origin === "https://accounts.google.com" && url.pathname === "/o/oauth2/v2/auth";
  const facebook = provider === "facebook" && url.origin === "https://www.facebook.com" && /^\/v\d{1,2}\.\d{1,2}\/dialog\/oauth$/.test(url.pathname);
  const callback = `${location.origin}/api/marketplace/auth/${provider}/callback`;
  if ((!google && !facebook) || url.searchParams.get("redirect_uri") !== callback || url.searchParams.get("response_type") !== "code" || !url.searchParams.get("state")) throw new Error("The provider returned an unsafe connection address.");
  return url.toString();
}

function privacyLabel(type) {
  return type === "deletion" ? "Account deletion" : "Data export";
}

function privacyStatus(status) {
  return ({ requested: "Received", verifying: "Verifying identity", processing: "In progress", completed: "Completed", rejected: "Closed after review" })[status] || "Under review";
}

function renderPrivacyRequests() {
  const activeTypes = new Set(privacyRecords.filter((record) => ["requested", "verifying", "processing"].includes(record.status)).map((record) => record.requestType));
  for (const button of privacyButtons) {
    const active = activeTypes.has(button.dataset.privacyAction);
    button.disabled = active;
    button.textContent = active ? `${privacyLabel(button.dataset.privacyAction)} requested` : button.dataset.privacyAction === "deletion" ? "Request account deletion" : "Request my data";
  }
  privacyList.replaceChildren(...privacyRecords.map((record) => {
    const item = document.createElement("li");
    const detail = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = privacyLabel(record.requestType);
    const small = document.createElement("small");
    small.textContent = `Requested ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(record.createdAt))}`;
    const status = document.createElement("span");
    status.className = `settings-privacy-status settings-privacy-status-${record.status}`;
    status.textContent = privacyStatus(record.status);
    detail.append(strong, small);
    item.append(detail, status);
    return item;
  }));
  privacyHistory.hidden = privacyRecords.length === 0;
}

function openPrivacyDialog(type) {
  selectedPrivacyType = type;
  privacyForm.reset();
  showFeedback(privacyDialogFeedback, "");
  const deletion = type === "deletion";
  privacyDialogTitle.textContent = deletion ? "Request account deletion" : "Request my data";
  privacyDialogCopy.textContent = deletion
    ? "Tideway will verify your identity and review active obligations before any account data can be removed."
    : "Tideway will verify your identity and prepare a secure copy of the account data it holds about you.";
  deletionConfirmation.hidden = !deletion;
  deletionCheckbox.required = deletion;
  privacyDialog.showModal();
  (deletion ? deletionCheckbox : privacySubmit).focus();
}

function openDialog(action, provider) {
  selectedAction = action;
  selectedProvider = provider;
  form.reset();
  showFeedback(dialogFeedback, "");
  const label = providerLabels[provider];
  const removal = action === "remove";
  dialogTitle.textContent = `${removal ? "Remove" : "Connect"} ${label}`;
  dialogCopy.textContent = removal
    ? `${label} will stop working for sign-in and all Tideway sessions will be signed out. Your profile and bookings will remain.`
    : `${label} will ask you to approve another secure way to sign in. Your role, profile and bookings will not change.`;
  passwordField.hidden = !passwordStepUpAvailable;
  passwordInput.required = passwordStepUpAvailable;
  submit.textContent = removal ? "Remove and sign out" : "Continue securely";
  dialog.showModal();
  (passwordStepUpAvailable ? passwordInput : submit).focus();
}

function renderIdentity(identity, removalAllowed) {
  const item = document.createElement("li");
  const mark = document.createElement("span");
  mark.className = "settings-provider-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "✓";
  const detail = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = providerLabels[identity.provider] || "Connected method";
  const small = document.createElement("small");
  small.textContent = identity.connectedAt ? `Connected ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(identity.connectedAt))}` : "Connected";
  detail.append(strong, small);
  item.append(mark, detail);
  if (removalAllowed) {
    const button = document.createElement("button");
    button.className = "button button-text settings-remove-provider";
    button.type = "button";
    button.textContent = `Remove ${providerLabels[identity.provider]}`;
    button.addEventListener("click", () => openDialog("remove", identity.provider));
    item.append(button);
  }
  return item;
}

async function startStepUp(provider) {
  const csrf = csrfToken();
  if (!csrf) return showFeedback(feedback, "Your security token is missing. Sign in again before changing account methods.");
  for (const button of stepUpButtons) button.disabled = true;
  try {
    const result = await requestJson(`/api/marketplace/auth/provider-links/${provider}/step-up/start`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" });
    location.assign(safeProviderLocation(result.location, provider));
  } catch (error) {
    showFeedback(feedback, error.message);
    for (const button of stepUpButtons) button.disabled = false;
  }
}

async function load() {
  const resultMessage = fragment.get("provider") || "";
  if (resultMessage.endsWith("-connected")) showFeedback(feedback, `${providerLabels[resultMessage.split("-", 1)[0]] || "Provider"} was connected successfully.`, "success");
  else if (resultMessage.endsWith("-verified")) showFeedback(feedback, `${providerLabels[resultMessage.split("-", 1)[0]] || "Provider"} confirmed it is you. You can now change another method for ten minutes.`, "success");
  else if (resultMessage) showFeedback(feedback, resultMessage === "rate-limited" ? "Too many attempts. Wait before trying again." : "The provider security check was not completed. Your existing sign-in methods were not changed.");
  try {
    const [result, privacyResult] = await Promise.all([
      requestJson("/api/marketplace/auth/provider-links"),
      requestJson("/api/marketplace/privacy-requests")
    ]);
    const connected = new Set(result.connected.map((item) => item.provider));
    passwordStepUpAvailable = connected.has("password");
    recentStepUpProvider = connected.has(result.recentStepUp?.provider) ? result.recentStepUp.provider : "";
    const methodCount = connected.size;
    providerList.replaceChildren(...result.connected.map((identity) => {
      const social = identity.provider === "google" || identity.provider === "facebook";
      const removalAllowed = social && methodCount > 1 && (passwordStepUpAvailable || (recentStepUpProvider && recentStepUpProvider !== identity.provider));
      return renderIdentity(identity, removalAllowed);
    }));

    let connectable = 0;
    for (const button of connectButtons) {
      const provider = button.dataset.connectProvider;
      button.hidden = !(passwordStepUpAvailable || recentStepUpProvider) || result.available?.[provider] !== true || connected.has(provider);
      if (!button.hidden) connectable += 1;
    }
    let verifiable = 0;
    for (const button of stepUpButtons) {
      const provider = button.dataset.stepUpProvider;
      button.hidden = passwordStepUpAvailable || Boolean(recentStepUpProvider) || result.available?.[provider] !== true || !connected.has(provider);
      if (!button.hidden) verifiable += 1;
    }
    stepUpActions.hidden = verifiable === 0;
    providerActions.hidden = connectable === 0 && verifiable === 0;
    actionCopy.textContent = passwordStepUpAvailable
      ? "Your current Tideway password protects every connection or removal. Tideway never receives a Google or Facebook password."
      : recentStepUpProvider
        ? `${providerLabels[recentStepUpProvider]} recently confirmed it is you. Tideway clears this approval when another connection starts.`
        : "Confirm one existing provider before connecting or removing another sign-in method.";
    content.hidden = false;
    privacyRecords = Array.isArray(privacyResult.privacyRequests) ? privacyResult.privacyRequests : [];
    renderPrivacyRequests();
    privacyContent.hidden = false;
    stateTitle.textContent = "Your account is protected.";
    stateCopy.textContent = connectable || verifiable
      ? "You can add another method without changing your Tideway role, profile or bookings."
      : methodCount <= 1 ? "Your only sign-in method cannot be removed." : "No additional provider change is currently available.";
  } catch (error) {
    stateTitle.textContent = error.status === 401 ? "Sign in to open settings." : "Account settings are not available yet.";
    stateCopy.textContent = error.status === 401 ? "Use your verified Tideway account, then return here." : "The secure account database and provider services must be ready before these controls appear.";
  }
}

for (const button of connectButtons) button.addEventListener("click", () => openDialog("connect", button.dataset.connectProvider));
for (const button of stepUpButtons) button.addEventListener("click", () => startStepUp(button.dataset.stepUpProvider));
for (const button of privacyButtons) button.addEventListener("click", () => openPrivacyDialog(button.dataset.privacyAction));
cancel.addEventListener("click", () => dialog.close());
privacyCancel.addEventListener("click", () => privacyDialog.close());
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const csrf = csrfToken();
  if (!csrf) return showFeedback(dialogFeedback, "Your security token is missing. Sign in again before changing account methods.");
  const password = passwordStepUpAvailable ? String(new FormData(form).get("password") || "") : "";
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = selectedAction === "remove" ? "Removing…" : "Checking…";
  try {
    if (selectedAction === "remove") {
      await requestJson(`/api/marketplace/auth/provider-links/${selectedProvider}`, { method: "DELETE", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ password }) });
      try { sessionStorage.removeItem("tideway_csrf"); } catch {}
      location.assign(`/login#provider=${selectedProvider}-removed`);
      return;
    }
    const result = await requestJson(`/api/marketplace/auth/provider-links/${selectedProvider}/start`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ password }) });
    passwordInput.value = "";
    location.assign(safeProviderLocation(result.location, selectedProvider));
  } catch (error) {
    passwordInput.value = "";
    showFeedback(dialogFeedback, error.message);
    submit.disabled = false;
    cancel.disabled = false;
    submit.textContent = selectedAction === "remove" ? "Remove and sign out" : "Continue securely";
    (passwordStepUpAvailable ? passwordInput : submit).focus();
  }
});

privacyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (selectedPrivacyType === "deletion" && !deletionCheckbox.checked) return showFeedback(privacyDialogFeedback, "Confirm that you understand what this request does before continuing.");
  const csrf = csrfToken();
  if (!csrf) return showFeedback(privacyDialogFeedback, "Your security token is missing. Sign in again before making this request.");
  const requestId = pendingPrivacyIds.get(selectedPrivacyType) || crypto.randomUUID();
  pendingPrivacyIds.set(selectedPrivacyType, requestId);
  privacySubmit.disabled = true;
  privacyCancel.disabled = true;
  privacySubmit.textContent = "Sending privately…";
  try {
    const result = await requestJson("/api/marketplace/privacy-requests", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ requestId, requestType: selectedPrivacyType }) });
    pendingPrivacyIds.delete(selectedPrivacyType);
    privacyRecords = [result.privacyRequest, ...privacyRecords.filter((record) => record.requestId !== result.privacyRequest.requestId && !(record.requestType === result.privacyRequest.requestType && ["requested", "verifying", "processing"].includes(record.status)))];
    renderPrivacyRequests();
    privacyDialog.close();
    showFeedback(privacyFeedback, `${privacyLabel(selectedPrivacyType)} request received. Tideway will verify it before anything changes.`, "success");
  } catch (error) {
    showFeedback(privacyDialogFeedback, error.message);
  } finally {
    privacySubmit.disabled = false;
    privacyCancel.disabled = false;
    privacySubmit.textContent = "Send private request";
  }
});

load();
