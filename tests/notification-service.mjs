import { readFile } from "node:fs/promises";
import { createNotificationRepository } from "../src/marketplace/notification-repository.mjs";
import { createNotificationService, safePayloadKeys } from "../src/marketplace/notification-service.mjs";
import { createEmailNotificationRepository } from "../src/marketplace/email-notification-repository.mjs";
import { createEmailNotificationWorker, notificationEmail, notificationEmailEventCopy } from "../src/marketplace/email-notification-worker.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }

const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const notificationId = "77777777-7777-4777-8777-777777777777";
const bookingId = "55555555-5555-4555-8555-555555555555";
const disputeId = "66666666-6666-4666-8666-666666666666";
const repositoryCalls = [];
const repository = {
  async listNotifications(actor, input) {
    repositoryCalls.push({ kind: "list", actor, input });
    return {
      notifications: [{
        notificationId,
        bookingId,
        eventType: "dispute-resolved",
        payload: { bookingId, eventId: 42, disputeId, status: "resolved", outcome: "cancelled", exactAddress: "must not escape", email: "private@example.com", latitude: 51.5, resolutionNote: "must remain private" },
        createdAt: "2026-07-15T18:00:00.000Z",
        readAt: null
      }],
      unreadCount: 1,
      hasMore: true,
      nextCursor: { beforeCreatedAt: "2026-07-15T18:00:00.000Z", beforeNotificationId: notificationId }
    };
  },
  async markNotificationRead(actor, id) {
    repositoryCalls.push({ kind: "read", actor, id });
    return { notificationId: id, readAt: "2026-07-15T18:05:00.000Z" };
  },
  async markAllNotificationsRead(actor, cutoffCreatedAt) {
    repositoryCalls.push({ kind: "read-all", actor, cutoffCreatedAt });
    return { markedRead: 3, cutoffCreatedAt };
  }
};
const service = createNotificationService(repository, { now: () => new Date("2026-07-15T18:10:00.000Z") });

const page = await service.listNotifications(landlord, { limit: "20" });
assert(page.notifications.length === 1 && page.unreadCount === 1 && page.hasMore && Object.isFrozen(page) && Object.isFrozen(page.notifications), "Notification listing lost its bounded immutable page projection.");
assert(JSON.stringify(page.notifications[0].payload) === JSON.stringify({ bookingId, eventId: "42", disputeId, status: "resolved", outcome: "cancelled" }) && safePayloadKeys.every((key) => !["email", "latitude", "exactAddress", "resolutionNote"].includes(key)), "Notification payload projection leaked private case, contact, address or location data.");
assert(repositoryCalls[0].actor.userId === landlord.userId && repositoryCalls[0].input.limit === 20 && repositoryCalls[0].input.beforeCreatedAt === null, "Notification listing was not actor-bound or did not normalize pagination.");
const read = await service.markNotificationRead(landlord, notificationId.toUpperCase());
const readAll = await service.markAllNotificationsRead(landlord);
assert(read.notificationId === notificationId && readAll.markedRead === 3 && repositoryCalls.at(-1).cutoffCreatedAt === "2026-07-15T18:10:00.000Z", "Single/read-all actions lost normalized identifiers or the race-safe cutoff.");
assert(await rejects(() => service.listNotifications(landlord, { beforeCreatedAt: "2026-07-15T18:00:00.000Z" }), "supplied together") && await rejects(() => service.listNotifications(landlord, { limit: 101 }), "outside") && await rejects(() => service.markNotificationRead(landlord, "not-a-uuid"), "valid notification id"), "Notification input validation accepted a partial cursor, excessive page or invalid ID.");
assert(await rejects(() => service.listNotifications(null), "authenticated"), "An unauthenticated caller entered the notification service.");

const databaseCalls = [];
let databaseFailure = null;
const database = {
  async withAccountTransaction(actor, operation) {
    return operation({ async query(queryText, values) {
      databaseCalls.push({ actor, queryText, values });
      if (databaseFailure) throw databaseFailure;
      return { rows: [{ result: { notifications: [], unreadCount: 0, hasMore: false, nextCursor: null } }] };
    } });
  }
};
const notificationRepository = createNotificationRepository(database);
await notificationRepository.listNotifications(landlord, { beforeCreatedAt: null, beforeNotificationId: null, limit: 30 });
assert(databaseCalls[0].queryText.includes("get_my_notifications") && databaseCalls[0].values.join(",") === ",,30" && !databaseCalls[0].queryText.includes(landlord.userId), "Notification repository bypassed its actor-scoped function or interpolated account data.");
databaseFailure = new Error("notification-not-found");
assert(await rejects(() => notificationRepository.markNotificationRead(landlord, notificationId), "not found"), "A missing/foreign notification did not receive the same safe not-found response.");

