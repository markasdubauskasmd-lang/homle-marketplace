const [rawToken = "", rawReference = ""] = location.hash.slice(1).split("|");
const customerStatusToken = /^[A-Za-z0-9_-]{32}$/.test(rawToken) ? rawToken : "";
const fragmentReference = /^BRF-[A-Z0-9]{8}$/.test(rawReference) ? rawReference : "";
if (location.hash) history.replaceState(null, "", "/brief-complete");

document.querySelectorAll("[data-year]").forEach((element) => { element.textContent = String(new Date().getFullYear()); });

let completion = null;
try {
  const stored = JSON.parse(sessionStorage.getItem("tidewayBriefComplete") || "null");
  if (stored && /^BRF-[A-Z0-9]{8}$/.test(stored.reference || "") && Date.now() - Number(stored.storedAt || 0) < 24 * 60 * 60 * 1000) completion = stored;
} catch {}

const reference = document.querySelector("[data-brief-reference]");
if (fragmentReference || completion?.reference) reference.textContent = fragmentReference || completion.reference;

const statusLink = document.querySelector("[data-status-link]");
const safeToken = customerStatusToken || (/^[A-Za-z0-9_-]{32}$/.test(completion?.customerStatusToken || "") ? completion.customerStatusToken : "");
if (safeToken) {
  statusLink.href = `/request-status#${safeToken}`;
  statusLink.hidden = false;
}
