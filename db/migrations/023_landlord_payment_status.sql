BEGIN;

CREATE FUNCTION tideway_private.read_booking_payment(target_booking_id uuid)
RETURNS TABLE(
  id uuid,
  booking_id uuid,
  status text,
  amount_pence integer,
  currency character(3),
  amount_captured_pence integer,
  amount_refunded_pence integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='payment-role-required';
  END IF;

  PERFORM 1 FROM bookings booking
    WHERE booking.id = target_booking_id
      AND (booking.landlord_user_id = actor_id OR tideway_private.has_role('administrator'));
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found';
  END IF;

  RETURN QUERY
    SELECT payment.id, payment.booking_id, payment.status, payment.amount_pence, payment.currency,
      payment.amount_captured_pence, payment.amount_refunded_pence, payment.created_at, payment.updated_at
    FROM booking_payments payment
    WHERE payment.booking_id = target_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.read_booking_payment(uuid) FROM PUBLIC;

COMMIT;