const migration = await readFile(new URL("../db/migrations/017_notification_inbox_and_outbox.sql", import.meta.url), "utf8");
const disputeMigration = await readFile(new URL("../db/migrations/033_audited_booking_disputes.sql", import.meta.url), "utf8");
const paymentReminderMigration = await readFile(new URL("../db/migrations/041_due_payment_readiness_notifications.sql", import.meta.url), "utf8");
const runtimeGrants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const workerGrants = await readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8");
for (const required of ["safe_notification_payload", "queue_email_for_in_app_notification", "get_my_notifications", "mark_my_notification_read", "mark_all_my_notifications_read", "claim_due_email_notifications", "complete_email_notification", "FOR UPDATE OF notification SKIP LOCKED", "attempt_count>=5", "attempt_count<5", "attempt-limit", "email:'||NEW.idempotency_key", "lease_token IS DISTINCT FROM worker_lease_token"]) assert(migration.includes(required), `Notification migration omitted ${required}.`);
assert(migration.includes("notification.recipient_user_id=actor_id") && !migration.includes("exactAddress") && !migration.includes("latitude") && !migration.includes("longitude"), "Notification inbox authorization or payload redaction is incomplete.");
assert(runtimeGrants.includes("get_my_notifications") && runtimeGrants.includes("mark_my_notification_read") && runtimeGrants.includes("REVOKE SELECT ON notifications"), "The web role can bypass the authorized notification inbox functions.");
assert(workerGrants.includes("claim_due_email_notifications") && workerGrants.includes("complete_email_notification") && !workerGrants.includes("GRANT SELECT ON notifications"), "The email worker is missing narrow functions or has direct notification-table access.");
for (const required of ["queue_due_booking_payment_reminders", "batch_limit NOT BETWEEN 1 AND 500", "booking.status='confirmed'", "scheduled_start_at<=now()+interval '24 hours'", "payment.status='authorized'", "payment.authorized_at BETWEEN booking.scheduled_start_at-interval '5 days'", "FOR UPDATE OF booking SKIP LOCKED", "ON CONFLICT(idempotency_key) DO NOTHING", "payment-action-required", "REVOKE ALL ON FUNCTION tideway_private.queue_due_booking_payment_reminders(integer) FROM PUBLIC"]) assert(paymentReminderMigration.includes(required), `Payment-readiness migration omitted ${required}.`);
assert(!paymentReminderMigration.includes("UPDATE booking_payments") && !paymentReminderMigration.includes("INSERT INTO booking_payments") && !paymentReminderMigration.includes("UPDATE bookings"), "Payment readiness can mutate a payment or booking instead of only warning the Landlord.");
assert(workerGrants.includes("queue_due_booking_payment_reminders(integer)") && !runtimeGrants.includes("queue_due_booking_payment_reminders(integer)"), "Payment readiness escaped its function-only worker boundary.");

const queuedEventBlock = paymentReminderMigration.match(/CREATE OR REPLACE FUNCTION tideway_private\.queue_email_for_in_app_notification\(\)[\s\S]*?NEW\.event_type IN \(([\s\S]*?)\) THEN/);
assert(queuedEventBlock, "The latest notification migration no longer exposes a verifiable email event allowlist.");
const queuedEmailEvents = [...queuedEventBlock[1].matchAll(/'([a-z][a-z0-9-]+)'/g)].map((match) => match[1]).sort();
assert(JSON.stringify(queuedEmailEvents) === JSON.stringify(Object.keys(notificationEmailEventCopy).sort()), "A database-queued email event has no worker copy, or worker copy is unreachable from the outbox.");
for (const safeCaseField of ["disputeId", "status", "outcome"]) assert(disputeMigration.includes(`'${safeCaseField}'`) && safePayloadKeys.includes(safeCaseField), `Private case notifications lost their safe ${safeCaseField} projection.`);

