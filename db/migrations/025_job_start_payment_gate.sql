BEGIN;

CREATE FUNCTION tideway_private.current_booking_payment_authorized(target_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
BEGIN
  SELECT * INTO booking_record
  FROM bookings booking
  WHERE booking.id=target_booking_id
    AND (booking.cleaner_user_id=actor_id OR booking.landlord_user_id=actor_id OR tideway_private.has_role('administrator'));
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM booking_payments payment
    WHERE payment.booking_id=booking_record.id
      AND payment.landlord_user_id=booking_record.landlord_user_id
      AND payment.cleaner_user_id=booking_record.cleaner_user_id
      AND payment.provider='stripe'
      AND payment.provider_payment_id IS NOT NULL
      AND payment.status='authorized'
      AND payment.currency='gbp'
      AND payment.amount_pence=booking_record.customer_price_pence
      AND payment.terms_fingerprint=booking_record.terms_fingerprint
      AND payment.authorized_at BETWEEN now()-interval '5 days' AND now()+interval '5 minutes'
  );
END;
$$;

CREATE FUNCTION tideway_private.require_current_payment_before_job_start()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status IN ('confirmed','cleaner-en-route','cleaner-arrived')
     AND NEW.status IN ('cleaner-en-route','cleaner-arrived','cleaning-in-progress')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NOT tideway_private.current_booking_payment_authorized(NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-authorization-required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_require_current_payment_before_job_start
BEFORE UPDATE OF status ON bookings
FOR EACH ROW EXECUTE FUNCTION tideway_private.require_current_payment_before_job_start();

REVOKE ALL ON FUNCTION tideway_private.current_booking_payment_authorized(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.require_current_payment_before_job_start() FROM PUBLIC;

COMMIT;
