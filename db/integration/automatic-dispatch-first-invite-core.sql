\set ON_ERROR_STOP on

BEGIN;
CREATE TEMP TABLE dispatch_rehearsal_context (lease_token uuid NOT NULL) ON COMMIT DROP;
INSERT INTO dispatch_rehearsal_context VALUES (:'lease_token'::uuid);

DO $$
DECLARE
  selected_lease uuid;
  candidate_count integer;
  has_first boolean;
  has_second boolean;
  result jsonb;
BEGIN
  SELECT lease_token INTO selected_lease FROM dispatch_rehearsal_context;
  SELECT count(*)::integer,
         bool_or((candidate->>'cleaner_id')::uuid='10000000-0000-4000-8000-000000000002'),
         bool_or((candidate->>'cleaner_id')::uuid='10000000-0000-4000-8000-000000000005')
    INTO candidate_count,has_first,has_second
  FROM tideway_private.get_automatic_dispatch_candidates(
    '30000000-0000-4000-8000-000000000004',selected_lease,25
  ) AS candidate;
  IF candidate_count<>2 OR has_first IS NOT TRUE OR has_second IS NOT TRUE THEN
    RAISE EXCEPTION 'The first automatic-dispatch lease did not see exactly two independent eligible Cleaners';
  END IF;

  SELECT tideway_private.complete_automatic_dispatch(
    '30000000-0000-4000-8000-000000000004',selected_lease,
    '40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002',
    now()+interval '30 minutes',9000,5000,500,300,200,100,100,1000,1800
  ) INTO result;
  IF result->>'bookingId'<>'40000000-0000-4000-8000-000000000004'
     OR result->>'cleanerId'<>'10000000-0000-4000-8000-000000000002'
     OR (result->>'attemptNumber')::integer<>1 THEN
    RAISE EXCEPTION 'The first automatic-dispatch invitation was not recorded exactly once';
  END IF;
END
$$;
COMMIT;
