import { readFile } from "node:fs/promises";
import { createUnpaidBookingWorker } from "../src/marketplace/unpaid-booking-worker.mjs";
import { createUnpaidBookingRepository } from "../src/marketplace/unpaid-booking-repository.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

const administrator = Object.freeze({ userId: "11111111-1111-4111-8111-111111111111", roles: ["administrator"] });
const bookingId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";
const startAt = "2026-09-21T09:00:00.000Z";

function repository({ due = [], expire } = {}) {
  const calls = [];
  return {
    calls,
    async listExpirable(actor, limit) { calls.push({ kind: "list", actor, limit }); return due; },
    async expire(actor, id) {
      calls.push({ kind: "expire", actor, bookingId: id });
      if (typeof expire === "function") return expire(id);
      return { bookingId: id, expired: true, reason: "payment-not-authorised" };
    }
  };
}

function paymentService(behaviour = () => {}) {
  const calls = [];
  return { calls, async cancel(actor, input) { calls.push({ actor, input }); return behaviour(input); } };
}

/* ── The hold is released before the booking is ended ──────────────────── */

// Not a preference. `begin_payment_command` will not cancel a hold on a booking
// that has already left `confirmed`, so cancelling the booking first would
// strand the customer's money with no route out. A review found exactly that
// defect in the Landlord cancellation path before it shipped.
{
  const order = [];
  const store = repository({ due: [{ bookingId, scheduledStartAt: startAt, paymentId }] });
  const originalExpire = store.expire;
  store.expire = async (...args) => { order.push("expire"); return originalExpire(...args); };
  const payments = paymentService(() => { order.push("release"); });
  const worker = createUnpaidBookingWorker({ repository: store, payments, actor: administrator });

  const outcome = await worker.runOnce();
  assert(order.join(">") === "release>expire", `The booking was ended before its hold was released: ${order.join(">")}`);
  assert(outcome.expired === 1 && outcome.released === 1 && outcome.failed === 0, `Unexpected pass outcome: ${JSON.stringify(outcome)}`);
  assert(payments.calls[0].input.idempotencyKey === `expire_unpaid_${paymentId}`,
    "The release used an unstable idempotency key, so a retried pass could cancel twice.");
}

// A release that fails leaves the booking alive. A booking that still holds
// somebody's money is safer alive than cancelled with the money stranded.
{
  const store = repository({ due: [{ bookingId, scheduledStartAt: startAt, paymentId }] });
  const payments = paymentService(() => { throw Object.assign(new Error("Stripe unavailable"), { code: "provider-unavailable" }); });
  const reported = [];
  const worker = createUnpaidBookingWorker({ repository: store, payments, actor: administrator, onUnexpectedError: (error) => reported.push(error) });

  const outcome = await worker.runOnce();
  assert(!store.calls.some((call) => call.kind === "expire"), "A booking was cancelled after its hold failed to release.");
  assert(outcome.failed === 1 && outcome.expired === 0, `A failed release was not reported: ${JSON.stringify(outcome)}`);
  assert(reported.length === 1, "A failed release never reached monitoring.");
}

// An attempt that became uncancellable between the queue and the call has no
// hold left to release, so ending the booking is still correct.
{
  const store = repository({ due: [{ bookingId, scheduledStartAt: startAt, paymentId }] });
  const payments = paymentService(() => { throw Object.assign(new Error("not cancellable"), { code: "payment-not-cancellable" }); });
  const worker = createUnpaidBookingWorker({ repository: store, payments, actor: administrator });

  const outcome = await worker.runOnce();
  assert(outcome.expired === 1 && outcome.released === 0 && outcome.failed === 0,
    `An already-cancelled hold blocked the expiry: ${JSON.stringify(outcome)}`);
}

/* ── A booking with no payment attempt needs no provider call ──────────── */

{
  const store = repository({ due: [{ bookingId, scheduledStartAt: startAt, paymentId: null }] });
  const payments = paymentService();
  const worker = createUnpaidBookingWorker({ repository: store, payments, actor: administrator });

  const outcome = await worker.runOnce();
  assert(payments.calls.length === 0, "A booking with no payment attempt still called the provider.");
  assert(outcome.expired === 1, `A booking with no payment attempt was not ended: ${JSON.stringify(outcome)}`);
}

