import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { createEmailNotificationRepository } from "../src/marketplace/email-notification-repository.mjs";
import { createEmailNotificationWorker } from "../src/marketplace/email-notification-worker.mjs";

export function validateEmailLeaseEnvironment(env) {
  assert.equal(env.TIDEWAY_DATABASE_TEST_CONFIRMATION, "RUN TIDEWAY DISPOSABLE DATABASE TESTS");
  const ownerUrl = new URL(env.DATABASE_INTEGRATION_OWNER_URL);
  const workerUrl = new URL(env.DATABASE_INTEGRATION_WORKER_URL);
  for (const [url, role] of [[ownerUrl, "tideway_owner"], [workerUrl, "tideway_worker"]]) {
    assert(["postgres:", "postgresql:"].includes(url.protocol));
    assert.equal(url.hostname, "localhost");
    assert.equal(url.pathname, "/ci_tideway_test");
    assert.equal(decodeURIComponent(url.username), role);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert(url.password.length > 0, "Explicit disposable credentials are required");
  }
  assert.equal(ownerUrl.port || "5432", workerUrl.port || "5432");
  return { ownerUrl, workerUrl };
}

let phase = "configuration";

async function rehearse() {
  const { ownerUrl, workerUrl } = validateEmailLeaseEnvironment(process.env);
  const owner = new Client({ connectionString: ownerUrl.toString(), statement_timeout: 10000, connectionTimeoutMillis: 10000 });
  const clients = [0, 1].map(() => new Client({ connectionString: workerUrl.toString(), statement_timeout: 10000, connectionTimeoutMillis: 10000 }));
  const connected = [];
  const fixtureUsers = [1, 2, 3, 4, 5].map(number => "10000000-0000-4000-8000-" + String(number).padStart(12, "0"));
  const ids = [1, 2, 3].map(number => "7b000000-0000-4000-8000-" + String(number).padStart(12, "0"));
  const sqlFile = async name => (await readFile(new URL("../db/integration/" + name, import.meta.url), "utf8")).replace(/^\\set ON_ERROR_STOP on\r?\n/, "");
  const setupSql = await sqlFile("marketplace-integration-setup.sql");
  const cleanupSql = await sqlFile("marketplace-integration-cleanup.sql");
  const reservedIds = [...new Set([...setupSql.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g), ...cleanupSql.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g)].map(match => match[0]))];
  assert(reservedIds.length > fixtureUsers.length);
  const quote = value => '"' + value.replaceAll('"', '""') + '"';
  let created = false, releaseCompletion, firstRun;
  const completionGate = new Promise(resolve => { releaseCompletion = resolve; });
  let signalCompletion;
  const completionStarted = new Promise(resolve => { signalCompletion = resolve; });
  let watchdog;
  try {
    phase = "fixture-guards";
    await owner.connect(); connected.push(owner);
    const ownerRole = (await owner.query("SELECT current_user AS role,current_database() AS database,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(ownerRole.database, "ci_tideway_test");
    assert.equal(ownerRole.role, "tideway_owner");
    assert.equal(ownerRole.rolsuper, false);
    assert.equal(ownerRole.rolbypassrls, false);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM notifications WHERE id=ANY($1::uuid[])", [ids])).rows[0].count, 0, "Existing explicit notification fixture refused");
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM users WHERE id=ANY($1::uuid[])", [fixtureUsers])).rows[0].count, 0, "Existing integration fixture refused");
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM notifications WHERE channel='email' AND delivery_status='pending'")).rows[0].count, 0, "Unrelated pending email work refused");
    // Shared cleanup references more than users. Refuse any pre-existing row
    // containing any reserved setup/cleanup UUID before creating our fixtures.
    const uuidColumns = (await owner.query("SELECT n.nspname AS schema,c.relname AS table,a.attname AS column FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','tideway_private') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype")).rows;
    for (const field of uuidColumns) {
      const found = await owner.query("SELECT EXISTS(SELECT 1 FROM " + quote(field.schema) + "." + quote(field.table) + " WHERE " + quote(field.column) + "=ANY($1::uuid[])) AS present", [reservedIds]);
      assert.equal(found.rows[0].present, false, "Reserved shared fixture identity already exists; setup and cleanup refused");
    }
    phase = "synthetic-seed";
    await owner.query(setupSql); created = true;
    // Only setup-owned synthetic recipients: keep its unrelated fixture events
    // from taking the three explicit regression records' claim positions.
    await owner.query("UPDATE notifications SET next_attempt_at=now()+interval '1 day' WHERE channel='email' AND recipient_user_id=ANY($1::uuid[])", [fixtureUsers]);
    for (const [index, id] of ids.entries()) {
      await owner.query("INSERT INTO notifications(id,recipient_user_id,booking_id,event_type,channel,idempotency_key,next_attempt_at) VALUES($1,$2,'40000000-0000-4000-8000-000000000001','booking-confirmed','email',$3,now()-interval '1 hour'+$4::interval)",
        [id, fixtureUsers[0], "email-lease-rehearsal:" + id, index + " seconds"]);
    }
    phase = "worker-connections";
    for (const connection of clients) {
      await connection.connect(); connected.push(connection);
      const role = (await connection.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
      assert.equal(role.name, "tideway_worker"); assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
    }
    const repositories = clients.map(createEmailNotificationRepository);
    let held = false;
    const delayedRepository = {
      claimDue: (...args) => repositories[0].claimDue(...args),
      async complete(...args) {
        if (held) return repositories[0].complete(...args);
        held = true;
        await clients[0].query("BEGIN");
        await repositories[0].complete(...args);
        signalCompletion();
        await completionGate;
        await clients[0].query("COMMIT");
      }
    };
    const deliveries = [];
    const delivery = { async send(message) {
      assert(ids.includes(message.idempotencyKey), "Worker attempted unrelated notification");
      deliveries.push(message.idempotencyKey);
      return { accepted: true };
    } };
    const options = { appOrigin: "https://homlle.invalid" };
    const workerA = createEmailNotificationWorker(delayedRepository, delivery, options);
    const workerB = createEmailNotificationWorker(repositories[1], delivery, options);
    phase = "held-completion";
    firstRun = workerA.runOnce();
    // Bound fixture mistakes without sleeping to simulate a180-second lease.
    await Promise.race([completionStarted, firstRun.then(() => { throw new Error("First worker ended before the completion gate"); }),
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("Completion gate was not reached")), 10000); })]);
    clearTimeout(watchdog);
    const waiting = (await owner.query("SELECT id,lease_token,leased_until,attempt_count FROM notifications WHERE id=ANY($1::uuid[]) ORDER BY id", [ids.slice(1)])).rows;
    assert.equal(waiting.length, 2);
    assert(waiting.every(row => row.lease_token === null && row.leased_until === null && row.attempt_count === 0), "Unsent tail was preleased while earlier completion was delayed");
    phase = "competing-worker";
    const secondResult = await workerB.runOnce();
    assert.deepEqual(secondResult, { claimed: 2, sent: 2, retried: 0, failed: 0 });
    releaseCompletion();
    const firstResult = await firstRun;
    assert.deepEqual(firstResult, { claimed: 1, sent: 1, retried: 0, failed: 0 });
    phase = "final-records";
    const final = (await owner.query("SELECT id,delivery_status,attempt_count,lease_token,leased_until FROM notifications WHERE id=ANY($1::uuid[]) ORDER BY id", [ids])).rows;
    assert.equal(final.length, 3);
    assert(final.every(row => row.delivery_status === "sent" && row.attempt_count === 1 && row.lease_token === null && row.leased_until === null));
    assert.equal(deliveries.length, 3); assert.equal(new Set(deliveries).size, 3);
    console.log("Real PostgreSQL email lease rehearsal passed: actual workers/repositories, delayed completion row lock, unleased waiting records, competing claim isolation and three unique synthetic delivery attempts. No provider messages sent.");
  } finally {
    clearTimeout(watchdog);
    releaseCompletion();
    if (firstRun) await Promise.allSettled([firstRun]);
    await Promise.allSettled(connected.map(connection => connection.query("ROLLBACK")));
    try {
      if (created) await owner.query(cleanupSql);
    } finally {
      await Promise.allSettled(connected.map(connection => connection.end()));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await rehearse(); }
  catch (error) { console.error("Disposable email lease rehearsal failed at " + phase + "; no provider messages were sent. Credentials and message content omitted."); if (/^[0-9A-Z]{5}$/.test(error?.code || "")) console.error("PostgreSQL code: " + error.code); process.exitCode = 1; }
}
