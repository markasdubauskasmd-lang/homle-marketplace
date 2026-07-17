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
  administratorBootstrapDenied: "administrator-bootstrap-app-denied.sql",
  administratorBootstrapOwner: "administrator-bootstrap-owner.sql",
  setup: "marketplace-integration-setup.sql",
  matchingSelfExclusion: "matching-self-exclusion.sql",
  automaticDispatchSetup: "automatic-dispatch-rehearsal-setup.sql",
  automaticDispatchClaimA: "automatic-dispatch-claim-a.sql",
  automaticDispatchClaimB: "automatic-dispatch-claim-b.sql",
  automaticDispatchFirstInviteA: "automatic-dispatch-first-invite-a.sql",
  automaticDispatchFirstInviteB: "automatic-dispatch-first-invite-b.sql",
  automaticDispatchFirstExpirySetup: "automatic-dispatch-first-expiry-setup.sql",
  automaticDispatchRequeue: "automatic-dispatch-requeue.sql",
  automaticDispatchSecondExpirySetup: "automatic-dispatch-second-expiry-setup.sql",
  automaticDispatchAttemptLimit: "automatic-dispatch-attempt-limit.sql",
  automaticDispatchVerify: "automatic-dispatch-rehearsal-verify.sql",
  automaticDispatchCleanup: "automatic-dispatch-rehearsal-cleanup.sql",
  landlordSingleDispatch: "landlord-single-dispatch-authorization.sql",
  cleaningRequestRealtimeAndAvatar: "cleaning-request-realtime-and-avatar.sql",
  facebookDataDeletion: "facebook-data-deletion-behaviour.sql",
  rls: "marketplace-rls-behaviour.sql",
  acceptA: "accept-booking-a.sql",
  acceptB: "accept-booking-b.sql",
  postConcurrency: "marketplace-post-concurrency.sql",
  participantLifecycleSetup: "participant-lifecycle-rehearsal-setup.sql",
  participantLifecycle: "participant-lifecycle-rehearsal.sql",
  disputeSetup: "marketplace-dispute-setup.sql",
  disputeBehaviour: "marketplace-dispute-behaviour.sql",
  paymentGate: "marketplace-payment-gate.sql",
  paymentOrdering: "marketplace-payment-ordering.sql",
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

function validateTargets(owner, app, worker, confirmation) {
  if (confirmation !== postgresIntegrationConfirmation) throw new Error(`Set TIDEWAY_DATABASE_TEST_CONFIRMATION exactly to: ${postgresIntegrationConfirmation}`);
  if (!/_tideway_test$/i.test(owner.summary.database)) throw new Error("PostgreSQL integration database name must end in _tideway_test.");
  if (app.summary.user !== "tideway_app") throw new Error("DATABASE_INTEGRATION_APP_URL must authenticate as tideway_app.");
  if (worker.summary.user !== "tideway_worker") throw new Error("DATABASE_INTEGRATION_WORKER_URL must authenticate as tideway_worker.");
  if (owner.summary.user === app.summary.user || owner.summary.user === worker.summary.user) throw new Error("The integration owner must be separate from Tideway runtime and worker roles.");
  for (const field of ["host", "port", "database"]) {
    if (owner.summary[field] !== app.summary[field] || owner.summary[field] !== worker.summary[field]) throw new Error("Integration owner, app and worker URLs must target the same PostgreSQL database endpoint.");
  }
}

