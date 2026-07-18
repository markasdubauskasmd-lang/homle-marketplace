BEGIN;

CREATE FUNCTION tideway_private.get_public_cleaner_profile(selected_cleaner_id uuid)
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
    profile.user_id,
    profile.public_slug,
    account.display_name,
    COALESCE(profile.profile_photo_url, account.avatar_url),
    profile.biography,
    profile.hourly_rate_pence,
    profile.fixed_price_options,
    profile.travel_radius_km,
    profile.years_experience,
    profile.languages,
    profile.equipment_supplied,
    profile.products_supplied,
    profile.residential_preference,
    profile.commercial_preference,
    profile.average_rating,
    profile.review_count,
    profile.completed_job_count,
    profile.profile_completion_percent,
    profile.current_availability_status,
    profile.verified_badges,
    profile.identity_check_status = 'verified',
    NULL::numeric,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'serviceCode', service.service_code,
        'pricingModel', service.pricing_model,
        'pricePence', service.price_pence
      ) ORDER BY service.service_code)
      FROM cleaner_services service
      WHERE service.cleaner_user_id = profile.user_id AND service.is_active
    ), '[]'::jsonb)
  FROM cleaner_profiles profile
  JOIN users account ON account.id = profile.user_id AND account.account_status = 'active'
  WHERE profile.user_id = selected_cleaner_id
    AND profile.is_public
    AND profile.profile_completion_percent = 100
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION tideway_private.get_public_cleaner_profile(uuid) FROM PUBLIC;

COMMIT;
