-- Compute UK outward postcodes correctly.
--
-- Matching, invitation eligibility, the coverage report and the booking
-- summaries all derived a property's outward postcode with
-- `substring(upper(replace(postcode,' ','')) from '^([A-Z]{1,2}[0-9][A-Z0-9]?)')`.
-- Removing the space first lets the optional third character swallow the first
-- character of the inward code, so a single-digit district became a different
-- real district: BS1 4ST -> "BS14", M1 1AE -> "M11", E1 6AN -> "E16",
-- EH1 1YZ -> "EH11", L1 8JQ -> "L18", G1 1XW -> "G11".
--
-- The consequences were not cosmetic. `exact_postcode_area` was computed
-- against the wrong district, and with no geocoding provider configured
-- `distance_km` is NULL, so exact area membership is the only eligibility
-- signal that can be true. Every Landlord in a single-digit city-centre
-- district therefore matched zero Cleaners however many served that area,
-- while Cleaners in the unrelated neighbouring district could be invited.
-- Cleaners were also shown the wrong area label for a job.
--
-- A UK inward code is always exactly three characters (digit + two letters),
-- so the outward code is the remainder. `outward_postcode` applies that rule,
-- accepts a value that is already an outward code, and returns NULL for
-- anything else so eligibility fails closed rather than on a wrong district.
BEGIN;

