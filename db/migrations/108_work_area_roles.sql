BEGIN;
ALTER TABLE cleaner_service_areas ADD COLUMN role text NOT NULL DEFAULT 'primary' CHECK(role IN ('primary','secondary','excluded'));
CREATE OR REPLACE FUNCTION tideway_private.invite_cleaner(proposed_booking_id uuid, target_request_id uuid, target_cleaner_id uuid, response_deadline timestamp with time zone, proposed_customer_price_pence integer, proposed_cleaner_pay_pence integer, proposed_labour_on_cost_pence integer, proposed_payment_fee_pence integer, proposed_travel_cost_pence integer, proposed_supplies_cost_pence integer, proposed_other_cost_pence integer, proposed_target_margin_basis_points integer)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  request_record cleaning_requests%ROWTYPE;
  property_record properties%ROWTYPE;
  profile_record cleaner_profiles%ROWTYPE;
  request_outward_postcode text;
  duration_minutes integer;
  priced_service_count integer;
  expected_cleaner_pay bigint;
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  IF target_cleaner_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='cleaner-not-eligible'; END IF;

  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id=target_request_id
      AND (request.landlord_user_id=actor_id OR tideway_private.has_role('administrator'))
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found'; END IF;
  IF request_record.status<>'searching-for-cleaner' OR request_record.submitted_at IS NULL OR request_record.requested_start_at<=now() THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-not-matchable';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_cleaner_id::text,0));

  SELECT * INTO property_record FROM properties property
    WHERE property.id=request_record.property_id AND property.archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='property-not-found'; END IF;

  SELECT profile.* INTO profile_record FROM cleaner_profiles profile
    JOIN users account ON account.id=profile.user_id AND account.account_status='active'
    WHERE profile.user_id=target_cleaner_id
      AND profile.is_public AND profile.profile_completion_percent=100
      AND profile.current_availability_status<>'unavailable'
    FOR SHARE OF profile;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-account-inactive'; END IF;

  IF (property_record.property_type IN ('house','flat','studio') AND NOT profile_record.residential_preference)
    OR (property_record.property_type IN ('office','retail','clinic','communal') AND NOT profile_record.commercial_preference)
    OR (property_record.property_type='other' AND NOT (profile_record.residential_preference OR profile_record.commercial_preference))
    OR property_record.property_type NOT IN ('house','flat','studio','office','retail','clinic','communal','other') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-property-mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cleaner_availability availability
    WHERE availability.cleaner_user_id=target_cleaner_id AND availability.status='available'
      AND availability.starts_at<=request_record.requested_start_at
      AND availability.ends_at>=request_record.requested_end_at
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-unavailable'; END IF;

  duration_minutes:=ceil(extract(epoch FROM (request_record.requested_end_at-request_record.requested_start_at))/60)::integer;
  SELECT count(*)::integer,
         COALESCE(sum(CASE service.pricing_model
           WHEN 'hourly' THEN ceil(service.price_pence::numeric*duration_minutes/60)::bigint
           WHEN 'fixed' THEN service.price_pence::bigint
           ELSE NULL END),0)
    INTO priced_service_count,expected_cleaner_pay
  FROM unnest(request_record.required_services) required(service_code)
  JOIN cleaner_services service ON service.cleaner_user_id=target_cleaner_id
    AND service.service_code=required.service_code AND service.is_active
    AND service.pricing_model IN ('hourly','fixed') AND service.price_pence IS NOT NULL;
  IF priced_service_count<>cardinality(request_record.required_services) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-services-mismatch';
  END IF;
  IF expected_cleaner_pay<>proposed_cleaner_pay_pence THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-price-changed';
  END IF;

  request_outward_postcode:=tideway_private.outward_postcode(property_record.postcode);
  IF EXISTS (SELECT 1 FROM cleaner_service_areas excluded WHERE excluded.cleaner_user_id=target_cleaner_id AND excluded.outward_postcode=request_outward_postcode AND excluded.role='excluded') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaner-excluded-service-area';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM (SELECT * FROM cleaner_service_areas WHERE role <> 'excluded') area
    WHERE area.cleaner_user_id=target_cleaner_id AND area.outward_postcode=request_outward_postcode
  ) AND NOT EXISTS (
    SELECT 1 FROM (SELECT * FROM cleaner_service_areas WHERE role <> 'excluded') area
    WHERE area.cleaner_user_id=target_cleaner_id
      AND property_record.latitude IS NOT NULL AND property_record.longitude IS NOT NULL
      AND area.latitude IS NOT NULL AND area.longitude IS NOT NULL
      AND profile_record.travel_radius_km IS NOT NULL
      AND 6371*acos(LEAST(1,GREATEST(-1,
        sin(radians(property_record.latitude::double precision))*sin(radians(area.latitude::double precision))+
        cos(radians(property_record.latitude::double precision))*cos(radians(area.latitude::double precision))*
        cos(radians(area.longitude::double precision-property_record.longitude::double precision))
      )))<=profile_record.travel_radius_km
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-outside-service-area'; END IF;

  IF EXISTS (
    SELECT 1 FROM bookings occupied
    WHERE occupied.cleaner_user_id=target_cleaner_id
      AND occupied.status IN ('pending-cleaner-acceptance','confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review')
      AND tstzrange(occupied.scheduled_start_at,occupied.scheduled_end_at,'[)') &&
          tstzrange(request_record.requested_start_at,request_record.requested_end_at,'[)')
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-has-overlapping-invitation'; END IF;

  RETURN tideway_private.invite_cleaner_before_eligibility_hardening(
    proposed_booking_id,target_request_id,target_cleaner_id,response_deadline,
    proposed_customer_price_pence,proposed_cleaner_pay_pence,proposed_labour_on_cost_pence,
    proposed_payment_fee_pence,proposed_travel_cost_pence,proposed_supplies_cost_pence,
    proposed_other_cost_pence,proposed_target_margin_basis_points
  );
END;
$function$
;


CREATE OR REPLACE FUNCTION tideway_private.recommend_cleaners_for_request(target_request_id uuid, result_limit integer DEFAULT 25)
 RETURNS TABLE(cleaner_id uuid, public_slug citext, display_name text, profile_photo_url text, biography text, average_rating numeric, review_count integer, completed_job_count integer, years_experience integer, languages text[], equipment_supplied text[], products_supplied text[], verified_badges text[], identity_verified boolean, current_availability_status text, distance_km numeric, exact_postcode_area boolean, previous_completed_jobs integer, base_match_score numeric, requested_start_at timestamp with time zone, requested_end_at timestamp with time zone, required_services text[], budget_pence integer, services jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  request_record cleaning_requests%ROWTYPE;
  request_property properties%ROWTYPE;
  request_outward_postcode text;
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'landlord-required';
  END IF;
  IF result_limit IS NULL OR result_limit < 1 OR result_limit > 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid-match-limit';
  END IF;

  SELECT * INTO request_record FROM cleaning_requests request
  WHERE request.id = target_request_id
    AND (request.landlord_user_id = actor_id OR tideway_private.has_role('administrator'));
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'request-not-found'; END IF;
  IF request_record.status <> 'searching-for-cleaner' OR request_record.submitted_at IS NULL OR request_record.requested_start_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'request-not-matchable';
  END IF;
  SELECT * INTO request_property FROM properties property
    WHERE property.id = request_record.property_id AND property.archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'property-not-found'; END IF;
  request_outward_postcode := tideway_private.outward_postcode(request_property.postcode);

  RETURN QUERY
  WITH eligible AS (
    SELECT
      profile.user_id,
      profile.public_slug,
      account.display_name,
      COALESCE(profile.profile_photo_url, account.avatar_url) AS profile_photo_url,
      profile.biography,
      profile.average_rating,
      profile.review_count,
      profile.completed_job_count,
      profile.years_experience,
      profile.languages,
      profile.equipment_supplied,
      profile.products_supplied,
      profile.verified_badges,
      profile.identity_check_status = 'verified' AS identity_verified,
      profile.current_availability_status,
      coverage.distance_km,
      coverage.exact_postcode_area,
      relationships.previous_completed_jobs,
      round((
        CASE WHEN EXISTS (SELECT 1 FROM cleaner_service_areas secondary WHERE secondary.cleaner_user_id=profile.user_id AND secondary.outward_postcode=request_outward_postcode AND secondary.role='secondary') THEN 15::numeric
          WHEN coverage.exact_postcode_area THEN 25::numeric
          WHEN coverage.distance_km IS NOT NULL THEN GREATEST(0::numeric, 25 * (1 - coverage.distance_km / profile.travel_radius_km))
          ELSE 0::numeric END
        + CASE WHEN profile.review_count = 0 THEN 10::numeric ELSE profile.average_rating / 5 * 20 END
        + CASE WHEN relationships.previous_completed_jobs > 0 THEN 15::numeric ELSE 0::numeric END
        + COALESCE(profile.acceptance_rate, 50) / 100 * 10
        + CASE WHEN profile.identity_check_status = 'verified' THEN 5::numeric ELSE 0::numeric END
      ), 2) AS base_match_score,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'serviceCode', service.service_code,
          'pricingModel', service.pricing_model,
          'pricePence', service.price_pence
        ) ORDER BY service.service_code)
        FROM cleaner_services service
        WHERE service.cleaner_user_id = profile.user_id AND service.is_active
      ), '[]'::jsonb) AS services
    FROM cleaner_profiles profile
    JOIN users account ON account.id = profile.user_id AND account.account_status = 'active'
    CROSS JOIN LATERAL (
      SELECT
        EXISTS (
          SELECT 1 FROM (SELECT * FROM cleaner_service_areas WHERE role <> 'excluded') exact_area
          WHERE exact_area.cleaner_user_id = profile.user_id AND exact_area.outward_postcode = request_outward_postcode
        ) AS exact_postcode_area,
        round(MIN(
          CASE WHEN request_property.latitude IS NOT NULL AND request_property.longitude IS NOT NULL
                    AND area.latitude IS NOT NULL AND area.longitude IS NOT NULL
            THEN 6371 * acos(LEAST(1, GREATEST(-1,
              sin(radians(request_property.latitude::double precision)) * sin(radians(area.latitude::double precision)) +
              cos(radians(request_property.latitude::double precision)) * cos(radians(area.latitude::double precision)) *
              cos(radians(area.longitude::double precision - request_property.longitude::double precision))
            ))) END
        )::numeric, 2) AS distance_km
      FROM (SELECT * FROM cleaner_service_areas WHERE role <> 'excluded') area WHERE area.cleaner_user_id = profile.user_id
    ) coverage
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS previous_completed_jobs FROM bookings previous
      WHERE previous.landlord_user_id = request_record.landlord_user_id
        AND previous.cleaner_user_id = profile.user_id AND previous.status = 'completed'
    ) relationships
    WHERE NOT EXISTS (SELECT 1 FROM cleaner_service_areas excluded WHERE excluded.cleaner_user_id=profile.user_id AND excluded.outward_postcode=request_outward_postcode AND excluded.role='excluded')
      AND profile.is_public
      AND profile.profile_completion_percent = 100
      AND profile.current_availability_status <> 'unavailable'
      AND (
        (request_property.property_type IN ('house', 'flat', 'studio') AND profile.residential_preference) OR
        (request_property.property_type IN ('office', 'retail', 'clinic', 'communal') AND profile.commercial_preference) OR
        (request_property.property_type = 'other' AND (profile.residential_preference OR profile.commercial_preference))
      )
      AND NOT EXISTS (
        SELECT required.service_code FROM unnest(request_record.required_services) AS required(service_code)
        EXCEPT SELECT service.service_code FROM cleaner_services service
          WHERE service.cleaner_user_id = profile.user_id AND service.is_active
            AND service.pricing_model <> 'quote' AND service.price_pence IS NOT NULL
      )
      AND EXISTS (
        SELECT 1 FROM cleaner_availability availability
        WHERE availability.cleaner_user_id = profile.user_id AND availability.status = 'available'
          AND availability.starts_at <= request_record.requested_start_at
          AND availability.ends_at >= request_record.requested_end_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings occupied
        WHERE occupied.cleaner_user_id = profile.user_id
          AND occupied.status IN ('pending-cleaner-acceptance', 'confirmed', 'cleaner-en-route', 'cleaner-arrived', 'cleaning-in-progress', 'awaiting-review')
          AND tstzrange(occupied.scheduled_start_at, occupied.scheduled_end_at, '[)') &&
              tstzrange(request_record.requested_start_at, request_record.requested_end_at, '[)')
      )
      AND (
        coverage.exact_postcode_area OR
        (coverage.distance_km IS NOT NULL AND coverage.distance_km <= profile.travel_radius_km)
      )
  )
  SELECT
    eligible.user_id,
    eligible.public_slug,
    eligible.display_name,
    eligible.profile_photo_url,
    eligible.biography,
    eligible.average_rating,
    eligible.review_count,
    eligible.completed_job_count,
    eligible.years_experience,
    eligible.languages,
    eligible.equipment_supplied,
    eligible.products_supplied,
    eligible.verified_badges,
    eligible.identity_verified,
    eligible.current_availability_status,
    eligible.distance_km,
    eligible.exact_postcode_area,
    eligible.previous_completed_jobs,
    eligible.base_match_score,
    request_record.requested_start_at,
    request_record.requested_end_at,
    request_record.required_services,
    request_record.budget_pence,
    eligible.services
  FROM eligible
  ORDER BY eligible.base_match_score DESC, eligible.distance_km ASC NULLS LAST,
    eligible.average_rating DESC, eligible.completed_job_count DESC, eligible.public_slug
  LIMIT result_limit;
