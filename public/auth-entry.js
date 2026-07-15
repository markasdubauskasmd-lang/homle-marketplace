const modes = Object.freeze({
  "/login": { form: "login", title: "Sign in to Tideway", lead: "Use your verified account to open the correct private workspace." },
  "/signup": { form: "signup", title: "Create a Tideway account", lead: "Start as a Cleaner or Landlord/Property Manager after verifying your email." },
  "/verify-email": { form: "verify", title: "Verify your email", lead: "Use the private one-time link sent to your email address." },
  "/reset-password": { form: "reset", title: "Reset your password", lead: "Replace your password and close every existing session." },
  "/onboarding": { form: "onboarding", title: "Choose your Tideway workspace", lead: "Select Cleaner or Landlord/Property Manager to complete account setup." }
});

const selectedMode = modes[location.pathname] || modes["/login"];
const title = document.querySelector("[data-account-title]");
const lead = document.querySelector("[data-account-lead]");
const stateTitle = document.querySelector("[data-account-state-title]");
const stateCopy = document.querySelector("[data-account-state-copy]");
const runtime = document.querySelector("[data-account-runtime]");
const feedback = document.querySelector("[data-account-feedback]");
const forms = [...document.querySelectorAll("[data-account-form]")];
const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
const privateToken = fragment.get("token") || "";

if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);
document.title = `${selectedMode.title} — Tideway`;
if (title) title.textContent = `${selectedMode.title} is not open yet.`;
if (lead) lead.textContent = location.pathname === "/login"
  ? "Existing pilot requests use their protected private tracker links while account sign-in is being prepared."
  : "Cleaner and landlord onboarding is being built behind Tideway's secure database boundary.";
document.querySelectorAll("[data-year]").forEach((element) => { element.textContent = String(new Date().getFullYear()); });

function showFeedback(message, kind = "info") {
  if (!feedback) return;
  feedback.hidden = false;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
  feedback.focus?.();
}

function activateForm() {
  const activeName = selectedMode.form === "reset" && !privateToken ? "reset-request" : selectedMode.form === "verify" && !privateToken ? "verification-request" : selectedMode.form;
  for (const form of forms) {
    const active = form.dataset.accountForm === activeName;
    form.hidden = !active;
    form.querySelectorAll("[data-account-controls]").forEach((fieldset) => { fieldset.disabled = !active; });
  }
  runtime.hidden = false;
  title.textContent = selectedMode.title;
  lead.textContent = selectedMode.lead;
  if (selectedMode.form === "verify" && !privateToken) showFeedback("This verification link is incomplete or has already been removed. Request a fresh link below.", "error");
}

function formBody(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function post(path, body, csrfToken = "") {
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", headers, body: JSON.stringify(body) });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result?.error || "The account action could not be completed. Please try again.");
  return result;
}

function setPending(form, pending) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (!button.dataset.readyLabel) button.dataset.readyLabel = button.textContent;
  button.disabled = pending;
  button.textContent = pending ? "Please wait…" : button.dataset.readyLabel;
}

function storeCsrf(token) {
  try { sessionStorage.setItem("tideway_csrf", token); return sessionStorage.getItem("tideway_csrf") === token; } catch { return false; }
}

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function clearStoredCsrf() {
  try { sessionStorage.removeItem("tideway_csrf"); } catch {}
}

async function submitAccountForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const kind = form.dataset.accountForm;
  const body = formBody(form);
  if (kind === "reset" && body.password !== body.passwordConfirm) {
    showFeedback("The two passwords do not match.", "error");
    return;
  }
  setPending(form, true);
  if (feedback) feedback.hidden = true;
  try {
    if (kind === "login") {
      const result = await post("/api/marketplace/auth/login", body);
      if (!storeCsrf(result.csrfToken)) {
        await post("/api/marketplace/auth/logout", {}, result.csrfToken);
        throw new Error("Secure browser storage is unavailable, so Tideway closed the new session. Try a standard browser window.");
      }
      if (!result.account?.roles?.length) {
        location.assign("/onboarding");
        return;
      }
      showFeedback("Signed in securely. Your marketplace dashboard is being prepared.", "success");
      form.querySelector("fieldset").disabled = true;
    } else if (kind === "signup") {
      await post("/api/marketplace/auth/signup", body);
      showFeedback("If the address can be registered, a private verification link is on its way.", "success");
      form.reset();
    } else if (kind === "verify") {
      if (!privateToken) throw new Error("This verification link is incomplete or expired.");
      await post("/api/marketplace/auth/verification/confirm", { token: privateToken });
      showFeedback("Email verified. You can now sign in.", "success");
      form.querySelector("fieldset").disabled = true;
    } else if (kind === "verification-request") {
      await post("/api/marketplace/auth/verification/resend", { email: body.email });
      showFeedback("If the account still needs verification, a fresh private link is on its way.", "success");
      form.reset();
    } else if (kind === "reset-request") {
      await post("/api/marketplace/auth/password-reset/request", { email: body.email });
      showFeedback("If the account can be reset, a private link is on its way.", "success");
      form.reset();
    } else if (kind === "reset") {
      if (!privateToken) throw new Error("This password-reset link is incomplete or expired.");
      await post("/api/marketplace/auth/password-reset/confirm", { token: privateToken, password: body.password });
      clearStoredCsrf();
      showFeedback("Password replaced and earlier sessions closed. Sign in with the new password.", "success");
      form.reset();
      form.querySelector("fieldset").disabled = true;
    } else if (kind === "onboarding") {
      const csrfToken = storedCsrf();
      if (!csrfToken) throw new Error("Your secure setup token is missing. Sign in again before choosing a workspace.");
      const result = await post("/api/marketplace/onboarding", { role: body.role }, csrfToken);
      if (!storeCsrf(result.csrfToken)) {
        await post("/api/marketplace/auth/logout", {}, result.csrfToken);
        throw new Error("Secure browser storage is unavailable, so Tideway closed the rotated session. Sign in again in a standard browser window.");
      }
      showFeedback(`${result.account.selectedRole === "cleaner" ? "Cleaner" : "Landlord"} workspace selected securely. Your dashboard is being prepared.`, "success");
      form.querySelector("fieldset").disabled = true;
    }
  } catch (error) {
    showFeedback(error.message, "error");
  } finally {
    setPending(form, false);
  }
}

for (const form of forms) form.addEventListener("submit", submitAccountForm);

try {
  const response = await fetch("/api/auth/providers", { headers: { Accept: "application/json" }, cache: "no-store" });
  const result = response.ok ? await response.json() : null;
  const providers = result?.providers || {};
  if (providers.emailPassword === true) {
    stateTitle.textContent = "Secure account access is ready.";
    stateCopy.textContent = "Forms are protected by verified email, rate limits, secure sessions and server-side role checks.";
    activateForm();
  } else {
    stateTitle.textContent = "Account access is safely unavailable.";
    stateCopy.textContent = "The database, verified email delivery and sign-in runtime are not active, so Tideway is not showing buttons that cannot work.";
  }
} catch {
  stateTitle.textContent = "Account availability could not be checked.";
  stateCopy.textContent = "Use the working private pilot routes below; no account action has been attempted.";
}
