function boundedInteger(value, minimum, maximum, fallback, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}

function purgeResult(value, batchLimit) {
  if (!value || !Number.isInteger(value.deletedCount) || value.deletedCount < 0 || value.deletedCount > batchLimit || typeof value.batchFull !== "boolean" || value.batchFull !== (value.deletedCount === batchLimit)) {
    throw new TypeError("The session purge repository returned an invalid batch result.");
  }
  return value;
}

export function createSessionPurgeWorker(repository, options = {}) {
  if (!repository || typeof repository.purgeBatch !== "function") throw new TypeError("A session purge repository is required.");
  const batchLimit = boundedInteger(options.batchLimit, 1, 5000, 500, "Session purge batch limit");
  const maximumBatches = boundedInteger(options.maximumBatches, 1, 20, 5, "Session purge maximum batches");

  return Object.freeze({
    async runOnce() {
      let deleted = 0;
      let batches = 0;
      let batchFull = false;
      do {
        const result = purgeResult(await repository.purgeBatch(batchLimit), batchLimit);
        batches += 1;
        deleted += result.deletedCount;
        batchFull = result.batchFull;
      } while (batchFull && batches < maximumBatches);

      return Object.freeze({ batches, deleted, moreMayRemain: batchFull });
    }
  });
}
