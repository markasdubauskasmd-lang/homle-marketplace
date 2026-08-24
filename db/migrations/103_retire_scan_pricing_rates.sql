-- Retires the second and third places prices used to live.
--
-- Migration 075 gave the scan estimate its own rate table — an hourly rate, a
-- per-room charge, condition multipliers, a square-metre rate and a minimum
-- charge — with its own administrator screen. Migration 078 added a third
-- place, a scan-only add-on catalogue. The price list that actually charged a
-- customer was a fourth thing entirely, edited somewhere else, and nothing ever
-- compared them. Both shipped £28.00/hour and a £45.00 minimum, so an operator
-- raising the rate on one screen moved half the product and silently left the
-- other half behind.
--
-- public/pricing-config.js is the single owner now. scan-pricing.mjs computes
-- no money of its own: it asks quoteRooms() for the figure and adds only the
-- range that expresses how much of the scan a customer has not yet confirmed.
-- Those three range fields are all this table still needs.
--
-- WHY THE COLUMNS GO RATHER THAN STAYING HARMLESSLY UNUSED
--
-- An operator-editable rate that changes nothing is worse than no rate at all.
-- Somebody eventually raises it, sees no effect, and either concludes the
-- product is broken or keeps raising it until something else gives. A field on
-- an administrator form is a promise that it does something.
--
-- WHAT IS LOST, AND WHY THAT IS ACCEPTABLE
--
-- scan_pricing_rulesets is append-only so an old estimate can be explained by
-- the rates that produced it. Dropping these columns loses that for estimates
-- given before the unification. They were never charged: an estimate is not a
-- booking, every booking's own total is frozen on its row alongside the
-- pricing_config_version that produced it, and that record is untouched here.
--
-- The add-on catalogue loses nothing at all. No client ever sent add-on codes to
-- the scan estimate, so it has only ever held whatever an operator typed into a
-- form that fed nothing.

BEGIN;

/* ── The scan-only add-on catalogue ─────────────────────────────────────── */

DROP FUNCTION IF EXISTS tideway_private.upsert_scan_pricing_addon(text, text, integer, integer, boolean);
DROP FUNCTION IF EXISTS tideway_private.list_scan_pricing_addons();
DROP TABLE IF EXISTS scan_pricing_addons;

/* ── The scan-only rate table ───────────────────────────────────────────── */

-- The readers are rebuilt FIRST, against the columns that will survive, so that
-- the DROP below cannot leave a function referencing a column that is gone.
-- Same names, same signatures, same privileges: nothing outside this file needs
-- to know the shape changed.

CREATE OR REPLACE FUNCTION tideway_private.get_active_scan_pricing_ruleset(target_ruleset_id text)
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
    'baseRangeBasisPoints', ruleset_record.base_range_basis_points,
    'unresolvedRangeBasisPointsEach', ruleset_record.unresolved_range_basis_points_each,
    'maximumRangeBasisPoints', ruleset_record.maximum_range_basis_points,
    'createdAt', ruleset_record.created_at,
    'changeReason', ruleset_record.change_reason);
END;
$$;

-- Publishes a new version and retires the previous one, in one transaction.
-- Never an UPDATE: an estimate carries the ruleset version that produced it.
CREATE OR REPLACE FUNCTION tideway_private.publish_scan_pricing_ruleset(
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
    -- Retired keys in `supplied_rules` are ignored rather than refused, so an
    -- older client that still sends an hourly rate publishes successfully and
    -- simply has no effect on any price.
    INSERT INTO scan_pricing_rulesets (
      ruleset_id, version, base_range_basis_points, unresolved_range_basis_points_each,
      maximum_range_basis_points, created_by, change_reason)
    VALUES (
      resolved_id, next_version,
      (supplied_rules->>'baseRangeBasisPoints')::integer,
      (supplied_rules->>'unresolvedRangeBasisPointsEach')::integer,
      (supplied_rules->>'maximumRangeBasisPoints')::integer,
      actor_id, trim(supplied_reason))
      RETURNING * INTO published;
  EXCEPTION
    -- A malformed number and an out-of-range value both mean the same thing to
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

-- The history, so a change can be traced to a person and a reason.
CREATE OR REPLACE FUNCTION tideway_private.list_scan_pricing_rulesets(target_ruleset_id text, supplied_limit integer)
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
      'baseRangeBasisPoints', ruleset.base_range_basis_points,
      'unresolvedRangeBasisPointsEach', ruleset.unresolved_range_basis_points_each,
      'maximumRangeBasisPoints', ruleset.maximum_range_basis_points,
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

ALTER TABLE scan_pricing_rulesets
  DROP COLUMN minimum_charge_pence,
  DROP COLUMN hourly_rate_pence,
  DROP COLUMN room_base_pence,
  DROP COLUMN level_1_basis_points,
  DROP COLUMN level_2_basis_points,
  DROP COLUMN level_3_basis_points,
  DROP COLUMN level_4_basis_points,
  DROP COLUMN per_square_metre_pence;

REVOKE ALL ON FUNCTION tideway_private.get_active_scan_pricing_ruleset(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.publish_scan_pricing_ruleset(text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.list_scan_pricing_rulesets(text, integer) FROM PUBLIC;

COMMIT;
