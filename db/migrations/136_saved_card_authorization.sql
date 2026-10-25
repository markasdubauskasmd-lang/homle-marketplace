-- Pay at booking for a clean more than five days away (PROGRESS M4).
--
-- A card authorization holds for about seven days, so migration 022 opens the
-- payment window only five days before the slot. A customer booking three
-- weeks out could not pay when they booked; they had to come back. This is
-- the standard answer: save the card at booking (a Stripe SetupIntent for
-- off-session use, against a Stripe Customer), then place the authorization
-- automatically once the window opens.
--
-- What does not change: the authorization is still for the booking's frozen
-- total, still made inside the window, and still lands in booking_payments
-- through the same ledger functions, so every later step (capture, refund,
-- transfer, reconciliation, webhooks) is the path every other payment takes.
-- A card is used only for the total and terms the customer consented to; a
-- later change to the booking's price or terms stops it being used. If the
-- bank wants the customer present, the payment becomes
-- requires-customer-action and the existing in-app payment step finishes it.
--
-- Private table, no grants: reachable only through the functions below.

BEGIN;

CREATE TABLE tideway_private.booking_saved_cards (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE RESTRICT,
  landlord_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  provider_customer_id text CHECK (provider_customer_id IS NULL OR provider_customer_id ~ '^cus_[A-Za-z0-9_]{3,250}$'),
  provider_setup_id text UNIQUE CHECK (provider_setup_id IS NULL OR provider_setup_id ~ '^seti_[A-Za-z0-9_]{3,250}$'),
  provider_payment_method_id text CHECK (provider_payment_method_id IS NULL OR provider_payment_method_id ~ '^pm_[A-Za-z0-9_]{3,250}$'),
  status text NOT NULL CHECK (status IN ('creating','requires-customer-action','saved','failed','authorizing','action-required','authorized','withdrawn')),
  amount_pence integer NOT NULL CHECK (amount_pence BETWEEN 1 AND 10000000),
  terms_fingerprint character(64) NOT NULL,
  consented_at timestamptz NOT NULL,
  payment_id uuid UNIQUE REFERENCES booking_payments(id) ON DELETE RESTRICT,
  authorization_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'saved' OR (provider_customer_id IS NOT NULL AND provider_setup_id IS NOT NULL AND provider_payment_method_id IS NOT NULL)),
  CHECK (status NOT IN ('authorizing','action-required','authorized') OR payment_id IS NOT NULL)
);
ALTER TABLE tideway_private.booking_saved_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tideway_private.booking_saved_cards FROM PUBLIC;

CREATE FUNCTION tideway_private.saved_card_projection(card tideway_private.booking_saved_cards)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  -- The payment method id is never projected: it is only useful for charging.
  SELECT jsonb_build_object(
    'bookingId', card.booking_id,
    'status', card.status,
    'amountPence', card.amount_pence,
    'currency', 'gbp',
    'providerCustomerId', card.provider_customer_id,
    'providerSetupId', card.provider_setup_id,
    'paymentId', card.payment_id,
    'consentedAt', card.consented_at
  );
$$;