END;
$function$
;


CREATE OR REPLACE FUNCTION tideway_private.search_cleaner_directory(
  candidate_outward_postcode text DEFAULT NULL,
  candidate_service_code text DEFAULT NULL,
  candidate_start_at timestamptz DEFAULT NULL,
  candidate_end_at timestamptz DEFAULT NULL,
  candidate_minimum_rating numeric DEFAULT NULL,
  candidate_maximum_price_pence integer DEFAULT NULL,
  candidate_verified_only boolean DEFAULT false,
  candidate_latitude numeric DEFAULT NULL,
  candidate_longitude numeric DEFAULT NULL,
  candidate_maximum_distance_km numeric DEFAULT NULL,
  result_limit integer DEFAULT 20,
  result_offset integer DEFAULT 0
)
RETURNS TABLE (
  cleaner_id uuid,
  public_slug citext,
  display_name text,
  profile_photo_url text,
  biography text,
  hourly_rate_pence integer,
  fixed_price_options jsonb,
  travel_radius_km numeric,
  years_experience integer,
  languages text[],
  equipment_supplied text[],
  products_supplied text[],
  residential_preference boolean,
  commercial_preference boolean,
  average_rating numeric,
  review_count integer,
  completed_job_count integer,
  profile_completion_percent integer,
  current_availability_status text,
  verified_badges text[],
  verified boolean,
  distance_km numeric,
  services jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    cp.user_id,
    cp.public_slug,
    u.display_name,
    COALESCE(cp.profile_photo_url, u.avatar_url),
    cp.biography,
    cp.hourly_rate_pence,
    cp.fixed_price_options,
    cp.travel_radius_km,
    cp.years_experience,
    cp.languages,
    cp.equipment_supplied,
    cp.products_supplied,
    cp.residential_preference,
    cp.commercial_preference,
    cp.average_rating,
    cp.review_count,
    cp.completed_job_count,
    cp.profile_completion_percent,
    cp.current_availability_status,
    cp.verified_badges,
    cp.identity_check_status = 'verified',
    area_distance.distance_km,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'serviceCode', cs.service_code,
        'pricingModel', cs.pricing_model,
        'pricePence', cs.price_pence
      ) ORDER BY cs.service_code)
      FROM cleaner_services cs
      WHERE cs.cleaner_user_id = cp.user_id AND cs.is_active
    ), '[]'::jsonb)
  FROM cleaner_profiles cp
  JOIN users u ON u.id = cp.user_id AND u.account_status = 'active'
  LEFT JOIN LATERAL (
    SELECT round(MIN(
      6371 * acos(LEAST(1, GREATEST(-1,
        sin(radians(candidate_latitude::double precision)) * sin(radians(csa.latitude::double precision)) +
        cos(radians(candidate_latitude::double precision)) * cos(radians(csa.latitude::double precision)) *
        cos(radians(csa.longitude::double precision - candidate_longitude::double precision))
      )))
    )::numeric, 2) AS distance_km
    FROM (SELECT * FROM cleaner_service_areas WHERE role <> 'excluded') csa
    WHERE csa.cleaner_user_id = cp.user_id
      AND candidate_latitude IS NOT NULL AND candidate_longitude IS NOT NULL
      AND csa.latitude IS NOT NULL AND csa.longitude IS NOT NULL
  ) area_distance ON true
  WHERE NOT EXISTS (SELECT 1 FROM cleaner_service_areas excluded WHERE excluded.cleaner_user_id=cp.user_id AND excluded.role='excluded' AND excluded.outward_postcode=tideway_private.outward_postcode(candidate_outward_postcode))
    AND cp.is_public
    AND cp.profile_completion_percent = 100
    AND (
      candidate_outward_postcode IS NULL
      OR (candidate_latitude IS NOT NULL AND candidate_longitude IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM (SELECT * FROM cleaner_service_areas WHERE role <> 'excluded') csa
        WHERE csa.cleaner_user_id = cp.user_id
          AND csa.outward_postcode = replace(upper(btrim(candidate_outward_postcode)), ' ', '')
      )
    )
    AND (
      candidate_service_code IS NULL OR EXISTS (
        SELECT 1 FROM cleaner_services cs
        WHERE cs.cleaner_user_id = cp.user_id AND cs.service_code = candidate_service_code AND cs.is_active
      )
    )
    AND (
      candidate_start_at IS NULL OR EXISTS (
        SELECT 1 FROM cleaner_availability ca
        WHERE ca.cleaner_user_id = cp.user_id AND ca.status = 'available'
          AND ca.starts_at <= candidate_start_at AND ca.ends_at >= candidate_end_at
      )
    )
    AND (candidate_minimum_rating IS NULL OR cp.average_rating >= candidate_minimum_rating)
    AND (
      candidate_maximum_price_pence IS NULL OR cp.hourly_rate_pence <= candidate_maximum_price_pence OR EXISTS (
        SELECT 1 FROM cleaner_services cs
        WHERE cs.cleaner_user_id = cp.user_id AND cs.is_active
          AND (candidate_service_code IS NULL OR cs.service_code = candidate_service_code)
          AND cs.price_pence <= candidate_maximum_price_pence
      )
    )
    AND (candidate_verified_only IS NOT TRUE OR cp.identity_check_status = 'verified')
    AND (
      candidate_maximum_distance_km IS NULL
      OR (
        area_distance.distance_km IS NOT NULL
        AND area_distance.distance_km <= LEAST(candidate_maximum_distance_km, cp.travel_radius_km)
      )
      OR (
        candidate_outward_postcode IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM (SELECT * FROM cleaner_service_areas WHERE role <> 'excluded') csa
          WHERE csa.cleaner_user_id = cp.user_id
            AND csa.outward_postcode = replace(upper(btrim(candidate_outward_postcode)), ' ', '')
            AND csa.latitude IS NULL
            AND csa.longitude IS NULL
        )
      )
    )
  ORDER BY
    CASE WHEN candidate_outward_postcode IS NULL THEN 0 WHEN EXISTS (SELECT 1 FROM cleaner_service_areas secondary WHERE secondary.cleaner_user_id=cp.user_id AND secondary.outward_postcode=tideway_private.outward_postcode(candidate_outward_postcode) AND secondary.role='secondary') THEN 1 ELSE 0 END,
    (cp.identity_check_status = 'verified') DESC,
    cp.average_rating DESC,
    cp.completed_job_count DESC,
    area_distance.distance_km ASC NULLS LAST,
    cp.hourly_rate_pence ASC NULLS LAST,
    cp.public_slug
  LIMIT LEAST(GREATEST(result_limit, 1), 50)
  OFFSET LEAST(GREATEST(result_offset, 0), 10000)
$$;
COMMIT;
