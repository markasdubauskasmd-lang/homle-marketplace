-- Execute the two cancellation functions against a real database.
--
-- This file exists because of a defect that a green test suite could not see.
-- `cancel_booking_as_landlord` and `expire_unpaid_booking` both declared the
-- previous booking status as `text` and inserted it into an enum column, so
-- both threw on the one path where they would act. Everything covering them
-- was a JavaScript fake or a string match against the migration source, and
-- neither can see a type error. Both callers release the customer's card hold
-- before calling these, so the live behaviour was: return the money, fail to
-- cancel the booking, leave the Cleaner's slot blocked.
--
-- So this asserts the one thing those tests could not: that the functions run.
-- It is written for a disposable database with every migration applied.

BEGIN;

DO $$
DECLARE
  landlord_id uuid;
  cleaner_id uuid;
  administrator_id uuid;
  property_id uuid;
  request_id uuid;
  cancellable_booking_id uuid;
  expirable_booking_id uuid;
  unwarned_booking_id uuid;
  outcome jsonb;
  cancelled bookings;
BEGIN
  INSERT INTO users (email, display_name, account_status)
    VALUES ('landlord@verification.invalid', 'Verification Landlord', 'active') RETURNING id INTO landlord_id;
  INSERT INTO users (email, display_name, account_status)
    VALUES ('cleaner@verification.invalid', 'Verification Cleaner', 'active') RETURNING id INTO cleaner_id;
  INSERT INTO users (email, display_name, account_status)
    VALUES ('admin@verification.invalid', 'Verification Administrator', 'active') RETURNING id INTO administrator_id;
  INSERT INTO user_roles (user_id, role) VALUES (landlord_id, 'landlord'), (cleaner_id, 'cleaner'), (administrator_id, 'administrator');

  INSERT INTO landlord_profiles (user_id) VALUES (landlord_id);
  INSERT INTO cleaner_profiles (user_id, public_slug) VALUES (cleaner_id, 'verification-cleaner');

  INSERT INTO properties (landlord_user_id, name, property_type, postcode, address_line_1, locality)
    VALUES (landlord_id, 'Verification Property', 'house', 'SM4 4LE', '1 Verification Road', 'Morden')
    RETURNING id INTO property_id;

  -- A request may only leave draft once the customer has reviewed the scope,
  -- so the fixture satisfies that rather than routing around the trigger.
  INSERT INTO cleaning_requests (landlord_user_id, property_id, status, cleaning_type, scope_fingerprint,
      requested_start_at, requested_end_at,
      submission_review_version, customer_scope_confirmed_at, scan_fingerprint, submitted_at)
    VALUES (landlord_id, property_id, 'matched', 'regular-domestic', repeat('a', 64),
      now() + interval '6 hours', now() + interval '9 hours',
      1, now(), repeat('c', 64), now())
    RETURNING id INTO request_id;

  /* ── The Landlord cancellation path (migration 115, repaired in 126) ── */

  INSERT INTO bookings (cleaning_request_id, landlord_user_id, cleaner_user_id, property_id, status,
      scheduled_start_at, scheduled_end_at, customer_price_pence, cleaner_pay_pence,
      invited_at, cleaner_response_deadline, scope_fingerprint, terms_fingerprint, scope_snapshot)
    VALUES (request_id, landlord_id, cleaner_id, property_id, 'confirmed',
      now() + interval '6 hours', now() + interval '9 hours', 9000, 6000,
      now(), now() + interval '2 hours', repeat('a', 64), repeat('b', 64), '{}'::jsonb)
    RETURNING id INTO cancellable_booking_id;

  PERFORM set_config('app.user_id', landlord_id::text, true);
  PERFORM set_config('app.user_roles', 'landlord', true);

  cancelled := tideway_private.cancel_booking_as_landlord(cancellable_booking_id, 'Plans changed.');
  IF cancelled.status <> 'cancelled' THEN
    RAISE EXCEPTION 'cancel_booking_as_landlord did not cancel the booking (status %)', cancelled.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM booking_status_history WHERE booking_id = cancellable_booking_id
    AND from_status = 'confirmed' AND to_status = 'cancelled') THEN
    RAISE EXCEPTION 'cancel_booking_as_landlord recorded no status history';
  END IF;
  -- Repeating it is not an error: a customer who taps twice wanted it
  -- cancelled, and it is cancelled.
  cancelled := tideway_private.cancel_booking_as_landlord(cancellable_booking_id, 'Plans changed.');
  IF cancelled.status <> 'cancelled' THEN
    RAISE EXCEPTION 'a repeated cancellation was not idempotent';
  END IF;

  /* ── The unpaid-booking expiry path (migration 125, repaired in 126) ── */

  INSERT INTO bookings (cleaning_request_id, landlord_user_id, cleaner_user_id, property_id, status,
      scheduled_start_at, scheduled_end_at, customer_price_pence, cleaner_pay_pence,
      invited_at, cleaner_response_deadline, scope_fingerprint, terms_fingerprint, scope_snapshot)
    VALUES (request_id, landlord_id, cleaner_id, property_id, 'confirmed',
      now() + interval '6 hours', now() + interval '9 hours', 9000, 6000,
      now(), now() + interval '2 hours', repeat('a', 64), repeat('b', 64), '{}'::jsonb)
    RETURNING id INTO expirable_booking_id;

  PERFORM set_config('app.user_id', administrator_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);

  -- Nobody is expired without a warning. Before the reminder exists, the
  -- booking must not be in the queue at all.
  IF (tideway_private.list_unpaid_bookings_for_expiry(100))::jsonb @> jsonb_build_array(jsonb_build_object('bookingId', expirable_booking_id)) THEN
    RAISE EXCEPTION 'an unwarned booking was queued for expiry';
  END IF;
  outcome := tideway_private.expire_unpaid_booking(expirable_booking_id);
  IF outcome->>'expired' <> 'false' OR outcome->>'reason' <> 'no-longer-expirable' THEN
    RAISE EXCEPTION 'an unwarned booking was expired: %', outcome;
  END IF;

  -- With a reminder sent more than two hours ago, it becomes expirable.
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key, created_at)
    VALUES (landlord_id, expirable_booking_id, 'payment-action-required', 'in-app',
      jsonb_build_object('bookingId', expirable_booking_id),
      'payment-readiness:' || expirable_booking_id, now() - interval '3 hours');

  IF NOT ((tideway_private.list_unpaid_bookings_for_expiry(100))::jsonb @> jsonb_build_array(jsonb_build_object('bookingId', expirable_booking_id))) THEN
    RAISE EXCEPTION 'a warned, unpaid booking was not queued for expiry';
  END IF;

  outcome := tideway_private.expire_unpaid_booking(expirable_booking_id);
  IF outcome->>'expired' <> 'true' THEN
    RAISE EXCEPTION 'expire_unpaid_booking did not expire a warned, unpaid booking: %', outcome;
  END IF;
  IF (SELECT status FROM bookings WHERE id = expirable_booking_id) <> 'cancelled' THEN
    RAISE EXCEPTION 'expire_unpaid_booking reported success without cancelling the booking';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM booking_status_history WHERE booking_id = expirable_booking_id
    AND from_status = 'confirmed' AND to_status = 'cancelled') THEN
    RAISE EXCEPTION 'expire_unpaid_booking recorded no status history';
  END IF;
  -- Both sides are told. The Cleaner especially: the whole point of ending it
  -- early is that they find out in time to use the day.
  IF (SELECT count(*) FROM notifications WHERE booking_id = expirable_booking_id
    AND event_type = 'booking-cancelled' AND channel = 'in-app'
    AND recipient_user_id IN (landlord_id, cleaner_id)) <> 2 THEN
    RAISE EXCEPTION 'expire_unpaid_booking did not notify both the customer and the Cleaner';
  END IF;

  outcome := tideway_private.expire_unpaid_booking(expirable_booking_id);
  IF outcome->>'reason' <> 'already-cancelled' THEN
    RAISE EXCEPTION 'a repeated expiry pass was not idempotent: %', outcome;
  END IF;

  /* ── A booking that has been paid for is never touched ── */

  INSERT INTO bookings (cleaning_request_id, landlord_user_id, cleaner_user_id, property_id, status,
      scheduled_start_at, scheduled_end_at, customer_price_pence, cleaner_pay_pence,
      invited_at, cleaner_response_deadline, scope_fingerprint, terms_fingerprint, scope_snapshot)
    VALUES (request_id, landlord_id, cleaner_id, property_id, 'confirmed',
      now() + interval '6 hours', now() + interval '9 hours', 9000, 6000,
      now(), now() + interval '2 hours', repeat('a', 64), repeat('b', 64), '{}'::jsonb)
    RETURNING id INTO unwarned_booking_id;
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key, created_at)
    VALUES (landlord_id, unwarned_booking_id, 'payment-action-required', 'in-app',
      jsonb_build_object('bookingId', unwarned_booking_id),
      'payment-readiness:' || unwarned_booking_id, now() - interval '3 hours');
  INSERT INTO booking_payments (id, booking_id, landlord_user_id, cleaner_user_id, provider, provider_payment_id,
      status, currency, amount_pence, terms_fingerprint, idempotency_key_hash, authorized_at)
    VALUES (gen_random_uuid(), unwarned_booking_id, landlord_id, cleaner_id, 'stripe', 'pi_verification',
      'authorized', 'gbp', 9000, repeat('b', 64), decode(repeat('00', 32), 'hex'), now());

  outcome := tideway_private.expire_unpaid_booking(unwarned_booking_id);
  IF outcome->>'expired' <> 'false' THEN
    RAISE EXCEPTION 'a booking that had been paid for was expired: %', outcome;
  END IF;
  IF (SELECT status FROM bookings WHERE id = unwarned_booking_id) <> 'confirmed' THEN
    RAISE EXCEPTION 'a booking that had been paid for was cancelled';
  END IF;

  /* ── The Administrator case read (migration 127) ── */

  -- It exists so the case desk can find a case's booking BEFORE resolving it,
  -- which is what lets a refund be sent while the booking is still disputed.
  PERFORM set_config('app.user_id', landlord_id::text, true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  BEGIN
    PERFORM tideway_private.get_booking_dispute_for_administrator(gen_random_uuid());
    RAISE EXCEPTION 'a non-Administrator read the booking-case queue';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('app.user_id', administrator_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);
  BEGIN
    PERFORM tideway_private.get_booking_dispute_for_administrator(gen_random_uuid());
    RAISE EXCEPTION 'an unknown booking case was reported as found';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  RAISE NOTICE 'Booking cancellation verification passed: Landlord cancellation and unpaid expiry both execute, are idempotent, warn before expiring, notify both parties, and leave a paid booking alone; the Administrator case read is role-gated and reports a missing case.';
END $$;

ROLLBACK;
