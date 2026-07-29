-- Shadow observations, so the scan estimate can earn its way out of shadow mode.
--
-- Phase 6 shipped an estimate that influences nothing, on the explicit condition
-- that its error against reviewed quotes be measured before anything depends on
-- it. The benchmark dataset measures object detection, condition agreement and
-- complexity level; it cannot measure price error, because a reviewed total is a
-- human's judgement of a real job and inventing one would measure this project's
-- arithmetic against its own guess.
--
-- This is where the real figure comes from. Every estimate produced against a
-- request is recorded; the agreed customer price already exists on the booking.
-- The error is the difference, and it accrues from ordinary trading rather than
-- from a labelling exercise.
--
-- Design rules:
--
--   * **Append-only, and no reviewed total is stored here.** The agreed price
--     lives on `bookings` and is joined at read time. Copying it in would create
--     a second version of the truth that could drift from the booking a customer
--     actually agreed to.
--
--   * **Bounded by ruleset and model version.** An estimate is only comparable
--     to another produced by the same rules, so the version pair is part of the
--     identity rather than metadata beside it.
--
--   * **Administrator-only aggregate.** The individual rows carry a request id,
--     so the reporting function returns statistics rather than rows: an error
--     distribution discloses nothing, a list of requests and prices does.
--
-- Nothing here changes a price. It measures one.
BEGIN;

CREATE TABLE scan_estimate_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_request_id uuid NOT NULL REFERENCES cleaning_requests(id) ON DELETE CASCADE,
  ruleset_id text NOT NULL CHECK (char_length(ruleset_id) BETWEEN 1 AND 40),
  ruleset_version integer NOT NULL CHECK (ruleset_version BETWEEN 1 AND 100000),
  complexity_model_version integer NOT NULL CHECK (complexity_model_version BETWEEN 1 AND 100000),
  -- 0 means the scan was not assessed. Recorded rather than omitted, because how
  -- often the estimate declines to answer is itself a number worth watching.
  complexity_level smallint NOT NULL CHECK (complexity_level BETWEEN 0 AND 5),
  labour_minutes integer NOT NULL CHECK (labour_minutes BETWEEN 0 AND 10000),
  priceable boolean NOT NULL,
  -- Zero when the estimate refused. A refusal is a real answer and must be
  -- distinguishable from a £0 estimate, which is what `priceable` is for.
  total_pence integer NOT NULL CHECK (total_pence BETWEEN 0 AND 10000000),
  low_pence integer NOT NULL CHECK (low_pence BETWEEN 0 AND 10000000),
  high_pence integer NOT NULL CHECK (high_pence BETWEEN 0 AND 10000000),
  refusal_code text NOT NULL DEFAULT '' CHECK (char_length(refusal_code) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (low_pence <= total_pence AND total_pence <= high_pence),
  -- A refusal carries no price; a priceable estimate carries one. Without this
  -- a refusal could be recorded with a total and skew every aggregate.
  CHECK ((priceable AND total_pence > 0 AND refusal_code = '') OR (NOT priceable AND total_pence = 0 AND refusal_code <> '')),
  -- One observation per request per rules version. Reading a scan repeatedly
  -- must not fill this table with identical rows and weight one indecisive
  -- customer as heavily as a hundred bookings.
  UNIQUE (cleaning_request_id, ruleset_id, ruleset_version, complexity_model_version)
);

CREATE INDEX scan_estimate_observations_version_idx
  ON scan_estimate_observations(ruleset_id, ruleset_version, complexity_model_version, created_at);

ALTER TABLE scan_estimate_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY scan_estimate_observations_administrator ON scan_estimate_observations
  USING (tideway_private.has_role('administrator'));

