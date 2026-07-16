BEGIN;

CREATE TABLE tideway_private.request_rate_limits (
  scope text NOT NULL CHECK (scope IN (
    'google-start','google-callback','signup','verification-resend','verification-confirm','login',
    'password-reset-request','password-reset-confirm','marketplace-public:cleaner-directory','marketplace-public:cleaner-reviews'
  )),
  key_hash bytea NOT NULL CHECK (octet_length(key_hash) = 32),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 121),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key_hash)
);

CREATE INDEX request_rate_limits_updated_idx ON tideway_private.request_rate_limits (updated_at);

CREATE FUNCTION tideway_private.consume_rate_limit(selected_scope text, selected_key_hash bytea)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  maximum_requests integer;
  window_seconds integer;
  observed_count integer;
  observed_window timestamptz;
  observed_at timestamptz := clock_timestamp();
BEGIN
  IF selected_key_hash IS NULL OR octet_length(selected_key_hash) <> 32 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='rate-limit-key-invalid';
  END IF;

  SELECT policy.maximum_requests, policy.window_seconds
    INTO maximum_requests, window_seconds
    FROM (VALUES
      ('google-start', 20, 900),
      ('google-callback', 30, 900),
      ('signup', 5, 3600),
      ('verification-resend', 5, 3600),
      ('verification-confirm', 20, 3600),
      ('login', 10, 900),
      ('password-reset-request', 5, 3600),
      ('password-reset-confirm', 10, 3600),
      ('marketplace-public:cleaner-directory', 60, 60),
      ('marketplace-public:cleaner-reviews', 120, 60)
    ) AS policy(scope, maximum_requests, window_seconds)
    WHERE policy.scope = selected_scope;

  IF maximum_requests IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='rate-limit-scope-unsupported';
  END IF;

  INSERT INTO tideway_private.request_rate_limits AS existing
    (scope, key_hash, window_started_at, request_count, updated_at)
  VALUES (selected_scope, selected_key_hash, observed_at, 1, observed_at)
  ON CONFLICT (scope, key_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN existing.window_started_at + make_interval(secs => window_seconds) <= observed_at THEN observed_at
      ELSE existing.window_started_at
    END,
    request_count = CASE
      WHEN existing.window_started_at + make_interval(secs => window_seconds) <= observed_at THEN 1
      ELSE LEAST(existing.request_count + 1, maximum_requests + 1)
    END,
    updated_at = observed_at
  RETURNING request_count, window_started_at INTO observed_count, observed_window;

  allowed := observed_count <= maximum_requests;
  retry_after_seconds := CASE WHEN allowed THEN 0 ELSE GREATEST(1, LEAST(3600,
    CEIL(EXTRACT(epoch FROM observed_window + make_interval(secs => window_seconds) - observed_at))::integer
  )) END;
  RETURN NEXT;
END
$$;

CREATE FUNCTION tideway_private.purge_expired_rate_limits(batch_size integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE deleted_count integer;
BEGIN
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 5000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='rate-limit-purge-batch-invalid';
  END IF;
  WITH expired AS (
    SELECT scope, key_hash
    FROM tideway_private.request_rate_limits
    WHERE updated_at < clock_timestamp() - interval '2 hours'
    ORDER BY updated_at, scope, key_hash
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  DELETE FROM tideway_private.request_rate_limits stored
  USING expired
  WHERE stored.scope = expired.scope AND stored.key_hash = expired.key_hash;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$$;

REVOKE ALL ON TABLE tideway_private.request_rate_limits FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.consume_rate_limit(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.purge_expired_rate_limits(integer) FROM PUBLIC;

COMMIT;
