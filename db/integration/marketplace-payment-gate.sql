\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('app.user_roles', 'cleaner', true);

DO $payment_gate$
DECLARE
  booking_record bookings%ROWTYPE;
  blocked boolean := false;
BEGIN
  SELECT * INTO booking_record
  FROM bookings
  WHERE id::text LIKE '40000000-0000-4000-8000-%' AND status='confirmed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Confirmed payment-gate fixture is missing'; END IF;

  BEGIN
    UPDATE bookings SET status='cleaner-en-route' WHERE id=booking_record.id;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment-authorization-required' THEN RAISE; END IF;
    blocked := true;
  END;
  IF blocked IS NOT TRUE THEN RAISE EXCEPTION 'Journey started without a payment authorization'; END IF;
  IF tideway_private.current_booking_payment_authorized(booking_record.id) THEN RAISE EXCEPTION 'Missing payment was reported as authorized'; END IF;

  INSERT INTO booking_payments(
    id,booking_id,landlord_user_id,cleaner_user_id,provider,currency,amount_pence,status,
    terms_fingerprint,provider_payment_id,idempotency_key_hash,authorized_at,last_provider_event_at
  ) VALUES (
    '50000000-0000-4000-8000-000000000001',booking_record.id,booking_record.landlord_user_id,
    booking_record.cleaner_user_id,'stripe','gbp',booking_record.customer_price_pence,'authorized',
    booking_record.terms_fingerprint,'pi_integration_payment_gate',decode(repeat('cd',32),'hex'),
    now()-interval '6 days',now()-interval '6 days'
  );
  IF tideway_private.current_booking_payment_authorized(booking_record.id) THEN RAISE EXCEPTION 'Stale payment authorization unlocked the journey'; END IF;

  blocked := false;
  BEGIN
    UPDATE bookings SET status='cleaner-en-route' WHERE id=booking_record.id;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment-authorization-required' THEN RAISE; END IF;
    blocked := true;
  END;
  IF blocked IS NOT TRUE THEN RAISE EXCEPTION 'Stale payment authorization unlocked the journey transition'; END IF;

  UPDATE booking_payments SET authorized_at=now(),last_provider_event_at=now() WHERE booking_id=booking_record.id;
  IF tideway_private.current_booking_payment_authorized(booking_record.id) IS NOT TRUE THEN RAISE EXCEPTION 'Current exact payment authorization was not recognized'; END IF;
  UPDATE bookings SET status='cleaner-en-route' WHERE id=booking_record.id;
  IF (SELECT status FROM bookings WHERE id=booking_record.id) <> 'cleaner-en-route' THEN RAISE EXCEPTION 'Current payment authorization did not unlock journey start'; END IF;
END
$payment_gate$;

ROLLBACK;
