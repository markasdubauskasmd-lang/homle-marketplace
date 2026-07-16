import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgresVerificationEnvironment, runPostgresDeploymentVerification, sanitizePostgresOutput } from "./postgres-verification-runner.mjs";

const toolPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(toolPath), "..");
const integrationDirectory = path.join(projectRoot, "db", "integration");
export const postgresIntegrationConfirmation = "RUN TIDEWAY DISPOSABLE DATABASE TESTS";

const scripts = Object.freeze({
  target: "assert-integration-target.sql",
  setup: "marketplace-integration-setup.sql",
  rls: "marketplace-rls-behaviour.sql",
  acceptA: "accept-booking-a.sql",
  acceptB: "accept-booking-b.sql",
  postConcurrency: "marketplace-post-concurrency.sql",
  disputeSetup: "marketplace-dispute-setup.sql",
  disputeBehaviour: "marketplace-dispute-behaviour.sql",
  paymentGate: "marketplace-payment-gate.sql",
  verify: "marketplace-integration-verify.sql",
  cleanup: "marketplace-integration-cleanup.sql"
});

function scriptPath(name) {
  return path.join(integrationDirectory, name);
}

function psqlArguments(file) {
  return ["-X", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", scriptPath(file)];
}

function failedPsql(label, result) {
  if (result?.error?.code === "ENOENT") return new Error("PostgreSQL integration tests require the psql client, which is not installed or not on PATH.");
  if (result?.error) return new Error(`${label} could not start psql.`);
  const error = new Error(`${label} failed.`);
  error.integrationOutput = sanitizePostgresOutput(`${result?.stdout || ""}\n${result?.stderr || ""}`);
  return error;
}

function runPsqlSync({ label, file, environment, command, execute }) {
  const result = execute(command, psqlArguments(file), { encoding: "utf8", windowsHide: true, env: environment });
  if (result?.status !== 0) throw failedPsql(label, result);
  return sanitizePostgresOutput(result.stdout);
}

function boundedAppend(current, chunk) {
  return (current + String(chunk || "")).slice(-8000);
}

export function runConcurrentPsql(jobs, { command = "psql", timeoutMs = 30_000, spawnProcess = spawn } = {}) {
  return Promise.all(jobs.map((job) => new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timer;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawnProcess(command, psqlArguments(job.file), { windowsHide: true, env: job.environment, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ status: null, error, stdout, stderr });
      return;
    }
    child.stdout?.on("data", (chunk) => { stdout = boundedAppend(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = boundedAppend(stderr, chunk); });
    child.on("error", (error) => finish({ status: null, error, stdout, stderr }));
    child.on("close", (status) => finish({ status, stdout: sanitizePostgresOutput(stdout), stderr: sanitizePostgresOutput(stderr) }));
    timer = setTimeout(() => {
      child.kill();
      finish({ status: null, error: new Error("Concurrent PostgreSQL test timed out."), stdout, stderr });
    }, timeoutMs);
    timer.unref?.();
  })));
}

function validateTargets(owner, app, confirmation) {
  if (confirmation !== postgresIntegrationConfirmation) throw new Error(`Set TIDEWAY_DATABASE_TEST_CONFIRMATION exactly to: ${postgresIntegrationConfirmation}`);
  if (!/_tideway_test$/i.test(owner.summary.database)) throw new Error("PostgreSQL integration database name must end in _tideway_test.");
  if (app.summary.user !== "tideway_app") throw new Error("DATABASE_INTEGRATION_APP_URL must authenticate as tideway_app.");
  if (owner.summary.user === app.summary.user || owner.summary.user === "tideway_worker") throw new Error("The integration owner must be separate from Tideway runtime and worker roles.");
  for (const field of ["host", "port", "database"]) {
    if (owner.summary[field] !== app.summary[field]) throw new Error("Integration owner and app URLs must target the same PostgreSQL database endpoint.");
  }
}

