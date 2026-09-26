import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

assert.equal(process.env.TIDEWAY_DATABASE_TEST_CONFIRMATION, "RUN TIDEWAY DISPOSABLE DATABASE TESTS");
const ownerUrl = new URL(process.env.DATABASE_INTEGRATION_OWNER_URL);
const workerUrl = new URL(process.env.DATABASE_INTEGRATION_WORKER_URL);
assert(/_tideway_test$/.test(ownerUrl.pathname));
assert.equal(ownerUrl.pathname, workerUrl.pathname);
assert.equal(ownerUrl.host, workerUrl.host);
assert.notEqual(ownerUrl.username, workerUrl.username);
const owner = new Client({ connectionString: ownerUrl.toString(), statement_timeout: 10000 });
const workers = [0, 1].map(() => new Client({ connectionString: workerUrl.toString(), statement_timeout: 10000 }));
const sqlFile = async name => (await readFile(new URL("../db/integration/" + name, import.meta.url), "utf8")).replace(/^\\set ON_ERROR_STOP on\r?\n/, "");
let created = false;
let ownerConnected = false;
const connectedWorkers = [];
try {
  await owner.connect();
  ownerConnected = true;
  assert((await owner.query("SELECT current_database() AS name")).rows[0].name.endsWith("_tideway_test"));
  assert.equal((await owner.query("SELECT count(*)::int AS count FROM users WHERE id='10000000-0000-4000-8000-000000000001'")).rows[0].count, 0, "Disposable fixtures already exist; refusing to overwrite");
  await owner.query(await sqlFile("marketplace-integration-setup.sql"));
  created = true;
  for (const worker of workers) {
    await worker.connect();
    connectedWorkers.push(worker);
    const role = (await worker.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.name, decodeURIComponent(workerUrl.username));
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
  }
  for (const [kind, table, suffix] of [["job", "job_photo_uploads", "1"], ["request", "cleaning_request_photo_uploads", "2"]]) {
    const ids = [1, 2, 3].map(n => `6e000000-0000-4000-8000-0000000000${suffix}${n}`);
    for (const [index, id] of ids.entries()) {
      const columns = kind === "job" ? "booking_id,requested_by,photo_type" : "cleaning_request_id,requested_by,room_name,note";
      const values = kind === "job"
        ? "'40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','before'"
        : "'30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Kitchen','Synthetic expiry fixture'";
      await owner.query(`INSERT INTO ${table}(id,${columns},quarantine_storage_key,final_storage_key,requested_mime_type,requested_byte_size,requested_checksum_sha256,status,created_at,expires_at)
        VALUES($1,${values},$2,$3,'image/jpeg',123,decode(repeat('a',64),'hex'),$4,now()-interval '2 hours',now()+$5::interval)`,
      [id, `quarantine/${kind}/${id}.jpg`, `${kind}-photos/${id}.jpg`, index === 2 ? "completed" : "pending", index === 1 ? "1 hour" : "-1 hour"]);
    }
    const claim = client => client.query(`SELECT * FROM tideway_private.expire_due_${kind}_photo_uploads(1000)`);
    const ack = client => client.query(`SELECT tideway_private.acknowledge_${kind}_photo_upload_cleanup($1::uuid) AS acknowledged`, [ids[0]]);
    // Hold a real row lock across two independent runtime-role connections.
    await workers[0].query("BEGIN");
    assert.deepEqual((await claim(workers[0])).rows.map(row => row.upload_id), [ids[0]]);
    assert.equal((await claim(workers[1])).rowCount, 0, "Second worker did not skip the locked upload");
    await workers[0].query("ROLLBACK");
    assert.deepEqual((await claim(workers[1])).rows.map(row => row.upload_id), [ids[0]], "Rolled-back expiry lost cleanup work");
    // A committed claim without external deletion acknowledgment is retryable.
    assert.deepEqual((await claim(workers[0])).rows.map(row => row.upload_id), [ids[0]], "Crash after claim lost cleanup work");
    for (const result of await Promise.all(workers.map(ack))) assert.equal(result.rows[0].acknowledged, true);
    assert.equal((await claim(workers[0])).rowCount, 0, "Acknowledged work was immediately reselected");
    // A late provider write is eligible for a subsequent bounded re-sweep.
    await owner.query(`UPDATE ${table} SET cleanup_completed_at=now()-interval '2 days',cleanup_attempted_at=now()-interval '2 days' WHERE id=$1`, [ids[0]]);
    assert.deepEqual((await claim(workers[1])).rows.map(row => row.upload_id), [ids[0]]);
    await ack(workers[1]);
    const preserved = (await owner.query(`SELECT id,status,cleanup_attempted_at,cleanup_completed_at FROM ${table} WHERE id=ANY($1::uuid[]) ORDER BY id`, [ids.slice(1)])).rows;
    assert.deepEqual(preserved.map(row => row.status), ["pending", "completed"]);
    assert(preserved.every(row => row.cleanup_attempted_at === null && row.cleanup_completed_at === null), "Valid media entered cleanup");
  }
  console.log("Real PostgreSQL upload cleanup passed: two worker connections, locked-row exclusion, rollback/crash recovery, duplicate acknowledgment, late-write resweep and completed/future media exclusion. No storage requests performed.");
} finally {
  await Promise.allSettled(connectedWorkers.map(worker => worker.query("ROLLBACK")));
  try {
    if (ownerConnected) await owner.query("ROLLBACK");
    if (created) await owner.query(await sqlFile("marketplace-integration-cleanup.sql"));
  } finally {
    await Promise.allSettled([...workers.map(worker => worker.end()), owner.end()]);
  }
}
