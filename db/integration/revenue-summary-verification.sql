-- Execute the Administrator revenue summary against real ledger rows.
--
-- The arithmetic is the whole feature, so it is asserted against money that
-- was actually captured, refunded and transferred rather than against an empty
-- window. Migration 130 must agree with migration 121's per-payment view: two
-- ways of computing "what the platform kept" is how a business ends up with
-- two answers and trusts neither.
--
-- Written for a disposable database with every migration applied. Creates its
-- own fixtures and rolls back.

BEGIN;

DO $$
DECLARE
  administrator_id uuid;
  landlord_id uuid;
  cleaner_id uuid;
  property_id uuid;
  request_id uuid;
  stale_request_id uuid;
  booking_id uuid;
  payment_id uuid := gen_random_uuid();
  stale_booking_id uuid;
  stale_payment_id uuid := gen_random_uuid();
  revenue jsonb;
  refused boolean;
BEGIN
  INSERT INTO users (email, display_name, account_status)
    VALUES ('revenue-admin@verification.invalid', 'Revenue Administrator', 'active') RETURNING id INTO administrator_id;
  INSERT INTO users (email, display_name, account_status)
    VALUES ('revenue-landlord@verification.invalid', 'Revenue Landlord', 'active') RETURNING id INTO landlord_id;
  INSERT INTO users (email, display_name, account_status)
    VALUES ('revenue-cleaner@verification.invalid', 'Revenue Cleaner', 'active') RETURNING id INTO cleaner_id;
  INSERT INTO user_roles (user_id, role)
    VALUES (administrator_id, 'administrator'), (landlord_id, 'landlord'), (cleaner_id, 'cleaner');
  INSERT INTO landlord_profiles (user_id) VALUES (landlord_id);
  INSERT INTO cleaner_profiles (user_id, public_slug) VALUES (cleaner_id, 'revenue-cleaner');
  INSERT INTO properties (landlord_user_id, name, property_type, postcode, address_line_1, locality)
    VALUES (landlord_id, 'Revenue Property', 'house', 'SM4 4LE', '1 Revenue Road', 'Morden') RETURNING id INTO property_id;
  INSERT INTO cleaning_requests (landlord_user_id, property_id, status, cleaning_type, scope_fingerprint,
      requested_start_at, requested_end_at, submission_review_version, customer_scope_confirmed_at, scan_fingerprint, submitted_at)
    VALUES (landlord_id, property_id, 'matched', 'regular-domestic', repeat('a', 64),
      now() + interval '6 hours', now() + interval '9 hours', 1, now(), repeat('c', 64), now())
    RETURNING id INTO request_id;

  -- One completed booking: £120 charged, £120 captured, £15 refunded, £84
  -- transferred to the Cleaner. Net customer £105, platform take £21.
  --
  -- `planned_contribution_pence` is a generated column -- price minus Cleaner
  -- pay minus the planned costs -- so it is left to derive (£120 - £84 = £36)
  -- rather than asserted against a number typed here. That is worth knowing:
  -- the summary's "planned" figure cannot drift from what pricing decided.
  INSERT INTO bookings (cleaning_request_id, landlord_user_id, cleaner_user_id, property_id, status,
      scheduled_start_at, scheduled_end_at, customer_price_pence, cleaner_pay_pence,
      invited_at, cleaner_response_deadline, scope_fingerprint, terms_fingerprint, scope_snapshot)
    VALUES (request_id, landlord_id, cleaner_id, property_id, 'completed',
      now() - interval '2 days', now() - interval '2 days' + interval '3 hours', 12000, 8400,
      now() - interval '3 days', now() - interval '3 days' + interval '2 hours', repeat('a', 64), repeat('b', 64), '{}'::jsonb)
    RETURNING id INTO booking_id;
  INSERT INTO booking_payments (id, booking_id, landlord_user_id, cleaner_user_id, provider, provider_payment_id,
      status, currency, amount_pence, amount_captured_pence, amount_refunded_pence, terms_fingerprint,
      idempotency_key_hash, authorized_at, captured_at)
    VALUES (payment_id, booking_id, landlord_id, cleaner_id, 'stripe', 'pi_revenue',
      'partially-refunded', 'gbp', 12000, 12000, 1500, repeat('b', 64),
      decode(repeat('11', 32), 'hex'), now() - interval '3 days', now() - interval '1 day');
  INSERT INTO payment_commands (id, payment_id, command_kind, status, amount_pence, created_by, idempotency_key_hash)
    VALUES (gen_random_uuid(), payment_id, 'transfer', 'reconciled', 8400, administrator_id, decode(repeat('22', 32), 'hex'));

  -- A second booking captured well outside the window, to prove the window is
  -- applied to when the money was taken. It needs its own request: only one
  -- live booking attempt per request is permitted.
  INSERT INTO cleaning_requests (landlord_user_id, property_id, status, cleaning_type, scope_fingerprint,
      requested_start_at, requested_end_at, submission_review_version, customer_scope_confirmed_at, scan_fingerprint, submitted_at)
    VALUES (landlord_id, property_id, 'matched', 'regular-domestic', repeat('d', 64),
      now() + interval '20 hours', now() + interval '23 hours', 1, now(), repeat('e', 64), now())
    RETURNING id INTO stale_request_id;
  INSERT INTO bookings (cleaning_request_id, landlord_user_id, cleaner_user_id, property_id, status,
      scheduled_start_at, scheduled_end_at, customer_price_pence, cleaner_pay_pence,
      invited_at, cleaner_response_deadline, scope_fingerprint, terms_fingerprint, scope_snapshot)
    VALUES (stale_request_id, landlord_id, cleaner_id, property_id, 'completed',
      now() - interval '200 days', now() - interval '200 days' + interval '3 hours', 50000, 30000,
      now() - interval '201 days', now() - interval '201 days' + interval '2 hours', repeat('a', 64), repeat('b', 64), '{}'::jsonb)
    RETURNING id INTO stale_booking_id;
  INSERT INTO booking_payments (id, booking_id, landlord_user_id, cleaner_user_id, provider, provider_payment_id,
      status, currency, amount_pence, amount_captured_pence, amount_refunded_pence, terms_fingerprint,
      idempotency_key_hash, authorized_at, captured_at)
    VALUES (stale_payment_id, stale_booking_id, landlord_id, cleaner_id, 'stripe', 'pi_revenue_old',
      'captured', 'gbp', 50000, 50000, 0, repeat('b', 64),
      decode(repeat('44', 32), 'hex'), now() - interval '201 days', now() - interval '199 days');
  -- Its transfer is still pending with the provider, so the money has not left
  -- the platform balance. Counting it would report the Cleaner as paid and the
  -- fee as smaller than it is. (A unique index permits only one live transfer
  -- command per payment, which is why this sits on the second booking rather
  -- than alongside the reconciled one.)
  INSERT INTO payment_commands (id, payment_id, command_kind, status, amount_pence, created_by, idempotency_key_hash)
    VALUES (gen_random_uuid(), stale_payment_id, 'transfer', 'provider-pending', 30000, administrator_id, decode(repeat('33', 32), 'hex'));

  PERFORM set_config('app.user_id', administrator_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);

  revenue := tideway_private.get_administrator_revenue(30);
  IF (revenue->>'capturedCount')::integer <> 1 THEN
    RAISE EXCEPTION 'the thirty-day window counted % captured payments, not the one inside it', revenue->>'capturedCount';
  END IF;
  IF (revenue->>'capturedPence')::bigint <> 12000 THEN RAISE EXCEPTION 'captured total wrong: %', revenue; END IF;
  IF (revenue->>'refundedPence')::bigint <> 1500 THEN RAISE EXCEPTION 'refunded total wrong: %', revenue; END IF;
  IF (revenue->>'netCustomerPence')::bigint <> 10500 THEN RAISE EXCEPTION 'net customer total wrong: %', revenue; END IF;
  -- The pending transfer is excluded; only the reconciled £84 counts.
  IF (revenue->>'transferredPence')::bigint <> 8400 THEN
    RAISE EXCEPTION 'a transfer that has not left the platform balance was counted: %', revenue;
  END IF;
  IF (revenue->>'platformTakePence')::bigint <> 2100 THEN RAISE EXCEPTION 'platform take wrong: %', revenue; END IF;
  IF (revenue->>'plannedContributionPence')::bigint <> 3600 THEN RAISE EXCEPTION 'planned contribution wrong: %', revenue; END IF;
  IF (revenue->>'refundedCount')::integer <> 1 THEN RAISE EXCEPTION 'refunded count wrong: %', revenue; END IF;
  IF (revenue->>'awaitingTransferCount')::integer <> 0 THEN RAISE EXCEPTION 'awaiting-transfer count wrong: %', revenue; END IF;

  -- A wider window picks up the older capture, which proves the window is real
  -- rather than a label.
  revenue := tideway_private.get_administrator_revenue(365);
  IF (revenue->>'capturedCount')::integer <> 2 OR (revenue->>'capturedPence')::bigint <> 62000 THEN
    RAISE EXCEPTION 'the yearly window did not include the older capture: %', revenue;
  END IF;
  -- The older capture's transfer is still pending, so it must not appear in
  -- the transferred total: £84 reconciled and nothing else.
  IF (revenue->>'transferredPence')::bigint <> 8400 THEN
    RAISE EXCEPTION 'a transfer still pending with the provider was counted as paid: %', revenue;
  END IF;
  -- And the Cleaner who has not been paid must be visible as money still owed,
  -- rather than hidden inside a healthy-looking fee.
  IF (revenue->>'awaitingTransferCount')::integer <> 1 THEN
    RAISE EXCEPTION 'a capture whose transfer has not settled was not reported as awaiting one: %', revenue;
  END IF;
  IF (revenue->>'platformTakePence')::bigint <> 52100 THEN
    RAISE EXCEPTION 'the yearly platform take did not account for the unsettled transfer: %', revenue;
  END IF;

  -- Aggregate only. An operator asking what the month was worth does not need
  -- a list of who paid what.
  IF revenue::text LIKE '%' || booking_id::text || '%' OR revenue::text LIKE '%' || payment_id::text || '%'
     OR revenue::text LIKE '%' || landlord_id::text || '%' THEN
    RAISE EXCEPTION 'the revenue summary carried an identifier: %', revenue;
  END IF;

  refused := false;
  BEGIN
    PERFORM tideway_private.get_administrator_revenue(31);
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'invalid-revenue-window' THEN RAISE; END IF;
    refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'an unsupported revenue window was accepted'; END IF;

  PERFORM set_config('app.user_id', landlord_id::text, true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  refused := false;
  BEGIN
    PERFORM tideway_private.get_administrator_revenue(30);
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'a Landlord read the platform revenue'; END IF;

  RAISE NOTICE 'Revenue summary verification passed: captured, refunded, reconciled-only transfers, platform take and planned contribution all agree with the ledger; window applies to capture time; aggregate-only and Administrator-only.';
END $$;

ROLLBACK;
