\set ON_ERROR_STOP on
-- After 117 to 134 are applied over the seeded 116 database, prove the
-- launch-work functions act on records that existed before they did, and
-- that no live row was invalidated by a replaced constraint. Rolls back.
DO $disposable_target$
BEGIN
 IF current_database()<>'ci_tideway_upgrade' THEN
   RAISE EXCEPTION 'Launch-work upgrade fixture requires its dedicated disposable CI database';
 END IF;
END;
$disposable_target$;
BEGIN;
DO $upgrade$
DECLARE
  landlord_id uuid := (SELECT evidence FROM launch_upgrade_fixture WHERE kind='landlord')::uuid;
  booking_id uuid := (SELECT evidence FROM launch_upgrade_fixture WHERE kind='booking')::uuid;
  request_id uuid := (SELECT evidence FROM launch_upgrade_fixture WHERE kind='request')::uuid;
  cancelled bookings;
  revenue jsonb;
BEGIN
  IF to_regprocedure('tideway_private.get_administrator_revenue(integer)') IS NULL THEN
    RAISE EXCEPTION 'Launch-work upgrade verification requires migration 134 to be applied';
  END IF;

  -- Replaced scope CHECK constraints (122, 123, 127) kept every live row.
  IF (SELECT count(*) FROM tideway_private.request_rate_limits)::text IS DISTINCT FROM
     (SELECT evidence FROM launch_upgrade_fixture WHERE kind='rate-limit-rows') THEN
    RAISE EXCEPTION 'An upgraded rate-limit constraint lost or rejected live rows';
  END IF;

  -- A booking confirmed before cancellation existed can be cancelled (118, repaired in 129).
  PERFORM set_config('app.user_id', landlord_id::text, true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  cancelled := tideway_private.cancel_booking_as_landlord(booking_id, 'Plans changed after the upgrade.');
  IF cancelled.status <> 'cancelled' THEN
    RAISE EXCEPTION 'A pre-upgrade booking could not be cancelled (status %)', cancelled.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM booking_status_history WHERE booking_status_history.booking_id = cancelled.id
      AND from_status = 'confirmed' AND to_status = 'cancelled') THEN
    RAISE EXCEPTION 'Cancelling a pre-upgrade booking recorded no status history';
  END IF;
  IF (SELECT status FROM cleaning_requests WHERE id = request_id) <> 'cancelled' THEN
    RAISE EXCEPTION 'Cancelling a pre-upgrade booking left its request open';
  END IF;

  -- The revenue summary (133) sums a payment captured and refunded before 117
  -- existed, through the 117 observation ledger, without double counting.
  UPDATE booking_payments SET captured_at = now() - interval '1 day'
    WHERE id = '58000000-0000-4000-8000-000000000001' AND captured_at IS NULL;
  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000004', true);
  PERFORM set_config('app.user_roles', 'administrator', true);
  revenue := tideway_private.get_administrator_revenue(30);
  IF (revenue->>'capturedCount')::integer <> 1 OR (revenue->>'refundedPence')::integer <> 1000
     OR (revenue->>'refundedCount')::integer <> 1 OR (revenue->>'transferredPence')::integer <> 0 THEN
    RAISE EXCEPTION 'Revenue summary misread pre-upgrade money: %', revenue;
  END IF;

  -- The expiry sweep (128, repaired in 129) runs over historical bookings.
  PERFORM * FROM tideway_private.list_unpaid_bookings_for_expiry(100);
END;
$upgrade$;
ROLLBACK;
\echo 'Actual PostgreSQL116-to134 launch-work upgrade passed: live rate-limit rows kept, pre-upgrade booking cancelled with history, historical refund summed once, expiry sweep runs.'
