import { randomUUID } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const eventCopy = Object.freeze({
  "new-booking-request": ["New cleaning request", "A new cleaning request is waiting for your response."],
  "cleaner-declined": ["Cleaner response received", "The invited Cleaner declined. Matching can continue in Homle."],
  "booking-confirmed": ["Cleaning booking confirmed", "The Cleaner accepted the booking. Review the confirmed details in Homle."],
  "cleaner-invitation-expired": ["Cleaning invitation expired", "The Cleaner invitation expired without a response."],
  "payment-action-required": ["Payment step needed before your clean", "Confirm payment authorisation in Homle before the clean so the Cleaner can start on time. You will review the exact total before continuing."],
  "cleaner-started-travelling": ["Cleaner started travelling", "The Cleaner started their journey for the confirmed booking."],
  "cleaner-nearby": ["Cleaner is nearby", "The Cleaner is near the property for the confirmed booking."],
  "cleaner-arrived": ["Cleaner arrived", "The Cleaner recorded their arrival for the confirmed booking."],
  "cleaning-started": ["Cleaning started", "The Cleaner started the cleaning checklist."],
  "cleaning-paused": ["Cleaning paused", "The Cleaner paused the active cleaning job. Review the update in Homle."],
  "cleaning-resumed": ["Cleaning resumed", "The Cleaner resumed the active cleaning job."],
  "cleaning-progress-update": ["Cleaning progress updated", "The Cleaner updated the room-by-room checklist."],
  "issue-reported": ["Cleaning issue reported", "The Cleaner reported an issue on the active booking."],
  "job-photo-added": ["Cleaning photo added", "The Cleaner added a private booking photo."],
  "issue-photo-added": ["Issue photo added", "The Cleaner added a private photo to a reported issue."],
  "unexpected-task-approval-requested": ["Extra task needs a decision", "The Cleaner proposed an unexpected task for your approval. No price changes automatically."],
  "unexpected-task-decision": ["Extra-task decision received", "The Landlord recorded a decision on the unexpected task."],
  "cleaning-completed": ["Cleaning checklist completed", "The Cleaner finished the cleaning checklist."],
  "booking-completed": ["Cleaning visit completed", "The Landlord confirmed the finished cleaning visit."],
  "review-requested": ["Review the completed clean", "The cleaning checklist is complete and ready for your review."],
  "review-submitted": ["Homle review submitted", "A review was submitted for a completed booking and is awaiting moderation."],
  "booking-message": ["New Homle booking message", "A booking participant sent a private message in Homle."],
  "dispute-opened": ["Private booking case opened", "A private case was opened for this booking. Homle paused the booking while it is reviewed."],
  "dispute-reviewing": ["Booking case under review", "Homle started reviewing the private case for this booking."],
  "dispute-resolved": ["Booking case resolved", "Homle recorded an outcome for the private booking case. Open Homle to review it."]
});

function integer(value, minimum, maximum, fallback, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}

function deliveryRecord(record) {
  if (!record || !uuidPattern.test(record.notificationId || "") || !uuidPattern.test(record.bookingId || "") || !emailPattern.test(record.recipientEmail || "") || !eventCopy[record.eventType]) throw Object.assign(new Error("invalid-notification-record"), { permanent: true, code: "invalid-notification-record" });
  const attemptNumber = Number(record.attemptNumber);
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 20) throw Object.assign(new Error("invalid-notification-record"), { permanent: true, code: "invalid-notification-record" });
  return record;
}

function safeErrorCode(error) {
  const supplied = typeof error?.code === "string" ? error.code : typeof error?.name === "string" ? error.name : "delivery-error";
  const normalized = supplied.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return normalized || "delivery-error";
}

function trustedOrigin(value) {
  try {
    const parsed = new URL(value);
    const production = parsed.protocol === "https:" && !parsed.username && !parsed.password;
    const local = parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && !parsed.username && !parsed.password;
    if ((!production && !local) || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch { return null; }
}

function notificationActionPath(record) {
  if (record.eventType === "new-booking-request") return "/cleaner/dashboard";
  if (record.eventType === "cleaner-declined") return "/landlord/dashboard";
  if (record.eventType === "cleaner-invitation-expired") return record.payload?.matchingReopened === true ? "/landlord/dashboard" : "/cleaner/dashboard";
  if (record.eventType === "payment-action-required") return `/booking-payment?bookingId=${record.bookingId.toLowerCase()}`;
  return `/bookings/${record.bookingId.toLowerCase()}`;
}

export function notificationEmail(record, appOrigin) {
  const selected = deliveryRecord(record);
  const [subject, update] = eventCopy[selected.eventType];
  const safeName = typeof selected.recipientName === "string" ? selected.recipientName.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  const greeting = safeName ? `Hello ${safeName},` : "Hello,";
  const actionUrl = `${appOrigin}${notificationActionPath(selected)}`;
  return Object.freeze({
    to: selected.recipientEmail,
    idempotencyKey: selected.notificationId,
    subject: `Homle: ${subject}`,
    text: `${greeting}\n\n${update}\n\nOpen the next private step in Homle: ${actionUrl}\n\nFor privacy, this email does not include an address, access instructions, contact details, photos, case text, messages or live location.`
  });
}

export function createEmailNotificationWorker(repository, delivery, options = {}) {
  if (!repository || typeof repository.claimDue !== "function" || typeof repository.complete !== "function") throw new TypeError("A complete email-notification repository is required.");
  if (!delivery || typeof delivery.send !== "function") throw new TypeError("A transactional email delivery adapter is required.");
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;
  const appOrigin = trustedOrigin(options.appOrigin);
  if (!appOrigin) throw new TypeError("A trusted Homle application origin is required for notification email.");
  const batchLimit = integer(options.batchLimit, 1, 100, 25, "Email batch limit");
  const leaseSeconds = integer(options.leaseSeconds, 30, 600, 180, "Email lease duration");

  return Object.freeze({
    async runOnce() {
      const leaseToken = createId();
      if (!uuidPattern.test(leaseToken || "")) throw new TypeError("The email worker lease generator must return a UUID.");
      const claimed = await repository.claimDue(leaseToken.toLowerCase(), batchLimit, leaseSeconds);
      const result = { claimed: claimed.length, sent: 0, retried: 0, failed: 0 };
      for (const candidate of claimed) {
        try {
          const email = notificationEmail(candidate, appOrigin);
          await delivery.send(email);
        } catch (error) {
          const outcome = error?.permanent === true ? "permanent-failure" : "retry";
          await repository.complete(candidate.notificationId, leaseToken, outcome, safeErrorCode(error));
          if (outcome === "retry") result.retried += 1;
          else result.failed += 1;
          continue;
        }
        await repository.complete(candidate.notificationId, leaseToken, "sent", null);
        result.sent += 1;
      }
      return Object.freeze(result);
    }
  });
}

export { eventCopy as notificationEmailEventCopy };
