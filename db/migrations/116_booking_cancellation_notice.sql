-- Tell a Cleaner their confirmed job was cancelled.
--
-- Migration 115 inserts a `booking-cancelled` in-app notification when the
-- customer cancels. That row was inert: `queue_email_for_in_app_notification`
-- fans an in-app notification out to email only for an explicit allow-list of
-- event types, and `booking-cancelled` was not on it. A Cleaner who had
-- arranged their day around a confirmed job therefore received no email, and
-- the in-app row fell back to a generic "Booking updated" line that did not say
-- the job was off.
--
-- This is the one notification in the set where silence costs somebody a
-- morning. It belongs on the list beside `cleaner-invitation-expired`, which is
-- the same class of event: work that was going to happen and now is not.
--
-- The list is restated in full rather than appended to, because the function is
-- replaced wholesale. Every other entry is unchanged from migration 044.

BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.queue_email_for_in_app_notification() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.channel='in-app' AND NEW.event_type IN (
    'new-booking-request','cleaner-declined','booking-confirmed','cleaner-invitation-expired','booking-cancelled','payment-window-opened','payment-action-required','booking-reminder','cleaner-start-journey','cleaner-started-travelling','cleaner-nearby','cleaner-arrived','cleaning-started',
    'cleaning-paused','cleaning-resumed','cleaning-progress-update','issue-reported','job-photo-added','issue-photo-added','unexpected-task-approval-requested',
    'unexpected-task-decision','cleaning-completed','booking-completed','review-requested','review-submitted','booking-message','dispute-opened','dispute-reviewing','dispute-resolved'
  ) THEN
    INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key)
    VALUES(NEW.recipient_user_id,NEW.booking_id,NEW.event_type,'email',tideway_private.safe_notification_payload(NEW.payload),'email:'||NEW.idempotency_key)
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
