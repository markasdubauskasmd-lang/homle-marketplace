-- The price list, owned by an operator rather than by a deployment.
--
-- What a customer pays and what a cleaner earns now come from
-- public/pricing-config.js, whose shipped values are a complete working price
-- list. This table lets an administrator replace them without a deployment, and
-- keeps every previous version so a booking made last month can still be
-- explained by the prices that produced it.
--
-- Rules that shape this table, and why:
--
--   * **Append-only.** Publishing a change writes a new version and retires the
--     previous one. A booking stores the config version it was priced at; an
--     UPDATE would make that reference point at numbers that were never used,
--     which is precisely the audit trail this exists to provide.
--
--   * **The price list and the economics are separate columns.** They are two
--     different kinds of secret. `config` is what a customer is quoted and is
--     served to their browser so the scanner can total instantly. `economics`
--     is the cleaner's share, the processor's cut and the margin floors — it is
--     administrator-only and must never reach a customer-facing response. Two
--     columns rather than one object makes it possible for a reader to fetch
--     one without the other, which is exactly what the public endpoint does.
--
--   * **JSONB, validated in the application.** The configuration is a nested
--     object of rooms, specialist tasks and add-ons that grows as the business
--     does. Column-per-rate would mean a migration every time a room type is
--     added. normalizedPricingConfig() and normalizedPricingEconomics() are
--     strict — they refuse rather than clamp — and this table stores the result
--     of that validation, never raw operator input.
--
--   * **Bounded anyway.** The scalars that could do the most damage carry CHECKs
--     regardless of the application layer, because "the app validates it" stops
--     being true the moment a second writer exists.
--
-- This does not change what any in-flight booking costs. Bookings priced before
-- a change keep the total frozen on their own record.

BEGIN;

CREATE TABLE pricing_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id text NOT NULL CHECK (char_length(config_id) BETWEEN 1 AND 40),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 100000),

  -- Customer-facing. Safe to serve; carries no commercial position.
  config jsonb NOT NULL,
  -- Administrator-only. The cleaner's share and the floors that decide whether
  -- Homle will sell at a price at all.
  economics jsonb NOT NULL,

  -- Denormalised out of the JSON so the values most likely to be fat-fingered
  -- are bounded by the database as well as by the application, and so an
  -- operator can be shown a version history without parsing every blob.
  customer_hourly_rate_pence integer NOT NULL CHECK (customer_hourly_rate_pence BETWEEN 500 AND 30000),
  additional_item_pence integer NOT NULL CHECK (additional_item_pence BETWEEN 0 AND 10000),
  included_items_per_room integer NOT NULL CHECK (included_items_per_room BETWEEN 0 AND 50),
  minimum_booking_minutes integer NOT NULL CHECK (minimum_booking_minutes BETWEEN 0 AND 1440),
  cleaner_share_basis_points integer NOT NULL CHECK (cleaner_share_basis_points BETWEEN 3000 AND 9500),

  created_by uuid NOT NULL REFERENCES users(id),
  -- A price change with no stated reason is the one nobody can explain six
  -- months later, when the question is why margin moved.
  change_reason text NOT NULL CHECK (char_length(change_reason) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CHECK (retired_at IS NULL OR retired_at >= created_at),
  UNIQUE (config_id, version)
);

-- Exactly one live version, enforced by the database rather than by convention.
-- Two live rows would price two identical scans differently depending on which
-- one a query happened to reach first.
CREATE UNIQUE INDEX pricing_configurations_one_active_idx
  ON pricing_configurations(config_id) WHERE retired_at IS NULL;

ALTER TABLE pricing_configurations ENABLE ROW LEVEL SECURITY;
CREATE POLICY pricing_configurations_administrator ON pricing_configurations
  USING (tideway_private.has_role('administrator'));

