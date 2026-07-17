\set ON_ERROR_STOP on

BEGIN;

DO $setup$
DECLARE
  selected_booking_id uuid;
  selected_booking bookings%ROWTYPE;
BEGIN
  SELECT booking.id INTO selected_booking_id
  FROM bookings booking
  WHERE booking.id::text LIKE '40000000-0000-4000-8000-%'
    AND booking.status = 'confirmed'
  ORDER BY booking.id
  LIMIT 1
  FOR UPDATE;

  IF selected_booking_id IS NULL THEN
    RAISE EXCEPTION 'Confirmed participant rehearsal booking is missing';
  END IF;

  UPDATE bookings
  SET cleaner_response_deadline = now() + interval '1 minute',
      scheduled_start_at = now() + interval '5 minutes',
      scheduled_end_at = now() + interval '125 minutes',
      updated_at = now()
  WHERE id = selected_booking_id;

  SELECT * INTO selected_booking FROM bookings WHERE id = selected_booking_id;
  INSERT INTO booking_payments(
    id, booking_id, landlord_user_id, cleaner_user_id, provider, currency, amount_pence,
    status, terms_fingerprint, provider_payment_id, idempotency_key_hash, authorized_at, last_provider_event_at
  ) VALUES (
    '52000000-0000-4000-8000-000000000001', selected_booking.id, selected_booking.landlord_user_id,
    selected_booking.cleaner_user_id, 'stripe', 'gbp', selected_booking.customer_price_pence,
    'authorized', selected_booking.terms_fingerprint, 'pi_synthetic_local_rehearsal',
    decode(repeat('d5', 32), 'hex'), now(), now()
  );
END
$setup$;

COMMIT;