export async function runPostgresMarketplaceIntegration(options = {}) {
  const owner = postgresVerificationEnvironment(options.ownerUrl ?? process.env.DATABASE_INTEGRATION_OWNER_URL, options.baseEnvironment || process.env);
  const app = postgresVerificationEnvironment(options.appUrl ?? process.env.DATABASE_INTEGRATION_APP_URL, options.baseEnvironment || process.env);
  const worker = postgresVerificationEnvironment(options.workerUrl ?? process.env.DATABASE_INTEGRATION_WORKER_URL, options.baseEnvironment || process.env);
  validateTargets(owner, app, worker, options.confirmation ?? process.env.TIDEWAY_DATABASE_TEST_CONFIRMATION);

  const command = options.psqlCommand || "psql";
  const execute = options.spawnSync || spawnSync;
  const executeConcurrent = options.runConcurrent || ((jobs) => runConcurrentPsql(jobs, { command, spawnProcess: options.spawnProcess }));
  const ownerEnvironment = { ...owner.environment, PGAPPNAME: "tideway-integration-owner" };
  const appEnvironment = { ...app.environment, PGAPPNAME: "tideway-integration-app" };
  const workerEnvironment = { ...worker.environment, PGAPPNAME: "tideway-integration-worker" };
  let fixturesCreated = false;
  let cleanupFailure = null;

  runPostgresDeploymentVerification({ connectionUrl: options.ownerUrl ?? process.env.DATABASE_INTEGRATION_OWNER_URL, psqlCommand: command, spawn: execute, baseEnvironment: options.baseEnvironment || process.env });
  runPsqlSync({ label: "Integration target guard", file: scripts.target, environment: ownerEnvironment, command, execute });
  runPsqlSync({ label: "Restricted Administrator bootstrap denial", file: scripts.administratorBootstrapDenied, environment: appEnvironment, command, execute });
  runPsqlSync({ label: "Migration-owner Administrator bootstrap", file: scripts.administratorBootstrapOwner, environment: ownerEnvironment, command, execute });

  try {
    runPsqlSync({ label: "Integration fixture setup", file: scripts.setup, environment: ownerEnvironment, command, execute });
    fixturesCreated = true;
    runPsqlSync({ label: "Matching self-exclusion behaviour test", file: scripts.matchingSelfExclusion, environment: appEnvironment, command, execute });
    runPsqlSync({ label: "Automatic-dispatch rehearsal setup", file: scripts.automaticDispatchSetup, environment: ownerEnvironment, command, execute });
    const dispatchClaims = await executeConcurrent([
      { file: scripts.automaticDispatchClaimA, environment: workerEnvironment },
      { file: scripts.automaticDispatchClaimB, environment: workerEnvironment }
    ]);
    if (!Array.isArray(dispatchClaims) || dispatchClaims.length !== 2 || dispatchClaims.some((result) => result?.status !== 0)) {
      const error = new Error("Concurrent automatic-dispatch workers did not both finish safely.");
      error.integrationOutput = dispatchClaims?.map((result) => sanitizePostgresOutput(`${result?.stdout || ""}\n${result?.stderr || ""}`)).join("\n") || "";
      throw error;
    }
    const claimA = dispatchClaims[0].stdout.includes("AUTOMATIC_DISPATCH_CLAIM_A|1") && dispatchClaims[1].stdout.includes("AUTOMATIC_DISPATCH_CLAIM_B|0");
    const claimB = dispatchClaims[0].stdout.includes("AUTOMATIC_DISPATCH_CLAIM_A|0") && dispatchClaims[1].stdout.includes("AUTOMATIC_DISPATCH_CLAIM_B|1");
    if (claimA === claimB) throw new Error("Concurrent automatic-dispatch workers did not produce exactly one lease owner.");
    runPsqlSync({ label: "First automatic invitation", file: claimA ? scripts.automaticDispatchFirstInviteA : scripts.automaticDispatchFirstInviteB, environment: workerEnvironment, command, execute });
    runPsqlSync({ label: "First automatic-invitation expiry setup", file: scripts.automaticDispatchFirstExpirySetup, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Automatic-dispatch expiry and requeue", file: scripts.automaticDispatchRequeue, environment: workerEnvironment, command, execute });
    runPsqlSync({ label: "Second automatic-invitation expiry setup", file: scripts.automaticDispatchSecondExpirySetup, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Automatic-dispatch attempt ceiling", file: scripts.automaticDispatchAttemptLimit, environment: workerEnvironment, command, execute });
    runPsqlSync({ label: "Automatic-dispatch rehearsal verification", file: scripts.automaticDispatchVerify, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Automatic-dispatch rehearsal cleanup", file: scripts.automaticDispatchCleanup, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Landlord single-dispatch authorization test", file: scripts.landlordSingleDispatch, environment: appEnvironment, command, execute });
    runPsqlSync({ label: "Private request live-update and session-avatar test", file: scripts.cleaningRequestRealtimeAndAvatar, environment: appEnvironment, command, execute });
    runPsqlSync({ label: "Facebook data-deletion behaviour test", file: scripts.facebookDataDeletion, environment: appEnvironment, command, execute });
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
    runPsqlSync({ label: "Job-start payment gate test", file: scripts.paymentGate, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Participant lifecycle rehearsal setup", file: scripts.participantLifecycleSetup, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Participant lifecycle rehearsal", file: scripts.participantLifecycle, environment: appEnvironment, command, execute });
    runPsqlSync({ label: "Dispute fixture setup", file: scripts.disputeSetup, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Dispute workflow test", file: scripts.disputeBehaviour, environment: appEnvironment, command, execute });
    runPsqlSync({ label: "Payment reconciliation ordering test", file: scripts.paymentOrdering, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Concurrency result verification", file: scripts.verify, environment: ownerEnvironment, command, execute });
    runPsqlSync({ label: "Integration fixture cleanup", file: scripts.cleanup, environment: ownerEnvironment, command, execute });
    fixturesCreated = false;
    return Object.freeze({ database: owner.summary.database, host: owner.summary.host, verified: true, administratorBootstrap: true, matchingSelfExclusion: true, automaticDispatchConcurrency: true, automaticDispatchRequeue: true, landlordSingleDispatch: true, requestRealtimeAndAvatar: true, facebookDataDeletion: true, rls: true, concurrentOverlap: true, participantLifecycle: true, participantMessaging: true, disputes: true, paymentJourneyGate: true, paymentOrdering: true, fixturesRemoved: true });
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
    console.log(`PostgreSQL marketplace integration passed for ${result.database} on ${result.host}; owner-only first-Administrator bootstrap, signed-provider deletion persistence, RLS, privacy, two-worker automatic dispatch with expiry/requeue, concurrent booking overlap protection, a complete synthetic Landlord-to-Cleaner lifecycle with private two-way messaging, audited disputes, current-payment journey gating and exactly-once payment ordering verified and fixtures removed.`);
  } catch (error) {
    console.error(error.message);
    if (error.integrationOutput) console.error(error.integrationOutput.trim());
    process.exitCode = 1;
  }
}