// With no payment service at all, a live attempt is left alone rather than
// cancelled with no route back to the money.
{
  const store = repository({ due: [{ bookingId, scheduledStartAt: startAt, paymentId }] });
  const worker = createUnpaidBookingWorker({ repository: store, actor: administrator });
  const outcome = await worker.runOnce();
  assert(!store.calls.some((call) => call.kind === "expire") && outcome.skipped === 1,
    `A live payment attempt was ended with no way to release it: ${JSON.stringify(outcome)}`);
}

/* ── The database keeps the last word ──────────────────────────────────── */

// Every condition in the queue is re-made under lock. A payment landing between
// the two means the booking is left alone, and that is not a failure.
{
  const store = repository({
    due: [{ bookingId, scheduledStartAt: startAt, paymentId: null }],
    expire: () => ({ bookingId, expired: false, reason: "no-longer-expirable" })
  });
  const reported = [];
  const worker = createUnpaidBookingWorker({ repository: store, actor: administrator, onUnexpectedError: (error) => reported.push(error) });
  const outcome = await worker.runOnce();
  assert(outcome.expired === 0 && outcome.skipped === 1 && outcome.failed === 0,
    `A booking that was paid in the meantime was miscounted: ${JSON.stringify(outcome)}`);
  assert(reported.length === 0, "A booking somebody paid for was reported as an error.");
}

/* ── One failure never ends the batch ──────────────────────────────────── */

{
  const ids = ["a", "b", "c"].map((letter) => `4444444${letter}-4444-4444-8444-444444444444`);
  const store = repository({
    due: ids.map((id) => ({ bookingId: id, scheduledStartAt: startAt, paymentId: null })),
    expire: (id) => {
      if (id === ids[1]) throw new Error("locked");
      return { bookingId: id, expired: true, reason: "payment-not-authorised" };
    }
  });
  const reported = [];
  const worker = createUnpaidBookingWorker({ repository: store, actor: administrator, onUnexpectedError: (error) => reported.push(error) });
  const outcome = await worker.runOnce();
  assert(outcome.considered === 3 && outcome.expired === 2 && outcome.failed === 1,
    `One failing booking stopped the batch: ${JSON.stringify(outcome)}`);
  assert(reported.length === 1, "A failed expiry never reached monitoring.");
}

// Paused money movement is the whole pass standing down, not one item failing.
// Continuing would report the same fault once per booking in the queue.
{
  const store = repository({
    due: [1, 2, 3].map((n) => ({ bookingId: `5555555${n}-5555-4555-8555-555555555555`, scheduledStartAt: startAt, paymentId }))
  });
  const payments = paymentService(() => { throw Object.assign(new Error("paused"), { code: "payment-command-writes-paused" }); });
  const reported = [];
  const worker = createUnpaidBookingWorker({ repository: store, payments, actor: administrator, onUnexpectedError: (error) => reported.push(error) });
  const outcome = await worker.runOnce();
  assert(outcome.failed === 1 && reported.length === 1, `A paused pass reported once per booking: ${JSON.stringify(outcome)}`);
  assert(!store.calls.some((call) => call.kind === "expire"), "A booking was ended while money movement was paused.");
}

/* ── The actor and the bounds ──────────────────────────────────────────── */

for (const attempt of [undefined, {}, { userId: administrator.userId, roles: [] }, { userId: administrator.userId, roles: ["landlord"] }, { roles: ["administrator"] }]) {
  let threw = false;
  try { createUnpaidBookingWorker({ repository: repository(), actor: attempt }); } catch { threw = true; }
  assert(threw, `An expiry worker was built without a platform administrator: ${JSON.stringify(attempt)}`);
}
for (const attempt of [0, 201, 1.5, "100"]) {
  let threw = false;
  try { createUnpaidBookingWorker({ repository: repository(), actor: administrator, batchLimit: attempt }); } catch { threw = true; }
  assert(threw, `An unbounded expiry batch limit was accepted: ${attempt}`);
}
{
  const store = repository({ due: [] });
  const worker = createUnpaidBookingWorker({ repository: store, actor: administrator, batchLimit: 25 });
  const outcome = await worker.runOnce();
  assert(store.calls[0].limit === 25 && outcome.considered === 0 && outcome.batchFull === false,
    "The expiry batch limit was not passed through, or an empty queue reported a full batch.");
}

