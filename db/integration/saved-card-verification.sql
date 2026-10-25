-- Execute pay-at-booking with a saved card (migration 136) against a real
-- database: who may save, when a card may be used, that consent to one total
-- is not consent to another, and that the platform's authorization lands in
-- the same ledger as any other. Owner-run, self-contained, rolls back.

BEGIN;

DO $$
DECLARE
  landlord_id uuid; other_landlord_id uuid; cleaner_id uuid; admin_id uuid;
  property_id uuid; request_id uuid; second_request_id uuid; far_booking uuid; near_booking uuid;
  card jsonb; started jsonb; again jsonb; refused boolean; due integer;
  payment_row booking_payments;
BEGIN
  INSERT INTO users (email, display_name, account_status) VALUES ('saved-landlord@verification.invalid', 'Saved Landlord', 'active') RETURNING id INTO landlord_id;
  INSERT INTO users (email, display_name, account_status) VALUES ('saved-other@verification.invalid', 'Other Landlord', 'active') RETURNING id INTO other_landlord_id;
  INSERT INTO users (email, display_name, account_status) VALUES ('saved-cleaner@verification.invalid', 'Saved Cleaner', 'active') RETURNING id INTO cleaner_id;
  INSERT INTO users (email, display_name, account_status) VALUES ('saved-admin@verification.invalid', 'Saved Administrator', 'active') RETURNING id INTO admin_id;
  INSERT INTO user_roles (user_id, role) VALUES (landlord_id, 'landlord'), (other_landlord_id, 'landlord'), (cleaner_id, 'cleaner'), (admin_id, 'administrator');
  INSERT INTO landlord_profiles (user_id) VALUES (landlord_id), (other_landlord_id);
  INSERT INTO cleaner_profiles (user_id, public_slug) VALUES (cleaner_id, 'saved-cleaner');
  INSERT INTO properties (landlord_user_id, name, property_type, postcode, address_line_1, locality)
    VALUES (landlord_id, 'Saved Property', 'house', 'SM4 4LE', '1 Saved Road', 'Morden') RETURNING id INTO property_id;
  INSERT INTO cleaning_requests (landlord_user_id, property_id, status, cleaning_type, scope_fingerprint,
      requested_start_at, requested_end_at, submission_review_version, customer_scope_confirmed_at, scan_fingerprint, submitted_at)
    VALUES (landlord_id, property_id, 'matched', 'regular-domestic', repeat('a', 64),
      now() + interval '10 days', now() + interval '10 days 3 hours', 1, now(), repeat('c', 64), now())
    RETURNING id INTO request_id;
  INSERT INTO bookings (cleaning_request_id, landlord_user_id, cleaner_user_id, property_id, status,
      scheduled_start_at, scheduled_end_at, customer_price_pence, cleaner_pay_pence,
      invited_at, cleaner_response_deadline, scope_fingerprint, terms_fingerprint, scope_snapshot)
    VALUES (request_id, landlord_id, cleaner_id, property_id, 'confirmed',
      now() + interval '10 days', now() + interval '10 days 3 hours', 9000, 6000,
      now(), now() + interval '2 hours', repeat('a', 64), repeat('b', 64), '{}'::jsonb)
    RETURNING id INTO far_booking;
  INSERT INTO cleaning_requests (landlord_user_id, property_id, status, cleaning_type, scope_fingerprint,
      requested_start_at, requested_end_at, submission_review_version, customer_scope_confirmed_at, scan_fingerprint, submitted_at)
    VALUES (landlord_id, property_id, 'matched', 'regular-domestic', repeat('a', 64),
      now() + interval '3 days', now() + interval '3 days 3 hours', 1, now(), repeat('c', 64), now())
    RETURNING id INTO second_request_id;
  INSERT INTO bookings (cleaning_request_id, landlord_user_id, cleaner_user_id, property_id, status,
      scheduled_start_at, scheduled_end_at, customer_price_pence, cleaner_pay_pence,
      invited_at, cleaner_response_deadline, scope_fingerprint, terms_fingerprint, scope_snapshot)
    VALUES (second_request_id, landlord_id, cleaner_id, property_id, 'confirmed',
      now() + interval '3 days', now() + interval '3 days 3 hours', 9000, 6000,
      now(), now() + interval '2 hours', repeat('a', 64), repeat('b', 64), '{}'::jsonb)
    RETURNING id INTO near_booking;

  /* ── Saving: the owning Landlord, outside the window only ── */
  PERFORM set_config('app.user_id', landlord_id::text, true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  card := tideway_private.begin_booking_saved_card(far_booking);
  IF card->>'status' <> 'creating' OR (card->>'amountPence')::integer <> 9000 OR card ? 'providerPaymentMethodId' THEN
    RAISE EXCEPTION 'Saving a card did not start against the frozen total: %', card;
  END IF;
  refused := false;
  BEGIN PERFORM tideway_private.begin_booking_saved_card(near_booking);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'payment-window-open' THEN RAISE; END IF; refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'A card was saved for a booking whose payment window is already open'; END IF;

  -- The provider state is recorded, and a different setup cannot replace it.
  card := tideway_private.record_booking_saved_card(far_booking, 'cus_verification', 'seti_verification', 'requires-customer-action', NULL);
  refused := false;
  BEGIN PERFORM tideway_private.record_booking_saved_card(far_booking, 'cus_verification', 'seti_other', 'saved', 'pm_other');
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'saved-card-conflict' THEN RAISE; END IF; refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'A second setup replaced the one the customer completed'; END IF;
  refused := false;
  BEGIN PERFORM tideway_private.record_booking_saved_card(far_booking, 'cus_verification', 'seti_verification', 'saved', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'A card was marked saved with no payment method'; END IF;
  card := tideway_private.record_booking_saved_card(far_booking, 'cus_verification', 'seti_verification', 'saved', 'pm_verification');
  IF card->>'status' <> 'saved' THEN RAISE EXCEPTION 'The completed setup was not recorded as saved: %', card; END IF;

  -- Another Landlord sees nothing and changes nothing.
  PERFORM set_config('app.user_id', other_landlord_id::text, true);
  IF tideway_private.get_booking_saved_card(far_booking) IS NOT NULL THEN RAISE EXCEPTION 'Another Landlord read a saved card'; END IF;
  refused := false;
  BEGIN PERFORM tideway_private.withdraw_booking_saved_card(far_booking);
  EXCEPTION WHEN no_data_found THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'Another Landlord withdrew a saved card'; END IF;

  /* ── Using it: only inside the window, only for the consented total ── */
  PERFORM set_config('app.user_id', admin_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);
  SELECT count(*) INTO due FROM tideway_private.list_saved_cards_due(200) d WHERE d.booking_id = far_booking;
  IF due <> 0 THEN RAISE EXCEPTION 'A saved card was due before its payment window opened'; END IF;

  UPDATE bookings SET scheduled_start_at = now() + interval '4 days', scheduled_end_at = now() + interval '4 days 3 hours' WHERE id = far_booking;
  SELECT count(*) INTO due FROM tideway_private.list_saved_cards_due(200) d WHERE d.booking_id = far_booking;
  IF due <> 1 THEN RAISE EXCEPTION 'A saved card was not due once its payment window opened'; END IF;

  -- The window-opened reminder would ask the customer to pay; their card is about to.
  PERFORM tideway_private.queue_due_booking_payment_reminders(500);
  IF EXISTS (SELECT 1 FROM notifications WHERE notifications.booking_id = far_booking AND event_type = 'payment-window-opened') THEN
    RAISE EXCEPTION 'The customer was asked to pay while their saved card was about to be used';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM notifications WHERE notifications.booking_id = near_booking AND event_type = 'payment-window-opened') THEN
    RAISE EXCEPTION 'The reminder exclusion silenced a booking with no saved card';
  END IF;

  -- Consent to 90.00 is not consent to 95.00.
  UPDATE bookings SET customer_price_pence = 9500 WHERE id = far_booking;
  SELECT count(*) INTO due FROM tideway_private.list_saved_cards_due(200) d WHERE d.booking_id = far_booking;
  IF due <> 0 THEN RAISE EXCEPTION 'A saved card was due for a total the customer never consented to'; END IF;
  refused := false;
  BEGIN PERFORM tideway_private.begin_saved_card_authorization(far_booking, gen_random_uuid(), decode(repeat('c1', 32), 'hex'));
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'saved-card-consent-stale' THEN RAISE; END IF; refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'A saved card was authorized for a changed total'; END IF;
  UPDATE bookings SET customer_price_pence = 9000 WHERE id = far_booking;

  -- Only the platform Administrator starts it.
  PERFORM set_config('app.user_id', landlord_id::text, true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  refused := false;
  BEGIN PERFORM tideway_private.begin_saved_card_authorization(far_booking, gen_random_uuid(), decode(repeat('c2', 32), 'hex'));
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'A Landlord started an off-session authorization'; END IF;

  PERFORM set_config('app.user_id', admin_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);
  started := tideway_private.begin_saved_card_authorization(far_booking, '5b000000-0000-4000-8000-000000000001', decode(repeat('c3', 32), 'hex'));
  IF started->>'status' <> 'creating' OR (started->>'amountPence')::integer <> 9000
    OR started->>'providerPaymentMethodId' <> 'pm_verification' OR started->>'providerCustomerId' <> 'cus_verification' THEN
    RAISE EXCEPTION 'The platform authorization did not start for the saved card and frozen total: %', started;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payment_status_history WHERE payment_id = (started->>'paymentId')::uuid AND event_source = 'administrator' AND to_status = 'creating') THEN
    RAISE EXCEPTION 'The platform authorization left no ledger history';
  END IF;
  -- Resuming returns the same payment, so the provider idempotency key repeats.
  again := tideway_private.begin_saved_card_authorization(far_booking, gen_random_uuid(), decode(repeat('c4', 32), 'hex'));
  IF again->>'paymentId' <> started->>'paymentId' THEN RAISE EXCEPTION 'A resumed authorization created a second payment'; END IF;

  -- The card cannot be withdrawn mid-authorization.
  PERFORM set_config('app.user_id', landlord_id::text, true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  refused := false;
  BEGIN PERFORM tideway_private.withdraw_booking_saved_card(far_booking);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'saved-card-in-use' THEN RAISE; END IF; refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'A card in use was withdrawn'; END IF;

  -- The bank wanted the customer present: the ordinary in-app step finishes it.
  PERFORM set_config('app.user_id', admin_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);
  payment_row := tideway_private.record_booking_payment_authorization((started->>'paymentId')::uuid, 'pi_saved_verification', 'requires-customer-action');
  IF payment_row.status <> 'requires-customer-action' THEN RAISE EXCEPTION 'The off-session attempt was not recorded on the ledger'; END IF;
  card := tideway_private.record_saved_card_authorization(far_booking, 'requires-customer-action');
  IF card->>'status' <> 'action-required' THEN RAISE EXCEPTION 'An attempt needing the customer was recorded as %', card->>'status'; END IF;
  SELECT count(*) INTO due FROM tideway_private.list_saved_cards_due(200) d WHERE d.booking_id = far_booking;
  IF due <> 0 THEN RAISE EXCEPTION 'A finished attempt was offered again'; END IF;

  /* ── Withdrawing an unused card hands back its payment method to detach ── */
  PERFORM set_config('app.user_id', landlord_id::text, true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  UPDATE bookings SET scheduled_start_at = now() + interval '12 days', scheduled_end_at = now() + interval '12 days 3 hours' WHERE id = near_booking;
  DELETE FROM notifications WHERE notifications.booking_id = near_booking;
  PERFORM tideway_private.begin_booking_saved_card(near_booking);
  PERFORM tideway_private.record_booking_saved_card(near_booking, 'cus_second', 'seti_second', 'saved', 'pm_second');
  card := tideway_private.withdraw_booking_saved_card(near_booking);
  IF card->>'status' <> 'withdrawn' OR card->>'detachPaymentMethodId' <> 'pm_second' THEN RAISE EXCEPTION 'Withdrawing a saved card failed: %', card; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'saved-card-withdrawn' AND resource_id = near_booking::text) THEN
    RAISE EXCEPTION 'Withdrawing a saved card was not audited';
  END IF;

  RAISE NOTICE 'Saved card verification passed: Landlord-only saving outside the window, verified provider state, consent bound to the frozen total, Administrator-only use inside the window, one ledger payment, reminder exclusion, and withdrawal.';
END $$;

ROLLBACK;
