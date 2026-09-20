import { readFile } from "node:fs/promises";
import { createPaymentSettlementWorker, paymentSettlementEnabled, platformSettlementUserId } from "../src/marketplace/payment-settlement-worker.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
function throws(operation, fragment) { try { operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }

const actor = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", roles: ["administrator"] };
const paymentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherPaymentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function payment(overrides = {}) {
  return {
    paymentId,
    bookingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    canCapture: false,
    canTransfer: false,
    reconciliationReviewRequired: false,
    disputeReviewRequired: false,
    ...overrides
  };
}

function stubPayments(queue, behaviour = {}) {
  const calls = [];
  return {
    calls,
    async listForAdministrator(suppliedActor, input) {
      calls.push({ kind: "list", actor: suppliedActor, input });
      return { payments: queue, limit: input.limit, offset: 0, testMode: true };
    },
    async capture(suppliedActor, input) {
      calls.push({ kind: "capture", actor: suppliedActor, input });
      if (behaviour.captureError) throw behaviour.captureError;
      return { commandId: "captured" };
    },
    async transfer(suppliedActor, input) {
      calls.push({ kind: "transfer", actor: suppliedActor, input });
      if (behaviour.transferError) throw behaviour.transferError;
      return { commandId: "transferred" };
    }
  };
}

// The actor must genuinely carry the administrator role. The database resolves
// the role from the account rather than trusting the caller, so a worker
// without one cannot move money — and must fail loudly at construction rather
// than silently do nothing every five minutes.
assert(throws(() => createPaymentSettlementWorker({ payments: stubPayments([]) }), "platform administrator actor"), "A settlement worker was built without an administrator actor.");
assert(throws(() => createPaymentSettlementWorker({ payments: stubPayments([]), actor: { userId: actor.userId, roles: ["landlord"] } }), "platform administrator actor"), "A non-administrator actor was accepted for settlement.");
assert(throws(() => createPaymentSettlementWorker({ actor }), "administrator queue, capture and transfer"), "A settlement worker was built without a complete payment service.");

// Capture happens without anybody clicking, which is the whole point: an
// uncaptured Stripe authorization expires in about a week, so a missed manual
// click does not delay the money, it loses it.
const capturable = stubPayments([payment({ canCapture: true })]);
const captureWorker = createPaymentSettlementWorker({ payments: capturable, actor });
const captureRun = await captureWorker.runOnce();
assert(captureRun.captured === 1 && captureRun.transferred === 0 && captureRun.failed === 0, "A capturable payment was not captured automatically.");
const captureCall = capturable.calls.find((call) => call.kind === "capture");
assert(captureCall && captureCall.input.paymentId === paymentId, "Capture was not called for the queued payment.");
// A stable key means a repeated pass, a restart mid-flight or two workers
// racing all resolve to the same command rather than charging twice.
assert(captureCall.input.idempotencyKey === `settle_capture_${paymentId}`, "Capture used an unstable idempotency key, so a retry could charge the customer twice.");

// A transfer is funded by a captured charge and needs that capture reconciled
// through the signed webhook first, so the two never happen in one pass.
const both = stubPayments([payment({ canCapture: true, canTransfer: true })]);
const bothRun = await createPaymentSettlementWorker({ payments: both, actor }).runOnce();
assert(bothRun.captured === 1 && bothRun.transferred === 0, "The worker captured and transferred the same payment in one pass, before the capture could be reconciled.");
assert(!both.calls.some((call) => call.kind === "transfer"), "A transfer was attempted against a capture that has not reconciled.");

const transferable = stubPayments([payment({ canTransfer: true })]);
const transferWorker = createPaymentSettlementWorker({ payments: transferable, actor });
const transferRun = await transferWorker.runOnce();
assert(transferRun.transferred === 1 && transferRun.captured === 0, "A transferable payment did not pay the Cleaner automatically.");
assert(transferable.calls.find((call) => call.kind === "transfer").input.idempotencyKey === `settle_transfer_${paymentId}`, "Transfer used an unstable idempotency key, so a retry could pay the Cleaner twice.");

// Anything flagged for human review stays for a human. These are precisely the
// cases where moving money automatically is most likely to be wrong.
for (const flag of ["reconciliationReviewRequired", "disputeReviewRequired"]) {
  const held = stubPayments([payment({ canCapture: true, canTransfer: true, [flag]: true })]);
  const run = await createPaymentSettlementWorker({ payments: held, actor }).runOnce();
  assert(run.captured === 0 && run.transferred === 0 && run.failed === 0, `A payment held for review by ${flag} was settled automatically.`);
  assert(!held.calls.some((call) => call.kind === "capture" || call.kind === "transfer"), `${flag} did not stop automatic money movement.`);
}

// Nothing settles that the queue has not marked settleable. The worker never
// forms its own opinion about eligibility.
const idle = stubPayments([payment()]);
const idleRun = await createPaymentSettlementWorker({ payments: idle, actor }).runOnce();
assert(idleRun.captured === 0 && idleRun.transferred === 0 && idleRun.inspected === 1, "The worker acted on a payment the queue did not mark settleable.");

// One refusal must not end the batch, or a single stuck payment stops every
// Cleaner behind it being paid.
const reported = [];
const mixed = stubPayments([payment({ canCapture: true }), payment({ paymentId: otherPaymentId, canTransfer: true })], { captureError: Object.assign(new Error("provider refused"), { code: "payment-not-capturable" }) });
const mixedRun = await createPaymentSettlementWorker({ payments: mixed, actor, onUnexpectedError: (error) => reported.push(error) }).runOnce();
assert(mixedRun.failed === 1 && mixedRun.transferred === 1, "A failing payment stopped the rest of the batch from settling.");
assert(reported.length === 1 && reported[0].code === "payment-not-capturable", "A settlement refusal was swallowed instead of being reported to monitoring.");

// A full page means there is probably more waiting.
const full = stubPayments(Array.from({ length: 2 }, (_, index) => payment({ paymentId: index === 0 ? paymentId : otherPaymentId })));
const fullRun = await createPaymentSettlementWorker({ payments: full, actor, batchLimit: 2 }).runOnce();
assert(fullRun.moreMayRemain === true && full.calls[0].input.limit === 2, "A full settlement page did not report that more may remain.");

// Default off, like every other money-touching capability here.
assert(paymentSettlementEnabled({}) === false && paymentSettlementEnabled({ WORKER_PAYMENT_SETTLEMENT_ENABLED: "false" }) === false, "Automatic settlement defaulted to on.");
assert(paymentSettlementEnabled({ WORKER_PAYMENT_SETTLEMENT_ENABLED: "true" }) === true, "Automatic settlement cannot be switched on.");
assert(platformSettlementUserId({}) === null && platformSettlementUserId({ PLATFORM_SETTLEMENT_USER_ID: "  " }) === null, "A blank settlement account was treated as configured.");

// Settlement must reuse the audited command path rather than reaching into the
// database itself. Every guard — booking completed, payment authorized, no
// dispute or reconciliation hold, verified destination, one live command per
// kind — lives in begin_payment_command, and a second implementation of money
// movement is the thing most likely to drift out of step with it.
const workerSource = await readFile(new URL("../src/marketplace/payment-settlement-worker.mjs", import.meta.url), "utf8");
// Comments stripped first. A guard that also matches the explanation of the
// guard fires on documentation, which pushes the next person to delete the
// explanation rather than keep it.
const workerCode = workerSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
assert(!/\bquery\(|begin_payment_command|\bpool\b/.test(workerCode), "The settlement worker talks to the database directly instead of reusing the audited payment commands.");
const runtimeSource = await readFile(new URL("../src/marketplace/worker-runtime.mjs", import.meta.url), "utf8");
assert(runtimeSource.includes("options.paymentSettlement") && runtimeSource.includes("payment-settlement"), "Automatic settlement is not composed into the worker runtime.");
assert(/paymentSettlement[\s\S]{0,400}actor: options\.paymentSettlement\.actor/.test(runtimeSource), "The settlement job does not receive an explicit platform actor.");

console.log("Payment settlement worker tests passed: completed bookings capture and pay out without a manual click, keys are stable against retries, capture and transfer never share a pass, held and unflagged payments are left alone, one refusal does not stop the batch, and the audited command path is the only route to the money.");
