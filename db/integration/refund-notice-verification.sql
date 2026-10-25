-- Execute the payment-outcome notice for a refund that arrives through the
-- signed observation ledger.
--
-- Migration 117 routes every refund event, Homle's own and one made outside
-- Homle, through `reconcile_payment_observation`, which records the history
-- row with the event id but not its kind. Migration 126 sends a refund notice
-- only for a history row naming `refund-succeeded`, so after 117 no refund
-- told the customer anything. Migration 135 resolves the kind from the signed
-- event the row names. It also asserts that settlement reconciliation (124)
-- flags the Cleaner left unpaid by a partial refund. Owner-run, self-contained,
-- rolls back.

BEGIN;

DO $$
DECLARE
  landlord_id uuid; cleaner_id uuid; property_id uuid; request_id uuid; fixture_booking uuid;
  payment_id uuid := '5a000000-0000-4000-8000-000000000001';
  outcome jsonb;
  notices integer;
BEGIN
  INSERT INTO users (email, display_name, account_status)
    VALUES ('refund-landlord@verification.invalid', 'Refund Landlord', 'active') RETURNING id INTO landlord_id;
  INSERT INTO users (email, display_name, account_status)
    VALUES ('refund-cleaner@verification.invalid', 'Refund Cleaner', 'active') RETURNING id INTO cleaner_id;
  INSERT INTO user_roles (user_id, role) VALUES (landlord_id, 'landlord'), (cleaner_id, 'cleaner');
  INSERT INTO landlord_profiles (user_id) VALUES (landlord_id);
  INSERT INTO cleaner_profiles (user_id, public_slug) VALUES (cleaner_id, 'refund-cleaner');
  INSERT INTO properties (landlord_user_id, name, property_type, postcode, address_line_1, locality)
    VALUES (landlord_id, 'Refund Property', 'house', 'SM4 4LE', '1 Refund Road', 'Morden') RETURNING id INTO property_id;
  INSERT INTO cleaning_requests (landlord_user_id, property_id, status, cleaning_type, scope_fingerprint,
      requested_start_at, requested_end_at, submission_review_version, customer_scope_confirmed_at, scan_fingerprint, submitted_at)
    VALUES (landlord_id, property_id, 'matched', 'regular-domestic', repeat('a', 64),
      now() + interval '6 hours', now() + interval '9 hours', 1, now(), repeat('c', 64), now())
    RETURNING id INTO request_id;
  INSERT INTO bookings (cleaning_request_id, landlord_user_id, cleaner_user_id, property_id, status,
      scheduled_start_at, scheduled_end_at, customer_price_pence, cleaner_pay_pence,
      invited_at, cleaner_response_deadline, scope_fingerprint, terms_fingerprint, scope_snapshot)
    VALUES (request_id, landlord_id, cleaner_id, property_id, 'confirmed',
      now() + interval '6 hours', now() + interval '9 hours', 9000, 6000,
      now(), now() + interval '2 hours', repeat('a', 64), repeat('b', 64), '{}'::jsonb)
    RETURNING id INTO fixture_booking;
  UPDATE bookings SET status = 'completed' WHERE id = fixture_booking;
  INSERT INTO booking_payments (id, booking_id, landlord_user_id, cleaner_user_id, provider, currency, amount_pence,
      amount_captured_pence, status, captured_at, terms_fingerprint, provider_payment_id, idempotency_key_hash)
    VALUES (payment_id, fixture_booking, landlord_id, cleaner_id, 'stripe', 'gbp', 9000, 9000, 'captured', now(),
      repeat('b', 64), 'pi_refund_notice', decode(repeat('a1', 32), 'hex'));

  PERFORM set_config('app.user_id', landlord_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);

  -- A refund made outside Homle, reported by a signed event with no metadata.
  outcome := tideway_private.reconcile_payment_provider_event('stripe', 'evt_refund_notice_success', 'refund-succeeded',
    're_refund_notice', payment_id, NULL, 2500, 'gbp', now() - interval '1 minute', repeat('d', 64),
    'pi_refund_notice', 'ch_refund_notice', NULL);
  IF outcome->>'accepted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'The refund observation was not applied: %', outcome; END IF;
  IF (SELECT amount_refunded_pence FROM booking_payments WHERE id = payment_id) <> 2500 THEN
    RAISE EXCEPTION 'The refund observation did not move the refunded total';
  END IF;

  SELECT count(*) INTO notices FROM notifications
    WHERE notifications.booking_id = fixture_booking AND event_type = 'payment-refunded' AND recipient_user_id = landlord_id AND channel = 'in-app';
  IF notices <> 1 THEN RAISE EXCEPTION 'A refund told the customer nothing (% in-app notices)', notices; END IF;
  IF NOT EXISTS (SELECT 1 FROM notifications WHERE notifications.booking_id = fixture_booking
      AND event_type = 'payment-refunded' AND channel = 'email') THEN
    RAISE EXCEPTION 'A refund notice was not fanned out to email, so the receipt only exists behind a login';
  END IF;

  -- The partial refund leaves money for the Cleaner but blocks the automatic
  -- transfer, so reconciliation (124) must flag the payment once it is stale
  -- rather than leave the Cleaner unpaid with nothing saying so.
  UPDATE booking_payments SET captured_at = now() - interval '4 days' WHERE id = payment_id;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(tideway_private.settlement_reconciliation(72, 100)->'drift') drift
      WHERE drift->>'paymentId' = payment_id::text AND drift->>'kind' = 'awaiting-transfer'
        AND drift->>'paymentStatus' = 'partially-refunded') THEN
    RAISE EXCEPTION 'A partially refunded payment with an unpaid Cleaner was not flagged for reconciliation';
  END IF;

  -- The same refund reported again is not a second refund and not a second notice.
  PERFORM tideway_private.reconcile_payment_provider_event('stripe', 'evt_refund_notice_repeat', 'refund-succeeded',
    're_refund_notice', payment_id, NULL, 2500, 'gbp', now(), repeat('e', 64), 'pi_refund_notice', 'ch_refund_notice', NULL);
  SELECT count(*) INTO notices FROM notifications WHERE notifications.booking_id = fixture_booking AND event_type = 'payment-refunded' AND channel = 'in-app';
  IF notices <> 1 THEN RAISE EXCEPTION 'A repeated refund event sent % notices', notices; END IF;

  -- A failed refund reverses the money and is not announced as a refund.
  PERFORM tideway_private.reconcile_payment_provider_event('stripe', 'evt_refund_notice_failed', 'refund-failed',
    're_refund_notice', payment_id, NULL, 2500, 'gbp', now(), repeat('f', 64), 'pi_refund_notice', 'ch_refund_notice', NULL);
  SELECT count(*) INTO notices FROM notifications WHERE notifications.booking_id = fixture_booking AND event_type = 'payment-refunded' AND channel = 'in-app';
  IF notices <> 1 THEN RAISE EXCEPTION 'A failed refund was announced as a refund (% notices)', notices; END IF;

  RAISE NOTICE 'Refund notice verification passed: an observed refund notifies once, a repeat is silent, a failure is not announced.';
END $$;

ROLLBACK;
