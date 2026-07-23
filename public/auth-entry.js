import { accountIntentFromSearch, clearAccountIntent, normalizeAccountIntent, readAccountIntent, saveAccountIntent, saveSelectedCleaner, selectedCleanerFromSearch } from "./account-intent.js";
import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { accountReadyPresentation, availableAccountMethodLabel } from "./account-ready-model.js?v=20260723-1";

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
const accountReadyDashboard = document.querySelector("[data-account-ready-dashboard]");
const pilotActions = document.querySelector("[data-pilot-actions]");
const accountSideTitle = document.querySelector("[data-account-side-title]");
const accountSideNote = document.querySelector("[data-account-side-note]");
const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
const privateToken = fragment.get("token") || "";
const socialResult = fragment.get("social") || "";
const socialFailureReason = fragment.get("reason") || "";
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
let signedInAccount = null;
const accountRequestTimeoutMs = 15_000;

if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);
document.title = `${selectedMode.title} — Homle`;
if (title) title.textContent = "Checking secure account access";
if (lead) lead.textContent = "Homle is confirming the sign-in methods available on this deployment.";
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

function setAccountSide(role = "landlord") {
  const cleaner = role === "cleaner";
  if (accountSideTitle) accountSideTitle.textContent = cleaner ? "Your Cleaner work stays focused." : "Your property booking stays simple.";
  const titles = cleaner ? ["Finish your profile", "Set availability", "Manage accepted jobs"] : ["Add a property", "Scan and speak", "Track the booking"];
  const copies = cleaner
    ? ["Show only real services, prices and travel area.", "Choose the times when suitable requests can reach you.", "See your checklist, journey, progress and payout setup."]
    : ["Save the location privately once.", "Turn each room walkthrough into concise Cleaner tasks.", "See matching, arrival and cleaning progress in one place."];
  titles.forEach((value, index) => {
    const step = index + 1;
    const titleNode = document.querySelector(`[data-account-step-title="${step}"]`);
    const copyNode = document.querySelector(`[data-account-step-copy="${step}"]`);
    if (titleNode) titleNode.textContent = value;
    if (copyNode) copyNode.textContent = copies[index];
  });
  if (accountSideNote) accountSideNote.textContent = cleaner
    ? "Landlord properties and booking controls never appear in the Cleaner dashboard."
    : "Cleaner profile, availability and earnings controls never appear in the Landlord dashboard.";
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
  const availableMethods = availableAccountMethodLabel(providers);
  if (selectedMode.form === "signup" && availableMethods) {
    lead.textContent = `Continue with ${availableMethods}. Homle creates a new account automatically, then asks you to choose a Cleaner or Landlord workspace.`;
  } else if (selectedMode.form === "login" && availableMethods) {
    lead.textContent = `Use ${availableMethods} to open the correct private workspace.`;
  }
  if (bookingIntent && selectedMode.form === "signup") {
    title.textContent = "Create an account to book a clean";
    lead.textContent = `Continue with ${availableMethods}. Homle automatically creates your account when the verified provider is new, then asks you to confirm the Landlord workspace.`;
  } else if (bookingIntent && selectedMode.form === "login") {
    title.textContent = "Sign in to book a clean";
    lead.textContent = `Use ${availableMethods}, then continue to your private Landlord workspace.`;
  } else if (bookingIntent && selectedMode.form === "onboarding") {
    title.textContent = "Confirm your booking workspace";
    lead.textContent = "Continue as a Landlord or Property Manager to add the property, scan rooms and request the clean.";
  } else if (cleanerIntent && selectedMode.form === "signup") {
    title.textContent = "Create your Cleaner profile";
    lead.textContent = `Continue with ${availableMethods}. Homle creates your account automatically, then opens the Cleaner workspace setup.`;
  } else if (cleanerIntent && selectedMode.form === "login") {
    title.textContent = "Sign in to work as a Cleaner";
    lead.textContent = "Use your existing secure account and continue to the Cleaner workspace.";
  } else if (cleanerIntent && selectedMode.form === "onboarding") {
    title.textContent = "Confirm your Cleaner workspace";
    lead.textContent = "Continue as a Cleaner to build your professional profile, availability and service area.";
  }
  if (bookingIntent) setAccountSide("landlord");
  else if (cleanerIntent) setAccountSide("cleaner");
  if (pilotActions) pilotActions.hidden = selectedMode.form === "ready";
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

async function accountFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), accountRequestTimeoutMs);
  try {
    return await fetch(path, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Homle is taking too long to respond. Your account may still have been saved; refresh this page once to continue.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function post(path, body, csrfToken = "") {
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await accountFetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", headers, body: JSON.stringify(body) });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result?.error || "The account action could not be completed. Please try again.");
  return result;
}

async function recoverOnboardingCsrf() {
  const result = await post("/api/marketplace/auth/onboarding-session", {});
  if (!storeCsrf(result.csrfToken)) {
    await post("/api/marketplace/auth/logout", {}, result.csrfToken);
    throw new Error("Secure browser storage is unavailable, so Homle closed the refreshed session. Sign in again in a standard browser window.");
  }
  return result.csrfToken;
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
  if (accountIntent === "book") destination = account?.roles?.includes("landlord") ? "/landlord/book" : "";
  else if (accountIntent === "work") destination = account?.roles?.includes("cleaner") ? "/cleaner/profile" : "";
  else if (account?.selectedRole === "cleaner" && account?.roles?.includes("cleaner")) destination = "/cleaner/dashboard";
  else if (account?.selectedRole === "landlord" && account?.roles?.includes("landlord")) destination = "/landlord/dashboard";
  return destination && !workspaceReady ? "/account-ready" : destination;
}

async function openSignedInWorkspace() {
  const response = await accountFetch("/api/marketplace/account", { credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) return false;
  const result = await response.json();
  signedInAccount = result.account || null;
  workspaceReady = result.workspaceReady === true;
  if (accountIntent === "book" && result.account?.roles?.length && !result.account.roles.includes("landlord")) {
    if (selectedMode.form !== "onboarding") location.assign("/onboarding?intent=book");
    else showFeedback("Your Cleaner workspace stays separate. Confirm below to add a private Landlord workspace to this same verified account.", "info");
    return true;
  }
  if (accountIntent === "work" && result.account?.roles?.length && !result.account.roles.includes("cleaner")) {
    if (selectedMode.form !== "onboarding") location.assign("/onboarding?intent=work");
    else showFeedback("Your Landlord workspace stays separate. Confirm below to add a private Cleaner workspace to this same verified account.", "info");
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
  const presentation = accountReadyPresentation(result.account, workspaceReady);
  if (!presentation) throw new Error("Your saved Homle role could not be verified.");
  const cleaner = presentation.role === "cleaner";
  if (accountReadyTitle) accountReadyTitle.textContent = presentation.title;
  if (accountReadyCopy) accountReadyCopy.textContent = presentation.copy;
  renderAccountAvatar(result.account);
  setAccountSide(cleaner ? "cleaner" : "landlord");
  if (pilotActions) pilotActions.hidden = true;
  if (accountReadyDashboard) {
    accountReadyDashboard.href = presentation.actionHref;
    accountReadyDashboard.textContent = presentation.actionLabel;
  }
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
      signedInAccount = result.account;
      if (bookingIntent && !result.account.roles.includes("landlord")) {
        location.assign("/onboarding?intent=book");
        return;
      }
      if (cleanerIntent && !result.account.roles.includes("cleaner")) {
        location.assign("/onboarding?intent=work");
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
      const csrfToken = storedCsrf() || await recoverOnboardingCsrf();
      const endpoint = signedInAccount?.roles?.length ? "/api/marketplace/auth/workspace" : "/api/marketplace/onboarding";
      const result = await post(endpoint, { role: body.role }, csrfToken);
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
    if (kind === "onboarding") {
      try {
        if (await openSignedInWorkspace()) return;
      } catch {}
    }
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
  const authenticationReady = providers.emailPassword === true || providers.google === true || providers.apple === true || providers.facebook === true;
  if (authenticationReady) {
    stateTitle.textContent = "Secure account access is ready.";
    stateCopy.textContent = "Available sign-in methods use rate limits, secure sessions and server-side role checks.";
    activateForm(providers);
    if (selectedMode.form === "ready") {
      await loadAccountReady();
    } else if (selectedMode.form === "onboarding" && await openSignedInWorkspace()) {
      // A previous role-save may have completed even if its browser navigation was interrupted.
    } else if (socialResult === "google" && socialCsrfToken) {
      if (storeCsrf(socialCsrfToken)) {
        const opened = location.pathname !== "/onboarding" && await openSignedInWorkspace();
        if (!opened) showFeedback(location.pathname === "/onboarding" ? (bookingIntent ? "Google sign-in succeeded. Confirm the booking workspace below." : cleanerIntent ? "Google sign-in succeeded. Confirm the Cleaner workspace below." : "Google sign-in succeeded. Choose how you will use Homle.") : "Google sign-in succeeded. Your secure Homle session is ready.", "success");
      } else {
        await post("/api/marketplace/auth/logout", {}, socialCsrfToken);
        showFeedback("Secure browser storage is unavailable, so Homle closed the Google session. Try a standard browser window.", "error");
      }
    } else if (socialResult === "google-failed") {
      const googleFailureMessages = {
        "access-denied": "Google did not approve this sign-in. If Homle is still in Google testing mode, use an account added as a test user, then try again.",
        "attempt-expired": "The secure Google sign-in attempt expired or its browser cookie was unavailable. Start again from this Homle sign-in page in the same browser tab.",
        "handoff-rejected": "Google rejected the secure account handoff. Homle has recorded the exact stage so the Google client setup can be corrected.",
        "identity-unverified": "Google returned an account response Homle could not verify. Try once more; if it repeats, the technical stage has been recorded.",
        "account-save-failed": "Google verified the account, but Homle could not safely save the account or session. The technical stage has been recorded for repair."
      };
      showFeedback(googleFailureMessages[socialFailureReason] || "Google sign-in could not be completed. No Homle session was created; please try again.", "error");
    } else if (socialResult === "apple" && socialCsrfToken) {
      if (storeCsrf(socialCsrfToken)) {
        const opened = await openSignedInWorkspace();
        if (!opened) showFeedback(location.pathname === "/onboarding" ? (bookingIntent ? "Apple sign-in succeeded. Confirm the booking workspace below." : cleanerIntent ? "Apple sign-in succeeded. Confirm the Cleaner workspace below." : "Apple sign-in succeeded. Choose how you will use Homle.") : "Apple sign-in succeeded. Your secure Homle session is ready.", "success");
      } else {
        await fetch("/api/marketplace/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": socialCsrfToken }, body: "{}" }).catch(() => {});
        showFeedback("Secure browser storage is unavailable, so Homle closed the Apple session. Try a standard browser window.", "error");
      }
    } else if (socialResult === "apple-failed") {
      const appleFailureMessages = {
        "access-denied": "Apple did not approve this sign-in. Choose Continue with Apple and try again.",
        "attempt-expired": "The secure Apple sign-in attempt expired or its browser cookie was unavailable. Start again from this Homle sign-in page in the same browser.",
        "handoff-rejected": "Apple rejected the secure account handoff. Homle has recorded the exact stage so the Apple Services ID setup can be corrected.",
        "identity-unverified": "Apple returned an account response Homle could not verify. Try once more; if it repeats, the technical stage has been recorded.",
        "account-save-failed": "Apple verified the account, but Homle could not safely save the account or session. The technical stage has been recorded for repair."
      };
      showFeedback(appleFailureMessages[socialFailureReason] || "Apple sign-in could not be completed. No Homle session was created; please try again.", "error");
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
