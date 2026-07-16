import { createAutomaticDispatchRepository } from "./automatic-dispatch-repository.mjs";
import { createAutomaticDispatchWorker } from "./automatic-dispatch-worker.mjs";
import { createEmailNotificationRepository } from "./email-notification-repository.mjs";
import { createEmailNotificationWorker } from "./email-notification-worker.mjs";
import { createMaintenanceRepository } from "./maintenance-repository.mjs";
import { createMarketplaceMaintenanceJobs } from "./maintenance-worker.mjs";
import { createWorkerSupervisor } from "./worker-supervisor.mjs";

function integer(value, minimum, maximum, fallback, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}

export function createMarketplaceWorkerRuntime(pool, options = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A dedicated Tideway worker PostgreSQL pool is required.");
  if (typeof options.onUnexpectedError !== "function") throw new TypeError("Marketplace workers require private operational error monitoring.");
  const jobs = [...createMarketplaceMaintenanceJobs((options.createMaintenanceRepository || createMaintenanceRepository)(pool), {
    objectStorage: options.objectStorage,
    minuteIntervalMs: options.minuteIntervalMs,
    quarterHourIntervalMs: options.quarterHourIntervalMs,
    hourlyIntervalMs: options.hourlyIntervalMs
  })];

  if (options.emailDelivery) {
    const worker = createEmailNotificationWorker((options.createEmailRepository || createEmailNotificationRepository)(pool), options.emailDelivery, {
      appOrigin: options.appOrigin,
      batchLimit: integer(options.emailBatchLimit, 1, 100, 25, "Email worker batch limit"),
      leaseSeconds: integer(options.emailLeaseSeconds, 30, 600, 180, "Email worker lease duration")
    });
    jobs.push(Object.freeze({ name: "email-notifications", intervalMs: integer(options.emailIntervalMs, 1000, 3_600_000, 15_000, "Email worker interval"), runOnce: () => worker.runOnce() }));
  }

  if (options.dispatchPricingPolicy) {
    const worker = createAutomaticDispatchWorker((options.createDispatchRepository || createAutomaticDispatchRepository)(pool), options.dispatchPricingPolicy, {
      batchLimit: integer(options.dispatchBatchLimit, 1, 50, 10, "Automatic-dispatch batch limit"),
      leaseSeconds: integer(options.dispatchLeaseSeconds, 30, 600, 120, "Automatic-dispatch lease duration"),
      retryMinutes: integer(options.dispatchRetryMinutes, 1, 1440, 15, "Automatic-dispatch retry delay")
    });
    jobs.push(Object.freeze({ name: "automatic-dispatch", intervalMs: integer(options.dispatchIntervalMs, 1000, 3_600_000, 60_000, "Automatic-dispatch interval"), runOnce: () => worker.runOnce() }));
  }

  return createWorkerSupervisor(jobs, {
    onUnexpectedError: options.onUnexpectedError,
    clock: options.clock,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
    keepAlive: options.keepAlive
  });
}
