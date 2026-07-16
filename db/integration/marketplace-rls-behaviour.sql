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
  BEGIN
    PERFORM tideway_private.get_cleaning_request_scan('30000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Unrelated account can read a private room scan';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  UPDATE properties SET name = 'unauthorised' WHERE id = '20000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Unrelated account modified a property'; END IF;
  BEGIN
    UPDATE bookings SET status = 'cancelled' WHERE id = '40000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Runtime role unexpectedly has direct booking mutation permission';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF tideway_private.verify_my_social_identity('google','integration-google-subject') IS TRUE THEN
    RAISE EXCEPTION 'Unrelated account verified another user provider subject';
  END IF;
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
    PERFORM 1 FROM tideway_private.cleaner_payout_onboarding;
    RAISE EXCEPTION 'Runtime role can read private Cleaner payout onboarding material';
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
  BEGIN
    PERFORM 1 FROM privacy_requests;
    RAISE EXCEPTION 'Runtime role can read account privacy requests directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM cleaning_request_photos;
    RAISE EXCEPTION 'Runtime role can read private request-photo object keys directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM cleaning_request_photo_uploads;
    RAISE EXCEPTION 'Runtime role can read private request-photo upload verification records directly';
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
DECLARE disconnected_record record; export_first jsonb; export_retry jsonb; deletion_first jsonb; privacy_history jsonb;
BEGIN
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%') <> 2 THEN RAISE EXCEPTION 'Landlord cannot read both own bookings'; END IF;
  IF (SELECT count(*) FROM properties WHERE id::text LIKE '20000000-0000-4000-8000-%') <> 2 THEN RAISE EXCEPTION 'Landlord cannot read both own properties'; END IF;
  IF (SELECT count(*) FROM cleaning_requests WHERE id::text LIKE '30000000-0000-4000-8000-%') <> 2 THEN RAISE EXCEPTION 'Landlord cannot read both own requests'; END IF;
  IF tideway_private.verify_my_social_identity('google','integration-google-subject') IS NOT TRUE
     OR tideway_private.verify_my_social_identity('google','different-subject') IS TRUE THEN
    RAISE EXCEPTION 'Provider step-up did not require the exact connected subject';
  END IF;
  SELECT tideway_private.request_my_privacy_action('71000000-0000-4000-8000-000000000001','export') INTO export_first;
  SELECT tideway_private.request_my_privacy_action('71000000-0000-4000-8000-000000000002','export') INTO export_retry;
  IF export_first->>'requestId'<>'71000000-0000-4000-8000-000000000001' OR (export_first->>'created')::boolean IS NOT TRUE
     OR export_retry->>'requestId'<>'71000000-0000-4000-8000-000000000001' OR (export_retry->>'created')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Privacy export intake lost active-request idempotency';
  END IF;
  SELECT tideway_private.request_my_privacy_action('71000000-0000-4000-8000-000000000003','deletion') INTO deletion_first;
  SELECT tideway_private.get_my_privacy_requests() INTO privacy_history;
  IF deletion_first->>'requestType'<>'deletion' OR jsonb_array_length(privacy_history)<>2 THEN
    RAISE EXCEPTION 'Privacy intake did not separate export and deletion requests or owner history';
  END IF;
  SELECT * INTO disconnected_record FROM tideway_private.disconnect_my_social_identity('facebook');
  IF disconnected_record.disconnected IS NOT TRUE OR disconnected_record.reason IS NOT NULL OR disconnected_record.revoked_sessions <> 2 THEN
    RAISE EXCEPTION 'Provider removal did not revoke both sessions atomically';
  END IF;
  IF EXISTS (SELECT 1 FROM tideway_private.list_my_authentication_identities() identity WHERE identity.provider='facebook')
     OR NOT EXISTS (SELECT 1 FROM tideway_private.list_my_authentication_identities() identity WHERE identity.provider='google') THEN
    RAISE EXCEPTION 'Provider removal changed the wrong identity';
  END IF;
  SELECT * INTO disconnected_record FROM tideway_private.disconnect_my_social_identity('google');
  IF disconnected_record.disconnected IS TRUE OR disconnected_record.reason <> 'last-sign-in-method' OR disconnected_record.revoked_sessions <> 0 THEN
    RAISE EXCEPTION 'Final sign-in method removal did not fail closed';
  END IF;
END
$landlord$;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('app.user_roles', 'cleaner', true);
DO $cleaner$
DECLARE scan jsonb; object_record record; payout_first jsonb; payout_retry jsonb; payout_synced jsonb;
BEGIN
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%') <> 2 THEN RAISE EXCEPTION 'Assigned cleaner cannot read invitations'; END IF;
  IF (SELECT count(*) FROM properties WHERE id::text LIKE '20000000-0000-4000-8000-%') <> 0 THEN RAISE EXCEPTION 'Cleaner received access instructions before acceptance'; END IF;
  SELECT tideway_private.get_cleaning_request_scan('30000000-0000-4000-8000-000000000001') INTO scan;
  IF jsonb_array_length(scan->'photos')<>1 OR scan->'photos'->0->>'roomName'<>'Kitchen' THEN RAISE EXCEPTION 'Consented invited-Cleaner room scan is unavailable'; END IF;
  SELECT * INTO object_record FROM tideway_private.get_cleaning_request_photo_object('30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001');
  IF object_record.storage_key IS NULL THEN RAISE EXCEPTION 'Consented invited-Cleaner room photo is unavailable'; END IF;
  BEGIN
    PERFORM tideway_private.get_cleaning_request_scan('30000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'Cleaner can read a room scan without Landlord preview consent';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  SELECT tideway_private.begin_my_cleaner_payout_onboarding('72000000-0000-4000-8000-000000000001') INTO payout_first;
  SELECT tideway_private.attach_my_cleaner_payout_account('72000000-0000-4000-8000-000000000001','acct_integration_cleaner') INTO payout_synced;
  SELECT tideway_private.begin_my_cleaner_payout_onboarding('72000000-0000-4000-8000-000000000002') INTO payout_retry;
  SELECT tideway_private.sync_my_cleaner_payout_account('acct_integration_cleaner',false,true,true) INTO payout_synced;
  IF payout_first->>'requestId'<>'72000000-0000-4000-8000-000000000001'
     OR payout_retry->>'requestId'<>'72000000-0000-4000-8000-000000000001'
     OR payout_synced->>'destinationAccountId'<>'acct_integration_cleaner'
     OR (payout_synced->>'payoutsEnabled')::boolean IS NOT TRUE
     OR (payout_synced->>'detailsSubmitted')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Cleaner payout onboarding lost owner binding, stable retry or verified readiness state';
  END IF;
END
$cleaner$;

ROLLBACK;
