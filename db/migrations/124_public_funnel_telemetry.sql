-- Measure the funnel, without being able to follow anybody through it.
--
-- The product had no analytics of any kind. Nothing recorded how many people
-- reach the landing page, how many of them press a call to action, how many
-- sign up, and how many of those ever reach a confirmed booking. The stated
-- growth channel is letting agents and landlords with several properties, and
-- there was no way to tell whether that audience arrives, converts, or leaves.
--
-- DECISIONS.md D11 settled how: first-party and cookieless, not a vendor tag.
-- The content security policy is `script-src 'self'` and `connect-src 'self'`,
-- so a third-party tag is blocked without weakening it; an analytics cookie
-- needs PECR consent, which means a banner; and the published cookie policy
-- states plainly that Homle sets no analytics cookie. A first-party aggregate
-- satisfies all three and keeps that published promise true.
--
-- This is a sibling of `tideway_private.scan_telemetry_hourly` (migration 101)
-- rather than an extension of it: that table's vocabulary and administrator
-- page are scanner-specific. The privacy shape is copied exactly, because it
-- is the part that matters.
--
-- What this table CANNOT hold, by construction rather than by convention:
--   * no account, session, request, property or booking id -- a counter tied
--     to an identity is not a counter, it is a profile;
--   * no visitor identifier of any kind, first- or third-party. There is
--     nothing here that could be joined to make one, which is exactly why no
--     consent banner is required;
--   * no IP address, user agent, referrer, campaign tag or URL. The only
--     record of "where" is one name from the fixed `surface` list below;
--   * no free text: every column is a name from a list or a count;
--   * no timestamp finer than an hour, and rows are deleted after 90 days on
--     every write.
--
-- The moment any of that changes, this stops being consent-free and the cookie
-- policy has to change before the code does.

BEGIN;

CREATE TABLE tideway_private.public_funnel_hourly (
  observed_hour timestamptz NOT NULL,
  metric text NOT NULL,
  -- Which pitch the visitor was reading, not who they are. This is the single
  -- dimension that answers the question the business actually has: does the
  -- letting-agent channel convert, or only the one-off customer?
  audience text NOT NULL DEFAULT '',
  -- Which page it happened on, from a fixed list. Never a URL, never a path
  -- carrying an id, never a referrer.
  surface text NOT NULL DEFAULT '',
  event_count bigint NOT NULL CHECK (event_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observed_hour, metric, audience, surface),
  CONSTRAINT public_funnel_metric_allowed CHECK (metric IN (
    'funnel.landing.viewed','funnel.landing.cta',
    'funnel.signup.started','funnel.signup.completed',
    'funnel.property.added','funnel.scan.completed','funnel.price.shown',
    'funnel.slot.chosen','funnel.payment.authorised'
  )),
  CONSTRAINT public_funnel_audience_allowed CHECK (audience IN ('','customer','landlord','agent','cleaner','unknown')),
  CONSTRAINT public_funnel_surface_allowed CHECK (surface IN ('','landing','for-landlords','pricing','signup','app'))
);

