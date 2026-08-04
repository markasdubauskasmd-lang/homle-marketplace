\set ON_ERROR_STOP on

BEGIN;

-- This integration file runs as the migration owner only so it can age the
-- disposable fixtures below. Every product-facing assertion explicitly adopts
-- the restricted runtime role; do not grant the runtime direct fixture access.
SET LOCAL ROLE tideway_app;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);
DO $landlord_denied$
BEGIN
  BEGIN
    PERFORM tideway_private.get_administrator_funnel_report(30);
    RAISE EXCEPTION 'A Landlord read the private Administrator funnel report';
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
    PERFORM tideway_private.get_administrator_funnel_report(30);
    RAISE EXCEPTION 'A Cleaner read the private Administrator funnel report';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'administrator-required' THEN RAISE; END IF;
  END;
END
$cleaner_denied$;

RESET ROLE;

-- Mature the existing synthetic Landlord and request fixtures. The transaction
-- rolls back, so later integration scripts retain their original timestamps.
UPDATE user_roles
SET granted_at=now()-interval '2 days'
WHERE user_id='10000000-0000-4000-8000-000000000001' AND role='landlord';

UPDATE cleaning_requests
SET created_at=now()-interval '2 days'
WHERE id IN (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003'
);

INSERT INTO room_scan_sessions(id,cleaning_request_id,landlord_user_id,device_class,captured_at,created_at)
VALUES(
  '3e000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'guided-web',now()-interval '2 days',now()-interval '2 days'
);

SET LOCAL ROLE tideway_app;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
DO $funnel_report$
DECLARE
  report jsonb;
  serialized text;
BEGIN
  report:=tideway_private.get_administrator_funnel_report(30);
  serialized:=(report-'privacyScope'-'cohortPolicy')::text;
  IF (report->'onboarding'->>'accountCount')::integer<>1
    OR (report->'onboarding'->>'profileCount')::integer<>1
    OR (report->'onboarding'->>'propertyCount')::integer<>1
    OR (report->'requestJourney'->>'requestCount')::integer<>3
    OR (report->'requestJourney'->>'scanCount')::integer<>1
    OR (report->'requestJourney'->>'submittedCount')::integer<>1
    OR (report->'requestJourney'->>'bookingCount')::integer<>0
    OR (report->'payments'->>'bookingCount')::integer<>0
    OR (report->>'maturityHours')::integer<>24 THEN
    RAISE EXCEPTION 'Administrator funnel did not derive cumulative matured cohorts from authoritative records';
  END IF;
  IF serialized ~* '(10000000-|20000000-|30000000-|integration-|Private test address|SW1A|email|address|postcode|avatar|latitude|longitude|room|photo|provider|amount|price)' THEN
    RAISE EXCEPTION 'Administrator funnel exposed an identity, location, scan, provider or monetary field';
  END IF;
  IF report->>'privacyScope' NOT LIKE 'Aggregate stage counts only.%'
    OR report->>'cohortPolicy' NOT LIKE 'Each lane is an independent cohort%' THEN
    RAISE EXCEPTION 'Administrator funnel omitted its privacy or cohort boundary';
  END IF;
END
$funnel_report$;

DO $invalid_input$
BEGIN
  BEGIN
    PERFORM tideway_private.get_administrator_funnel_report(365);
    RAISE EXCEPTION 'Administrator funnel accepted an unbounded reporting window';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM<>'invalid-funnel-window' THEN RAISE; END IF;
  END;
END
$invalid_input$;

DO $runtime_boundary$
BEGIN
  IF NOT has_function_privilege('tideway_app','tideway_private.get_administrator_funnel_report(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'The runtime role cannot execute the protected funnel projection';
  END IF;
  IF has_table_privilege('tideway_app','public.room_scan_sessions','SELECT')
    OR has_table_privilege('tideway_app','public.booking_payments','SELECT') THEN
    RAISE EXCEPTION 'The funnel feature widened direct runtime access to private scan or payment records';
  END IF;
END
$runtime_boundary$;

ROLLBACK;
