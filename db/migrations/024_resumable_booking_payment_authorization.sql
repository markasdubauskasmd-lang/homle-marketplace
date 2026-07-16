BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.begin_booking_payment_authorization(proposed_payment_id uuid, target_booking_id uuid, selected_provider text, supplied_idempotency_hash bytea)
RETURNS booking_payments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
  payment_record booking_payments%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required'; END IF;
  IF selected_provider <> 'stripe' OR octet_length(supplied_idempotency_hash) <> 32 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-request'; END IF;

  SELECT * INTO payment_record FROM booking_payments WHERE idempotency_key_hash=supplied_idempotency_hash;
  IF FOUND THEN
    IF payment_record.landlord_user_id <> actor_id OR payment_record.booking_id <> target_booking_id THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='payment-idempotency-conflict'; END IF;
    RETURN payment_record;
  END IF;

  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  IF booking_record.status <> 'confirmed' OR booking_record.journey_started_at IS NOT NULL OR booking_record.scheduled_start_at <= now() OR booking_record.scheduled_start_at > now()+interval '5 days' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-authorizable'; END IF;

  -- A booking owns exactly one authorization. A refreshed browser can safely
  -- resume that authorization with a new browser retry key; the stored payment
  -- id still produces the same provider idempotency key server-side.
  SELECT * INTO payment_record FROM booking_payments WHERE booking_id=booking_record.id FOR UPDATE;
  IF FOUND THEN RETURN payment_record; END IF;

  INSERT INTO booking_payments(id,booking_id,landlord_user_id,cleaner_user_id,provider,currency,amount_pence,status,terms_fingerprint,idempotency_key_hash)
    VALUES(proposed_payment_id,booking_record.id,booking_record.landlord_user_id,booking_record.cleaner_user_id,'stripe','gbp',booking_record.customer_price_pence,'creating',booking_record.terms_fingerprint,supplied_idempotency_hash)
    RETURNING * INTO payment_record;
  INSERT INTO payment_status_history(payment_id,from_status,to_status,event_source,changed_by,reason)
    VALUES(payment_record.id,NULL,'creating','landlord',actor_id,'Landlord started payment authorization for the frozen booking total.');
  RETURN payment_record;
END;
$$;

COMMIT;
