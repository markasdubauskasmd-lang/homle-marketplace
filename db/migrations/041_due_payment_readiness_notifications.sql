BEGIN;

CREATE FUNCTION tideway_private.queue_due_booking_payment_reminders(batch_limit integer DEFAULT 100)
RETURNS TABLE(booking_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-payment-reminder-batch-limit';
  END IF;

  RETURN QUERY
  WITH due_booking AS (
    SELECT booking.id,booking.landlord_user_id,booking.scheduled_start_at,
      'payment-readiness:'||booking.id||':'||to_char(booking.scheduled_start_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS') AS reminder_key
    FROM bookings booking
    WHERE booking.status='confirmed'
      AND booking.scheduled_start_at>now()
      AND booking.scheduled_start_at<=now()+interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM booking_payments payment
        WHERE payment.booking_id=booking.id
          AND payment.landlord_user_id=booking.landlord_user_id
          AND payment.cleaner_user_id=booking.cleaner_user_id
          AND payment.provider='stripe'
          AND payment.provider_payment_id IS NOT NULL
          AND payment.status='authorized'
          AND payment.currency='gbp'
          AND payment.amount_pence=booking.customer_price_pence
          AND payment.terms_fingerprint=booking.terms_fingerprint
          AND payment.authorized_at BETWEEN booking.scheduled_start_at-interval '5 days' AND now()+interval '5 minutes'
      )
      AND NOT EXISTS (
        SELECT 1 FROM notifications notification
        WHERE notification.idempotency_key='payment-readiness:'||booking.id||':'||to_char(booking.scheduled_start_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS')
      )
    ORDER BY booking.scheduled_start_at,booking.id
    LIMIT batch_limit
    FOR UPDATE OF booking SKIP LOCKED
  ), inserted AS (
    INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key)
    SELECT due_booking.landlord_user_id,due_booking.id,'payment-action-required','in-app',
      jsonb_build_object('bookingId',due_booking.id),due_booking.reminder_key
    FROM due_booking
    ON CONFLICT(idempotency_key) DO NOTHING
    RETURNING notifications.booking_id
  )
  SELECT inserted.booking_id FROM inserted;
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.queue_email_for_in_app_notification() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.channel='in-app' AND NEW.event_type IN (
    'new-booking-request','cleaner-declined','booking-confirmed','cleaner-invitation-expired','payment-action-required','cleaner-started-travelling','cleaner-nearby','cleaner-arrived','cleaning-started',
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

REVOKE ALL ON FUNCTION tideway_private.queue_due_booking_payment_reminders(integer) FROM PUBLIC;

COMMIT;
