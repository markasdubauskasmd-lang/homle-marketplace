-- End a booking nobody ever paid for.
--
-- The dunning half of this already exists. Migration 041 queues a payment
-- reminder, 043 makes it two stages -- once when the five-day authorization
-- window opens, once twenty-four hours before the slot -- and 117 and 123 mail
-- the outcome when an authorization fails. What none of them does is finish
-- the story: a booking that is still unpaid after every reminder simply stays
-- `confirmed` forever.
--
-- That is not a tidiness problem. Migration 025 refuses to let a job start
-- without an authorized payment, so the clean was never going to happen; and
-- the Cleaner's calendar is held for it the whole time. An unpaid booking is a
-- Cleaner's working day quietly taken off the market for a job that cannot
-- legally begin, and nobody tells them. At a pilot with almost no supply, that
-- is the most expensive silent failure in the system.
--
-- The deadline is twelve hours before the slot (DECISIONS.md D13). The customer
-- has had the window-opened notice five days out and the action-required notice
-- at twenty-four hours; twelve more hours after that is a real chance to pay,
-- and it leaves the Cleaner half a day's notice rather than a doorstep.
--
-- What this function deliberately does NOT do:
--
--   * It does not touch the provider. Cancelling a live Stripe authorization is
--     network I/O against a third party; doing it inside this transaction would
--     hold a lock across an external call and could leave the booking and the
--     hold disagreeing. The caller releases the hold FIRST and only then calls
--     `expire_unpaid_booking` -- the same ordering migration 115 settled, and
--     for the same reason: `begin_payment_command` will not cancel a hold on a
--     booking that has already left `confirmed`, so cancelling the booking
--     first would strand the customer's money with no way out.
--   * It does not charge a cancellation fee. Nothing was ever authorized, so
--     there is nothing to charge and no approved terms to charge it under.
--   * It does not re-open the cleaning request for matching. The customer did
--     not decline a Cleaner; they did not pay. Putting a Cleaner back to work
--     on it would repeat the same outcome.

BEGIN;

-- The payment that would make a booking payable-for. Written once and used by
-- both functions below, because the selection and the re-check under lock
-- drifting apart is exactly how a paid booking would get cancelled.
--
-- The predicate is the same strict one migration 043 uses to decide a reminder
-- is not needed: the right booking, the right parties, the right amount, the
-- same terms fingerprint, and an authorization inside its own five-day window.
-- A payment that fails any of those is not a payment for this booking.
CREATE FUNCTION tideway_private.booking_has_live_authorization(target_booking bookings)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM booking_payments payment
    WHERE payment.booking_id = target_booking.id
      AND payment.landlord_user_id = target_booking.landlord_user_id
      AND payment.cleaner_user_id = target_booking.cleaner_user_id
      AND payment.provider = 'stripe'
      AND payment.provider_payment_id IS NOT NULL
      AND payment.status = 'authorized'
      AND payment.currency = 'gbp'
      AND payment.amount_pence = target_booking.customer_price_pence
      AND payment.terms_fingerprint = target_booking.terms_fingerprint
      AND payment.authorized_at BETWEEN target_booking.scheduled_start_at - interval '5 days' AND now() + interval '5 minutes'
  );
$$;

-- The queue: bookings past their payment deadline with nothing authorized.
--
-- Read-only. It reports what needs ending and whether a half-finished payment
-- attempt is still open, so the caller can release that hold before asking for
-- the booking to be cancelled. Deciding and acting are separate on purpose:
-- the decision is re-made under lock in `expire_unpaid_booking`, so a payment
-- that lands between the two is not cancelled out from under the customer.
CREATE FUNCTION tideway_private.list_unpaid_bookings_for_expiry(batch_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
      -- The open payment attempt, if there is one, so the caller can release it
      -- before the booking leaves `confirmed`. Null means nothing was ever
      -- started and there is no hold to release.
      'paymentId', (
        SELECT payment.id FROM booking_payments payment
        WHERE payment.booking_id = booking.id
          AND payment.status IN ('creating','requires-customer-action','processing')
        ORDER BY payment.created_at DESC
        LIMIT 1
      )
    ) AS entry
    FROM bookings booking
    WHERE booking.status = 'confirmed'
      AND booking.journey_started_at IS NULL
      AND booking.scheduled_start_at <= now() + interval '12 hours'
      AND NOT tideway_private.booking_has_live_authorization(booking)
    ORDER BY booking.scheduled_start_at, booking.id
    LIMIT batch_limit
  ) rows;
  RETURN result;
END;
$$;

CREATE FUNCTION tideway_private.expire_unpaid_booking(target_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings;
  request_record cleaning_requests;
  previous_status text;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;

  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id = target_booking_id FOR UPDATE;
  IF booking_record.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-found';
  END IF;

  -- Already ended. Repeating the call is not an error: the queue is read
  -- outside this lock, so two passes can legitimately see the same booking.
  IF booking_record.status = 'cancelled' THEN
    RETURN jsonb_build_object('bookingId', booking_record.id, 'expired', false, 'reason', 'already-cancelled');
  END IF;

  -- Every condition from the queue, re-made under lock. A payment that landed
  -- in the meantime, a journey that started, a booking that moved on -- any of
  -- them means this is no longer an unpaid booking and must be left alone. The
  -- caller is told nothing happened rather than being given an error, because
  -- nothing went wrong: somebody paid.
  IF booking_record.status <> 'confirmed'
    OR booking_record.journey_started_at IS NOT NULL
    OR booking_record.scheduled_start_at > now() + interval '12 hours'
    OR tideway_private.booking_has_live_authorization(booking_record) THEN
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

  -- Both sides are told, and the Cleaner especially: they have held this slot
  -- for a job that was never going to happen, and the whole point of ending it
  -- early is that they find out in time to use the day. The idempotency keys
  -- make a repeated pass silent rather than duplicating the message.
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

  IF booking_record.cleaner_user_id IS NOT NULL THEN
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
  END IF;

  RETURN jsonb_build_object('bookingId', booking_record.id, 'expired', true, 'reason', 'payment-not-authorised');
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.booking_has_live_authorization(bookings) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.list_unpaid_bookings_for_expiry(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.expire_unpaid_booking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.list_unpaid_bookings_for_expiry(integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.expire_unpaid_booking(uuid) TO tideway_app;

COMMIT;
