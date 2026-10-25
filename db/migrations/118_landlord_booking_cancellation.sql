-- Landlord booking cancellation.
--
-- `confirmed:cancelled` has been a permitted Landlord transition in
-- src/marketplace/domain.mjs since the booking model was written, but no
-- database function and no HTTP route ever implemented it. A customer whose
-- plans changed had no way to cancel, and — worse — no way to release the card
-- hold their booking had placed. Because the refund path requires a booking in
-- `cancelled`, `completed` or `disputed`, an unreachable cancellation also
-- stranded refunds for every confirmed booking.
--
-- Cancelling releases the whole authorization and charges nothing. That is not
-- a generosity policy, it is what the ledger can honestly support today: the
-- money is only ever authorized, never captured, before the clean happens, so
-- releasing an uncaptured hold costs the platform nothing and returns the
-- customer's money immediately. A cancellation fee is a pricing decision that
-- needs PRICING_POLICY_APPROVED and approved customer terms; it is recorded in
-- HUMAN_TODO.md rather than invented here.
--
-- The provider call is deliberately NOT made from this function. Cancelling the
-- Stripe authorization is network I/O against a third party; doing it inside the
-- transaction would hold a database lock across an external call and leave the
-- booking and the hold inconsistent if the call failed halfway. The service
-- layer cancels the booking first, then issues the existing role-bound `cancel`
-- payment command, which is already idempotent and already permits a Landlord.

BEGIN;

CREATE FUNCTION tideway_private.cancel_booking_as_landlord(target_booking_id uuid, supplied_reason text DEFAULT NULL)
RETURNS bookings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings;
  request_record cleaning_requests;
  cancellation_reason text := NULLIF(trim(supplied_reason), '');
  -- Captured before the UPDATE overwrites booking_record, so the history row
  -- records the status the booking actually moved from rather than 'cancelled'
  -- to itself.
  previous_status text;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required';
  END IF;

  -- Ownership is proven by the lookup, not by a separate check that could drift
  -- from it. A booking belonging to someone else simply is not found.
  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id = target_booking_id AND booking.landlord_user_id = actor_id
    FOR UPDATE;
  IF booking_record.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-found';
  END IF;

  -- Repeating a cancellation is not an error. A customer who taps twice, or
  -- retries after a lost response, must not be told their booking is in a state
  -- they cannot act on — they wanted it cancelled and it is cancelled.
  IF booking_record.status = 'cancelled' THEN
    RETURN booking_record;
  END IF;

  -- Mirrors landlordTransitions in src/marketplace/domain.mjs exactly. Once a
  -- Cleaner is en route the customer is no longer simply changing their mind:
  -- somebody is travelling to the property, and that is a dispute, not a
  -- cancellation.
  IF booking_record.status NOT IN ('draft','searching-for-cleaner','cleaner-invited','pending-cleaner-acceptance','confirmed') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-cancellable';
  END IF;

  -- A started journey contradicts a cancellable status; treat the stronger
  -- signal as authoritative rather than trusting the status column alone.
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

  -- The customer cancelled the work, so the request is closed rather than
  -- returned to matching. Re-opening it would put a Cleaner back to work on
  -- something the customer just called off.
  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id = booking_record.cleaning_request_id FOR UPDATE;
  IF request_record.id IS NOT NULL AND request_record.status <> 'cancelled' THEN
    UPDATE cleaning_requests SET status = 'cancelled', updated_at = now() WHERE id = request_record.id;
    INSERT INTO cleaning_request_status_history (cleaning_request_id, from_status, to_status, changed_by, reason, metadata)
      VALUES (request_record.id, request_record.status, 'cancelled', actor_id, 'Customer cancelled the booking.', jsonb_build_object('bookingId', booking_record.id));
  END IF;

  -- An assigned Cleaner has arranged their day around this. Telling them is not
  -- optional, and the idempotency key makes a repeated cancel silent rather
  -- than duplicating the message.
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

REVOKE ALL ON FUNCTION tideway_private.cancel_booking_as_landlord(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.cancel_booking_as_landlord(uuid,text) TO tideway_app;

COMMIT;
