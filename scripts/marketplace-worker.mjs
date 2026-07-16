import { createMarketplaceWorkerAttachment } from "../src/marketplace/worker-attachment.mjs";

let attachment;
let stopping = false;

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  try { await attachment?.close?.(); } catch { process.exitCode = 1; }
  if (signal) process.stdout.write(`Tideway marketplace worker stopped after ${signal}.\n`);
}

try {
  attachment = await createMarketplaceWorkerAttachment();
  if (!attachment.enabled || !attachment.ready) throw new Error("Marketplace worker service is not enabled.");
  attachment.start();
  process.stdout.write(`Tideway marketplace worker ready with ${attachment.snapshot().jobs.length} scheduled jobs.\n`);
  process.once("SIGTERM", () => { void stop("SIGTERM"); });
  process.once("SIGINT", () => { void stop("SIGINT"); });
} catch (error) {
  process.stderr.write(`Tideway marketplace worker could not start: ${error?.message || "startup failed"}\n`);
  await stop();
  process.exitCode = 1;
}