/* ── The repository validates what the database returns ────────────────── */

{
  const queried = [];
  const database = {
    withUserTransaction: async (actor, run) => run({
      query: async (text, values) => {
        queried.push({ text, values });
        if (text.includes("list_unpaid_bookings_for_expiry")) {
          return { rows: [{ bookings: [{ bookingId, scheduledStartAt: startAt, paymentId: null }] }] };
        }
        return { rows: [{ outcome: { bookingId, expired: true, reason: "payment-not-authorised" } }] };
      }
    })
  };
  const store = createUnpaidBookingRepository(database);
  const due = await store.listExpirable(administrator, 100);
  assert(due.length === 1 && due[0].paymentId === null && due[0].scheduledStartAt === startAt, "The expiry queue was misread.");
  assert(queried[0].values[0] === 100, "The expiry batch limit did not reach the database.");
  const outcome = await store.expire(administrator, bookingId);
  assert(outcome.expired === true && outcome.reason === "payment-not-authorised", "The expiry outcome was misread.");
}

for (const rows of [
  [{ bookings: null }],
  [{ bookings: [{ bookingId: "not-a-uuid", scheduledStartAt: startAt, paymentId: null }] }],
  [{ bookings: [{ bookingId, scheduledStartAt: "soon", paymentId: null }] }],
  [{ bookings: [{ bookingId, scheduledStartAt: startAt, paymentId: "not-a-uuid" }] }]
]) {
  const store = createUnpaidBookingRepository({ withUserTransaction: async (actor, run) => run({ query: async () => ({ rows }) }) });
  let threw = false;
  try { await store.listExpirable(administrator, 100); } catch { threw = true; }
  assert(threw, `An impossible expiry queue was accepted: ${JSON.stringify(rows)}`);
}

/* ── The migration says what the worker assumes ────────────────────────── */

{
  const migration = await readFile(new URL("../db/migrations/125_unpaid_booking_expiry.sql", import.meta.url), "utf8");
  // Both functions decide eligibility from one shared predicate. Two copies of
  // "has this been paid for" drifting apart is how a paid booking would get
  // cancelled.
  assert((migration.match(/booking_has_live_authorization/g) || []).length >= 4,
    "The expiry queue and the locked re-check no longer share one paid-for predicate.");
  assert(migration.includes("tideway_private.has_role('administrator')"),
    "The expiry functions are no longer administrator-gated.");
  assert(migration.includes("FOR UPDATE"), "The expiry re-check no longer takes a lock.");
  assert(migration.includes("'booking-cancelled'") && migration.includes("unpaid-expiry:cleaner"),
    "The Cleaner is no longer told their held day has been released, which is the point of ending the booking early.");
  assert(migration.includes("ON CONFLICT (idempotency_key) DO NOTHING"),
    "A repeated expiry pass could notify twice.");
  // Nothing was ever authorised, so there is nothing to charge and no approved
  // terms to charge it under. Reading the ledger to decide whether a booking is
  // paid for is the whole job; writing to it is not, and releasing a hold
  // belongs to the payment service, where the command guards live.
  const statements = migration.replace(/--[^\n]*/g, "");
  assert(!/\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+booking_payments\b/i.test(statements),
    "The expiry path writes to the payment ledger directly, bypassing the payment command guards.");
  assert(!/begin_payment_command|payment_commands/i.test(statements),
    "The expiry path issues a payment command from inside a database transaction.");
}

console.log("Unpaid-booking expiry checks passed: hold released before the booking ends, failures leave the money reachable, the database keeps the last word, one failure never ends the batch, and a paused pass stands down.");
