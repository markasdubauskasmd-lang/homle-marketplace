BEGIN;

CREATE FUNCTION tideway_private.queue_due_booking_visit_reminders(batch_limit integer DEFAULT 100)
RETURNS TABLE(notification_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-visit-reminder-batch-limit';
  END IF;

  RETURN QUERY
  WITH due_notification AS (
    SELECT booking.id AS booking_id,participant.recipient_user_id,
      CASE WHEN booking.scheduled_start_at<=now()+interval '2 hours' THEN 'cleaner-start-journey' ELSE 'booking-reminder' END AS reminder_event,
      CASE WHEN booking.scheduled_start_at<=now()+interval '2 hours' THEN 'cleaner-start-journey:' ELSE 'booking-reminder:'||participant.participant_role||':' END
        ||booking.id||':'||to_char(booking.scheduled_start_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS') AS reminder_key
    FROM bookings booking
    CROSS JOIN LATERAL (VALUES
      (booking.landlord_user_id,'landlord'),
      (booking.cleaner_user_id,'cleaner')
    ) AS participant(recipient_user_id,participant_role)
    WHERE booking.status='confirmed'
      AND booking.scheduled_start_at>now()
      AND booking.scheduled_start_at<=now()+interval '24 hours'
      AND (
        booking.scheduled_start_at>now()+interval '2 hours'
        OR participant.participant_role='cleaner'
      )
      AND EXISTS (
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
        WHERE notification.idempotency_key=(
          CASE WHEN booking.scheduled_start_at<=now()+interval '2 hours' THEN 'cleaner-start-journey:' ELSE 'booking-reminder:'||participant.participant_role||':' END
          ||booking.id||':'||to_char(booking.scheduled_start_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS')
        )
      )
    ORDER BY booking.scheduled_start_at,participant.participant_role,booking.id
    LIMIT batch_limit
    FOR UPDATE OF booking SKIP LOCKED
  ), inserted AS (
    INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key)
    SELECT due_notification.recipient_user_id,due_notification.booking_id,due_notification.reminder_event,'in-app',
      jsonb_build_object('bookingId',due_notification.booking_id),due_notification.reminder_key
    FROM due_notification
    ON CONFLICT(idempotency_key) DO NOTHING
    RETURNING notifications.id
  )
  SELECT inserted.id FROM inserted;
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.queue_email_for_in_app_notification() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.channel='in-app' AND NEW.event_type IN (
    'new-booking-request','cleaner-declined','booking-confirmed','cleaner-invitation-expired','payment-window-opened','payment-action-required','booking-reminder','cleaner-start-journey','cleaner-started-travelling','cleaner-nearby','cleaner-arrived','cleaning-started',
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

REVOKE ALL ON FUNCTION tideway_private.queue_due_booking_visit_reminders(integer) FROM PUBLIC;

COMMIT;