-- Records one observation, idempotently.
--
-- Callable by the owning Landlord, because the estimate is produced while they
-- read their own scan and there is no worker to do it for them. They cannot read
-- the table back, and the values are computed server-side from their stored
-- scan, so this is not a channel for writing arbitrary numbers.
CREATE FUNCTION tideway_private.record_scan_estimate_observation(
  target_request_id uuid,
  supplied_ruleset_id text,
  supplied_ruleset_version integer,
  supplied_model_version integer,
  supplied_level smallint,
  supplied_labour_minutes integer,
  supplied_priceable boolean,
  supplied_total_pence integer,
  supplied_low_pence integer,
  supplied_high_pence integer,
  supplied_refusal_code text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); owns boolean;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM cleaning_requests request
    WHERE request.id = target_request_id
      AND (request.landlord_user_id = actor_id OR tideway_private.has_role('administrator'))
  ) INTO owns;
  IF NOT owns THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='request-not-found'; END IF;

  INSERT INTO scan_estimate_observations (
    cleaning_request_id, ruleset_id, ruleset_version, complexity_model_version, complexity_level,
    labour_minutes, priceable, total_pence, low_pence, high_pence, refusal_code)
  VALUES (
    target_request_id,
    COALESCE(NULLIF(trim(supplied_ruleset_id), ''), 'default'),
    supplied_ruleset_version, supplied_model_version, supplied_level,
    GREATEST(0, LEAST(COALESCE(supplied_labour_minutes, 0), 10000)),
    COALESCE(supplied_priceable, false),
    GREATEST(0, LEAST(COALESCE(supplied_total_pence, 0), 10000000)),
    GREATEST(0, LEAST(COALESCE(supplied_low_pence, 0), 10000000)),
    GREATEST(0, LEAST(COALESCE(supplied_high_pence, 0), 10000000)),
    left(COALESCE(supplied_refusal_code, ''), 60))
  ON CONFLICT (cleaning_request_id, ruleset_id, ruleset_version, complexity_model_version) DO NOTHING;
  RETURN true;
EXCEPTION
  -- A malformed observation must never fail the read that produced it. This
  -- measures the estimate; it is not the estimate.
  WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
    RETURN false;
END;
$$;

-- The shadow error, as statistics.
--
-- Returns aggregates rather than rows on purpose. An error distribution
-- discloses nothing about anybody; a list of request ids and agreed prices is a
-- list of what customers paid.
--
-- The comparison joins the agreed customer price from the booking rather than a
-- stored copy, so it can never disagree with what the customer actually agreed.
CREATE FUNCTION tideway_private.scan_estimate_shadow_report(
  target_ruleset_id text, supplied_model_version integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  resolved_id text := COALESCE(NULLIF(trim(target_ruleset_id), ''), 'default');
  report jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;

  WITH compared AS (
    SELECT
      observation.ruleset_version,
      observation.complexity_model_version,
      observation.total_pence,
      observation.low_pence,
      observation.high_pence,
      booking.customer_price_pence AS agreed_pence,
      -- Signed, so systematic over- or under-estimation is visible rather than
      -- averaging itself away against the opposite error.
      (observation.total_pence - booking.customer_price_pence)::numeric
        / booking.customer_price_pence AS relative_error
    FROM scan_estimate_observations observation
    JOIN bookings booking ON booking.cleaning_request_id = observation.cleaning_request_id
    WHERE observation.ruleset_id = resolved_id
      AND observation.priceable
      AND booking.customer_price_pence > 0
      -- Only bookings a Cleaner actually accepted. A pending invitation's price
      -- is a proposal, not a reviewed figure.
      AND booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review','completed')
      AND (supplied_model_version IS NULL OR observation.complexity_model_version = supplied_model_version)
  )
  SELECT jsonb_build_object(
    'rulesetId', resolved_id,
    'modelVersion', supplied_model_version,
    'comparedBookings', count(*),
    -- Median rather than mean: one absurd outlier should not decide whether the
    -- estimate is trusted with real money.
    'medianRelativeError', CASE WHEN count(*) > 0
      THEN round(percentile_cont(0.5) WITHIN GROUP (ORDER BY relative_error)::numeric, 4) END,
    'medianAbsoluteError', CASE WHEN count(*) > 0
      THEN round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(relative_error))::numeric, 4) END,
    'within15Percent', CASE WHEN count(*) > 0
      THEN round((count(*) FILTER (WHERE abs(relative_error) <= 0.15))::numeric / count(*), 4) END,
    'withinQuotedRange', CASE WHEN count(*) > 0
      THEN round((count(*) FILTER (WHERE agreed_pence BETWEEN low_pence AND high_pence))::numeric / count(*), 4) END,
    -- Reported so a promising figure from nine bookings is not mistaken for
    -- evidence. NULL above means no comparison was possible at all, which is
    -- different from an error of zero.
    'sufficient', count(*) >= 50)
    INTO report FROM compared;

  RETURN report;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.record_scan_estimate_observation(uuid,text,integer,integer,smallint,integer,boolean,integer,integer,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.scan_estimate_shadow_report(text,integer) FROM PUBLIC;

COMMIT;
