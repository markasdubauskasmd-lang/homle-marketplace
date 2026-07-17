const controls = [...document.querySelectorAll("[data-workspace-switch]")];
const destinations = Object.freeze({ cleaner: "/cleaner/dashboard", landlord: "/landlord/dashboard" });
const labels = Object.freeze({ cleaner: "Cleaner", landlord: "Landlord" });

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function saveCsrf(token) {
  try {
    sessionStorage.setItem("tideway_csrf", token);
    return sessionStorage.getItem("tideway_csrf") === token;
  } catch { return false; }
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...requestOptions,
    headers: { Accept: "application/json", ...headers }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || "The workspace could not be opened."), { statusCode: response.status, code: result.code });
  return result;
}

async function ensureCsrf() {
  const current = storedCsrf();
  if (current) return current;
  const result = await requestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!result.csrfToken || !saveCsrf(result.csrfToken)) throw new Error("This browser could not store the secure workspace token. Sign in again.");
  return result.csrfToken;
}

async function prepare() {
  if (!controls.length) return;
  try {
    const result = await requestJson("/api/marketplace/account");
    const roles = Array.isArray(result.account?.roles) ? result.account.roles : [];
    for (const control of controls) {
      const targetRole = control.dataset.targetWorkspace || "";
      if (!destinations[targetRole]) continue;
      const existing = roles.includes(targetRole);
      control.dataset.workspaceExisting = String(existing);
      control.textContent = existing ? `${labels[targetRole]} workspace` : `Add ${labels[targetRole]} workspace`;
      control.hidden = false;
      control.disabled = false;
    }
  } catch {
    for (const control of controls) control.hidden = true;
  }
}

for (const control of controls) {
  control.addEventListener("click", async () => {
    const targetRole = control.dataset.targetWorkspace || "";
    if (!destinations[targetRole]) return;
    const existing = control.dataset.workspaceExisting === "true";
    if (!existing && !window.confirm(`Add a private ${labels[targetRole]} workspace to this verified Homle account? Your existing workspace and records will stay separate.`)) return;
    for (const item of controls) item.disabled = true;
    const original = control.textContent;
    control.textContent = "Opening…";
    try {
      const csrf = await ensureCsrf();
      const result = await requestJson("/api/marketplace/auth/workspace", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ role: targetRole }) });
      if (!result.csrfToken || !saveCsrf(result.csrfToken)) throw new Error("This browser could not keep the renewed secure workspace token.");
      location.assign(destinations[targetRole]);
    } catch (error) {
      for (const item of controls) item.disabled = false;
      control.textContent = original;
      control.title = error.message;
      control.setAttribute("aria-label", `${original}. ${error.message}`);
    }
  });
}

prepare();
