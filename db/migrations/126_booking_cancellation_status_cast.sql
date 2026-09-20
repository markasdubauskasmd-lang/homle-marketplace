-- Repair two cancellation functions that could never complete, and require a
-- warning before a booking is expired.
--
-- PART ONE, and the reason this migration is urgent.
--
-- `tideway_private.cancel_booking_as_landlord` (migration 115) and
-- `tideway_private.expire_unpaid_booking` (migration 125) both declare
-- `previous_status text` and then insert it into `booking_status_history`,
-- whose `from_status` column is the `booking_status` enum. PostgreSQL has no
-- assignment cast from text to an enum, so that INSERT always fails:
--
--   ERROR:  column "from_status" is of type booking_status
--           but expression is of type text
--
-- Every early return in both functions succeeds. They throw on exactly the
-- path where they would do their job. Proved against PostgreSQL 16 with all
-- 125 migrations applied, not inferred.
--
-- The consequence is the precise failure both functions were written to
-- prevent. Both callers release the customer's card hold FIRST and cancel the
-- booking second, because `begin_payment_command` will not cancel a hold on a
-- booking that has already left `confirmed`. So the sequence was: release the
-- hold, then fail to cancel the booking. The customer's money was returned,
-- the booking stayed `confirmed`, migration 025 would never let the job start,
-- and the Cleaner's slot stayed blocked. For the expiry loop it is worse than
-- a one-off: the booking is still in the queue fifteen minutes later, so it
-- retries for ever, one alert per booking per pass.
--
-- A test suite that passed throughout. Both functions were covered only by
-- JavaScript fakes and by string matching against the migration text, and no
-- test in this repository executes a migration against PostgreSQL, so a type
-- error was invisible by construction. `tests/booking-cancellation-sql.mjs`
-- now runs both functions against a real database when one is available.
--
-- PART TWO: nobody is expired without having been warned.
--
-- `list_unpaid_bookings_for_expiry` had a single condition -- the slot is
-- twelve hours away or less -- and no lower bound at all. Nothing in this
-- codebase requires a minimum lead time when booking: migration 009 only asks
-- that the start is in the future. So a customer booking a same-day clean six
-- hours out was eligible for cancellation the instant the booking was
-- confirmed, before they had finished paying and before either of migration
-- 043's reminders could fire. The twelve-hour deadline in DECISIONS.md D13 is
-- justified by those reminders having already been sent; that justification
-- was simply untrue for any booking made inside the window.
--
-- The rule is now the honest version of the intent: a booking is expired only
-- when a payment reminder for it was sent at least two hours ago. It says what
-- it means -- nobody loses a booking without a warning and a chance to act on
-- it -- and it cannot drift out of step with the reminder schedule, because it
-- reads the reminders themselves rather than re-deriving when they were due.
--
-- One deliberate consequence: a booking whose slot is already in the past
-- never received a reminder (migration 043 only queues them for future slots),
-- so it is never expired. Those bookings stay as they are. Cancelling months
-- of historical rows and emailing both parties about each one is not something
-- to do as a side effect of switching settlement on; it is recorded in
-- HUMAN_TODO.md as a decision instead.
--
-- Also here, both narrow and worth having:
--   * the queue now releases any payment that is `authorized` as well as one
--     still being set up. Those four statuses are what `begin_payment_command`
--     treats as a cancellable hold, and the queue previously listed only
--     three. The fourth was unreachable -- it would mean an authorization that
--     the paid-for predicate rejects -- but if it ever became reachable the
--     result would be a booking cancelled with a live hold and no route back,
--     so the release list is now a superset of the predicate rather than its
--     complement.
--   * `FOR UPDATE ... SKIP LOCKED`, as migration 043 already does. Two web
--     processes on Render would otherwise read the same hundred bookings and
--     race to cancel the same holds.

BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.cancel_booking_as_landlord(target_booking_id uuid, supplied_reason text DEFAULT NULL)
RETURNS bookings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings;
  request_record cleaning_requests;
  cancellation_reason text := NULLIF(trim(supplied_reason), '');
  -- Typed as the enum the history column actually is. Declaring this `text`
  -- made the INSERT below fail on every cancellation that got this far.
  previous_status booking_status;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required';
  END IF;

  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id = target_booking_id AND booking.landlord_user_id = actor_id
    FOR UPDATE;
  IF booking_record.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-found';
  END IF;

  IF booking_record.status = 'cancelled' THEN
    RETURN booking_record;
  END IF;

  IF booking_record.status NOT IN ('draft','searching-for-cleaner','cleaner-invited','pending-cleaner-acceptance','confirmed') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-cancellable';
  END IF;

  IF booking_record.journey_started_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-cancellable';
  END IF;

  previous_status := booking_record.status;

  UPDATE bookings
    SET status = 'cancelled', cancelled_at = now(), updated_at = now()
    WHERE id = booking_record.id
    RETURNING * INTO booking_record;

  INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason, metadata)
    VALUES (
      booking_record.id,
      previous_status,
      'cancelled',
      actor_id,
      COALESCE(cancellation_reason, 'Cancelled by the customer.'),
      jsonb_build_object('cancelledBy', 'landlord')
    );

  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id = booking_record.cleaning_request_id FOR UPDATE;
  IF request_record.id IS NOT NULL AND request_record.status <> 'cancelled' THEN
    UPDATE cleaning_requests SET status = 'cancelled', updated_at = now() WHERE id = request_record.id;
    INSERT INTO cleaning_request_status_history (cleaning_request_id, from_status, to_status, changed_by, reason, metadata)
      VALUES (request_record.id, request_record.status, 'cancelled', actor_id, 'Customer cancelled the booking.', jsonb_build_object('bookingId', booking_record.id));
  END IF;

  IF booking_record.cleaner_user_id IS NOT NULL THEN
    INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
      VALUES (
        booking_record.cleaner_user_id,
        booking_record.id,
        'booking-cancelled',
        'in-app',
        jsonb_build_object('bookingId', booking_record.id),
        'booking:' || booking_record.id || ':cancelled'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN booking_record;
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.list_unpaid_bookings_for_expiry(batch_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-expiry-batch-limit';
  END IF;

  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb) INTO result FROM (
    SELECT jsonb_build_object(
      'bookingId', booking.id,
      'scheduledStartAt', booking.scheduled_start_at,
      -- Every status `begin_payment_command` treats as a cancellable hold, so
      -- the release list is a superset of the paid-for predicate rather than
      -- its complement. A payment that is `authorized` but fails the predicate
      -- is not reachable today; if it ever were, leaving it out here would
      -- cancel the booking with the customer's money still held.
      'paymentId', (
        SELECT payment.id FROM booking_payments payment
        WHERE payment.booking_id = booking.id
          AND payment.status IN ('creating','requires-customer-action','processing','authorized')
        ORDER BY payment.created_at DESC
        LIMIT 1
      )
    ) AS entry
    FROM bookings booking
    WHERE booking.status = 'confirmed'
      AND booking.journey_started_at IS NULL
      AND booking.scheduled_start_at <= now() + interval '12 hours'
      AND NOT tideway_private.booking_has_live_authorization(booking)
      -- Nobody loses a booking without having been warned and given time to
      -- act. Read from the reminders themselves rather than re-derived from
      -- the schedule, so this cannot drift out of step with migration 043.
      AND EXISTS (
        SELECT 1 FROM notifications warned
        WHERE warned.booking_id = booking.id
          AND warned.event_type IN ('payment-window-opened','payment-action-required')
          AND warned.created_at <= now() - interval '2 hours'
      )
    ORDER BY booking.scheduled_start_at, booking.id
    LIMIT batch_limit
    -- As migration 043 does. Without it, two web processes read the same
    -- hundred bookings and race to cancel the same card holds.
    FOR UPDATE OF booking SKIP LOCKED
  ) rows;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.expire_unpaid_booking(target_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings;
  request_record cleaning_requests;
  -- As above: the enum, not text.
  previous_status booking_status;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;

  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id = target_booking_id FOR UPDATE;
  IF booking_record.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-found';
  END IF;

  IF booking_record.status = 'cancelled' THEN
    RETURN jsonb_build_object('bookingId', booking_record.id, 'expired', false, 'reason', 'already-cancelled');
  END IF;

  -- Every condition from the queue, re-made under lock, including the warning.
  IF booking_record.status <> 'confirmed'
    OR booking_record.journey_started_at IS NOT NULL
    OR booking_record.scheduled_start_at > now() + interval '12 hours'
    OR tideway_private.booking_has_live_authorization(booking_record)
    OR NOT EXISTS (
      SELECT 1 FROM notifications warned
      WHERE warned.booking_id = booking_record.id
        AND warned.event_type IN ('payment-window-opened','payment-action-required')
        AND warned.created_at <= now() - interval '2 hours'
    ) THEN
    RETURN jsonb_build_object('bookingId', booking_record.id, 'expired', false, 'reason', 'no-longer-expirable');
  END IF;

  previous_status := booking_record.status;

  UPDATE bookings
    SET status = 'cancelled', cancelled_at = now(), updated_at = now()
    WHERE id = booking_record.id
    RETURNING * INTO booking_record;

  INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason, metadata)
    VALUES (
      booking_record.id,
      previous_status,
      'cancelled',
      actor_id,
      'Cancelled automatically: no payment was authorised before the deadline.',
      jsonb_build_object('cancelledBy', 'platform', 'cause', 'payment-not-authorised')
    );

  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id = booking_record.cleaning_request_id FOR UPDATE;
  IF request_record.id IS NOT NULL AND request_record.status <> 'cancelled' THEN
    UPDATE cleaning_requests SET status = 'cancelled', updated_at = now() WHERE id = request_record.id;
    INSERT INTO cleaning_request_status_history (cleaning_request_id, from_status, to_status, changed_by, reason, metadata)
      VALUES (request_record.id, request_record.status, 'cancelled', actor_id,
        'Booking cancelled automatically because no payment was authorised.',
        jsonb_build_object('bookingId', booking_record.id));
  END IF;

  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
    VALUES (
      booking_record.landlord_user_id,
      booking_record.id,
      'booking-cancelled',
      'in-app',
      jsonb_build_object('bookingId', booking_record.id, 'cause', 'payment-not-authorised'),
      'booking:' || booking_record.id || ':unpaid-expiry:landlord'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
    VALUES (
      booking_record.cleaner_user_id,
      booking_record.id,
      'booking-cancelled',
      'in-app',
      jsonb_build_object('bookingId', booking_record.id, 'cause', 'payment-not-authorised'),
      'booking:' || booking_record.id || ':unpaid-expiry:cleaner'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('bookingId', booking_record.id, 'expired', true, 'reason', 'payment-not-authorised');
END;
$$;

COMMIT;