-- The Landlord saves a card for a confirmed booking whose payment window has
-- not opened yet. Inside the window the ordinary payment step applies.
CREATE FUNCTION tideway_private.begin_booking_saved_card(target_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
  card tideway_private.booking_saved_cards%ROWTYPE;
  existing boolean;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;

  SELECT * INTO card FROM tideway_private.booking_saved_cards WHERE booking_id=booking_record.id FOR UPDATE;
  existing := FOUND;
  IF existing AND card.status IN ('saved','authorizing','action-required','authorized') THEN
    RETURN tideway_private.saved_card_projection(card);
  END IF;

  IF booking_record.status <> 'confirmed' OR booking_record.journey_started_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-authorizable';
  END IF;
  IF booking_record.scheduled_start_at <= now()+interval '5 days' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-window-open';
  END IF;
  IF EXISTS (SELECT 1 FROM booking_payments WHERE booking_id=booking_record.id) THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='booking-payment-exists';
  END IF;

  IF existing THEN
    -- Resume an unfinished setup, or start again after a failed or withdrawn
    -- one, always against the booking's current total and terms.
    UPDATE tideway_private.booking_saved_cards SET
      status = CASE WHEN status IN ('failed','withdrawn') THEN 'creating' ELSE status END,
      provider_setup_id = CASE WHEN status IN ('failed','withdrawn') THEN NULL ELSE provider_setup_id END,
      provider_payment_method_id = NULL,
      amount_pence = booking_record.customer_price_pence,
      terms_fingerprint = booking_record.terms_fingerprint,
      -- A restart is a new consent and a new provider setup; a resume keeps
      -- the same consent time, which keys the provider's idempotency.
      consented_at = CASE WHEN status IN ('failed','withdrawn') THEN now() ELSE consented_at END,
      updated_at = now()
    WHERE booking_id = booking_record.id RETURNING * INTO card;
  ELSE
    INSERT INTO tideway_private.booking_saved_cards (booking_id, landlord_user_id, status, amount_pence, terms_fingerprint, consented_at)
      VALUES (booking_record.id, actor_id, 'creating', booking_record.customer_price_pence, booking_record.terms_fingerprint, now())
      RETURNING * INTO card;
  END IF;
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (actor_id, 'saved-card-consented', 'booking', booking_record.id::text,
      jsonb_build_object('amountPence', card.amount_pence, 'termsFingerprint', card.terms_fingerprint));
  RETURN tideway_private.saved_card_projection(card);
END;
$$;

-- Attach the provider customer and setup, and record its state as the server
-- read it back from the provider. Never trusts the browser's word.
CREATE FUNCTION tideway_private.record_booking_saved_card(target_booking_id uuid, supplied_customer_id text, supplied_setup_id text, supplied_status text, supplied_payment_method_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  card tideway_private.booking_saved_cards%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required'; END IF;
  IF supplied_status IS NULL OR supplied_status NOT IN ('requires-customer-action','saved','failed')
    OR (supplied_status = 'saved') <> (supplied_payment_method_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-saved-card';
  END IF;
  SELECT * INTO card FROM tideway_private.booking_saved_cards WHERE booking_id=target_booking_id AND landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='saved-card-not-found'; END IF;
  IF (card.provider_setup_id IS NOT NULL AND card.provider_setup_id <> supplied_setup_id)
    OR (card.provider_customer_id IS NOT NULL AND card.provider_customer_id <> supplied_customer_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='saved-card-conflict';
  END IF;
  IF card.status NOT IN ('creating','requires-customer-action','saved') THEN
    RETURN tideway_private.saved_card_projection(card);
  END IF;
  UPDATE tideway_private.booking_saved_cards SET
    provider_customer_id = supplied_customer_id,
    provider_setup_id = supplied_setup_id,
    provider_payment_method_id = supplied_payment_method_id,
    status = supplied_status,
    updated_at = now()
  WHERE booking_id = card.booking_id RETURNING * INTO card;
  RETURN tideway_private.saved_card_projection(card);
END;
$$;

CREATE FUNCTION tideway_private.get_booking_saved_card(target_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  card tideway_private.booking_saved_cards%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='payment-role-required'; END IF;
  SELECT * INTO card FROM tideway_private.booking_saved_cards
    WHERE booking_id=target_booking_id AND (landlord_user_id=actor_id OR tideway_private.has_role('administrator'));
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN tideway_private.saved_card_projection(card);
END;
$$;

-- The customer may take the card back at any time before it is used. Returns
-- the payment method so the caller can detach it at the provider.
CREATE FUNCTION tideway_private.withdraw_booking_saved_card(target_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  card tideway_private.booking_saved_cards%ROWTYPE;
  method_id text;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required'; END IF;
  SELECT * INTO card FROM tideway_private.booking_saved_cards WHERE booking_id=target_booking_id AND landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='saved-card-not-found'; END IF;
  IF card.status IN ('authorizing','action-required','authorized') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='saved-card-in-use';
  END IF;
  method_id := card.provider_payment_method_id;
  UPDATE tideway_private.booking_saved_cards SET status='withdrawn', provider_payment_method_id=NULL, updated_at=now()
    WHERE booking_id=card.booking_id RETURNING * INTO card;
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (actor_id, 'saved-card-withdrawn', 'booking', card.booking_id::text, '{}'::jsonb);
  RETURN tideway_private.saved_card_projection(card) || jsonb_build_object('detachPaymentMethodId', method_id);
END;
$$;

-- Saved cards whose payment window is now open. A card is due only while the
-- booking still has the exact total and terms the customer consented to, and
-- no payment of its own. An attempt that started and never reached the
-- provider is offered again after ten minutes, under the same payment id, so
-- the provider's idempotency key makes the retry the same request.
CREATE FUNCTION tideway_private.list_saved_cards_due(batch_limit integer DEFAULT 50)
RETURNS TABLE(booking_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required'; END IF;
  IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-saved-card-batch-limit'; END IF;
  RETURN QUERY
    SELECT card.booking_id
    FROM tideway_private.booking_saved_cards card
    JOIN bookings booking ON booking.id = card.booking_id
    LEFT JOIN booking_payments payment ON payment.id = card.payment_id
    WHERE booking.status = 'confirmed'
      AND booking.journey_started_at IS NULL
      AND booking.scheduled_start_at > now()
      AND booking.scheduled_start_at <= now()+interval '5 days'
      AND booking.customer_price_pence = card.amount_pence
      AND booking.terms_fingerprint = card.terms_fingerprint
      AND (
        (card.status = 'saved' AND NOT EXISTS (SELECT 1 FROM booking_payments existing WHERE existing.booking_id = booking.id))
        OR (card.status = 'authorizing' AND payment.status = 'creating' AND payment.provider_payment_id IS NULL
            AND card.authorization_started_at < now()-interval '10 minutes')
      )
    ORDER BY booking.scheduled_start_at, card.booking_id
    LIMIT batch_limit;
END;
$$;

-- The platform Administrator starts the authorization on the customer's
-- behalf, with their saved card. Same ledger row and history as a Landlord's
-- own authorization; the history says who acted.
CREATE FUNCTION tideway_private.begin_saved_card_authorization(target_booking_id uuid, proposed_payment_id uuid, supplied_idempotency_hash bytea)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
  card tideway_private.booking_saved_cards%ROWTYPE;
  payment_record booking_payments%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required'; END IF;
  IF octet_length(supplied_idempotency_hash) <> 32 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-request'; END IF;
  SELECT * INTO booking_record FROM bookings WHERE id=target_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  SELECT * INTO card FROM tideway_private.booking_saved_cards WHERE booking_id=booking_record.id FOR UPDATE;
  IF NOT FOUND OR card.status NOT IN ('saved','authorizing') THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='saved-card-not-ready'; END IF;
  IF booking_record.status <> 'confirmed' OR booking_record.journey_started_at IS NOT NULL
    OR booking_record.scheduled_start_at <= now() OR booking_record.scheduled_start_at > now()+interval '5 days' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-authorizable';
  END IF;
  IF booking_record.customer_price_pence <> card.amount_pence OR booking_record.terms_fingerprint <> card.terms_fingerprint
    OR booking_record.landlord_user_id <> card.landlord_user_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='saved-card-consent-stale';
  END IF;

  IF card.status = 'authorizing' THEN
    SELECT * INTO payment_record FROM booking_payments WHERE id=card.payment_id FOR UPDATE;
  ELSE
    IF EXISTS (SELECT 1 FROM booking_payments WHERE booking_id=booking_record.id) THEN
      RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='booking-payment-exists';
    END IF;
    INSERT INTO booking_payments(id,booking_id,landlord_user_id,cleaner_user_id,provider,currency,amount_pence,status,terms_fingerprint,idempotency_key_hash)
      VALUES(proposed_payment_id,booking_record.id,booking_record.landlord_user_id,booking_record.cleaner_user_id,'stripe','gbp',booking_record.customer_price_pence,'creating',booking_record.terms_fingerprint,supplied_idempotency_hash)
      RETURNING * INTO payment_record;
    INSERT INTO payment_status_history(payment_id,from_status,to_status,event_source,changed_by,reason)
      VALUES(payment_record.id,NULL,'creating','administrator',actor_id,'Platform started authorization with the card the Landlord saved for this frozen total.');
    UPDATE tideway_private.booking_saved_cards SET status='authorizing', payment_id=payment_record.id, authorization_started_at=now(), updated_at=now()
      WHERE booking_id=card.booking_id RETURNING * INTO card;
  END IF;

  RETURN jsonb_build_object(
    'paymentId', payment_record.id,
    'bookingId', payment_record.booking_id,
    'status', payment_record.status,
    'amountPence', payment_record.amount_pence,
    'currency', payment_record.currency,
    'providerPaymentId', payment_record.provider_payment_id,
    'providerCustomerId', card.provider_customer_id,
    'providerPaymentMethodId', card.provider_payment_method_id
  );
END;
$$;

-- Where the attempt ended, as the provider reported it.
CREATE FUNCTION tideway_private.record_saved_card_authorization(target_booking_id uuid, provider_status text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  card tideway_private.booking_saved_cards%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required'; END IF;
  IF provider_status IS NULL OR provider_status NOT IN ('authorized','processing','requires-customer-action','failed') THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-provider-authorization'; END IF;
  SELECT * INTO card FROM tideway_private.booking_saved_cards WHERE booking_id=target_booking_id FOR UPDATE;
  IF NOT FOUND OR card.status <> 'authorizing' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='saved-card-not-authorizing'; END IF;
  UPDATE tideway_private.booking_saved_cards SET
    status = CASE WHEN provider_status IN ('authorized','processing') THEN 'authorized' ELSE 'action-required' END,
    updated_at = now()
  WHERE booking_id = card.booking_id RETURNING * INTO card;
  RETURN tideway_private.saved_card_projection(card);
END;
$$;

-- The window-opened reminder asks the customer to pay. While their saved card
-- is about to be used, that is the wrong message. The twenty-four-hour
-- reminder is unchanged: by then an unpaid booking needs the customer whatever
-- happened to the card. Otherwise identical to migration 043.
CREATE OR REPLACE FUNCTION tideway_private.queue_due_booking_payment_reminders(batch_limit integer DEFAULT 100)
RETURNS TABLE(booking_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-payment-reminder-batch-limit';
  END IF;

  RETURN QUERY
  WITH due_booking AS (
    SELECT booking.id,booking.landlord_user_id,booking.scheduled_start_at,
      CASE WHEN booking.scheduled_start_at<=now()+interval '24 hours' THEN 'payment-action-required' ELSE 'payment-window-opened' END AS reminder_event,
      CASE WHEN booking.scheduled_start_at<=now()+interval '24 hours' THEN 'payment-readiness:' ELSE 'payment-window-opened:' END
        ||booking.id||':'||to_char(booking.scheduled_start_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS') AS reminder_key
    FROM bookings booking
    WHERE booking.status='confirmed'
      AND booking.scheduled_start_at>now()
      AND booking.scheduled_start_at<=now()+interval '5 days'
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
      AND NOT (
        booking.scheduled_start_at>now()+interval '24 hours'
        AND EXISTS (
          SELECT 1 FROM tideway_private.booking_saved_cards card
          WHERE card.booking_id=booking.id
            AND card.status IN ('saved','authorizing')
            AND card.amount_pence=booking.customer_price_pence
            AND card.terms_fingerprint=booking.terms_fingerprint
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM notifications notification
        WHERE notification.idempotency_key=(
          CASE WHEN booking.scheduled_start_at<=now()+interval '24 hours' THEN 'payment-readiness:' ELSE 'payment-window-opened:' END
          ||booking.id||':'||to_char(booking.scheduled_start_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS')
        )
      )
    ORDER BY booking.scheduled_start_at,booking.id
    LIMIT batch_limit
    FOR UPDATE OF booking SKIP LOCKED
  ), inserted AS (
    INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key)
    SELECT due_booking.landlord_user_id,due_booking.id,due_booking.reminder_event,'in-app',
      jsonb_build_object('bookingId',due_booking.id),due_booking.reminder_key
    FROM due_booking
    ON CONFLICT(idempotency_key) DO NOTHING
    RETURNING notifications.booking_id
  )
  SELECT inserted.booking_id FROM inserted;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.saved_card_projection(tideway_private.booking_saved_cards) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.begin_booking_saved_card(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_booking_saved_card(uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_booking_saved_card(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.withdraw_booking_saved_card(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.list_saved_cards_due(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.begin_saved_card_authorization(uuid,uuid,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_saved_card_authorization(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.begin_booking_saved_card(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_booking_saved_card(uuid,text,text,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_booking_saved_card(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.withdraw_booking_saved_card(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_saved_cards_due(integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.begin_saved_card_authorization(uuid,uuid,bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_saved_card_authorization(uuid,text) TO tideway_app;

COMMIT;
