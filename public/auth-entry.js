import { accountIntentFromSearch, clearAccountIntent, normalizeAccountIntent, readAccountIntent, saveAccountIntent, saveSelectedCleaner, selectedCleanerFromSearch } from "./account-intent.js";

const modes = Object.freeze({
  "/login": { form: "login", title: "Sign in to Homle", lead: "Use your verified account to open the correct private workspace." },
  "/signup": { form: "signup", title: "Create a Homle account", lead: "Start as a Cleaner or Landlord/Property Manager after verifying your email." },
  "/verify-email": { form: "verify", title: "Verify your email", lead: "Use the private one-time link sent to your email address." },
  "/verify-facebook": { form: "facebook-verify", title: "Finish Facebook sign-in", lead: "Verify the private email link before Homle creates or connects an account." },
  "/reset-password": { form: "reset", title: "Reset your password", lead: "Replace your password and close every existing session." },
  "/onboarding": { form: "onboarding", title: "Choose your Homle workspace", lead: "Select Cleaner or Landlord/Property Manager to complete account setup." },
  "/account-ready": { form: "ready", title: "Your Homle profile is ready", lead: "Your secure role profile has been created for the private marketplace rehearsal." }
});

const selectedMode = modes[location.pathname] || modes["/login"];
const title = document.querySelector("[data-account-title]");
const lead = document.querySelector("[data-account-lead]");
const stateTitle = document.querySelector("[data-account-state-title]");
const stateCopy = document.querySelector("[data-account-state-copy]");
const runtime = document.querySelector("[data-account-runtime]");
const feedback = document.querySelector("[data-account-feedback]");
const forms = [...document.querySelectorAll("[data-account-form]")];
const socialActions = document.querySelector("[data-social-actions]");
const socialLinks = [...document.querySelectorAll("[data-social-provider]")];
const emailToggle = document.querySelector("[data-email-toggle]");
const accountChoiceDivider = document.querySelector("[data-account-choice-divider]");
const accountReadyPanel = document.querySelector("[data-account-ready]");
const accountReadyTitle = document.querySelector("[data-account-ready-title]");
const accountReadyCopy = document.querySelector("[data-account-ready-copy]");
const accountReadyLogout = document.querySelector("[data-account-ready-logout]");
const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
const privateToken = fragment.get("token") || "";
const socialResult = fragment.get("social") || "";
const socialCsrfToken = fragment.get("csrfToken") || "";
const fragmentIntent = normalizeAccountIntent(fragment.get("intent"));
let accountIntent = accountIntentFromSearch(location.search) || fragmentIntent;
try {
  const selectedCleaner = accountIntent === "book" ? selectedCleanerFromSearch(location.search) : "";
  if (selectedCleaner) saveSelectedCleaner(localStorage, selectedCleaner);
  if (accountIntent) saveAccountIntent(sessionStorage, accountIntent);
  else accountIntent = readAccountIntent(sessionStorage);
} catch { accountIntent = ""; }
const bookingIntent = accountIntent === "book";
const cleanerIntent = accountIntent === "work";
let emailFormRevealed = false;
let activeProviders = Object.freeze({});
let workspaceReady = false;

if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);
document.title = `${selectedMode.title} — Homle`;
if (title) title.textContent = `${selectedMode.title} is not open yet.`;
if (lead) lead.textContent = location.pathname === "/login"
  ? "Existing pilot requests use their protected private tracker links while account sign-in is being prepared."
  : "Cleaner and landlord onboarding is being built behind Homle's secure database boundary.";
document.querySelectorAll("[data-year]").forEach((element) => { element.textContent = String(new Date().getFullYear()); });

if (bookingIntent && ["login", "signup"].includes(selectedMode.form)) {
  document.title = `${selectedMode.form === "signup" ? "Create an account" : "Sign in"} to book a clean — Homle`;
} else if (cleanerIntent && ["login", "signup"].includes(selectedMode.form)) {
  document.title = `${selectedMode.form === "signup" ? "Create a Cleaner profile" : "Sign in as a Cleaner"} — Homle`;
}