CREATE FUNCTION tideway_private.outward_postcode(candidate text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $outward$
  SELECT CASE
    WHEN normalised ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' THEN left(normalised, length(normalised) - 3)
    WHEN normalised ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$' THEN normalised
    ELSE NULL
  END
  FROM (SELECT upper(regexp_replace(COALESCE(candidate, ''), '\s', '', 'g')) AS normalised) source;
$outward$;

REVOKE ALL ON FUNCTION tideway_private.outward_postcode(text) FROM PUBLIC;

-- The four live functions below are reproduced from their effective
-- definitions with exactly one change each: the broken expression above is
-- replaced by a call to the helper. No other logic, filter, grant, security
-- context or returned column is altered.

CREATE OR REPLACE FUNCTION tideway_private.get_administrator_coverage_report(window_days integer DEFAULT 30, require_payout_ready boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  result jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required';
  END IF;
  IF window_days IS NULL OR window_days NOT IN (7,30,90) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-coverage-window';
  END IF;
  IF require_payout_ready IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-payout-readiness-filter';
  END IF;

  WITH demand AS MATERIALIZED (
    SELECT
      request.id,
      COALESCE(
        tideway_private.outward_postcode(property.postcode),
        'UNKNOWN'
      ) AS outward_postcode,
      request.status,
      request.required_services,
      request.submitted_at,
      request.requested_start_at,
      CASE
        WHEN request.status='searching-for-cleaner' AND request.requested_start_at>now()
        THEN (
          SELECT count(*)::integer
          FROM tideway_private.recommend_cleaners_for_request_v3(request.id,50,require_payout_ready)
        )
        ELSE NULL
      END AS eligible_cleaner_count
    FROM cleaning_requests request
    JOIN properties property ON property.id=request.property_id
    WHERE request.submitted_at IS NOT NULL
      AND request.submitted_at>=now()-make_interval(days=>window_days)
  ),
  area_keys AS (
    SELECT DISTINCT outward_postcode FROM demand
  ),
  area_rows AS (
    SELECT
      area.outward_postcode,
      count(demand.id)::integer AS submitted_request_count,
      count(demand.id) FILTER (WHERE demand.status='searching-for-cleaner')::integer AS open_unmatched_request_count,
      count(demand.id) FILTER (
        WHERE demand.status='searching-for-cleaner' AND demand.requested_start_at<=now()
      )::integer AS expired_unmatched_request_count,
      count(demand.id) FILTER (
        WHERE demand.status='searching-for-cleaner' AND demand.requested_start_at>now()
          AND demand.eligible_cleaner_count=0
      )::integer AS zero_match_request_count,
      count(demand.id) FILTER (
        WHERE demand.status='searching-for-cleaner' AND demand.requested_start_at>now()
          AND demand.eligible_cleaner_count<=1
      )::integer AS at_risk_request_count,
      min(demand.eligible_cleaner_count) FILTER (
        WHERE demand.status='searching-for-cleaner' AND demand.requested_start_at>now()
      )::integer AS minimum_eligible_cleaner_count,
      max(demand.eligible_cleaner_count) FILTER (
        WHERE demand.status='searching-for-cleaner' AND demand.requested_start_at>now()
      )::integer AS maximum_eligible_cleaner_count,
      bool_or(demand.eligible_cleaner_count=50) FILTER (
        WHERE demand.status='searching-for-cleaner' AND demand.requested_start_at>now()
      ) IS TRUE AS eligible_count_capped,
      COALESCE(floor(extract(epoch FROM now()-min(demand.submitted_at) FILTER (
        WHERE demand.status='searching-for-cleaner'
      ))/3600),0)::integer AS oldest_unmatched_hours,
      (
        SELECT COALESCE(jsonb_agg(service_code ORDER BY service_code),'[]'::jsonb)
        FROM (
          SELECT DISTINCT unnest(service_demand.required_services) AS service_code
          FROM demand service_demand
          WHERE service_demand.outward_postcode=area.outward_postcode
        ) services
      ) AS demand_service_codes,
      (
        SELECT COALESCE(jsonb_agg(service_code ORDER BY service_code),'[]'::jsonb)
        FROM (
          SELECT DISTINCT unnest(gap_demand.required_services) AS service_code
          FROM demand gap_demand
          WHERE gap_demand.outward_postcode=area.outward_postcode
            AND gap_demand.status='searching-for-cleaner'
            AND gap_demand.requested_start_at>now()
            AND gap_demand.eligible_cleaner_count=0
        ) services
      ) AS zero_match_service_codes
    FROM area_keys area
    JOIN demand ON demand.outward_postcode=area.outward_postcode
    GROUP BY area.outward_postcode
  ),
  supply AS (
    SELECT count(*)::integer AS active_listed_cleaner_count
    FROM cleaner_profiles profile
    JOIN users account ON account.id=profile.user_id
    WHERE account.account_status='active'
      AND profile.is_public IS TRUE
      AND profile.profile_completion_percent=100
      AND profile.current_availability_status<>'unavailable'
      AND (
        NOT require_payout_ready
        OR EXISTS (
          SELECT 1
          FROM tideway_private.cleaner_payout_accounts payout
          WHERE payout.cleaner_user_id=profile.user_id
            AND payout.provider='stripe'
            AND payout.details_submitted IS TRUE
            AND payout.payouts_enabled IS TRUE
        )
      )
  ),
  summary AS (
    SELECT
      count(demand.id)::integer AS submitted_request_count,
      count(demand.id) FILTER (WHERE demand.status='searching-for-cleaner')::integer AS open_unmatched_request_count,
      count(demand.id) FILTER (
        WHERE demand.status='searching-for-cleaner' AND demand.requested_start_at<=now()
      )::integer AS expired_unmatched_request_count,
      count(demand.id) FILTER (
        WHERE demand.status='searching-for-cleaner' AND demand.requested_start_at>now()
          AND demand.eligible_cleaner_count=0
      )::integer AS zero_match_request_count,
      count(demand.id) FILTER (
        WHERE demand.status='searching-for-cleaner' AND demand.requested_start_at>now()
          AND demand.eligible_cleaner_count<=1
      )::integer AS at_risk_request_count,
      count(DISTINCT demand.outward_postcode)::integer AS area_count,
      COALESCE(floor(extract(epoch FROM now()-min(demand.submitted_at) FILTER (
        WHERE demand.status='searching-for-cleaner'
      ))/3600),0)::integer AS oldest_unmatched_hours
    FROM demand
  )
  SELECT jsonb_build_object(
    'windowDays',window_days,
    'generatedAt',now(),
    'matchingMode',CASE WHEN require_payout_ready THEN 'payout-ready' ELSE 'marketplace' END,
    'privacyScope','Outward-postcode aggregates only. No account, request, property or Cleaner identity is included.',
    'summary',jsonb_build_object(
      'submittedRequestCount',summary.submitted_request_count,
      'openUnmatchedRequestCount',summary.open_unmatched_request_count,
      'expiredUnmatchedRequestCount',summary.expired_unmatched_request_count,
      'zeroMatchRequestCount',summary.zero_match_request_count,
      'atRiskRequestCount',summary.at_risk_request_count,
      'areaCount',summary.area_count,
      'gapAreaCount',(
        SELECT count(*)::integer FROM area_rows
        WHERE zero_match_request_count>0 OR expired_unmatched_request_count>0
      ),
      'activeListedCleanerCount',supply.active_listed_cleaner_count,
      'oldestUnmatchedHours',summary.oldest_unmatched_hours
    ),
    'areas',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'outwardPostcode',area.outward_postcode,
        'submittedRequestCount',area.submitted_request_count,
        'openUnmatchedRequestCount',area.open_unmatched_request_count,
        'expiredUnmatchedRequestCount',area.expired_unmatched_request_count,
        'zeroMatchRequestCount',area.zero_match_request_count,
        'atRiskRequestCount',area.at_risk_request_count,
        'minimumEligibleCleanerCount',area.minimum_eligible_cleaner_count,
        'maximumEligibleCleanerCount',area.maximum_eligible_cleaner_count,
        'eligibleCountCapped',area.eligible_count_capped,
        'oldestUnmatchedHours',area.oldest_unmatched_hours,
        'demandServiceCodes',area.demand_service_codes,
        'zeroMatchServiceCodes',area.zero_match_service_codes
      ) ORDER BY
        (area.zero_match_request_count>0 OR area.expired_unmatched_request_count>0) DESC,
        area.open_unmatched_request_count DESC,
        area.submitted_request_count DESC,
        area.outward_postcode
      )
      FROM area_rows area
    ),'[]'::jsonb)
  ) INTO result
  FROM summary CROSS JOIN supply;

  RETURN result;
