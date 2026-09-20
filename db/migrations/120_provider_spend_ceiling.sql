-- A daily ceiling on metered provider calls.
--
-- Room reading and walkthrough summarisation call a metered language-model
-- provider, so every request costs real money. Both already have per-client
-- limits, a per-call token ceiling, a 30-second timeout, one retry, and a
-- model-tier guard that resolves anything unrecognised to the cheaper model.
--
-- None of that is a spend cap. Per-client limits bound what one session can do;
-- they do not bound what a thousand honest sessions cost, and that is the bill
-- that actually arrives. A launch that goes unexpectedly well, a crawler with
-- valid sessions, or a client stuck in a retry loop across many devices all
-- produce a large invoice through entirely allowed traffic.
--
-- These two scopes are keyed on a constant rather than on the caller, so every
-- request on every instance lands in one bucket. That makes it a genuine
-- platform ceiling rather than a per-process guess, and it uses the same
-- atomic, already-proven limiter as everything else rather than a second
-- counting mechanism that could drift.
--
-- The numbers are a ceiling, not a target: 4000 room readings and 2000
-- summaries a day are far above anything the current pilot will produce, so an
-- honest day never reaches them. They exist to convert a runaway bill into a
-- degraded feature. Reaching one is a signal to look, not a routine event.
--
-- Hitting the ceiling is not an error shown to a customer. The browser already
-- falls back to on-device reading when the provider is unavailable, and that is
-- the path a spent budget takes too.
--
-- The scope list and policy table are restated in full because both are
-- replaced wholesale. Every other entry is unchanged from migration 119.

BEGIN;

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
  'marketplace-platform:room-reading-daily','marketplace-platform:scan-summary-daily'
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
    ('marketplace-platform:room-reading-daily',4000,86400),('marketplace-platform:scan-summary-daily',2000,86400)
  ) AS policy(scope, maximum_requests, window_seconds) WHERE policy.scope = selected_scope;
  IF maximum_requests IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='rate-limit-scope-unsupported'; END IF;
  INSERT INTO tideway_private.request_rate_limits AS existing(scope,key_hash,window_started_at,request_count,updated_at)
  VALUES(selected_scope,selected_key_hash,observed_at,1,observed_at)
  ON CONFLICT(scope,key_hash) DO UPDATE SET
    window_started_at=CASE WHEN existing.window_started_at + make_interval(secs=>window_seconds) <= observed_at THEN observed_at ELSE existing.window_started_at END,
    request_count=CASE WHEN existing.window_started_at + make_interval(secs=>window_seconds) <= observed_at THEN 1 ELSE LEAST(existing.request_count+1,maximum_requests+1) END,
    updated_at=observed_at
  RETURNING request_count,window_started_at INTO observed_count,observed_window;
  allowed := observed_count <= maximum_requests;
  retry_after_seconds := CASE WHEN allowed THEN 0 ELSE GREATEST(1,LEAST(3600,CEIL(EXTRACT(epoch FROM observed_window + make_interval(secs=>window_seconds)-observed_at))::integer)) END;
  RETURN NEXT;
END;
$$;

COMMIT;
