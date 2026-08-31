/*
 * The five-open-support-request cap, and the retry key that must never fault.
 *
 * Both were races. The cap was `SELECT count(*) … >= 5` followed by an INSERT,
 * at READ COMMITTED, with no lock and no constraint behind it: every concurrent
 * transaction saw the same pre-insert count and every one passed. Measured
 * against an account with one open request, eight concurrent posts accepted
 * **five where four slots remained**. And `create_landlord_support_request`
 * read by `client_request_id`, found nothing and inserted, so a double-click had
 * both transactions miss and the second hit the unique index — a 500 before the
 * error mapping was fixed, a spurious 409 after.
 *
 * Both are now serialised per account by a transaction-scoped advisory lock,
 * taken BEFORE the idempotency read so it covers both.
 *
 * This is a SQL-shape test, and that limit is worth naming: it cannot prove the
 * lock serialises anything. What proves that is running it, and the audit
 * records the measurement — 4 accepted where 4 remained, and six concurrent
 * retries on one key producing exactly one row. What this file protects is the
 * property that measurement depended on: that the lock is present, in both
 * creators, before the reads, on a key that is byte-identical between them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../db/migrations/107_serialise_support_request_cap.sql", import.meta.url), "utf8");

/* ── The lock is present in both creators ── */

const creators = [
  ["create_landlord_support_request", "the support-request creator"],
  ["create_landlord_booking_change_request", "the booking-change creator"]
];
const bodies = new Map();
for (const [name, label] of creators) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION tideway_private.${name}(`);
  assert.ok(start >= 0, `Migration 107 no longer defines ${name}, so whatever it now contains is not the serialised version.`);
  const end = migration.indexOf("\n$$;", start);
  assert.ok(end > start, `${label} has no readable body in migration 107.`);
  bodies.set(name, migration.slice(start, end));
}

const keys = new Set();
for (const [name, label] of creators) {
  const body = bodies.get(name);
  const lock = /PERFORM pg_advisory_xact_lock\(hashtextextended\('([^']+)'\|\|actor_id::text,0\)\);/.exec(body);
  assert.ok(
    lock,
    `${label} no longer takes a per-account advisory lock. Without it the cap is a check-then-insert race again: every concurrent transaction reads the same count and every one passes.`
  );
  keys.add(lock[1]);

  // Before the reads, not merely somewhere in the function. A lock taken after
  // the count has already been read serialises nothing.
  const lockAt = body.indexOf("pg_advisory_xact_lock");
  const countAt = body.indexOf("count(*) FROM support_requests");
  const idempotencyAt = body.indexOf("request.client_request_id=proposed_client_request_id");
  assert.ok(countAt > lockAt, `${label} counts the open requests before taking the lock, so the count it acts on is already stale.`);
  assert.ok(idempotencyAt > lockAt, `${label} reads the retry key before taking the lock, so two retries can both miss and race the unique index.`);
}

assert.equal(
  keys.size,
  1,
  `The two creators use different advisory-lock keys (${[...keys].join(", ")}). Different keys do not exclude each other, so the cap would leak exactly as before while looking serialised.`
);
assert.match([...keys][0], /^tideway:support-request-cap:$/, "The advisory-lock key is no longer the namespaced support-request-cap key, so it may now collide with an unrelated lock.");

/* ── A retry key must not be able to fault ── */

for (const [name, label] of creators) {
  assert.match(
    bodies.get(name),
    /ON CONFLICT ON CONSTRAINT support_requests_retry_idempotency DO NOTHING/,
    `${label} inserts without handling a conflict on the retry key. The lock makes that unreachable rather than unnecessary, and an idempotency key must never turn a retry into a fault whatever else changes around it.`
  );
  assert.match(
    bodies.get(name),
    /IF NOT FOUND THEN\s+SELECT \* INTO request_record FROM support_requests request\s+WHERE request\.account_id=actor_id AND request\.client_request_id=proposed_client_request_id;/,
    `${label} does not return the existing request when its insert conflicts, so a retry would be answered as a failure rather than with what it already created.`
  );
}

/* ── No helper function, deliberately ── */

// A separate SECURITY DEFINER helper is owned by whichever role ran the
// migration, while these two are owned by homle_owner — so the inner call was
// refused with "permission denied for function" and every support request
// answered 500. Inlining is the fix; this stops it being "tidied up" back.
assert.ok(
  !/lock_support_request_cap/.test(migration),
  "The advisory lock has been factored into a helper function again. It is owned by the migration-running role, not by homle_owner who owns these SECURITY DEFINER creators, so the inner call is refused and every support request answers 500."
);

console.log("Support-request cap tests passed: both creators take the same namespaced per-account advisory lock, before both the retry-key read and the open-request count, and both return the existing request rather than faulting when the retry key conflicts.");