END;
$function$
;

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
  IF NOT EXISTS (
    SELECT 1 FROM cleaner_service_areas area
    WHERE area.cleaner_user_id=target_cleaner_id AND area.outward_postcode=request_outward_postcode
  ) AND NOT EXISTS (
    SELECT 1 FROM cleaner_service_areas area
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

CREATE OR REPLACE FUNCTION tideway_private.list_my_booking_summaries(maximum_results integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  summaries jsonb;
BEGIN
  -- participant-response-deadline-v1
  -- booking-client-conversation-names-v1
  -- booking-summary-verification-markers-v1
  IF actor_id IS NULL OR NOT (tideway_private.has_role('cleaner') OR tideway_private.has_role('landlord')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'booking-participant-required';
  END IF;
  IF maximum_results IS NULL OR maximum_results < 1 OR maximum_results > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid-booking-summary-limit';
  END IF;

  SELECT COALESCE(jsonb_agg(item.summary ORDER BY item.sort_rank, item.future_start ASC NULLS LAST, item.past_start DESC NULLS LAST, item.booking_id), '[]'::jsonb)
  INTO summaries
  FROM (
    SELECT booking.id AS booking_id,
      CASE
        WHEN booking.status = 'pending-cleaner-acceptance' THEN 0
        WHEN booking.status IN ('cleaner-en-route','cleaner-arrived','cleaning-in-progress') THEN 1
        WHEN booking.status IN ('confirmed','awaiting-review','disputed') THEN 2
        ELSE 3
      END AS sort_rank,
      CASE WHEN booking.scheduled_start_at >= now() THEN booking.scheduled_start_at END AS future_start,
      CASE WHEN booking.scheduled_start_at < now() THEN booking.scheduled_start_at END AS past_start,
      jsonb_build_object(
        'bookingId', booking.id,
        'participantRole', CASE WHEN booking.landlord_user_id = actor_id THEN 'landlord' ELSE 'cleaner' END,
        'status', booking.status,
        'scheduledStartAt', booking.scheduled_start_at,
        'scheduledEndAt', booking.scheduled_end_at,
        'responseDeadline', CASE WHEN booking.status = 'pending-cleaner-acceptance' THEN booking.cleaner_response_deadline END,
        'pricePence', CASE WHEN booking.landlord_user_id = actor_id THEN booking.customer_price_pence ELSE booking.cleaner_pay_pence END,
        'pricePerspective', CASE WHEN booking.landlord_user_id = actor_id THEN 'customer-total' ELSE 'cleaner-pay' END,
        'propertyName', CASE
          WHEN booking.landlord_user_id = actor_id OR booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review') THEN property.name
          ELSE 'Cleaning property'
        END,
        'propertyArea', tideway_private.outward_postcode(property.postcode),
        'cleaningType', COALESCE(booking.scope_snapshot->>'cleaningType', 'Cleaning'),
        'taskCount', (SELECT count(*) FROM cleaning_tasks task WHERE task.booking_id = booking.id),
        'counterpartyName', CASE
          WHEN booking.landlord_user_id = actor_id THEN cleaner_user.display_name
          WHEN booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review') THEN COALESCE(
            NULLIF(btrim(landlord_profile.organisation_name), ''),
            NULLIF(split_part(btrim(landlord_user.display_name), ' ', 1), ''),
            'Client'
          )
          ELSE 'Landlord'
        END,
        'canRespond', booking.cleaner_user_id = actor_id AND booking.status = 'pending-cleaner-acceptance' AND booking.cleaner_response_deadline > now(),
        'activeJobAvailable', booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review','completed','disputed'),
        'respondedAt', booking.responded_at,
        'confirmedAt', booking.confirmed_at
      ) || CASE WHEN booking.landlord_user_id=actor_id THEN jsonb_build_object(
        'paymentAuthorizationReady', booking.status = 'confirmed' AND COALESCE(payment_state.authorization_ready,false),
        'paymentStepAvailable', booking.status = 'confirmed'
          AND booking.scheduled_start_at > now() AND booking.scheduled_start_at <= now()+interval '5 days'
          AND NOT COALESCE(payment_state.authorization_ready,false),
        'paymentStepOpensAt', CASE
          WHEN booking.status = 'confirmed' AND booking.scheduled_start_at > now()+interval '5 days'
          THEN booking.scheduled_start_at-interval '5 days'
        END
      ) ELSE '{}'::jsonb END AS summary
    FROM bookings booking
    JOIN properties property ON property.id = booking.property_id
    JOIN users cleaner_user ON cleaner_user.id = booking.cleaner_user_id
    JOIN users landlord_user ON landlord_user.id = booking.landlord_user_id
    LEFT JOIN landlord_profiles landlord_profile ON landlord_profile.user_id = booking.landlord_user_id
    LEFT JOIN LATERAL (
      SELECT true AS authorization_ready
      FROM booking_payments payment
      WHERE payment.booking_id=booking.id
        AND payment.landlord_user_id=booking.landlord_user_id
        AND payment.cleaner_user_id=booking.cleaner_user_id
        AND payment.provider='stripe'
        AND payment.provider_payment_id IS NOT NULL
        AND payment.status='authorized'
        AND payment.currency='gbp'
        AND payment.amount_pence=booking.customer_price_pence
        AND payment.terms_fingerprint=booking.terms_fingerprint
        AND payment.authorized_at BETWEEN booking.scheduled_start_at-interval '5 days' AND now()+interval '5 minutes'
      LIMIT 1
    ) payment_state ON booking.landlord_user_id=actor_id AND booking.status='confirmed'
    WHERE booking.landlord_user_id = actor_id OR booking.cleaner_user_id = actor_id
    ORDER BY sort_rank, future_start ASC NULLS LAST, past_start DESC NULLS LAST, booking.id
    LIMIT maximum_results
  ) item;

  RETURN summaries;
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
$function$
;
COMMIT;
