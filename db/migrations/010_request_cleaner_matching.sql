BEGIN;

CREATE FUNCTION tideway_private.recommend_cleaners_for_request(target_request_id uuid, result_limit integer DEFAULT 25)
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  request_outward_postcode := substring(upper(replace(request_property.postcode, ' ', '')) from '^([A-Z]{1,2}[0-9][A-Z0-9]?)');

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
        CASE WHEN coverage.exact_postcode_area THEN 25::numeric
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
          SELECT 1 FROM cleaner_service_areas exact_area
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
      FROM cleaner_service_areas area WHERE area.cleaner_user_id = profile.user_id
    ) coverage
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS previous_completed_jobs FROM bookings previous
      WHERE previous.landlord_user_id = request_record.landlord_user_id
        AND previous.cleaner_user_id = profile.user_id AND previous.status = 'completed'
    ) relationships
    WHERE profile.is_public
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
$$;

REVOKE ALL ON FUNCTION tideway_private.recommend_cleaners_for_request(uuid, integer) FROM PUBLIC;

COMMIT;
