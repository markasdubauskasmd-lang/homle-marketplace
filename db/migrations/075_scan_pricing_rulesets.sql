-- Operator-configurable pricing rules for scan-derived estimates.
--
-- Phase 6 of docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md. The brief requires that
-- authorised staff can change rates, weighting and minimum charges without a
-- code change, and that no generative model is ever the pricing authority.
-- Both follow from putting the numbers in a row an Administrator edits and an
-- arithmetic module reads.
--
-- Rules that shape this table:
--
--   * **Append-only.** A ruleset is never edited in place. Changing a rate
--     writes a new version and retires the old one, so an estimate produced
--     last month can still be recomputed from exactly the rules that produced
--     it. An UPDATE would silently rewrite the past.
--
--   * **Administrator only.** These numbers decide what customers are charged.
--     Neither a Landlord nor a Cleaner may read or write them, and the runtime
--     role has no direct table privilege at all.
--
--   * **Bounded.** Every rate carries a CHECK. A typo in a web form should fail
--     loudly rather than price a thousand jobs at ten times the intended rate.
--
-- This table does not change what any existing booking costs. booking-workflow
-- quote() remains the only thing that prices a real booking, and it does not
-- read this table.
BEGIN;

CREATE TABLE scan_pricing_rulesets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id text NOT NULL CHECK (char_length(ruleset_id) BETWEEN 1 AND 40),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 100000),
  minimum_charge_pence integer NOT NULL CHECK (minimum_charge_pence BETWEEN 500 AND 100000),
  hourly_rate_pence integer NOT NULL CHECK (hourly_rate_pence BETWEEN 500 AND 30000),
  room_base_pence integer NOT NULL CHECK (room_base_pence BETWEEN 0 AND 20000),
  -- Level 5 is absent by construction: specialist review is not priceable, and
  -- an operator who could set a multiplier on it could put a number on "a
  -- person needs to look at this first".
  level_1_basis_points integer NOT NULL CHECK (level_1_basis_points BETWEEN 5000 AND 30000),
  level_2_basis_points integer NOT NULL CHECK (level_2_basis_points BETWEEN 5000 AND 30000),
  level_3_basis_points integer NOT NULL CHECK (level_3_basis_points BETWEEN 5000 AND 30000),
  level_4_basis_points integer NOT NULL CHECK (level_4_basis_points BETWEEN 5000 AND 30000),
  per_square_metre_pence integer NOT NULL CHECK (per_square_metre_pence BETWEEN 0 AND 2000),
  base_range_basis_points integer NOT NULL CHECK (base_range_basis_points BETWEEN 0 AND 5000),
  unresolved_range_basis_points_each integer NOT NULL CHECK (unresolved_range_basis_points_each BETWEEN 0 AND 2000),
  maximum_range_basis_points integer NOT NULL CHECK (maximum_range_basis_points BETWEEN 500 AND 9000),
  -- Who changed the price of everything, when, and why. A rate change with no
  -- stated reason is the one an operator cannot explain six months later.
  created_by uuid NOT NULL REFERENCES users(id),
  change_reason text NOT NULL CHECK (char_length(change_reason) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CHECK (retired_at IS NULL OR retired_at >= created_at),
  UNIQUE (ruleset_id, version)
);

-- Exactly one live version per ruleset, enforced by the database rather than by
-- convention. Two live rulesets would price two identical scans differently
-- depending on which row a query happened to reach first.
CREATE UNIQUE INDEX scan_pricing_rulesets_one_active_idx
  ON scan_pricing_rulesets(ruleset_id) WHERE retired_at IS NULL;

ALTER TABLE scan_pricing_rulesets ENABLE ROW LEVEL SECURITY;
CREATE POLICY scan_pricing_rulesets_administrator ON scan_pricing_rulesets USING (tideway_private.has_role('administrator'));

-- The live rules, for the estimate to read.
--
-- Readable by any authenticated account on purpose: a customer is entitled to
-- see the rates their estimate was built from, and the row contains no personal
-- data. Writing is a different matter entirely.
CREATE FUNCTION tideway_private.get_active_scan_pricing_ruleset(target_ruleset_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ruleset_record scan_pricing_rulesets%ROWTYPE;
BEGIN
  IF tideway_private.current_user_id() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required';
  END IF;
  SELECT * INTO ruleset_record FROM scan_pricing_rulesets
    WHERE ruleset_id = COALESCE(NULLIF(trim(target_ruleset_id), ''), 'default') AND retired_at IS NULL;
  -- No configured ruleset is not an error. The estimate falls back to the
  -- shipped defaults, which is why a deployment that has never opened the
  -- administrator page still produces the same numbers as one that has.
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'rulesetId', ruleset_record.ruleset_id,
    'version', ruleset_record.version,
    'minimumChargePence', ruleset_record.minimum_charge_pence,
    'hourlyRatePence', ruleset_record.hourly_rate_pence,
    'roomBasePence', ruleset_record.room_base_pence,
    'levelMultiplierBasisPoints', jsonb_build_object(
      '1', ruleset_record.level_1_basis_points, '2', ruleset_record.level_2_basis_points,
      '3', ruleset_record.level_3_basis_points, '4', ruleset_record.level_4_basis_points, '5', 0),
    'perSquareMetrePence', ruleset_record.per_square_metre_pence,
    'baseRangeBasisPoints', ruleset_record.base_range_basis_points,
    'unresolvedRangeBasisPointsEach', ruleset_record.unresolved_range_basis_points_each,
    'maximumRangeBasisPoints', ruleset_record.maximum_range_basis_points,
    'createdAt', ruleset_record.created_at,
    'changeReason', ruleset_record.change_reason);