function clearCompletedIntent() {
  try { clearAccountIntent(sessionStorage); } catch {}
  accountIntent = "";
}

function showFeedback(message, kind = "info") {
  if (!feedback) return;
  feedback.hidden = false;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
  feedback.focus?.();
}

function activateForm(providers) {
  activeProviders = Object.freeze({ ...providers });
  const activeName = selectedMode.form === "reset" && !privateToken ? "reset-request" : selectedMode.form === "verify" && !privateToken ? "verification-request" : selectedMode.form;
  const socialPage = selectedMode.form === "login" || selectedMode.form === "signup";
  const socialReady = socialPage && socialLinks.some((link) => providers[link.dataset.socialProvider] === true);
  const emailReady = providers.emailPassword === true;
  const providerFirst = socialReady && emailReady && socialPage;
  for (const link of socialLinks) link.hidden = !socialPage || providers[link.dataset.socialProvider] !== true;
  if (accountIntent) {
    for (const link of socialLinks) link.href = `${link.pathname}?intent=${accountIntent}`;
  }
  if (socialActions) socialActions.hidden = !socialReady || emailFormRevealed;
  if (emailToggle) {
    emailToggle.hidden = !providerFirst || emailFormRevealed;
    emailToggle.setAttribute("aria-controls", `account-email-${selectedMode.form}`);
    emailToggle.setAttribute("aria-expanded", String(emailFormRevealed));
  }
  if (accountChoiceDivider) accountChoiceDivider.hidden = !providerFirst || emailFormRevealed;
  if (accountReadyPanel) accountReadyPanel.hidden = selectedMode.form !== "ready";
  for (const form of forms) {
    const capabilityReady = selectedMode.form === "onboarding" || selectedMode.form === "ready" || (selectedMode.form === "facebook-verify" ? providers.facebook === true : providers.emailPassword === true);
    const emailEntryDeferred = providerFirst && form.dataset.accountForm === activeName && !emailFormRevealed;
    const active = form.dataset.accountForm === activeName && capabilityReady && !emailEntryDeferred;
    form.hidden = !active;
    form.querySelectorAll("[data-account-controls]").forEach((fieldset) => { fieldset.disabled = !active; });
  }
  runtime.hidden = false;
  title.textContent = selectedMode.title;
  lead.textContent = selectedMode.lead;
  if (bookingIntent && selectedMode.form === "signup") {
    title.textContent = "Create an account to book a clean";
    lead.textContent = "Continue with Google or Facebook for the quickest setup. Homle automatically creates your account when the verified provider is new, then asks you to confirm the Landlord workspace.";
  } else if (bookingIntent && selectedMode.form === "login") {
    title.textContent = "Sign in to book a clean";
    lead.textContent = "Use Google, Facebook or your verified email account, then continue to your private Landlord workspace.";
  } else if (bookingIntent && selectedMode.form === "onboarding") {
    title.textContent = "Confirm your booking workspace";
    lead.textContent = "Continue as a Landlord or Property Manager to add the property, scan rooms and request the clean.";
  } else if (cleanerIntent && selectedMode.form === "signup") {
    title.textContent = "Create your Cleaner profile";
    lead.textContent = "Continue with Google or Facebook. Homle creates your account automatically, then opens the Cleaner workspace setup.";
  } else if (cleanerIntent && selectedMode.form === "login") {
    title.textContent = "Sign in to work as a Cleaner";
    lead.textContent = "Use your existing secure account and continue to the Cleaner workspace.";
  } else if (cleanerIntent && selectedMode.form === "onboarding") {
    title.textContent = "Confirm your Cleaner workspace";
    lead.textContent = "Continue as a Cleaner to build your professional profile, availability and service area.";
  }
  if ((selectedMode.form === "verify" || selectedMode.form === "facebook-verify") && !privateToken) showFeedback("This verification link is incomplete or has already been removed.", "error");
}

