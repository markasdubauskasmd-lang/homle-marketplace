\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);
DO $landlord_denied$
BEGIN
  BEGIN
    PERFORM tideway_private.get_administrator_coverage_report(30,false);
    RAISE EXCEPTION 'A Landlord read the private Administrator coverage report';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'administrator-required' THEN RAISE; END IF;
  END;
END
$landlord_denied$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('app.user_roles','cleaner',true);
DO $cleaner_denied$
BEGIN
  BEGIN
    PERFORM tideway_private.get_administrator_coverage_report(30,false);
    RAISE EXCEPTION 'A Cleaner read the private Administrator coverage report';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'administrator-required' THEN RAISE; END IF;
  END;
END
$cleaner_denied$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
DO $coverage_report$
DECLARE
  marketplace_report jsonb;
  paid_report jsonb;
  selected_area jsonb;
  serialized text;
BEGIN
  marketplace_report:=tideway_private.get_administrator_coverage_report(30,false);
  paid_report:=tideway_private.get_administrator_coverage_report(30,true);
  selected_area:=marketplace_report->'areas'->0;
  serialized:=marketplace_report::text;

  IF marketplace_report->>'matchingMode'<>'marketplace'
    OR (marketplace_report->'summary'->>'submittedRequestCount')::integer<>3
    OR (marketplace_report->'summary'->>'openUnmatchedRequestCount')::integer<>1
    OR marketplace_report->'areas' IS NULL
    OR jsonb_array_length(marketplace_report->'areas')<>1
    OR selected_area->>'outwardPostcode'<>'SW1A'
    OR (selected_area->>'minimumEligibleCleanerCount')::integer<>1
    OR selected_area->'demandServiceCodes'<>jsonb_build_array('standard-clean') THEN
    RAISE EXCEPTION 'Administrator marketplace coverage did not use current request and matching records';
  END IF;
  IF paid_report->>'matchingMode'<>'payout-ready'
    OR (paid_report->'summary'->>'zeroMatchRequestCount')::integer<>1
    OR (paid_report->'areas'->0->>'minimumEligibleCleanerCount')::integer<>0 THEN
    RAISE EXCEPTION 'Administrator paid-mode coverage did not apply provider-verified payout eligibility';
  END IF;
  IF serialized ~* '(10000000-|20000000-|30000000-|integration-|Private test address|SW1A 1AA|latitude|longitude|propertyId|requestId|cleanerId|landlordId|room|photo)' THEN
    RAISE EXCEPTION 'Administrator coverage exposed an identity, exact property, request, room or media field';
  END IF;
  IF marketplace_report->>'privacyScope' NOT LIKE 'Outward-postcode aggregates only.%' THEN
    RAISE EXCEPTION 'Administrator coverage omitted its privacy boundary';
  END IF;
END
$coverage_report$;

DO $invalid_input$
BEGIN
  BEGIN
    PERFORM tideway_private.get_administrator_coverage_report(365,false);
    RAISE EXCEPTION 'Administrator coverage accepted an unbounded reporting window';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM<>'invalid-coverage-window' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM tideway_private.get_administrator_coverage_report(30,NULL);
    RAISE EXCEPTION 'Administrator coverage accepted ambiguous payment mode';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM<>'invalid-payout-readiness-filter' THEN RAISE; END IF;
  END;
END
$invalid_input$;

DO $runtime_boundary$
BEGIN
  IF NOT has_function_privilege('tideway_app','tideway_private.get_administrator_coverage_report(integer,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'The runtime role cannot execute the protected coverage projection';
  END IF;
  IF has_table_privilege('tideway_app','tideway_private.cleaner_payout_accounts','SELECT') THEN
    RAISE EXCEPTION 'The coverage feature widened direct runtime access to private payout records';
  END IF;
END
$runtime_boundary$;

ROLLBACK;
