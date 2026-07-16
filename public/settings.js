const stateTitle = document.querySelector("[data-settings-title]");
const stateCopy = document.querySelector("[data-settings-copy]");
const feedback = document.querySelector("[data-settings-feedback]");
const content = document.querySelector("[data-settings-content]");
const providerList = document.querySelector("[data-provider-list]");
const providerActions = document.querySelector("[data-provider-actions]");
const buttons = [...document.querySelectorAll("[data-connect-provider]")];
const dialog = document.querySelector("[data-link-dialog]");
const form = document.querySelector("[data-link-form]");
const dialogTitle = document.querySelector("[data-link-title]");
const dialogCopy = document.querySelector("[data-link-copy]");
const dialogFeedback = document.querySelector("[data-link-feedback]");
const cancel = document.querySelector("[data-link-cancel]");
const submit = document.querySelector("[data-link-submit]");
const providerLabels = Object.freeze({ password: "Email and password", google: "Google", facebook: "Facebook" });
let selectedProvider = "";

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
  if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || "Account settings could not be loaded."), { status: response.status, code: result.code || "" });
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

function renderIdentity(identity) {
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
  return item;
}

function openDialog(provider) {
  selectedProvider = provider;
  form.reset();
  showFeedback(dialogFeedback, "");
  const label = providerLabels[provider];
  dialogTitle.textContent = `Connect ${label}`;
  dialogCopy.textContent = `Confirm your current Tideway password, then ${label} will ask you to approve this connection.`;
  dialog.showModal();
  form.elements.password.focus();
}

async function load() {
  const resultMessage = fragment.get("provider") || "";
  if (resultMessage.endsWith("-connected")) showFeedback(feedback, `${providerLabels[resultMessage.split("-", 1)[0]] || "Provider"} was connected successfully.`, "success");
  else if (resultMessage) showFeedback(feedback, resultMessage === "rate-limited" ? "Too many attempts. Wait before trying again." : "The provider connection was not completed. Your existing sign-in methods were not changed.");
  try {
    const result = await requestJson("/api/marketplace/auth/provider-links");
    providerList.replaceChildren(...result.connected.map(renderIdentity));
    const connected = new Set(result.connected.map((item) => item.provider));
    const passwordStepUpAvailable = connected.has("password");
    let connectable = 0;
    for (const button of buttons) {
      const provider = button.dataset.connectProvider;
      button.hidden = !passwordStepUpAvailable || result.available?.[provider] !== true || connected.has(provider);
      if (!button.hidden) connectable += 1;
    }
    providerActions.hidden = connectable === 0;
    content.hidden = false;
    stateTitle.textContent = "Your account is protected.";
    stateCopy.textContent = connectable ? "Choose a provider below only if you want another way to sign in." : passwordStepUpAvailable ? "No additional sign-in provider is currently available to connect." : "Additional connections stay closed until Tideway adds a secure step-up method for social-only accounts.";
  } catch (error) {
    stateTitle.textContent = error.status === 401 ? "Sign in to open settings." : "Account settings are not available yet.";
    stateCopy.textContent = error.status === 401 ? "Use your verified Tideway account, then return here." : "The secure account database and provider services must be ready before these controls appear.";
  }
}

for (const button of buttons) button.addEventListener("click", () => openDialog(button.dataset.connectProvider));
cancel.addEventListener("click", () => dialog.close());
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const csrf = csrfToken();
  if (!csrf) return showFeedback(dialogFeedback, "Your security token is missing. Sign in again before connecting another method.");
  const password = String(new FormData(form).get("password") || "");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "Checking…";
  try {
    const result = await requestJson(`/api/marketplace/auth/provider-links/${selectedProvider}/start`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ password }) });
    form.elements.password.value = "";
    location.assign(safeProviderLocation(result.location, selectedProvider));
  } catch (error) {
    form.elements.password.value = "";
    showFeedback(dialogFeedback, error.message);
    submit.disabled = false;
    cancel.disabled = false;
    submit.textContent = "Continue securely";
    form.elements.password.focus();
  }
});

load();