function revealEmailForm() {
  emailFormRevealed = true;
  activateForm(activeProviders);
  const form = forms.find((item) => item.dataset.accountForm === selectedMode.form);
  form?.querySelector("input")?.focus();
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

function workspacePath(account) {
  let destination = "";
  if (accountIntent === "book") destination = account?.roles?.includes("landlord") ? "/landlord/dashboard?start=booking" : "";
  else if (accountIntent === "work") destination = account?.roles?.includes("cleaner") ? "/cleaner/profile" : "";
  else if (account?.selectedRole === "cleaner" && account?.roles?.includes("cleaner")) destination = "/cleaner/dashboard";
  else if (account?.selectedRole === "landlord" && account?.roles?.includes("landlord")) destination = "/landlord/dashboard";
  return destination && !workspaceReady ? "/account-ready" : destination;
}

async function openSignedInWorkspace() {
  const response = await fetch("/api/marketplace/account", { credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) return false;
  const result = await response.json();
  workspaceReady = result.workspaceReady === true;
  if (accountIntent === "book" && result.account?.roles?.length && !result.account.roles.includes("landlord")) {
    showFeedback("This account currently has only a Cleaner workspace. Use a Landlord account to book a clean; Homle has not changed your role.", "error");
    return true;
  }
  if (accountIntent === "work" && result.account?.roles?.length && !result.account.roles.includes("cleaner")) {
    showFeedback("This account currently has only a Landlord workspace. Use a Cleaner account to build a Cleaner profile; Homle has not changed your role.", "error");
    return true;
  }
  const destination = workspacePath(result.account);
  if (!destination) return false;
  clearCompletedIntent();
  location.assign(destination);
  return true;
}

async function loadAccountReady() {
  const response = await fetch("/api/marketplace/account", { credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store" });
  if (response.status === 401) {
    location.assign("/login");
    return;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.account) throw new Error(result.error || "Your saved Homle profile could not be verified.");
  if (!result.account.roles?.length) {
    location.assign("/onboarding");
    return;
  }
  workspaceReady = result.workspaceReady === true;
  if (workspaceReady) {
    const destination = workspacePath(result.account);
    if (destination && destination !== "/account-ready") {
      location.assign(destination);
      return;
    }
  }
  const cleaner = result.account.selectedRole === "cleaner" && result.account.roles.includes("cleaner");
  const landlord = result.account.selectedRole === "landlord" && result.account.roles.includes("landlord");
  if (!cleaner && !landlord) throw new Error("Your saved Homle role could not be verified.");
  if (accountReadyTitle) accountReadyTitle.textContent = cleaner ? "Your Cleaner profile is created." : "Your Landlord profile is created.";
  if (accountReadyCopy) accountReadyCopy.textContent = cleaner
    ? "Your secure Cleaner account and role are saved. Professional details, availability and service areas will open here when Homle's private booking services pass staging."
    : "Your secure Landlord account and role are saved. Properties, room scans and booking requests will open here when Homle's private booking services pass staging.";
}

async function logoutReadyAccount() {
  const csrfToken = storedCsrf();
  if (!csrfToken) return showFeedback("Your secure sign-out token is missing. Close this browser session or sign in again before retrying.", "error");
  accountReadyLogout.disabled = true;
  try {
    await post("/api/marketplace/auth/logout", {}, csrfToken);
    clearStoredCsrf();
    clearCompletedIntent();
    location.assign("/");
  } catch (error) {
    showFeedback(error.message, "error");
    accountReadyLogout.disabled = false;
  }
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
        throw new Error("Secure browser storage is unavailable, so Homle closed the new session. Try a standard browser window.");
      }
      if (!result.account?.roles?.length) {
        location.assign(accountIntent ? `/onboarding?intent=${accountIntent}` : "/onboarding");
        return;
      }
      if (bookingIntent && !result.account.roles.includes("landlord")) {
        showFeedback("This account currently has only a Cleaner workspace. Use a Landlord account to book a clean; Homle has not changed your role.", "error");
        return;
      }
      if (cleanerIntent && !result.account.roles.includes("cleaner")) {
        showFeedback("This account currently has only a Landlord workspace. Use a Cleaner account to build a Cleaner profile; Homle has not changed your role.", "error");
        return;
      }
      const destination = workspacePath(result.account);
      if (destination) {
        clearCompletedIntent();
        location.assign(destination);
        return;
      }
      showFeedback("Signed in securely. Your marketplace dashboard is being prepared.", "success");
      form.querySelector("fieldset").disabled = true;
    } else if (kind === "signup") {
      await post("/api/marketplace/auth/signup", { ...body, ...(accountIntent ? { intent: accountIntent } : {}) });
      showFeedback("If the address can be registered, a private verification link is on its way.", "success");
      form.reset();
    } else if (kind === "verify") {
      if (!privateToken) throw new Error("This verification link is incomplete or expired.");
      await post("/api/marketplace/auth/verification/confirm", { token: privateToken });
      if (accountIntent) {
        location.assign(`/login?intent=${accountIntent}#email=verified`);
        return;
      }
      showFeedback("Email verified. You can now sign in.", "success");
      form.querySelector("fieldset").disabled = true;
    } else if (kind === "facebook-verify") {
      if (!privateToken) throw new Error("This Facebook verification link is incomplete or expired.");
      const result = await post("/api/marketplace/auth/facebook/verification/confirm", { token: privateToken });
      if (!storeCsrf(result.csrfToken)) {
        await post("/api/marketplace/auth/logout", {}, result.csrfToken);
        throw new Error("Secure browser storage is unavailable, so Homle closed the new session. Try a standard browser window.");
      }
      if (!result.account?.roles?.length) {
        location.assign(`${accountIntent ? `/onboarding?intent=${accountIntent}` : "/onboarding"}#social=facebook-verified${accountIntent ? `&intent=${accountIntent}` : ""}`);
        return;
      }
      showFeedback("Facebook sign-in verified. Your secure Homle session is ready.", "success");
      form.querySelector("fieldset").disabled = true;
    } else if (kind === "verification-request") {
      await post("/api/marketplace/auth/verification/resend", { email: body.email, ...(accountIntent ? { intent: accountIntent } : {}) });
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
        throw new Error("Secure browser storage is unavailable, so Homle closed the rotated session. Sign in again in a standard browser window.");
      }
      const destination = workspacePath(result.account);
      if (destination) {
        clearCompletedIntent();
        location.assign(destination);
        return;
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
emailToggle?.addEventListener("click", revealEmailForm);
accountReadyLogout?.addEventListener("click", logoutReadyAccount);

if ((bookingIntent || cleanerIntent) && selectedMode.form === "onboarding") {
  const selectedRole = bookingIntent ? "landlord" : "cleaner";
  const selectedChoice = document.querySelector(`input[name="role"][value="${selectedRole}"]`);
  if (selectedChoice) selectedChoice.checked = true;
  const otherChoice = document.querySelector(`[data-onboarding-choice="${bookingIntent ? "cleaner" : "landlord"}"]`);
  if (otherChoice) otherChoice.hidden = true;
  const legend = document.querySelector("[data-onboarding-legend]");
  const copy = document.querySelector("[data-onboarding-copy]");
  const submit = document.querySelector("[data-onboarding-submit]");
  if (legend) legend.textContent = bookingIntent ? "Continue as a property owner" : "Continue as a Cleaner";
  if (copy) copy.textContent = bookingIntent
    ? "You chose Book a clean. Confirm this Landlord workspace once, then add the property and room scan."
    : "You chose Work as a cleaner. Confirm this Cleaner workspace once, then build your professional profile.";
  if (submit) submit.textContent = bookingIntent ? "Continue to property details" : "Continue to Cleaner profile";
}

try {
  const [response, healthResponse] = await Promise.all([
    fetch("/api/auth/providers", { headers: { Accept: "application/json" }, cache: "no-store" }),
    fetch("/api/health", { headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" }).catch(() => null)
  ]);
  const result = response.ok ? await response.json() : null;
  const health = healthResponse?.ok ? await healthResponse.json().catch(() => null) : null;
  workspaceReady = health?.marketplace?.enabled === true && health?.marketplace?.ready === true;
  const providers = result?.providers || {};
  const authenticationReady = providers.emailPassword === true || providers.google === true || providers.facebook === true;
  if (authenticationReady) {
    stateTitle.textContent = "Secure account access is ready.";
    stateCopy.textContent = "Available sign-in methods use rate limits, secure sessions and server-side role checks.";
    activateForm(providers);
    if (selectedMode.form === "ready") {
      await loadAccountReady();
    } else if (socialResult === "google" && socialCsrfToken) {
      if (storeCsrf(socialCsrfToken)) {
        const opened = location.pathname !== "/onboarding" && await openSignedInWorkspace();
        if (!opened) showFeedback(location.pathname === "/onboarding" ? (bookingIntent ? "Google sign-in succeeded. Confirm the booking workspace below." : cleanerIntent ? "Google sign-in succeeded. Confirm the Cleaner workspace below." : "Google sign-in succeeded. Choose how you will use Homle.") : "Google sign-in succeeded. Your secure Homle session is ready.", "success");
      } else {
        await post("/api/marketplace/auth/logout", {}, socialCsrfToken);
        showFeedback("Secure browser storage is unavailable, so Homle closed the Google session. Try a standard browser window.", "error");
      }
    } else if (socialResult === "google-failed") {
      showFeedback("Google sign-in could not be completed. No Homle session was created; please try again.", "error");
    } else if (socialResult === "facebook" && socialCsrfToken) {
      if (storeCsrf(socialCsrfToken)) {
        const opened = location.pathname !== "/onboarding" && await openSignedInWorkspace();
        if (!opened) showFeedback(location.pathname === "/onboarding" ? (bookingIntent ? "Facebook sign-in succeeded. Confirm the booking workspace below." : cleanerIntent ? "Facebook sign-in succeeded. Confirm the Cleaner workspace below." : "Facebook sign-in succeeded. Choose how you will use Homle.") : "Facebook sign-in succeeded. Your secure Homle session is ready.", "success");
      } else {
        await post("/api/marketplace/auth/logout", {}, socialCsrfToken);
        showFeedback("Secure browser storage is unavailable, so Homle closed the Facebook session. Try a standard browser window.", "error");
      }
    } else if (socialResult === "facebook-verified") {
      showFeedback(bookingIntent ? "Your email is verified and Facebook sign-in is complete. Confirm the booking workspace below." : cleanerIntent ? "Your email is verified and Facebook sign-in is complete. Confirm the Cleaner workspace below." : "Your email is verified and Facebook sign-in is complete. Choose how you will use Homle.", "success");
    } else if (socialResult === "facebook-verification-sent") {
      showFeedback("Facebook identity was confirmed. Check the private email link to finish creating or connecting your Homle account.", "success");
    } else if (socialResult === "facebook-email-unavailable") {
      showFeedback("Facebook did not provide an email address. Use email sign-in, or allow email access in Facebook and try again.", "error");
    } else if (socialResult === "facebook-failed") {
      showFeedback("Facebook sign-in could not be completed. No Homle session was created; please try again.", "error");
    } else if (socialResult === "staging-access-unavailable") {
      showFeedback("This preview is limited to approved test accounts. This sign-in account is not on the approved list, so no Homle account or session was created. Ask the Homle owner to approve it, then try again.", "error");
    } else if (socialResult === "rate-limited") {
      showFeedback("Too many sign-in attempts were made. Please wait before trying again.", "error");
    }
  } else {
    stateTitle.textContent = "Account access is safely unavailable.";
    stateCopy.textContent = "The database, verified email delivery and sign-in runtime are not active, so Homle is not showing buttons that cannot work.";
  }
} catch {
  stateTitle.textContent = "Account availability could not be checked.";
  stateCopy.textContent = "Use the working private pilot routes below; no account action has been attempted.";
}
