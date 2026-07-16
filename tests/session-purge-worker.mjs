import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSessionPurgeRepository } from "../src/marketplace/session-purge-repository.mjs";
import { createSessionPurgeWorker } from "../src/marketplace/session-purge-worker.mjs";

const migration = await readFile(new URL("../db/migrations/019_expired_session_purge.sql", import.meta.url), "utf8");
const runtimeGrants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const workerGrants = await readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8");
for (const required of ["sessions_expiry_purge_idx", "purge_expired_sessions", "expires_at <= now()", "ORDER BY candidate.expires_at, candidate.id", "FOR UPDATE OF candidate SKIP LOCKED", "LIMIT batch_limit", "DELETE FROM sessions", "batch_limit > 5000", "REVOKE ALL"]) {
  assert.ok(migration.includes(required), `Session purge migration omitted ${required}.`);
}
assert.ok(workerGrants.includes("GRANT EXECUTE ON FUNCTION tideway_private.purge_expired_sessions(integer) TO tideway_worker"), "The restricted worker cannot execute the session purge.");
assert.ok(runtimeGrants.includes("REVOKE DELETE ON sessions FROM tideway_app") && !runtimeGrants.includes("purge_expired_sessions") && !workerGrants.includes("GRANT DELETE ON sessions") && !workerGrants.includes("GRANT SELECT ON sessions"), "A web/worker role received direct session-purge table authority.");

const calls = [];
const batches = [
  { deletedCount: 3, batchFull: true },
  { deletedCount: 3, batchFull: true },
  { deletedCount: 1, batchFull: false }
];
const worker = createSessionPurgeWorker({ async purgeBatch(limit) { calls.push(limit); return batches.shift(); } }, { batchLimit: 3, maximumBatches: 5 });
assert.deepEqual(await worker.runOnce(), { batches: 3, deleted: 7, moreMayRemain: false });
assert.deepEqual(calls, [3, 3, 3]);

const cappedWorker = createSessionPurgeWorker({ async purgeBatch() { return { deletedCount: 2, batchFull: true }; } }, { batchLimit: 2, maximumBatches: 2 });
assert.deepEqual(await cappedWorker.runOnce(), { batches: 2, deleted: 4, moreMayRemain: true }, "A full final batch did not signal that another scheduled run may be needed.");

const emptyWorker = createSessionPurgeWorker({ async purgeBatch() { return { deletedCount: 0, batchFull: false }; } });
assert.deepEqual(await emptyWorker.runOnce(), { batches: 1, deleted: 0, moreMayRemain: false }, "An idempotent empty purge did not stop after one bounded batch.");

await assert.rejects(() => createSessionPurgeWorker({ async purgeBatch() { return { deletedCount: 2, batchFull: false }; } }, { batchLimit: 2 }).runOnce(), /invalid batch result/);
await assert.rejects(() => createSessionPurgeWorker({ async purgeBatch() { throw new Error("worker database unavailable"); } }).runOnce(), /worker database unavailable/);
assert.throws(() => createSessionPurgeWorker(null), /repository/);
assert.throws(() => createSessionPurgeWorker({ purgeBatch() {} }, { batchLimit: 5001 }), /batch limit/);

const poolCalls = [];
const repository = createSessionPurgeRepository({ async query(text, values) { poolCalls.push({ text, values }); return { rows: [{ deleted_count: "12", batch_full: false }] }; } });
assert.deepEqual(await repository.purgeBatch(500), { deletedCount: 12, batchFull: false });
assert.equal(poolCalls[0].text, "SELECT * FROM tideway_private.purge_expired_sessions($1::integer)");
assert.deepEqual(poolCalls[0].values, [500]);
assert.ok(!poolCalls[0].text.includes("DELETE FROM sessions"), "The worker repository bypassed the narrow purge function.");
assert.throws(() => createSessionPurgeRepository(null), /dedicated Homle worker/);

console.log("Session purge tests passed: bounded SKIP LOCKED deletion, least privilege, multi-batch draining, idempotency and failure propagation.");
