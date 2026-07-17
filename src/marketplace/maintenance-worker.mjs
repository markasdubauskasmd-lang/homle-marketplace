function integer(value, minimum, maximum, fallback, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}

function result(value, limit) {
  if (!value || !Number.isInteger(value.processedCount) || value.processedCount < 0 || value.processedCount > limit || typeof value.batchFull !== "boolean" || value.batchFull !== (value.processedCount === limit)) throw new Error("A marketplace maintenance repository returned an invalid batch result.");
  return value;
}

function createDrainJob(repository, method, options) {
  if (typeof repository?.[method] !== "function") throw new TypeError(`Marketplace maintenance requires ${method}.`);
  const batchLimit = integer(options.batchLimit, 1, options.maximumLimit, options.defaultLimit, `${options.name} batch limit`);
  const maximumBatches = integer(options.maximumBatches, 1, 20, 5, `${options.name} maximum batches`);
  return Object.freeze({
    name: options.name,
    intervalMs: options.intervalMs,
    async runOnce() {
      let processed = 0;
      let batches = 0;
      let batchFull = false;
      do {
        const batch = result(await repository[method](batchLimit), batchLimit);
        processed += batch.processedCount;
        batches += 1;
        batchFull = batch.batchFull;
      } while (batchFull && batches < maximumBatches);
      return Object.freeze({ batches, processed, moreMayRemain: batchFull });
    }
  });
}

function createUploadExpiryJob(repository, method, objectStorage, options) {
  if (typeof repository?.[method] !== "function") throw new TypeError(`Marketplace maintenance requires ${method}.`);
  if (!objectStorage || typeof objectStorage.deleteObject !== "function") throw new TypeError("Private object storage is required for upload expiry.");
  const batchLimit = integer(options.batchLimit, 1, 1000, 500, `${options.name} batch limit`);
  return Object.freeze({
    name: options.name,
    intervalMs: options.intervalMs,
    async runOnce() {
      const batch = result(await repository[method](batchLimit), batchLimit);
      if (!Array.isArray(batch.uploads) || batch.uploads.length !== batch.processedCount) throw new Error("Upload expiry returned invalid object cleanup work.");
      let objectsDeleted = 0;
      for (const upload of batch.uploads) {
        const keys = [...new Set([upload.quarantineStorageKey, upload.finalStorageKey].filter(Boolean))];
        for (const key of keys) {
          await objectStorage.deleteObject(key);
          objectsDeleted += 1;
        }
      }
      return Object.freeze({ batches: 1, processed: batch.processedCount, objectsDeleted, moreMayRemain: batch.batchFull });
    }
  });
}

export function createMarketplaceMaintenanceJobs(repository, options = {}) {
  const minute = integer(options.minuteIntervalMs, 1000, 3_600_000, 60_000, "Minute maintenance interval");
  const quarterHour = integer(options.quarterHourIntervalMs, 1000, 3_600_000, 900_000, "Quarter-hour maintenance interval");
  const hourly = integer(options.hourlyIntervalMs, 1000, 86_400_000, 3_600_000, "Hourly maintenance interval");
  const jobs = [
    createDrainJob(repository, "expireInvitations", { name: "invitation-expiry", intervalMs: minute, batchLimit: 100, defaultLimit: 100, maximumLimit: 500 }),
    createDrainJob(repository, "purgeLocations", { name: "location-expiry", intervalMs: minute, batchLimit: 500, defaultLimit: 500, maximumLimit: 1000 }),
    createDrainJob(repository, "queuePaymentReadinessReminders", { name: "payment-readiness-reminders", intervalMs: quarterHour, batchLimit: 100, defaultLimit: 100, maximumLimit: 500 }),
    createDrainJob(repository, "purgeSessions", { name: "session-expiry", intervalMs: quarterHour, batchLimit: 500, defaultLimit: 500, maximumLimit: 5000 }),
    createDrainJob(repository, "purgeRateLimits", { name: "rate-limit-retention", intervalMs: hourly, batchLimit: 1000, defaultLimit: 1000, maximumLimit: 5000 }),
    createDrainJob(repository, "purgePendingSocialIdentities", { name: "social-identity-retention", intervalMs: hourly, batchLimit: 1000, defaultLimit: 1000, maximumLimit: 5000 })
  ];
  if (options.objectStorage) {
    jobs.push(createUploadExpiryJob(repository, "expireJobPhotoUploads", options.objectStorage, { name: "job-photo-upload-expiry", intervalMs: minute }));
    jobs.push(createUploadExpiryJob(repository, "expireRequestPhotoUploads", options.objectStorage, { name: "request-photo-upload-expiry", intervalMs: minute }));
  }
  return Object.freeze(jobs);
}