ALTER TABLE tideway_private.public_funnel_hourly ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION tideway_private.record_public_funnel_batch(payload jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE recorded integer;
BEGIN
  IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) < 1 OR jsonb_array_length(payload) > 40 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-funnel-batch';
  END IF;
  -- The vocabulary is re-checked here and not only in the application, because
  -- this is the boundary that decides what can be stored. A future caller that
  -- forgets to validate gets an error, not a free-text column.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) entry
    WHERE jsonb_typeof(entry) <> 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(entry) key WHERE key NOT IN ('metric','dimensions','count'))
      OR jsonb_typeof(COALESCE(entry->'dimensions','{}'::jsonb)) <> 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(entry->'dimensions','{}'::jsonb)) key WHERE key NOT IN ('audience','surface'))
      OR COALESCE(entry->>'metric','') NOT IN (
        'funnel.landing.viewed','funnel.landing.cta',
        'funnel.signup.started','funnel.signup.completed',
        'funnel.property.added','funnel.scan.completed','funnel.price.shown',
        'funnel.slot.chosen','funnel.payment.authorised')
      OR COALESCE(entry->'dimensions'->>'audience','') NOT IN ('','customer','landlord','agent','cleaner','unknown')
      OR COALESCE(entry->'dimensions'->>'surface','') NOT IN ('','landing','for-landlords','pricing','signup','app')
      OR COALESCE(entry->>'count','') !~ '^[1-9][0-9]{0,3}$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-funnel-event';
  END IF;
  -- The numeric cast is kept in its own statement so PostgreSQL can never
  -- evaluate it against non-numeric JSON while reordering the predicates above.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) entry WHERE (entry->>'count')::numeric > 1000
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-funnel-count';
  END IF;

  -- Summed before the insert, not after. One page can honestly send the same
  -- metric and labels twice -- two calls to action pressed on one visit is the
  -- ordinary case -- and `ON CONFLICT DO UPDATE` refuses to touch the same row
  -- twice in one statement. Without this fold, a perfectly normal batch raises
  -- `cardinality_violation` and the whole visit goes uncounted.
  WITH submitted AS (
    SELECT entry->>'metric' AS metric,
      COALESCE(entry->'dimensions'->>'audience','') AS audience,
      COALESCE(entry->'dimensions'->>'surface','') AS surface,
      (entry->>'count')::integer AS event_count
    FROM jsonb_array_elements(payload) entry
  ), folded AS (
    SELECT metric, audience, surface, sum(event_count)::bigint AS event_count
    FROM submitted GROUP BY metric, audience, surface
  ), stored AS (
    INSERT INTO tideway_private.public_funnel_hourly (observed_hour, metric, audience, surface, event_count)
    SELECT date_trunc('hour', now()), metric, audience, surface, event_count FROM folded
    ON CONFLICT (observed_hour, metric, audience, surface)
    DO UPDATE SET event_count = tideway_private.public_funnel_hourly.event_count + EXCLUDED.event_count, updated_at = now()
    RETURNING 1
  )
  -- The number of events stored, not the number of rows touched. A caller
  -- comparing what it sent against what was kept wants the former; the row
  -- count would report 1 for a page that sent twelve of the same event.
  -- `stored` goes unread here and still runs: PostgreSQL executes a
  -- data-modifying CTE exactly once and to completion regardless of whether
  -- the primary query reads its output.
  SELECT COALESCE(sum(event_count), 0)::integer INTO recorded FROM folded;

  DELETE FROM tideway_private.public_funnel_hourly
  WHERE observed_hour < date_trunc('hour', now() - interval '90 days');
  RETURN recorded;
END $$;

CREATE FUNCTION tideway_private.get_administrator_public_funnel(window_days integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF window_days NOT IN (7,30,90) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-funnel-window';
  END IF;

  WITH aggregate AS (
    SELECT metric, audience, surface, sum(event_count)::bigint AS total
    FROM tideway_private.public_funnel_hourly
    WHERE observed_hour >= date_trunc('hour', now() - make_interval(days => window_days))
    GROUP BY metric, audience, surface
  ), series AS (
    SELECT metric
      || CASE WHEN audience <> '' OR surface <> '' THEN '|'
        || concat_ws(',', NULLIF('audience='||audience,'audience='), NULLIF('surface='||surface,'surface='))
        ELSE '' END AS series_key,
      total
    FROM aggregate
  )
  SELECT jsonb_build_object(
    'windowDays', window_days,
    'counters', COALESCE(jsonb_object_agg(series_key, total), '{}'::jsonb),
    'totals', COALESCE((
      SELECT jsonb_object_agg(metric, total) FROM (
        SELECT metric, sum(event_count)::bigint AS total
        FROM tideway_private.public_funnel_hourly
        WHERE observed_hour >= date_trunc('hour', now() - make_interval(days => window_days))
        GROUP BY metric
      ) summed
    ), '{}'::jsonb)
  ) INTO result FROM series;
  RETURN COALESCE(result, jsonb_build_object('windowDays', window_days, 'counters', '{}'::jsonb, 'totals', '{}'::jsonb));
END $$;

-- The visitor beacon is anonymous by design, so it needs its own client
-- ceiling: nothing else stands between one machine and this table. The
-- allowance is generous for an honest page (a landing view plus a few CTA
-- presses, across a handful of pages in a sitting) and still caps a loop.
--
-- The scope list and the policy table are restated in full because both are
-- replaced wholesale. Every other entry is unchanged from migration 120.
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
  'marketplace-public:funnel-events'
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
    ('marketplace-public:funnel-events',60,900)
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

REVOKE ALL ON TABLE tideway_private.public_funnel_hourly FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_public_funnel_batch(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_administrator_public_funnel(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.record_public_funnel_batch(jsonb) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_administrator_public_funnel(integer) TO tideway_app;

COMMIT;
