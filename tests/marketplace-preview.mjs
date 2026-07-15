import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, script, styles, server] = await Promise.all([
  readFile(path.join(root, "public", "marketplace-preview.html"), "utf8"),
  readFile(path.join(root, "public", "marketplace-preview.js"), "utf8"),
  readFile(path.join(root, "public", "styles.css"), "utf8"),
  readFile(path.join(root, "server.mjs"), "utf8")
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(html.includes("Design preview — no real Cleaner or active booking"), "The sample profile could be mistaken for a real Cleaner or booking.");
assert(html.includes("It does not collect location, contact anyone or create a booking."), "The preview is missing its privacy and non-action disclosure.");
assert(html.includes('data-preview-screen="profile"') && html.includes('data-preview-screen="tracking"'), "Cleaner profile or live tracking preview is missing.");
assert(["Start journey", "I have arrived", "Start cleaning", "Finish cleaning"].every((label) => html.includes(label)), "The core active-job actions are incomplete.");
assert(html.includes("Exact address appears only to confirmed participants") && html.includes("Private to this booking"), "The preview does not explain participant-only location and address access.");
assert(html.includes('role="progressbar"') && script.includes('setAttribute("aria-valuenow"'), "Dynamic progress is not exposed accessibly.");
assert(!/(navigator\.geolocation|fetch\(|WebSocket|EventSource)/.test(script), "The design preview unexpectedly accesses live location or a backend.");
assert(styles.includes(".profile-preview-layout") && styles.includes(".tracking-preview-layout") && styles.includes("@media (max-width: 680px)"), "Responsive profile or tracking styles are missing.");
assert(server.includes('"/marketplace-preview": "marketplace-preview.html"'), "The clean marketplace preview route is not registered.");

console.log("Marketplace preview tests passed: truthful sample profile, private tracking states, accessible progress and mobile layout.");
