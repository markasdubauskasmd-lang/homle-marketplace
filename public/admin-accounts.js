import { createRequestJson } from "./request-json.js";
import { storedCsrf } from "./session-csrf.js";
import { accountStatusLabel, accountStatusPayload, suspensionWarning } from "./admin-accounts-model.js";

const gate = document.querySelector("[data-admin-accounts-gate]");
const workspace = document.querySelector("[data-admin-accounts-workspace]");
const searchForm = document.querySelector("[data-admin-accounts-search]");
const searchSubmit = document.querySelector("[data-admin-accounts-search-submit]");
const result = document.querySelector("[data-admin-accounts-result]");
const feedback = document.querySelector("[data-admin-accounts-feedback]");
let busy = false;

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

function node(name, className, text) { const element = document.createElement(name); if (className) element.className = className; if (text != null) element.textContent = text; return element; }
function showFeedback(message, kind = "info") { feedback.hidden = !message; feedback.dataset.kind = kind; feedback.textContent = message; if (message) feedback.focus(); }
function showGate(title, copy, { signIn = false, retry = false } = {}) {
  gate.hidden = false; workspace.hidden = true;
  document.querySelector("[data-admin-accounts-gate-title]").textContent = title;
  document.querySelector("[data-admin-accounts-gate-copy]").textContent = copy;
  document.querySelector("[data-admin-accounts-sign-in]").hidden = !signIn;
  document.querySelector("[data-admin-accounts-retry]").hidden = !retry;
}

const requestJson = createRequestJson({ failureMessage: "The account could not be loaded." });

// Rendered with textContent throughout. Every value here was typed by the
// person the record is about.
function accountCard(account) {
  const card = node("article", "admin-case-card admin-booking-card");
  const heading = node("div", "admin-case-card-heading");
  const title = node("div");
  title.append(
    node("span", "booking-status-pill", accountStatusLabel(account.accountStatus)),
    node("h3", "", account.displayName || "Account"),
    node("p", "", `${account.email} · ${account.roles.join(", ") || "no roles"} · joined ${new Date(account.createdAt).toLocaleDateString("en-GB")}`)
  );
  heading.append(title);
  card.append(heading);

  // Shown before the decision, not after it. Suspending a Cleaner who has a
  // job tomorrow leaves a customer expecting somebody who will not arrive, and
  // nothing on this page cancels those.
  const warning = suspensionWarning(account);
  if (warning) card.append(node("p", "admin-verification-evidence-unreadable", warning));

  const form = node("div", "admin-verification-form");
  const suspending = account.accountStatus === "active";
  const noteWrap = node("label", "admin-verification-note");
  noteWrap.append(node("span", "", suspending ? "Why is this account being suspended? (recorded, required)" : "Why is this account being restored? (recorded, required)"));
  const reason = node("textarea");
  reason.maxLength = 1000; reason.rows = 3;
  reason.placeholder = suspending ? "For example: Reported conduct in a customer home; paused pending review." : "For example: Review concluded, no further action.";
  noteWrap.append(reason);
  form.append(noteWrap);

  const act = node("button", "button", suspending ? "Suspend account" : "Restore account");
  act.type = "button";
  act.addEventListener("click", async () => {
    if (busy) return;
    if (!navigator.onLine) return showFeedback("Reconnect before changing an account. Nothing was saved.", "error");
    let payload;
    try { payload = accountStatusPayload(suspending ? "suspended" : "active", reason.value); }
    catch (error) { return showFeedback(error.message, "error"); }
    const csrf = storedCsrf();
    if (!csrf) return showFeedback("Your secure editing token is missing. Sign in again before changing an account.", "error");
    busy = true; act.disabled = true; act.setAttribute("aria-busy", "true"); act.textContent = "Saving…"; showFeedback("");
    try {
      const outcome = await requestJson(`/api/marketplace/admin/accounts/${encodeURIComponent(account.accountId)}/status`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(payload)
      });
      // Re-read rather than patching the card from the response, so the screen
      // shows the account as it now is rather than as this page believes it to
      // be.
      await find(account.email);
      showFeedback(outcome.changed
        ? (outcome.accountStatus === "suspended"
          ? `Account suspended and signed out of ${outcome.revokedSessions} session${outcome.revokedSessions === 1 ? "" : "s"}. Their bookings were not cancelled.`
          : "Account restored. They can sign in again.")
        : "That account was already in this state. Nothing changed.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      busy = false; act.disabled = false; act.removeAttribute("aria-busy");
      act.textContent = suspending ? "Suspend account" : "Restore account";
    }
  });
  form.append(act);
  card.append(form);
  return card;
}

async function find(identifier) {
  const account = (await requestJson(`/api/marketplace/admin/accounts?identifier=${encodeURIComponent(identifier)}`)).account;
  result.replaceChildren(accountCard(account));
  result.hidden = false;
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const identifier = String(new FormData(searchForm).get("identifier") || "").trim();
  if (identifier.length < 3) return showFeedback("Enter the account's exact email address or id.", "error");
  busy = true; searchSubmit.disabled = true; searchSubmit.setAttribute("aria-busy", "true"); showFeedback("");
  try { await find(identifier); }
  catch (error) {
    result.hidden = true; result.replaceChildren();
    showFeedback(error.code === "account-not-found" ? "No account matches that email address or id." : error.message, "error");
  }
  finally { busy = false; searchSubmit.disabled = false; searchSubmit.removeAttribute("aria-busy"); }
});

async function load() {
  showGate("Checking secure Administrator access…", "Account control opens only inside an authenticated Homle Administrator account.");
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (!account?.roles?.includes("administrator")) return showGate("Administrator account required", "This account cannot suspend or restore other accounts.", { signIn: true });
    gate.hidden = true; workspace.hidden = false;
  } catch (error) {
    if ([401, 403].includes(error.statusCode)) showGate("Sign in as a Homle Administrator", "Account control is not available to Landlords, Cleaners or signed-out visitors.", { signIn: true });
    else showGate("Account control could not be opened", navigator.onLine ? "Try again. No account was changed." : "Reconnect, then try again.", { retry: true });
  }
}

document.querySelector("[data-admin-accounts-retry]").addEventListener("click", load);
function network() { document.querySelector("[data-network-status]").hidden = navigator.onLine; }
window.addEventListener("online", network); window.addEventListener("offline", network); network(); load();
