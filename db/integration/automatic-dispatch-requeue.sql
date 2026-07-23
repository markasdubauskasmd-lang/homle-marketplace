\set ON_ERROR_STOP on

BEGIN;
CREATE TEMP TABLE dispatch_expired (booking_id uuid) ON COMMIT DROP;
INSERT INTO dispatch_expired SELECT * FROM tideway_private.expire_due_cleaner_invitations(10);
CREATE TEMP TABLE dispatch_reclaimed (cleaning_request_id uuid,lease_expires_at timestamptz) ON COMMIT DROP;
INSERT INTO dispatch_reclaimed SELECT * FROM tideway_private.claim_due_automatic_dispatch('74000000-0000-4000-8000-000000000003',1,120);

DO $$
DECLARE candidate_count integer; has_next boolean; has_prior boolean; result jsonb;
BEGIN
  IF (SELECT count(*) FROM dispatch_expired)<>1 OR (SELECT booking_id FROM dispatch_expired LIMIT 1)<>'40000000-0000-4000-8000-000000000004' THEN
    RAISE EXCEPTION 'The first automatic invitation did not expire exactly once';
  END IF;
  IF (SELECT count(*) FROM dispatch_reclaimed)<>1 OR (SELECT cleaning_request_id FROM dispatch_reclaimed LIMIT 1)<>'30000000-0000-4000-8000-000000000004' THEN
    RAISE EXCEPTION 'Expired matching did not requeue into one worker lease';
  END IF;
  SELECT count(*)::integer,
         bool_or((candidate->>'cleaner_id')::uuid='10000000-0000-4000-8000-000000000005'),
         bool_or((candidate->>'cleaner_id')::uuid='10000000-0000-4000-8000-000000000002')
    INTO candidate_count,has_next,has_prior
  FROM tideway_private.get_automatic_dispatch_candidates(
    '30000000-0000-4000-8000-000000000004','74000000-0000-4000-8000-000000000003',25,false
  ) AS candidate;
  IF candidate_count<>1 OR has_next IS NOT TRUE OR has_prior IS TRUE THEN
    RAISE EXCEPTION 'Requeued matching did not exclude the tried Cleaner and select the next eligible Cleaner';
  END IF;
  SELECT tideway_private.complete_automatic_dispatch(
    '30000000-0000-4000-8000-000000000004','74000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005',
    now()+interval '30 minutes',9000,5200,520,300,200,100,100,1000,1800
  ) INTO result;
  IF result->>'bookingId'<>'40000000-0000-4000-8000-000000000005'
     OR result->>'cleanerId'<>'10000000-0000-4000-8000-000000000005'
     OR (result->>'attemptNumber')::integer<>2 THEN
    RAISE EXCEPTION 'The requeued automatic invitation did not use the second bounded attempt';
  END IF;
END
$$;
COMMIT;