const leaseToken = "99999999-9999-4999-8999-999999999999";
const emailCompletions = [];
const emailRepository = {
  async claimDue(token, batchLimit, leaseSeconds) {
    assert(token === leaseToken && batchLimit === 10 && leaseSeconds === 120, "Email worker used an unexpected lease boundary.");
    return [
      { notificationId, recipientEmail: "landlord@example.com", recipientName: "Landlord\nExample", eventType: "dispute-resolved", bookingId, payload: { outcome: "cancelled", resolutionNote: "REDACT-ME", exactAddress: "REDACT-ME", latitude: 51.5 }, attemptNumber: 1 },
      { notificationId: "88888888-8888-4888-8888-888888888888", recipientEmail: "landlord@example.com", recipientName: "Landlord", eventType: "cleaner-arrived", bookingId, payload: {}, attemptNumber: 2 },
      { notificationId: "99999999-9999-4999-8999-000000000000", recipientEmail: "landlord@example.com", recipientName: "Landlord", eventType: "invented-event", bookingId, payload: {}, attemptNumber: 1 }
    ];
  },
  async complete(id, token, outcome, errorCode) { emailCompletions.push({ id, token, outcome, errorCode }); }
};
const delivered = [];
const emailWorker = createEmailNotificationWorker(emailRepository, { async send(email) { delivered.push(email); if (email.subject.includes("Cleaner arrived")) throw Object.assign(new Error("provider down with secret detail"), { code: "SMTP ETIMEDOUT: private-host" }); } }, { appOrigin: "https://tideway.example", batchLimit: 10, leaseSeconds: 120, createId: () => leaseToken });
const emailRun = await emailWorker.runOnce();
assert(JSON.stringify(emailRun) === JSON.stringify({ claimed: 3, sent: 1, retried: 1, failed: 1 }) && emailCompletions.map((item) => item.outcome).join(",") === "sent,retry,permanent-failure", "Email delivery did not separate success, transient retry and permanent record failure.");
assert(delivered[0].idempotencyKey === notificationId && delivered[0].text.includes("Hello Landlord Example,") && delivered[0].text.includes(`https://tideway.example/bookings/${bookingId}`) && !delivered[0].text.includes("REDACT-ME") && !delivered[0].text.includes("51.5") && !JSON.stringify(emailRun).includes("landlord@example.com"), "Notification email lost its exact private booking action, leaked payload/recipient data or lost its stable provider idempotency key.");
assert(!delivered[0].text.includes("https://tideway.example\n") && !delivered[0].text.includes("?") && !delivered[0].text.includes("#"), "Notification email fell back to the homepage or added query/fragment tracking material.");
const invitationEmail = notificationEmail({ notificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", recipientEmail: "cleaner@example.com", eventType: "new-booking-request", bookingId, payload: {}, attemptNumber: 1 }, "https://tideway.example");
const declinedEmail = notificationEmail({ notificationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", recipientEmail: "landlord@example.com", eventType: "cleaner-declined", bookingId, payload: {}, attemptNumber: 1 }, "https://tideway.example");
const expiredLandlordEmail = notificationEmail({ notificationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", recipientEmail: "landlord@example.com", eventType: "cleaner-invitation-expired", bookingId, payload: { matchingReopened: true }, attemptNumber: 1 }, "https://tideway.example");
const expiredCleanerEmail = notificationEmail({ notificationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", recipientEmail: "cleaner@example.com", eventType: "cleaner-invitation-expired", bookingId, payload: {}, attemptNumber: 1 }, "https://tideway.example");
const paymentEmail = notificationEmail({ notificationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", recipientEmail: "landlord@example.com", eventType: "payment-action-required", bookingId, payload: {}, attemptNumber: 1 }, "https://tideway.example");
assert(invitationEmail.text.includes("https://tideway.example/cleaner/dashboard") && declinedEmail.text.includes("https://tideway.example/landlord/dashboard") && expiredLandlordEmail.text.includes("https://tideway.example/landlord/dashboard") && expiredCleanerEmail.text.includes("https://tideway.example/cleaner/dashboard"), "Role-specific invitation and matching emails do not open the workspace containing the next action.");
assert(paymentEmail.text.includes(`https://tideway.example/booking-payment?bookingId=${bookingId}`) && paymentEmail.text.includes("exact total") && !paymentEmail.text.includes("10 Downing Street"), "Payment readiness email lost its exact action or disclosed booking details.");
assert(emailCompletions[1].errorCode === "smtp-etimedout-private-host" && emailCompletions[2].errorCode === "invalid-notification-record", "Email failure codes were not bounded and sanitized for durable retry evidence.");
for (const requiredEvent of ["new-booking-request", "booking-confirmed", "payment-action-required", "cleaner-started-travelling", "cleaner-nearby", "cleaner-arrived", "cleaning-progress-update", "issue-reported", "cleaning-completed", "booking-completed", "review-requested", "review-submitted", "booking-message", "dispute-opened", "dispute-reviewing", "dispute-resolved"]) assert(notificationEmailEventCopy[requiredEvent], `Email copy omitted ${requiredEvent}.`);
assert(await rejects(() => Promise.resolve(createEmailNotificationWorker(emailRepository, { send() {} }, { appOrigin: "http://public.example", createId: () => leaseToken })), "trusted"), "The email worker accepted an insecure public application origin.");

const workerPoolCalls = [];
const emailWorkerRepository = createEmailNotificationRepository({ async query(queryText, values) { workerPoolCalls.push({ queryText, values }); return queryText.includes("claim_due") ? { rows: [{ notification_id: notificationId, recipient_email: "landlord@example.com", recipient_name: "Landlord", event_type: "booking-confirmed", booking_id: bookingId, payload: {}, attempt_number: 1 }] } : { rows: [] }; } });
const claimedEmail = await emailWorkerRepository.claimDue(leaseToken, 10, 120);
await emailWorkerRepository.complete(notificationId, leaseToken, "sent");
assert(claimedEmail[0].notificationId === notificationId && workerPoolCalls[0].queryText.includes("claim_due_email_notifications") && workerPoolCalls[1].queryText.includes("complete_email_notification") && workerPoolCalls.every((call) => !call.queryText.includes("landlord@example.com")), "Email worker repository bypassed its narrow functions or interpolated recipient data.");

console.log("Notification tests passed: account-only inbox, race-safe read actions, strict payload redaction and leased retrying email outbox.");
