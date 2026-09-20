-- Tell the customer what happened to their money.
--
-- Homle sent twenty-eight kinds of notification and not one of them was about
-- a payment outcome. A customer was charged, refunded, or had a card declined,
-- and heard nothing. Receipts existed but were pull-only: you had to know to
-- open the booking and press "Check receipt". Nobody does that, and the first
-- time most people look for a receipt is when they are querying the charge with
-- their bank — which is the worst possible moment for Homle to be silent.
--
-- Implemented as a trigger on `payment_status_history` rather than inside the
-- reconcile functions. Those are the most carefully guarded code in the
-- repository — exactly-once, ordering-aware, parent-identity-verified — and
-- threading notification inserts through them risks the money path to add a
-- message. Every route that moves a payment already writes exactly one history
-- row per transition, so the history is the honest, complete place to hang this.
--
-- The trigger is deliberately silent about amounts. `safe_notification_payload`
-- strips what must not travel by email, and the booking's own authenticated
-- pages carry the exact figures; a notification that repeats a number only
-- creates a second place for it to be wrong.

BEGIN;

CREATE FUNCTION tideway_private.queue_payment_outcome_notice() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  payment_record booking_payments%ROWTYPE;
  selected_event text;
BEGIN
  -- Only the transitions a customer would want to hear about. Intermediate
  -- states like `processing` are machinery, and telling someone their payment
  -- is "processing" invites them to act on something that is about to resolve
  -- by itself.
  selected_event := CASE NEW.to_status
    WHEN 'captured' THEN 'payment-captured'
    WHEN 'refunded' THEN 'payment-refunded'
    WHEN 'partially-refunded' THEN 'payment-refunded'
    WHEN 'authorization-failed' THEN 'payment-failed'
    ELSE NULL
  END;
  IF selected_event IS NULL OR NEW.to_status IS NOT DISTINCT FROM NEW.from_status THEN
    RETURN NEW;
  END IF;

  SELECT * INTO payment_record FROM booking_payments WHERE id = NEW.payment_id;
  IF payment_record.id IS NULL OR payment_record.landlord_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Keyed on the history row, which is unique by construction. A partial refund
  -- can legitimately happen more than once on one payment, so keying on the
  -- payment and status would silently drop the second notice.
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
    VALUES (
      payment_record.landlord_user_id,
      payment_record.booking_id,
      selected_event,
      'in-app',
      jsonb_build_object('bookingId', payment_record.booking_id),
      'payment-status:' || NEW.id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_outcome_notice
AFTER INSERT ON payment_status_history
FOR EACH ROW EXECUTE FUNCTION tideway_private.queue_payment_outcome_notice();

-- Fan the three new notices out to email alongside the existing set. A receipt
-- that only exists behind a login is not a receipt.
CREATE OR REPLACE FUNCTION tideway_private.queue_email_for_in_app_notification() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.channel='in-app' AND NEW.event_type IN (
    'new-booking-request','cleaner-declined','booking-confirmed','cleaner-invitation-expired','booking-cancelled','payment-window-opened','payment-action-required','payment-captured','payment-refunded','payment-failed','booking-reminder','cleaner-start-journey','cleaner-started-travelling','cleaner-nearby','cleaner-arrived','cleaning-started',
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

REVOKE ALL ON FUNCTION tideway_private.queue_payment_outcome_notice() FROM PUBLIC;

COMMIT;
