const signup = location.pathname === "/signup";
const title = document.querySelector("[data-account-title]");
const lead = document.querySelector("[data-account-lead]");
const stateTitle = document.querySelector("[data-account-state-title]");
const stateCopy = document.querySelector("[data-account-state-copy]");

document.title = signup ? "Create a Tideway account — not open yet" : "Tideway sign in — not open yet";
if (title) title.textContent = signup ? "Account creation is not open yet." : "Account sign-in is not open yet.";
if (lead) lead.textContent = signup
  ? "Cleaner and landlord onboarding is being built behind Tideway's secure database boundary."
  : "Existing pilot requests use their protected private tracker links while account sign-in is being prepared.";

document.querySelectorAll("[data-year]").forEach((element) => { element.textContent = String(new Date().getFullYear()); });

try {
  const response = await fetch("/api/auth/providers", { headers: { Accept: "application/json" }, cache: "no-store" });
  const result = response.ok ? await response.json() : null;
  const providers = result?.providers || {};
  const available = ["emailPassword", "google", "apple", "facebook"].some((provider) => providers[provider] === true);
  if (available) {
    stateTitle.textContent = "Account runtime is configured but this entry page remains closed.";
    stateCopy.textContent = "Tideway will expose a sign-in form only after the protected HTTP workflow passes staging verification.";
  } else {
    stateTitle.textContent = "Account access is safely unavailable.";
    stateCopy.textContent = "The database, verified email delivery and sign-in runtime are not active, so Tideway is not showing buttons that cannot work.";
  }
} catch {
  stateTitle.textContent = "Account availability could not be checked.";
  stateCopy.textContent = "Use the working private pilot routes below; no account action has been attempted.";
}
