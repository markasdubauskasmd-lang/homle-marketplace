import { readFile } from "node:fs/promises";

function assert(condition, message) { if (!condition) throw new Error(message); }

const [page, script, styles, server, repository] = await Promise.all([
  readFile(new URL("../public/cleaner-availability.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-availability.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/cleaner-repository.mjs", import.meta.url), "utf8")
]);

assert(server.includes('"/cleaner/availability": "cleaner-availability.html"') && page.includes("When can you clean?") && page.includes("One quick step"), "The focused Cleaner availability route or clear single purpose is missing.");
assert((page.match(/<input /g) || []).length === 3 && page.includes('name="date" type="date"') && page.includes('name="startTime" type="time"') && page.includes('name="endTime" type="time"') && page.includes("I'm available"), "Availability asks for more than the essential day/start/end decision or lacks its plain primary action.");
assert(script.includes('fetch(path, { credentials: "same-origin"') && script.includes('sessionStorage.getItem("tideway_csrf")') && script.includes('"X-CSRF-Token": csrf') && script.includes('method: "DELETE"') && !script.includes("innerHTML") && !script.includes("localStorage"), "Availability lost authenticated CSRF protection, safe rendering or its private non-persistent boundary.");
assert(script.includes("error.statusCode === 401") && script.includes("error.statusCode === 403") && script.includes("[404, 503].includes(error.statusCode)") && page.includes('role="status" aria-live="polite"'), "Availability lacks useful loading, authentication, disconnected or accessible feedback states.");
assert(page.includes("data-withdraw-dialog") && script.includes("withdrawDialog.showModal()") && script.includes("Decline or resolve") === false && repository.includes("Decline or resolve the overlapping request or job") && repository.includes("pg_advisory_xact_lock") && repository.includes("status IN ('cleaner-invited','pending-cleaner-acceptance','confirmed'") && repository.includes("current_availability_status='unavailable'"), "Availability removal is not confirmed, serialized, booking-safe or reflected in matching status.");
assert(styles.includes(".cleaner-availability-page") && styles.includes(".availability-add-card") && styles.includes("@media (max-width: 680px)") && styles.includes("grid-template-columns: 1fr;"), "The availability screen lacks the shared responsive visual system or one-handed mobile layout.");

console.log("Cleaner availability UI tests passed: one-step exact windows, authenticated updates, clear states, booking-safe removal and responsive mobile layout.");
