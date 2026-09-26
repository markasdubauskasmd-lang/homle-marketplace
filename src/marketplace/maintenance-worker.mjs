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

// Validate the exact server-owned shape before any deletion. In particular,
// a completed upload can never supply a final-image key to this worker.
function terminalCleanupKeys(upload, kind) {
  const id = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  const pattern = new RegExp("^quarantine/" + kind + "-photos/(" + id + ")/(" + id + ")$");
  const keys = upload?.cleanupKeys;
  if (!Array.isArray(keys) || !["completed", "rejected"].includes(upload?.status) || keys.length !== (upload.status === "completed" ? 1 : 2)) throw new Error("Terminal photo cleanup keys are invalid.");
  const match = typeof keys[0] === "string" ? pattern.exec(keys[0]) : null;
  if (!match || match[2] !== upload.uploadId || (upload.status === "rejected" && keys[1] !== kind + "-photos/" + match[1] + "/" + match[2] + ".jpg")) throw new Error("Terminal photo cleanup keys are invalid.");
  return keys;
}

function createUploadExpiryJob(repository, method, acknowledge, objectStorage, options) {
  if (typeof repository?.[acknowledge] !== "function") throw new TypeError(`Marketplace maintenance requires ${acknowledge}.`);
  if (typeof repository?.[method] !== "function") throw new TypeError(`Marketplace maintenance requires ${method}.`);
  if (!objectStorage || typeof objectStorage.deleteObject !== "function") throw new TypeError("Private object storage is required for upload expiry.");
  const batchLimit = integer(options.batchLimit, 1, 10, 10, `${options.name} batch limit`);
  return Object.freeze({
    name: options.name,
    intervalMs: options.intervalMs,
    async runOnce() {
      const batch = result(await repository[method](batchLimit), batchLimit);
      if (!Array.isArray(batch.uploads) || batch.uploads.length !== batch.processedCount) throw new Error("Upload expiry returned invalid object cleanup work.");
      let objectsDeleted = 0;
      const failures = [];
      let nextUpload = 0;
      const consume = async () => {
        while (nextUpload < batch.uploads.length) {
          const upload = batch.uploads[nextUpload++];
          try {
            if (!options.terminalKind && ![upload?.quarantineStorageKey, upload?.finalStorageKey].every((key) => typeof key === "string" && key.trim().length > 0)) throw new Error("Expired photo cleanup keys are incomplete.");
            const keys = options.terminalKind ? terminalCleanupKeys(upload, options.terminalKind) : [...new Set([upload.quarantineStorageKey, upload.finalStorageKey])];
            for (const key of keys) {
              await objectStorage.deleteObject({ storageKey: key });
              objectsDeleted += 1;
            }
            await repository[acknowledge](upload.uploadId, upload.status);
          } catch (error) { failures.push(error); }
        }
      };
      // Ten uploads at most, with five concurrent bounded storage requests.
      // Failed rows remain durable; do not serialize hundreds of timeouts.
      await Promise.all(Array.from({ length: Math.min(5, batch.uploads.length) }, consume));
      if (failures.length) throw new AggregateError(failures, "Expired photo cleanup remains pending and will be retried.");
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
    createDrainJob(repository, "queueBookingVisitReminders", { name: "booking-visit-reminders", intervalMs: quarterHour, batchLimit: 100, defaultLimit: 100, maximumLimit: 500 }),
    createDrainJob(repository, "purgeSessions", { name: "session-expiry", intervalMs: quarterHour, batchLimit: 500, defaultLimit: 500, maximumLimit: 5000 }),
    createDrainJob(repository, "purgeRateLimits", { name: "rate-limit-retention", intervalMs: hourly, batchLimit: 1000, defaultLimit: 1000, maximumLimit: 5000 }),
    createDrainJob(repository, "purgePendingSocialIdentities", { name: "social-identity-retention", intervalMs: hourly, batchLimit: 1000, defaultLimit: 1000, maximumLimit: 5000 }),
    // Hourly rather than by the minute: retention is measured in days, and a
    // deletion loop that wakes constantly to find nothing is cost without benefit.
    createDrainJob(repository, "purgeRoomScans", { name: "room-scan-retention", intervalMs: hourly, batchLimit: 200, defaultLimit: 200, maximumLimit: 2000 })
  ];
  if (options.objectStorage) {
    jobs.push(createUploadExpiryJob(repository, "expireJobPhotoUploads", "acknowledgeJobPhotoUploadCleanup", options.objectStorage, { name: "job-photo-upload-expiry", intervalMs: minute }));
    jobs.push(createUploadExpiryJob(repository, "expireRequestPhotoUploads", "acknowledgeRequestPhotoUploadCleanup", options.objectStorage, { name: "request-photo-upload-expiry", intervalMs: minute }));
  }
  if (options.objectStorage) {
    jobs.push(createUploadExpiryJob(repository, "claimJobPhotoTerminalCleanup", "acknowledgeJobPhotoTerminalCleanup", options.objectStorage, { name: "job-photo-terminal-cleanup", intervalMs: minute, terminalKind: "job" }));
    jobs.push(createUploadExpiryJob(repository, "claimRequestPhotoTerminalCleanup", "acknowledgeRequestPhotoTerminalCleanup", options.objectStorage, { name: "request-photo-terminal-cleanup", intervalMs: minute, terminalKind: "request" }));
  }
  return Object.freeze(jobs);
}
