BEGIN;

CREATE FUNCTION tideway_private.search_cleaner_directory(
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
    FROM cleaner_service_areas csa
    WHERE csa.cleaner_user_id = cp.user_id
      AND candidate_latitude IS NOT NULL AND candidate_longitude IS NOT NULL
      AND csa.latitude IS NOT NULL AND csa.longitude IS NOT NULL
  ) area_distance ON true
  WHERE cp.is_public
    AND cp.profile_completion_percent = 100
    AND (
      candidate_outward_postcode IS NULL OR EXISTS (
        SELECT 1 FROM cleaner_service_areas csa
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
      candidate_maximum_distance_km IS NULL OR
      (area_distance.distance_km IS NOT NULL AND area_distance.distance_km <= LEAST(candidate_maximum_distance_km, cp.travel_radius_km))
    )
  ORDER BY
    (cp.identity_check_status = 'verified') DESC,
    cp.average_rating DESC,
    cp.completed_job_count DESC,
    area_distance.distance_km ASC NULLS LAST,
    cp.hourly_rate_pence ASC NULLS LAST,
    cp.public_slug
  LIMIT LEAST(GREATEST(result_limit, 1), 50)
  OFFSET LEAST(GREATEST(result_offset, 0), 10000)
$$;

REVOKE ALL ON FUNCTION tideway_private.search_cleaner_directory(text, text, timestamptz, timestamptz, numeric, integer, boolean, numeric, numeric, numeric, integer, integer) FROM PUBLIC;

COMMIT;
