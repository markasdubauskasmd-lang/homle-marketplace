BEGIN;

CREATE FUNCTION tideway_private.recommend_cleaners_for_request_v2(target_request_id uuid, result_limit integer DEFAULT 25)
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
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  request_landlord_id uuid;
BEGIN
  IF result_limit IS NULL OR result_limit < 1 OR result_limit > 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-matching-limit';
  END IF;
  IF actor_id IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  SELECT request.landlord_user_id INTO request_landlord_id
  FROM cleaning_requests request
  WHERE request.id=target_request_id
    AND (request.landlord_user_id=actor_id OR tideway_private.has_role('administrator'));
  IF request_landlord_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found';
  END IF;

  RETURN QUERY
  SELECT candidate.*
  FROM tideway_private.recommend_cleaners_for_request(target_request_id,LEAST(result_limit + 1,50)) candidate
  WHERE candidate.cleaner_id<>request_landlord_id
  LIMIT result_limit;
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.get_automatic_dispatch_candidates(target_request_id uuid,lease_token uuid,result_limit integer DEFAULT 25)
RETURNS SETOF jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_record cleaning_requests%ROWTYPE; candidate_record record;
BEGIN
  IF lease_token IS NULL OR result_limit IS NULL OR result_limit NOT BETWEEN 1 AND 50 THEN
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
    SELECT candidate.* FROM tideway_private.recommend_cleaners_for_request_v2(request_record.id,50) candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM bookings prior WHERE prior.cleaning_request_id=request_record.id AND prior.cleaner_user_id=candidate.cleaner_id
    )
    LIMIT result_limit
  LOOP RETURN NEXT to_jsonb(candidate_record); END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.recommend_cleaners_for_request_v2(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_automatic_dispatch_candidates(uuid,uuid,integer) FROM PUBLIC;

COMMIT;
