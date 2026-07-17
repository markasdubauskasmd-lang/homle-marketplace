import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultWorkerPool, probeMarketplaceWorkerDatabase } from "../src/marketplace/worker-attachment.mjs";
import { createMarketplaceWorkerRuntime } from "../src/marketplace/worker-runtime.mjs";

const toolPath = fileURLToPath(import.meta.url);
export const workerVerificationConfirmation = "RUN TIDEWAY DISPOSABLE WORKER TESTS";
const allowedParameters = new Set(["sslmode", "sslrootcert", "connect_timeout"]);

export function validateWorkerVerificationTarget(connectionUrl, confirmation) {
  if (confirmation !== workerVerificationConfirmation) throw new Error(`Set TIDEWAY_WORKER_TEST_CONFIRMATION exactly to: ${workerVerificationConfirmation}`);
  let parsed;
  try { parsed = new URL(String(connectionUrl || "")); } catch { throw new TypeError("WORKER_DATABASE_VERIFICATION_URL must be a valid PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.pathname || parsed.pathname === "/") throw new TypeError("WORKER_DATABASE_VERIFICATION_URL must name one PostgreSQL database and user.");
  if (decodeURIComponent(parsed.username) !== "tideway_worker") throw new Error("Worker verification must authenticate as tideway_worker.");
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!/_tideway_test$/i.test(database)) throw new Error("Worker verification database name must end in _tideway_test.");
  for (const name of parsed.searchParams.keys()) if (!allowedParameters.has(name)) throw new TypeError(`Unsupported worker verification URL parameter: ${name}.`);
  const local = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase());
  if (!local && parsed.searchParams.get("sslmode") !== "verify-full") throw new Error("Remote worker verification requires sslmode=verify-full.");
  return Object.freeze({ connectionUrl: parsed.href, database });
}

export async function runPostgresWorkerVerification(options = {}) {
  const target = validateWorkerVerificationTarget(options.connectionUrl ?? process.env.WORKER_DATABASE_VERIFICATION_URL, options.confirmation ?? process.env.TIDEWAY_WORKER_TEST_CONFIRMATION);
  const createPool = options.createPool || createDefaultWorkerPool;
  const pool = await createPool({ ...(options.env || process.env), WORKER_DATABASE_URL: target.connectionUrl });
  let supervisor;
  try {
    const database = await (options.probeDatabase || probeMarketplaceWorkerDatabase)(pool);
    const failures = [];
    supervisor = (options.createRuntime || createMarketplaceWorkerRuntime)(pool, { onUnexpectedError(error, context) { failures.push({ error, context }); } });
    const names = ["invitation-expiry", "location-expiry", "payment-readiness-reminders", "booking-visit-reminders", "session-expiry", "rate-limit-retention", "social-identity-retention"];
    const results = [];
    for (const name of names) results.push(await supervisor.runNow(name));
    if (failures.length || results.some((result) => result?.ran !== true || result?.ok !== true)) throw new Error("One or more restricted worker jobs failed.");
    return Object.freeze({ database: target.database, postgresqlVersionNumber: database.postgresqlVersionNumber, functionCount: database.functionCount, jobs: names.length, verified: true });
  } finally {
    try { await supervisor?.close?.(); } finally { await pool?.end?.(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    const result = await runPostgresWorkerVerification();
    console.log(`PostgreSQL worker verification passed for ${result.database}: ${result.functionCount} restricted functions and ${result.jobs} maintenance jobs.`);
  } catch (error) {
    console.error(error?.message || "PostgreSQL worker verification failed.");
    process.exitCode = 1;
  }
}
