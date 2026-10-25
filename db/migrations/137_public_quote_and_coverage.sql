-- A visitor can see a price and whether Homle covers them before making an
-- account.
--
-- The price list and the quote rules were already "public-shaped": the scanner
-- runs the same pricing engine in the browser. What stopped a visitor was that
-- the database only answered a signed-in user. These functions answer without
-- one, and say nothing that is not already the customer's side of the
-- contract:
--
--   * get_public_pricing_config  - the customer price list (what the browser
--     engine already needs).
--   * get_public_pricing_economics - the floors the server checks a quote
--     against before it calls it priceable. For the server only: the HTTP layer
--     never returns it, exactly as with the signed-in quote route.
--   * public_cleaner_coverage - a yes/no for an outward postcode, from the same
--     eligibility the matcher uses. It returns no Cleaner identity, count or
--     location; the only data out is a boolean and the outward code the
--     visitor typed.
--   * record_launch_interest - a postcode and email kept for launch news, only
--     with explicit consent. Nothing sends to it: email is off, and switching
--     any send on is the founder's decision.
--
-- Four new anonymous rate-limit scopes bound each one per client. The scope
-- list and the policy table are restated in full because both are replaced
-- wholesale; every other entry is unchanged from migration 127.

BEGIN;

CREATE FUNCTION tideway_private.get_public_pricing_config(target_config_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT configuration.config
  FROM pricing_configurations configuration
  WHERE configuration.config_id = COALESCE(NULLIF(trim(target_config_id), ''), 'default')
    AND configuration.retired_at IS NULL;
$$;

CREATE FUNCTION tideway_private.get_public_pricing_economics(target_config_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT configuration.economics
  FROM pricing_configurations configuration
  WHERE configuration.config_id = COALESCE(NULLIF(trim(target_config_id), ''), 'default')
    AND configuration.retired_at IS NULL;
$$;

-- "Do you have a cleaner near me?" answered from the matcher's own rules:
-- an active account, a published and complete profile, not marked
-- unavailable, a primary or secondary service area in that outward postcode,
-- at least one future available window, and -- when payments are on -- a
-- Cleaner who can actually be paid. Exact outward-code match, so it can say
-- "no" to a neighbour a radius would have reached; it never says "yes" falsely.
CREATE FUNCTION tideway_private.public_cleaner_coverage(supplied_postcode text, require_payout_ready boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  outward text := tideway_private.outward_postcode(supplied_postcode);
BEGIN
  IF outward IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-postcode'; END IF;
  RETURN jsonb_build_object(
    'area', outward,
    'covered', EXISTS (
      SELECT 1
      FROM cleaner_service_areas area
      JOIN cleaner_profiles profile ON profile.user_id = area.cleaner_user_id
      JOIN users account ON account.id = profile.user_id AND account.account_status = 'active'
      WHERE area.outward_postcode = outward
        AND area.role IN ('primary','secondary')
        AND profile.is_public
        AND profile.profile_completion_percent = 100
        AND profile.current_availability_status <> 'unavailable'
        AND EXISTS (
          SELECT 1 FROM cleaner_availability availability
          WHERE availability.cleaner_user_id = profile.user_id
            AND availability.status = 'available'
            AND availability.ends_at > now()
        )
        -- The criteria of cleaner_payout_ready_for_paid_booking (068), inlined
        -- because that function requires a Landlord caller and a visitor has
        -- none. Only the yes/no leaves this function.
        AND (NOT COALESCE(require_payout_ready, true) OR EXISTS (
          SELECT 1 FROM tideway_private.cleaner_payout_accounts payout
          WHERE payout.cleaner_user_id = profile.user_id
            AND payout.provider = 'stripe'
            AND payout.details_submitted IS TRUE
            AND payout.payouts_enabled IS TRUE
        ))
    )
  );
END;
$$;

CREATE TABLE tideway_private.launch_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outward_postcode text NOT NULL CHECK (outward_postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$'),
  -- Stored lower-cased by record_launch_interest, so uniqueness is case-blind
  -- without citext (whose CHECK does not survive a dump and restore verbatim).
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  consent_text_version text NOT NULL CHECK (consent_text_version ~ '^[a-z0-9-]{1,40}$'),
  consented_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, outward_postcode)
);
ALTER TABLE tideway_private.launch_interest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tideway_private.launch_interest FROM PUBLIC;

-- Idempotent and silent about duplicates, so it cannot be used to discover
-- whether an address has already registered.
CREATE FUNCTION tideway_private.record_launch_interest(supplied_postcode text, supplied_email text, consent_version text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  outward text := tideway_private.outward_postcode(supplied_postcode);
  address text := lower(trim(COALESCE(supplied_email, '')));
BEGIN
  IF outward IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-postcode'; END IF;
  IF char_length(address) NOT BETWEEN 3 AND 254 OR address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-email';
  END IF;
  IF consent_version IS NULL OR consent_version !~ '^[a-z0-9-]{1,40}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='consent-required';
  END IF;
  INSERT INTO tideway_private.launch_interest (outward_postcode, email, consent_text_version)
    VALUES (outward, address, consent_version)
    ON CONFLICT (email, outward_postcode) DO UPDATE SET consent_text_version = EXCLUDED.consent_text_version, consented_at = now();
  RETURN true;
END;
$$;

-- What the founder needs before any launch email: how many, where. No
-- addresses leave the database through this.
CREATE FUNCTION tideway_private.get_administrator_launch_interest()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('area', area, 'count', total) ORDER BY total DESC, area)
    FROM (SELECT outward_postcode AS area, count(*) AS total FROM tideway_private.launch_interest GROUP BY outward_postcode) grouped
  ), '[]'::jsonb);
