\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  first_result jsonb;
  retried_result jsonb;
  owner_page jsonb;
  outsider_page jsonb;
  admin_page jsonb;
  reviewed_result jsonb;
  resolved_result jsonb;
  final_page jsonb;
  blocked boolean := false;
BEGIN
  IF has_table_privilege(current_user,'public.support_requests','SELECT')
    OR has_table_privilege(current_user,'public.support_requests','INSERT')
    OR has_table_privilege(current_user,'public.support_requests','UPDATE')
    OR has_table_privilege(current_user,'public.support_requests','DELETE') THEN
    RAISE EXCEPTION 'Runtime role can bypass the function-only Landlord support workflow';
  END IF;

  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000002',true);
  PERFORM set_config('app.user_roles','cleaner',true);
  BEGIN
    PERFORM tideway_private.create_landlord_support_request(
      '74000000-0000-4000-8000-000000000001','74100000-0000-4000-8000-000000000001',
      'room-scan','Room scan did not save','The scan stopped before the checklist appeared.'
    );
  EXCEPTION WHEN OTHERS THEN blocked := SQLERRM='landlord-required'; END;
  IF NOT blocked THEN RAISE EXCEPTION 'A Cleaner opened a Landlord support request'; END IF;

  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
  PERFORM set_config('app.user_roles','landlord',true);
  first_result := tideway_private.create_landlord_support_request(
    '74000000-0000-4000-8000-000000000001','74100000-0000-4000-8000-000000000001',
    'room-scan','Room scan did not save','The scan stopped before the checklist appeared.'
  );
  retried_result := tideway_private.create_landlord_support_request(
    '74000000-0000-4000-8000-000000000002','74100000-0000-4000-8000-000000000001',
    'room-scan','Room scan did not save','The scan stopped before the checklist appeared.'
  );
  IF first_result->>'supportRequestId' IS DISTINCT FROM retried_result->>'supportRequestId' THEN
    RAISE EXCEPTION 'A retried Landlord support request created a duplicate';
  END IF;
  owner_page := tideway_private.list_my_landlord_support_requests(25,0);
  IF jsonb_array_length(owner_page->'supportRequests')<>1 OR owner_page->'supportRequests'->0->>'status'<>'open' THEN
    RAISE EXCEPTION 'The owning Landlord could not read the private support request';
  END IF;

  blocked := false;
  BEGIN
    PERFORM tideway_private.create_landlord_support_request(
      '74000000-0000-4000-8000-000000000003','74100000-0000-4000-8000-000000000002',
      'property','Please save this door code','The access code is 1234 and the door code should be retained.'
    );
  EXCEPTION WHEN OTHERS THEN blocked := SQLERRM='invalid-support-request'; END;
  IF NOT blocked THEN RAISE EXCEPTION 'A Landlord stored a property access code in support'; END IF;

  PERFORM tideway_private.create_landlord_support_request(
    '74000000-0000-4000-8000-000000000004','74100000-0000-4000-8000-000000000004',
    'booking-preparation','Booking reference 123456 needs checking',
    'The requested date was 30/07/2026 for two rooms, but the draft still shows 31/07/2026.'
  );
  blocked := false;
  BEGIN
    PERFORM tideway_private.create_landlord_support_request(
      '74000000-0000-4000-8000-000000000005','74100000-0000-4000-8000-000000000005',
      'booking-preparation','Payment failed after room review',
      'The payment failed for 4242 4242 4242 4242 after the scan.'
    );
  EXCEPTION WHEN OTHERS THEN blocked := SQLERRM='invalid-support-request'; END;
  IF NOT blocked THEN RAISE EXCEPTION 'A Landlord stored a card-like number in support'; END IF;

  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000003',true);
  PERFORM set_config('app.user_roles','landlord',true);
  outsider_page := tideway_private.list_my_landlord_support_requests(25,0);
  IF jsonb_array_length(outsider_page->'supportRequests')<>0 THEN
    RAISE EXCEPTION 'An unrelated Landlord read another account support request';
  END IF;

  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
  PERFORM set_config('app.user_roles','administrator',true);
  admin_page := tideway_private.list_administrator_support_requests('open','room-scan',50,0);
  IF jsonb_array_length(admin_page->'supportRequests')<>1
    OR admin_page::text ~* '(integration-landlord@|Private test address|10000000-0000-4000-8000-000000000001)' THEN
    RAISE EXCEPTION 'Administrator support queue lost its minimum-data projection';
  END IF;
  reviewed_result := tideway_private.review_landlord_support_request((first_result->>'supportRequestId')::uuid,'reviewing',NULL);
  IF reviewed_result->>'status'<>'reviewing' THEN RAISE EXCEPTION 'Administrator could not start support review'; END IF;
  resolved_result := tideway_private.review_landlord_support_request(
    (first_result->>'supportRequestId')::uuid,'resolved',
    'Refresh the dashboard and reopen the saved draft before scanning again.'
  );
  IF resolved_result->>'status'<>'resolved' OR resolved_result->>'resolvedAt' IS NULL THEN
    RAISE EXCEPTION 'Administrator could not record the private support response';
  END IF;

  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
  PERFORM set_config('app.user_roles','landlord',true);
  final_page := tideway_private.list_my_landlord_support_requests(25,0);
  IF final_page->'supportRequests'->0->>'resolutionSummary'
      <> 'Refresh the dashboard and reopen the saved draft before scanning again.' THEN
    RAISE EXCEPTION 'The owning Landlord could not read the final in-app support response';
  END IF;
END;
$test$;

ROLLBACK;
