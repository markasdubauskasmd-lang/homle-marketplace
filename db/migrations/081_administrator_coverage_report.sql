-- Privacy-minimal supply-versus-demand reporting for Homle Administrators.
--
-- This deliberately reuses recommend_cleaners_for_request_v3 for every future
-- unmatched request. A dashboard count therefore means "eligible now under the
-- same rules used to match", not merely "a Cleaner profile exists nearby".
--
-- The projection is grouped at UK outward-postcode level. It returns no
-- request, property, Landlord or Cleaner identifiers; no exact postcode,
-- address or coordinates; and no room notes or media.
BEGIN;

CREATE FUNCTION tideway_private.get_administrator_coverage_report(
  window_days integer DEFAULT 30,
  require_payout_ready boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
        substring(upper(replace(property.postcode,' ','')) FROM '^([A-Z]{1,2}[0-9][A-Z0-9]?)'),
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
$$;

REVOKE ALL ON FUNCTION tideway_private.get_administrator_coverage_report(integer,boolean) FROM PUBLIC;

COMMIT;