END;
$$;

-- Publishes a new version and retires the previous one, in one transaction.
--
-- Never an UPDATE. An estimate carries the ruleset version that produced it, and
-- editing a row in place would make that reference point at different numbers
-- than the ones actually used — which is precisely the audit trail this exists
-- to provide.
CREATE FUNCTION tideway_private.publish_scan_pricing_ruleset(
  target_ruleset_id text, supplied_rules jsonb, supplied_reason text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  resolved_id text := COALESCE(NULLIF(trim(target_ruleset_id), ''), 'default');
  next_version integer;
  published scan_pricing_rulesets%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF jsonb_typeof(supplied_rules) <> 'object' OR char_length(trim(COALESCE(supplied_reason,''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-pricing-ruleset';
  END IF;

  SELECT COALESCE(max(version), 0) + 1 INTO next_version FROM scan_pricing_rulesets WHERE ruleset_id = resolved_id;
  UPDATE scan_pricing_rulesets SET retired_at = now() WHERE ruleset_id = resolved_id AND retired_at IS NULL;

  BEGIN
    INSERT INTO scan_pricing_rulesets (
      ruleset_id, version, minimum_charge_pence, hourly_rate_pence, room_base_pence,
      level_1_basis_points, level_2_basis_points, level_3_basis_points, level_4_basis_points,
      per_square_metre_pence, base_range_basis_points, unresolved_range_basis_points_each,
      maximum_range_basis_points, created_by, change_reason)
    VALUES (
      resolved_id, next_version,
      (supplied_rules->>'minimumChargePence')::integer,
      (supplied_rules->>'hourlyRatePence')::integer,
      (supplied_rules->>'roomBasePence')::integer,
      (supplied_rules->'levelMultiplierBasisPoints'->>'1')::integer,
      (supplied_rules->'levelMultiplierBasisPoints'->>'2')::integer,
      (supplied_rules->'levelMultiplierBasisPoints'->>'3')::integer,
      (supplied_rules->'levelMultiplierBasisPoints'->>'4')::integer,
      (supplied_rules->>'perSquareMetrePence')::integer,
      (supplied_rules->>'baseRangeBasisPoints')::integer,
      (supplied_rules->>'unresolvedRangeBasisPointsEach')::integer,
      (supplied_rules->>'maximumRangeBasisPoints')::integer,
      actor_id, trim(supplied_reason))
      RETURNING * INTO published;
  EXCEPTION
    -- A malformed number and an out-of-range rate both mean the same thing to
    -- an operator staring at a form: the value was refused. Reporting the raw
    -- constraint name would leak column layout for no benefit.
    WHEN invalid_text_representation OR not_null_violation OR check_violation THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-pricing-ruleset';
  END;

  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (actor_id, 'scan-pricing-ruleset-published', 'scan_pricing_ruleset', published.id,
      jsonb_build_object('rulesetId', published.ruleset_id, 'version', published.version, 'reason', published.change_reason));

  RETURN tideway_private.get_active_scan_pricing_ruleset(resolved_id);
END;
$$;

-- The history, so a rate change can be traced to a person and a reason.
CREATE FUNCTION tideway_private.list_scan_pricing_rulesets(target_ruleset_id text, supplied_limit integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE resolved_id text := COALESCE(NULLIF(trim(target_ruleset_id), ''), 'default'); history jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry->>'version' DESC), '[]'::jsonb) INTO history FROM (
    SELECT jsonb_build_object(
      'version', ruleset.version,
      'minimumChargePence', ruleset.minimum_charge_pence,
      'hourlyRatePence', ruleset.hourly_rate_pence,
      'roomBasePence', ruleset.room_base_pence,
      'perSquareMetrePence', ruleset.per_square_metre_pence,
      'changeReason', ruleset.change_reason,
      'createdAt', ruleset.created_at,
      'retiredAt', ruleset.retired_at,
      'active', ruleset.retired_at IS NULL) AS entry
    FROM scan_pricing_rulesets ruleset WHERE ruleset.ruleset_id = resolved_id
    ORDER BY ruleset.version DESC
    LIMIT GREATEST(1, LEAST(COALESCE(supplied_limit, 20), 100))
  ) AS rows;
  RETURN jsonb_build_object('rulesetId', resolved_id, 'versions', history);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_active_scan_pricing_ruleset(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.publish_scan_pricing_ruleset(text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.list_scan_pricing_rulesets(text,integer) FROM PUBLIC;

COMMIT;
