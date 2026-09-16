import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";

// Operational process identity only: no account, request or provider data.
// An exit marker is evidence that this process cannot resume asynchronous
// commands, not a claim that every in-flight operation finished successfully.
export function recordProcessLifecycle({ release = {}, commandWritesPaused = false,
  processObject = process, write = line => writeSync(1, line), bootId = randomUUID() } = {}) {
  const identity = {
    bootId,
    sourceCommit: /^[a-f0-9]{8}$/.test(release.sourceCommit || "") ? release.sourceCommit : null,
    migrationCount: Number.isInteger(release.migrationCount) ? release.migrationCount : null,
    commandWritesPaused: commandWritesPaused === true
  };
  let shutdownRequested = false;
  const record = (event, extra = {}) => {
    try { write(JSON.stringify({ event, ...identity, ...extra }) + "\n"); }
    catch { /* Missing evidence must not be mistaken for a successful exit. */ }
  };
  processObject.once("exit", exitCode => {
    // The exit event permits synchronous work only. Do not enqueue a flush or
    // promise here: it would be abandoned and could lose the termination proof.
    record("homlle-process-exit", { shutdownRequested, exitCode });
  });
  record("homlle-process-start");
  return Object.freeze({ requestShutdown() { shutdownRequested = true; } });
}
