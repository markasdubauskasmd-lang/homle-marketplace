\set ON_ERROR_STOP on

BEGIN;
CREATE TEMP TABLE dispatch_expired (booking_id uuid) ON COMMIT DROP;
INSERT INTO dispatch_expired SELECT * FROM tideway_private.expire_due_cleaner_invitations(10);
CREATE TEMP TABLE dispatch_final_claim (cleaning_request_id uuid,lease_expires_at timestamptz) ON COMMIT DROP;
INSERT INTO dispatch_final_claim SELECT * FROM tideway_private.claim_due_automatic_dispatch('74000000-0000-4000-8000-000000000004',1,120);
DO $$ BEGIN
  IF (SELECT count(*) FROM dispatch_expired)<>1 OR (SELECT booking_id FROM dispatch_expired LIMIT 1)<>'40000000-0000-4000-8000-000000000005' THEN
    RAISE EXCEPTION 'The second automatic invitation did not expire exactly once';
  END IF;
  IF (SELECT count(*) FROM dispatch_final_claim)<>0 THEN
    RAISE EXCEPTION 'Automatic dispatch exceeded the Landlord-approved attempt ceiling';
  END IF;
END $$;
COMMIT;