END;
$$;

ALTER TABLE tideway_private.request_rate_limits DROP CONSTRAINT request_rate_limits_scope_check;
ALTER TABLE tideway_private.request_rate_limits ADD CONSTRAINT request_rate_limits_scope_check CHECK (scope IN (
  'google-start','google-callback','apple-start','apple-callback','facebook-start','facebook-callback','facebook-verification-confirm',
  'facebook-data-deletion','facebook-data-deletion-status',
  'signup','verification-resend','verification-confirm','login','session-recovery',
  'password-reset-request','password-reset-confirm',
  'marketplace-public:cleaner-directory','marketplace-public:cleaner-profile','marketplace-public:cleaner-reviews',
  'marketplace-landlord:scan-summary','marketplace-landlord:room-reading','marketplace-landlord:scan-preview',
  'marketplace-cleaner:address-lookup',
  'marketplace-landlord:cleaning-request','marketplace-landlord:booking',
  'marketplace-platform:room-reading-daily','marketplace-platform:scan-summary-daily',
  'marketplace-public:funnel-events',
  'marketplace-public:pricing','marketplace-public:quote','marketplace-public:coverage','marketplace-public:launch-interest'
));

CREATE OR REPLACE FUNCTION tideway_private.consume_rate_limit(selected_scope text, selected_key_hash bytea)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE maximum_requests integer; window_seconds integer; observed_count integer; observed_window timestamptz; observed_at timestamptz := clock_timestamp();
BEGIN
  IF selected_key_hash IS NULL OR octet_length(selected_key_hash) <> 32 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='rate-limit-key-invalid'; END IF;
  SELECT policy.maximum_requests, policy.window_seconds INTO maximum_requests, window_seconds FROM (VALUES
    ('google-start',20,900),('google-callback',30,900),('apple-start',20,900),('apple-callback',30,900),
    ('facebook-start',20,900),('facebook-callback',30,900),('facebook-verification-confirm',20,3600),
    ('facebook-data-deletion',20,3600),('facebook-data-deletion-status',120,3600),
    ('signup',5,3600),('verification-resend',5,3600),('verification-confirm',20,3600),('login',10,900),('session-recovery',30,900),
    ('password-reset-request',5,3600),('password-reset-confirm',10,3600),
    ('marketplace-public:cleaner-directory',60,60),('marketplace-public:cleaner-profile',120,60),('marketplace-public:cleaner-reviews',120,60),
    ('marketplace-landlord:scan-summary',30,900),('marketplace-landlord:room-reading',40,900),
    ('marketplace-landlord:scan-preview',120,900),('marketplace-cleaner:address-lookup',40,900),
    ('marketplace-landlord:cleaning-request',20,900),('marketplace-landlord:booking',20,900),
    ('marketplace-platform:room-reading-daily',4000,86400),('marketplace-platform:scan-summary-daily',2000,86400),
    ('marketplace-public:funnel-events',60,900),
    -- A visitor adjusting rooms re-quotes on every tap, so the quote allowance
    -- matches the signed-in preview's pace; the price list is fetched once.
    ('marketplace-public:pricing',60,60),('marketplace-public:quote',120,900),
    ('marketplace-public:coverage',30,900),('marketplace-public:launch-interest',5,3600)
  ) AS policy(scope, maximum_requests, window_seconds) WHERE policy.scope = selected_scope;
  IF maximum_requests IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='rate-limit-scope-unsupported'; END IF;
  INSERT INTO tideway_private.request_rate_limits AS existing(scope,key_hash,window_started_at,request_count,updated_at)
  VALUES(selected_scope,selected_key_hash,observed_at,1,observed_at)
  ON CONFLICT(scope,key_hash) DO UPDATE SET
    window_started_at=CASE WHEN existing.window_started_at + make_interval(secs=>window_seconds) <= observed_at THEN observed_at ELSE existing.window_started_at END,
    request_count=CASE WHEN existing.window_started_at + make_interval(secs=>window_seconds) <= observed_at THEN 1 ELSE LEAST(existing.request_count+1,maximum_requests+1) END,
    updated_at=observed_at
  RETURNING existing.request_count, existing.window_started_at INTO observed_count, observed_window;
  IF observed_count <= maximum_requests THEN
    RETURN QUERY SELECT true, 0;
  ELSE
    RETURN QUERY SELECT false, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (observed_window + make_interval(secs=>window_seconds)) - observed_at))::integer);
  END IF;
END $$;

REVOKE ALL ON FUNCTION tideway_private.get_public_pricing_config(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_public_pricing_economics(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.public_cleaner_coverage(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_launch_interest(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_administrator_launch_interest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.get_public_pricing_config(text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_public_pricing_economics(text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.public_cleaner_coverage(text, boolean) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_launch_interest(text, text, text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_administrator_launch_interest() TO tideway_app;

COMMIT;
