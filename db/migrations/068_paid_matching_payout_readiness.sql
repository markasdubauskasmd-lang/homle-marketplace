BEGIN;

CREATE FUNCTION tideway_private.cleaner_payout_ready_for_paid_booking(target_cleaner_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF target_cleaner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-cleaner-id';
  END IF;
  IF tideway_private.current_user_id() IS NULL
     OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM tideway_private.cleaner_payout_accounts payout
    WHERE payout.cleaner_user_id=target_cleaner_id
      AND payout.provider='stripe'
      AND payout.details_submitted IS TRUE
      AND payout.payouts_enabled IS TRUE
  );
END;
$$;

CREATE FUNCTION tideway_private.recommend_cleaners_for_request_v3(
  target_request_id uuid,
  result_limit integer DEFAULT 25,
  require_payout_ready boolean DEFAULT false
)
RETURNS TABLE (
  cleaner_id uuid,
  public_slug citext,
  display_name text,
  profile_photo_url text,
  biography text,
  average_rating numeric,
  review_count integer,
  completed_job_count integer,
  years_experience integer,
  languages text[],
  equipment_supplied text[],
  products_supplied text[],
  verified_badges text[],
  identity_verified boolean,
  current_availability_status text,
  distance_km numeric,
  exact_postcode_area boolean,
  previous_completed_jobs integer,
  base_match_score numeric,
  requested_start_at timestamptz,
  requested_end_at timestamptz,
  required_services text[],
  budget_pence integer,
  services jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF require_payout_ready IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-payout-readiness-filter';
  END IF;
  IF result_limit IS NULL OR result_limit < 1 OR result_limit > 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-matching-limit';
  END IF;

  RETURN QUERY
  SELECT candidate.*
  FROM tideway_private.recommend_cleaners_for_request_v2(target_request_id,50) candidate
  WHERE NOT require_payout_ready
    OR EXISTS (
      SELECT 1
      FROM tideway_private.cleaner_payout_accounts payout
      WHERE payout.cleaner_user_id=candidate.cleaner_id
        AND payout.provider='stripe'
        AND payout.details_submitted IS TRUE
        AND payout.payouts_enabled IS TRUE
    )
  LIMIT result_limit;
END;
$$;

CREATE FUNCTION tideway_private.get_automatic_dispatch_candidates(
  target_request_id uuid,
  lease_token uuid,
  result_limit integer,
  require_payout_ready boolean
)
RETURNS SETOF jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_record cleaning_requests%ROWTYPE; candidate_record record;
BEGIN
  IF lease_token IS NULL OR result_limit IS NULL OR result_limit NOT BETWEEN 1 AND 50 OR require_payout_ready IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-automatic-dispatch-candidate-request';
  END IF;
  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id=target_request_id AND request.status='searching-for-cleaner'
      AND request.automatic_dispatch_authorized_at IS NOT NULL AND request.automatic_dispatch_revoked_at IS NULL
      AND request.automatic_dispatch_lease_token=lease_token AND request.automatic_dispatch_lease_expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='automatic-dispatch-lease-not-found'; END IF;
  PERFORM set_config('app.user_id',request_record.landlord_user_id::text,true);
  PERFORM set_config('app.user_roles','landlord',true);
  FOR candidate_record IN
    SELECT candidate.* FROM tideway_private.recommend_cleaners_for_request_v3(request_record.id,50,require_payout_ready) candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM bookings prior WHERE prior.cleaning_request_id=request_record.id AND prior.cleaner_user_id=candidate.cleaner_id
    )
    LIMIT result_limit
  LOOP RETURN NEXT to_jsonb(candidate_record); END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.recommend_cleaners_for_request_v3(uuid,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_automatic_dispatch_candidates(uuid,uuid,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.cleaner_payout_ready_for_paid_booking(uuid) FROM PUBLIC;

COMMIT;