-- The live price list, without the economics.
--
-- Readable by any authenticated account on purpose: these are the prices the
-- customer is about to be quoted, and the scanner needs them to total without a
-- round trip per tap. The economics column is deliberately not returned here —
-- that separation is the whole reason it is a separate column.
CREATE FUNCTION tideway_private.get_active_pricing_config(target_config_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE configuration_record pricing_configurations%ROWTYPE;
BEGIN
  IF tideway_private.current_user_id() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required';
  END IF;
  SELECT * INTO configuration_record FROM pricing_configurations
    WHERE config_id = COALESCE(NULLIF(trim(target_config_id), ''), 'default') AND retired_at IS NULL;
  -- Nothing configured is not an error. The runtime falls back to the shipped
  -- defaults, which is why a deployment that has never opened the pricing page
  -- quotes the same numbers as one that has.
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'config', configuration_record.config,
    'version', configuration_record.version,
    'createdAt', configuration_record.created_at,
    'changeReason', configuration_record.change_reason);
END;
$$;

-- The live price list WITH the economics. Administrator only.
CREATE FUNCTION tideway_private.get_active_pricing_economics(target_config_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE configuration_record pricing_configurations%ROWTYPE;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  SELECT * INTO configuration_record FROM pricing_configurations
    WHERE config_id = COALESCE(NULLIF(trim(target_config_id), ''), 'default') AND retired_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'config', configuration_record.config,
    'economics', configuration_record.economics,
    'version', configuration_record.version,
    'createdAt', configuration_record.created_at,
    'changeReason', configuration_record.change_reason);
END;
$$;

-- The economics alone, for the server to price a booking against.
--
-- SECURITY DEFINER and role-free by design: the runtime must be able to check
-- whether a quote clears its margin floor on behalf of a *customer*, who is not
-- an administrator and must never see the answer. Returning it to the runtime
-- is not the same as returning it to the browser, and the HTTP layer is what
-- keeps that boundary.
CREATE FUNCTION tideway_private.get_pricing_economics_for_runtime(target_config_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE configuration_record pricing_configurations%ROWTYPE;
BEGIN
  IF tideway_private.current_user_id() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required';
  END IF;
  SELECT * INTO configuration_record FROM pricing_configurations
    WHERE config_id = COALESCE(NULLIF(trim(target_config_id), ''), 'default') AND retired_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN configuration_record.economics;
END;
$$;

-- Publishes a new version and retires the previous one, in one transaction.
CREATE FUNCTION tideway_private.publish_pricing_configuration(
  target_config_id text, supplied_config jsonb, supplied_economics jsonb, supplied_reason text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  resolved_id text := COALESCE(NULLIF(trim(target_config_id), ''), 'default');
  next_version integer;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF jsonb_typeof(supplied_config) <> 'object' OR jsonb_typeof(supplied_economics) <> 'object'
     OR char_length(trim(COALESCE(supplied_reason, ''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-pricing-configuration';
  END IF;

  SELECT COALESCE(max(version), 0) + 1 INTO next_version FROM pricing_configurations WHERE config_id = resolved_id;
  UPDATE pricing_configurations SET retired_at = now() WHERE config_id = resolved_id AND retired_at IS NULL;

  INSERT INTO pricing_configurations (
    config_id, version, config, economics,
    customer_hourly_rate_pence, additional_item_pence, included_items_per_room,
    minimum_booking_minutes, cleaner_share_basis_points,
    created_by, change_reason
  ) VALUES (
    resolved_id, next_version, supplied_config, supplied_economics,
    (supplied_config->>'customerHourlyRatePence')::integer,
    (supplied_config->>'additionalItemPence')::integer,
    (supplied_config->>'includedItemsPerRoom')::integer,
    (supplied_config->>'minimumBookingMinutes')::integer,
    (supplied_economics->>'cleanerShareBasisPoints')::integer,
    actor_id, trim(supplied_reason)
  );

  RETURN tideway_private.get_active_pricing_economics(resolved_id);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_active_pricing_config(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_active_pricing_economics(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_pricing_economics_for_runtime(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.publish_pricing_configuration(text, jsonb, jsonb, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tideway_app') THEN
    -- The runtime reaches these only through the functions above. It has no
    -- direct privilege on the table, so a compromised query cannot read the
    -- economics of every version or rewrite a retired one.
    EXECUTE 'GRANT EXECUTE ON FUNCTION tideway_private.get_active_pricing_config(text) TO tideway_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION tideway_private.get_active_pricing_economics(text) TO tideway_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION tideway_private.get_pricing_economics_for_runtime(text) TO tideway_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION tideway_private.publish_pricing_configuration(text, jsonb, jsonb, text) TO tideway_app';
  END IF;
END $$;

COMMIT;
