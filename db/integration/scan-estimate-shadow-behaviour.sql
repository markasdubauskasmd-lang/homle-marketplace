\set ON_ERROR_STOP on

BEGIN;

-- Individual observations carry a request id. The runtime role reaching the table
-- directly would turn an error distribution into a list of what customers paid.
DO $privileges$
BEGIN
  IF has_table_privilege('tideway_app','public.scan_estimate_observations','SELECT')
    OR has_table_privilege('tideway_app','public.scan_estimate_observations','INSERT')
    OR has_table_privilege('tideway_app','public.scan_estimate_observations','UPDATE')
    OR has_table_privilege('tideway_app','public.scan_estimate_observations','DELETE')
  THEN RAISE EXCEPTION 'The runtime role can read or write shadow observations directly'; END IF;
END
$privileges$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);

DO $landlord$
DECLARE recorded boolean; observation_count integer;
BEGIN
  -- The Landlord records the observation because the estimate is produced while
  -- they read their own scan, and there is no worker to do it for them.
  recorded := tideway_private.record_scan_estimate_observation(
    '30000000-0000-4000-8000-000000000001','default',1,1,3::smallint,150,true,11000,9350,12650,'');
  IF NOT recorded THEN RAISE EXCEPTION 'A valid shadow observation was refused'; END IF;

  -- Reading a scan repeatedly must not fill the table with identical rows and
  -- weight one indecisive customer as heavily as a hundred bookings.
  PERFORM tideway_private.record_scan_estimate_observation(
    '30000000-0000-4000-8000-000000000001','default',1,1,3::smallint,150,true,11000,9350,12650,'');
  PERFORM tideway_private.record_scan_estimate_observation(
    '30000000-0000-4000-8000-000000000001','default',1,1,4::smallint,200,true,15000,12750,17250,'');
  SELECT count(*) INTO observation_count FROM scan_estimate_observations
    WHERE cleaning_request_id = '30000000-0000-4000-8000-000000000001';
  IF observation_count <> 1 THEN RAISE EXCEPTION 'Repeated reads duplicated a shadow observation'; END IF;

  -- A refusal is a real answer and must be recordable, because how often the
  -- estimate declines to answer is itself worth watching.
  recorded := tideway_private.record_scan_estimate_observation(
    '30000000-0000-4000-8000-000000000002','default',1,1,5::smallint,0,false,0,0,0,'specialist-review-required');
  IF NOT recorded THEN RAISE EXCEPTION 'A refusal could not be recorded'; END IF;

  -- A refusal carrying a price would skew every aggregate, so the row is
  -- rejected rather than stored. The function returns false rather than raising:
  -- this measures the estimate, it is not the estimate, and it must never fail
  -- the read that produced it.
  recorded := tideway_private.record_scan_estimate_observation(
    '30000000-0000-4000-8000-000000000003','default',1,1,5::smallint,0,false,9000,9000,9000,'specialist-review-required');
  IF recorded THEN RAISE EXCEPTION 'A refusal was recorded with a price attached'; END IF;

  -- One customer must not be able to record against another customer's request.
  BEGIN
    PERFORM tideway_private.record_scan_estimate_observation(
      '00000000-0000-4000-8000-0000000000ff','default',1,1,2::smallint,90,true,5000,4250,5750,'');
    RAISE EXCEPTION 'An observation was recorded against an unknown request';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'request-not-found' THEN RAISE; END IF;
  END;

  -- The aggregate is internal. A customer seeing how far the estimate usually
  -- misses is being handed a negotiating position, not a privacy leak, but it is
  -- still not theirs to read.
  BEGIN
    PERFORM tideway_private.scan_estimate_shadow_report('default',1);
    RAISE EXCEPTION 'A Landlord read the internal shadow report';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'administrator-required' THEN RAISE; END IF;
  END;
END
$landlord$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);

DO $administrator$
DECLARE report jsonb;
BEGIN
  report := tideway_private.scan_estimate_shadow_report('default',1);
  IF report IS NULL THEN RAISE EXCEPTION 'The shadow report returned nothing'; END IF;

  -- The fixtures hold only pending invitations. A price a Cleaner has not
  -- accepted is a proposal, not a reviewed figure, and comparing against it
  -- would measure the estimate against another estimate.
  IF (report->>'comparedBookings')::integer <> 0 THEN
    RAISE EXCEPTION 'A pending invitation was compared as though its price were reviewed';
  END IF;

  -- Once a Cleaner accepts, the agreed price is a human judgement of the job and
  -- the comparison becomes meaningful.
  UPDATE bookings SET status = 'confirmed'
    WHERE cleaning_request_id = '30000000-0000-4000-8000-000000000001';
  report := tideway_private.scan_estimate_shadow_report('default',1);

  -- Request 2's observation is a refusal and must not be compared at all.
  IF (report->>'comparedBookings')::integer <> 1 THEN
    RAISE EXCEPTION 'The shadow report compared % bookings rather than one', report->>'comparedBookings';
  END IF;
  -- The agreed price was 8000 against an 11000 estimate: a 37.5% over-estimate,
  -- and the sign must survive so systematic over-estimation is visible rather
  -- than averaging itself away against the opposite error.
  IF (report->>'medianRelativeError')::numeric <= 0 THEN
    RAISE EXCEPTION 'The direction of the estimate error was lost: %', report->>'medianRelativeError';
  END IF;
  IF (report->>'within15Percent')::numeric <> 0 THEN
    RAISE EXCEPTION 'A 37%% over-estimate was counted as within 15%%';
  END IF;
  IF (report->>'withinQuotedRange')::numeric <> 0 THEN
    RAISE EXCEPTION 'An agreed price outside the quoted band was reported as inside it';
  END IF;
  IF (report->>'medianRelativeError') IS NULL THEN RAISE EXCEPTION 'A comparable booking produced no error figure'; END IF;

  -- A promising figure from one booking must not be mistaken for evidence.
  IF (report->>'sufficient')::boolean THEN
    RAISE EXCEPTION 'One booking was reported as a sufficient sample';
  END IF;

  -- Statistics, not rows. An error distribution discloses nothing; a list of
  -- request ids and agreed prices is a list of what customers paid.
  IF report ? 'cleaningRequestId' OR report ? 'rows' OR report ? 'bookings' THEN
    RAISE EXCEPTION 'The shadow report returned identifiable rows rather than statistics';
  END IF;

  -- A model version nobody has observed is an empty comparison, not an error of
  -- zero: "nothing to compare" and "compared perfectly" are different facts.
  report := tideway_private.scan_estimate_shadow_report('default',99);
  IF (report->>'comparedBookings')::integer <> 0 THEN RAISE EXCEPTION 'An unobserved model version reported comparisons'; END IF;
  IF (report->>'medianRelativeError') IS NOT NULL THEN
    RAISE EXCEPTION 'An empty comparison reported an error of zero rather than nothing';
  END IF;
END
$administrator$;

ROLLBACK;