export async function runPostgresMarketplaceIntegration(options = {}) {
  const owner = postgresVerificationEnvironment(options.ownerUrl ?? process.env.DATABASE_INTEGRATION_OWNER_URL, options.baseEnvironment || process.env);
  const app = postgresVerificationEnvironment(options.appUrl ?? process.env.DATABASE_INTEGRATION_APP_URL, options.baseEnvironment || process.env);
  validateTargets(owner, app, options.confirmation ?? process.env.TIDEWAY_DATABASE_TEST_CONFIRMATION);

  const command = options.psqlCommand || "psql";
  const execute = options.spawnSync || spawnSync;
  const executeConcurrent = options.runConcurrent || ((jobs) => runConcurrentPsql(jobs, { command, spawnProcess: options.spawnProcess }));
  const ownerEnvironment = { ...owner.environment, PGAPPNAME: "tideway-integration-owner" };
  const appEnvironment = { ...app.environment, PGAPPNAME: "tideway-integration-app" };
  let fixturesCreated = false;
  let cleanupFailure = null;

  runPostgresDeploymentVerification({ connectionUrl: options.ownerUrl ?? process.env.DATABASE_INTEGRATION_OWNER_URL, psqlCommand: command, spawn: execute, baseEnvironment: options.baseEnvironment || process.env });
  runPsqlSync({ label: "Integration target guard", file: scripts.target, environment: ownerEnvironment, command, execute });

  try {
    runPsqlSync({ label: "Integration fixture setup", file: scripts.setup, environment: ownerEnvironment, command, execute });
    fixturesCreated = true;
    runPsqlSync({ label: "RLS behaviour test", file: scripts.rls, environment: appEnvironment, command, execute });

    const concurrentResults = await executeConcurrent([
      { file: scripts.acceptA, environment: appEnvironment },
      { file: scripts.acceptB, environment: appEnvironment }
    ]);
    if (!Array.isArray(concurrentResults) || concurrentResults.length !== 2) throw new Error("Concurrent PostgreSQL test runner returned an invalid result.");
    const successes = concurrentResults.filter((result) => result?.status === 0);
    const failures = concurrentResults.filter((result) => result?.status !== 0);
    const failedOutput = failures.map((result) => sanitizePostgresOutput(`${result?.stdout || ""}\n${result?.stderr || ""}`)).join("\n");
    if (successes.length !== 1 || failures.length !== 1 || !failedOutput.includes("cleaner-schedule-conflict")) {
      const error = new Error("Concurrent booking acceptance did not produce one success and one protected schedule conflict.");
      error.integrationOutput = failedOutput;
      throw error;
    }

    runPsqlSync({ label: "Post-concurrency RLS test", file: scripts.postConcurrency, environment: appEnvironment, command, execute });
    runPsqlSync({ label: "Dispute fixture setup", file: scripts.disputeSetup, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Dispute workflow test", file: scripts.disputeBehaviour, environment: appEnvironment, command, execute });
    runPsqlSync({ label: "Job-start payment gate test", file: scripts.paymentGate, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Concurrency result verification", file: scripts.verify, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Integration fixture cleanup", file: scripts.cleanup, environment: ownerEnvironment, command, execute });
    fixturesCreated = false;
    return Object.freeze({ database: owner.summary.database, host: owner.summary.host, verified: true, rls: true, concurrentOverlap: true, disputes: true, paymentJourneyGate: true, fixturesRemoved: true });
  } finally {
    if (fixturesCreated) {
      try {
        runPsqlSync({ label: "Integration fixture cleanup", file: scripts.cleanup, environment: ownerEnvironment, command, execute });
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (cleanupFailure) throw cleanupFailure;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    const result = await runPostgresMarketplaceIntegration();
    console.log(`PostgreSQL marketplace integration passed for ${result.database} on ${result.host}; RLS, privacy, social-provider step-up/removal, audited disputes, current-payment journey gating and concurrent overlap protection verified and fixtures removed.`);
  } catch (error) {
    console.error(error.message);
    if (error.integrationOutput) console.error(error.integrationOutput.trim());
    process.exitCode = 1;
  }
}
