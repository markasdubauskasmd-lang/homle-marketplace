\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config('app.user_roles', 'landlord', true);
DO $outsider$
DECLARE affected integer;
BEGIN
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%') <> 0 THEN RAISE EXCEPTION 'Unrelated account can read bookings'; END IF;
  IF (SELECT count(*) FROM properties WHERE id::text LIKE '20000000-0000-4000-8000-%') <> 0 THEN RAISE EXCEPTION 'Unrelated account can read property instructions'; END IF;
  IF (SELECT count(*) FROM cleaning_requests WHERE id::text LIKE '30000000-0000-4000-8000-%') <> 0 THEN RAISE EXCEPTION 'Unrelated account can read cleaning requests'; END IF;
  UPDATE properties SET name = 'unauthorised' WHERE id = '20000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Unrelated account modified a property'; END IF;
  BEGIN
    UPDATE bookings SET status = 'cancelled' WHERE id = '40000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Runtime role unexpectedly has direct booking mutation permission';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$outsider$;

DO $shared_rate_limit$
DECLARE
  attempt integer;
  decision record;
BEGIN
  BEGIN
    PERFORM 1 FROM tideway_private.request_rate_limits;
    RAISE EXCEPTION 'Runtime role can read private rate-limit keys';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM tideway_private.pending_social_identities;
    RAISE EXCEPTION 'Runtime role can read pending social identity material';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM tideway_private.cleaner_payout_accounts;
    RAISE EXCEPTION 'Runtime role can read private Cleaner payout destinations';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM tideway_private.payment_provider_events;
    RAISE EXCEPTION 'Runtime role can read private payment provider events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM booking_payments;
    RAISE EXCEPTION 'Runtime role can read payment provider references directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  FOR attempt IN 1..10 LOOP
    SELECT * INTO decision FROM tideway_private.consume_rate_limit('login', decode(repeat('ab', 32), 'hex'));
    IF decision.allowed IS NOT TRUE OR decision.retry_after_seconds <> 0 THEN
      RAISE EXCEPTION 'Shared login limiter denied before its reviewed threshold';
    END IF;
  END LOOP;
  SELECT * INTO decision FROM tideway_private.consume_rate_limit('login', decode(repeat('ab', 32), 'hex'));
  IF decision.allowed IS NOT FALSE OR decision.retry_after_seconds NOT BETWEEN 1 AND 900 THEN
    RAISE EXCEPTION 'Shared login limiter failed to deny at its reviewed threshold';
  END IF;
END
$shared_rate_limit$;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('app.user_roles', 'landlord', true);
DO $landlord$
BEGIN
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%') <> 2 THEN RAISE EXCEPTION 'Landlord cannot read both own bookings'; END IF;
  IF (SELECT count(*) FROM properties WHERE id::text LIKE '20000000-0000-4000-8000-%') <> 2 THEN RAISE EXCEPTION 'Landlord cannot read both own properties'; END IF;
  IF (SELECT count(*) FROM cleaning_requests WHERE id::text LIKE '30000000-0000-4000-8000-%') <> 2 THEN RAISE EXCEPTION 'Landlord cannot read both own requests'; END IF;
END
$landlord$;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('app.user_roles', 'cleaner', true);
DO $cleaner$
BEGIN
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%') <> 2 THEN RAISE EXCEPTION 'Assigned cleaner cannot read invitations'; END IF;
  IF (SELECT count(*) FROM properties WHERE id::text LIKE '20000000-0000-4000-8000-%') <> 0 THEN RAISE EXCEPTION 'Cleaner received access instructions before acceptance'; END IF;
END
$cleaner$;

ROLLBACK;
