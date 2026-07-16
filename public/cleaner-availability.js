const gate = document.querySelector("[data-availability-gate]");
const workspace = document.querySelector("[data-availability-workspace]");
const form = document.querySelector("[data-availability-form]");
const submit = document.querySelector("[data-availability-submit]");
const feedback = document.querySelector("[data-availability-feedback]");
const list = document.querySelector("[data-availability-list]");
const empty = document.querySelector("[data-availability-empty]");
const retry = document.querySelector("[data-availability-retry]");
const signIn = document.querySelector("[data-availability-sign-in]");
const withdrawDialog = document.querySelector("[data-withdraw-dialog]");
const withdrawForm = document.querySelector("[data-withdraw-form]");
let windows = [];
let selectedAvailabilityId = "";
let loading = false;

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function showGate(title, copy, { kind = "info", allowSignIn = false, allowRetry = false } = {}) {
  gate.hidden = false;
  gate.dataset.kind = kind;
  document.querySelector("[data-availability-gate-title]").textContent = title;
  document.querySelector("[data-availability-gate-copy]").textContent = copy;
  signIn.hidden = !allowSignIn;
  retry.hidden = !allowRetry;
  workspace.hidden = true;
}

function showFeedback(message, kind = "info") {
  feedback.hidden = !message;
  feedback.dataset.kind = kind;
  feedback.textContent = message;
  if (message) feedback.focus();
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers: { Accept: "application/json", ...headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || "Your availability could not be updated."), { statusCode: response.status, code: result.code });
  return result;
}

function localDateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new TypeError("Choose a valid day and time.");
  const value = new Date(`${date}T${time}:00`);
  if (Number.isNaN(value.getTime())) throw new TypeError("Choose a valid day and time.");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (value.getFullYear() !== year || value.getMonth() + 1 !== month || value.getDate() !== day || value.getHours() !== hour || value.getMinutes() !== minute) throw new TypeError("That local time does not exist. Choose another time.");
  return value.toISOString();
}

function formatWindow(item) {
  const start = new Date(item.startAt);
  const end = new Date(item.endAt);
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(start);
  const times = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${times.format(start)}-${times.format(end)}`;
}

function render() {
  list.replaceChildren();
  for (const item of windows) {
    const card = document.createElement("article");
    card.className = "availability-window";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = formatWindow(item);
    const note = document.createElement("span");
    note.textContent = item.status === "held" ? "Held for an active request" : "Available for matching";
    copy.append(title, note);
    card.append(copy);
    if (item.status === "available") {
      const remove = document.createElement("button");
      remove.className = "text-button availability-remove";
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove availability ${formatWindow(item)}`);
      remove.addEventListener("click", () => openWithdraw(item));
      card.append(remove);
    }
    list.append(card);
  }
  list.hidden = windows.length === 0;
  empty.hidden = windows.length > 0;
}

function defaultDay() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function loadAvailability() {
  if (loading) return;
  loading = true;
  showGate("Checking secure Cleaner access...", "Your availability is private to your account.");
  try {
    const result = await requestJson("/api/marketplace/cleaner/availability");
    windows = Array.isArray(result.availability) ? result.availability : [];
    render();
    gate.hidden = true;
    workspace.hidden = false;
  } catch (error) {
    if (error.statusCode === 401) showGate("Sign in as a Cleaner to set availability.", "Only your Cleaner account can change your schedule.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showGate("This is not a Cleaner account.", "Use the Cleaner workspace selected during onboarding.", { kind: "authentication", allowSignIn: true });
    else if ([404, 503].includes(error.statusCode)) showGate("Cleaner availability is not connected yet.", "No schedule was changed. Try again after the secure marketplace is connected.", { kind: "unavailable", allowRetry: true });
    else showGate("Availability is temporarily unavailable.", "No schedule was changed. Check the connection and try again.", { kind: "error", allowRetry: true });
  } finally { loading = false; }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showFeedback("");
  const csrf = storedCsrf();
  if (!csrf) return showFeedback("Your secure editing token is missing. Sign in again before saving.", "error");
  const data = new FormData(form);
  let body;
  try { body = { startAt: localDateTime(data.get("date")?.toString() || "", data.get("startTime")?.toString() || ""), endAt: localDateTime(data.get("date")?.toString() || "", data.get("endTime")?.toString() || "") }; }
  catch (error) { return showFeedback(error.message, "error"); }
  submit.disabled = true;
  submit.setAttribute("aria-busy", "true");
  submit.textContent = "Adding...";
  try {
    const result = await requestJson("/api/marketplace/cleaner/availability", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    windows = [...windows, result.availability].sort((left, right) => new Date(left.startAt) - new Date(right.startAt));
    render();
    showFeedback("Availability added. Suitable requests can now match this time.", "success");
  } catch (error) { showFeedback(error.message, "error"); }
  finally { submit.disabled = false; submit.removeAttribute("aria-busy"); submit.textContent = "I'm available"; }
});

function openWithdraw(item) {
  selectedAvailabilityId = item.availabilityId;
  document.querySelector("[data-withdraw-copy]").textContent = `${formatWindow(item)} will no longer be used for new matching.`;
  withdrawDialog.showModal();
}

withdrawForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const csrf = storedCsrf();
  if (!csrf) { withdrawDialog.close(); return showFeedback("Your secure editing token is missing. Sign in again before changing availability.", "error"); }
  const confirm = document.querySelector("[data-withdraw-confirm]");
  confirm.disabled = true;
  confirm.textContent = "Removing...";
  try {
    await requestJson(`/api/marketplace/cleaner/availability/${encodeURIComponent(selectedAvailabilityId)}`, { method: "DELETE", headers: { "X-CSRF-Token": csrf } });
    windows = windows.filter((item) => item.availabilityId !== selectedAvailabilityId);
    render();
    withdrawDialog.close();
    showFeedback("Availability removed.", "success");
  } catch (error) { withdrawDialog.close(); showFeedback(error.message, "error"); }
  finally { confirm.disabled = false; confirm.textContent = "Remove time"; }
});

document.querySelector("[data-withdraw-cancel]").addEventListener("click", () => withdrawDialog.close());
retry.addEventListener("click", loadAvailability);
form.elements.date.value = defaultDay();
form.elements.date.min = new Date().toISOString().slice(0, 10);
loadAvailability();
