BEGIN;

CREATE FUNCTION tideway_private.read_my_booking_receipt_payment(target_booking_id uuid)
RETURNS TABLE(id uuid, booking_id uuid, status text, amount_pence integer, currency character(3),
  amount_captured_pence integer, amount_refunded_pence integer, provider_payment_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id();
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required';
  END IF;
  PERFORM 1 FROM bookings b WHERE b.id=target_booking_id AND b.landlord_user_id=actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  RETURN QUERY SELECT p.id,p.booking_id,p.status,p.amount_pence,p.currency,
    p.amount_captured_pence,p.amount_refunded_pence,p.provider_payment_id
  FROM booking_payments p
  WHERE p.booking_id=target_booking_id AND p.landlord_user_id=actor_id AND p.provider='stripe';
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.read_my_booking_receipt_payment(uuid) FROM PUBLIC;

COMMIT;
