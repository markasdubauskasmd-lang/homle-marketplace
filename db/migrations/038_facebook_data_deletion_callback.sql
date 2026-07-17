BEGIN;

CREATE TABLE tideway_private.facebook_data_deletion_requests (
  id uuid PRIMARY KEY,
  provider_subject_hash bytea NOT NULL UNIQUE CHECK (octet_length(provider_subject_hash) = 32),
  confirmation_code_hash bytea NOT NULL UNIQUE CHECK (octet_length(confirmation_code_hash) = 32),
  privacy_request_id uuid REFERENCES privacy_requests(id) ON DELETE SET NULL,
  fallback_status privacy_request_status NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE tideway_private.request_rate_limits DROP CONSTRAINT request_rate_limits_scope_check;
ALTER TABLE tideway_private.request_rate_limits ADD CONSTRAINT request_rate_limits_scope_check CHECK (scope IN (
  'google-start','google-callback','facebook-start','facebook-callback','facebook-verification-confirm',
  'facebook-data-deletion','facebook-data-deletion-status',
  'signup','verification-resend','verification-confirm','login','password-reset-request','password-reset-confirm',
  'marketplace-public:cleaner-directory','marketplace-public:cleaner-reviews'
));

CREATE OR REPLACE FUNCTION tideway_private.consume_rate_limit(selected_scope text, selected_key_hash bytea)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE maximum_requests integer; window_seconds integer; observed_count integer; observed_window timestamptz; observed_at timestamptz := clock_timestamp();
BEGIN
  IF selected_key_hash IS NULL OR octet_length(selected_key_hash) <> 32 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='rate-limit-key-invalid'; END IF;
  SELECT policy.maximum_requests, policy.window_seconds INTO maximum_requests, window_seconds FROM (VALUES
    ('google-start',20,900),('google-callback',30,900),('facebook-start',20,900),('facebook-callback',30,900),('facebook-verification-confirm',20,3600),
    ('facebook-data-deletion',20,3600),('facebook-data-deletion-status',120,3600),
    ('signup',5,3600),('verification-resend',5,3600),('verification-confirm',20,3600),('login',10,900),
    ('password-reset-request',5,3600),('password-reset-confirm',10,3600),
    ('marketplace-public:cleaner-directory',60,60),('marketplace-public:cleaner-reviews',120,60)
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

CREATE FUNCTION tideway_private.request_facebook_data_deletion(
  supplied_request_id uuid,
  supplied_subject text,
  supplied_subject_hash bytea,
  supplied_confirmation_code_hash bytea
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  selected_record tideway_private.facebook_data_deletion_requests%ROWTYPE;
  selected_user_id uuid;
  selected_privacy_request privacy_requests%ROWTYPE;
  selected_status privacy_request_status;
  selected_completed_at timestamptz;
BEGIN
  IF supplied_request_id IS NULL
    OR supplied_subject IS NULL OR supplied_subject !~ '^[0-9]{1,32}$'
    OR supplied_subject_hash IS NULL OR octet_length(supplied_subject_hash) <> 32
    OR supplied_confirmation_code_hash IS NULL OR octet_length(supplied_confirmation_code_hash) <> 32
  THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-facebook-deletion-request'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(encode(supplied_subject_hash, 'hex'), 38));
  SELECT identity.user_id INTO selected_user_id
  FROM authentication_identities identity
  JOIN users account ON account.id = identity.user_id
  WHERE identity.provider = 'facebook'
    AND identity.provider_subject = supplied_subject
    AND account.account_status <> 'deleted'
  LIMIT 1;

  SELECT item.* INTO selected_record
  FROM tideway_private.facebook_data_deletion_requests item
  WHERE item.provider_subject_hash = supplied_subject_hash;

  IF FOUND THEN
    -- A subject that had no Homle account when Meta first called may later create one.
    -- Reusing the opaque confirmation is safe, but the later request must enter the real queue.
    IF selected_record.privacy_request_id IS NULL AND selected_user_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(selected_user_id::text || ':deletion', 35));
      SELECT request.* INTO selected_privacy_request
      FROM privacy_requests request
      WHERE request.user_id = selected_user_id
        AND request.request_type = 'deletion'
        AND request.status IN ('requested', 'verifying', 'processing')
      ORDER BY request.created_at DESC
      LIMIT 1;
      IF NOT FOUND THEN
        INSERT INTO privacy_requests(id, user_id, request_type)
        VALUES(gen_random_uuid(), selected_user_id, 'deletion')
        RETURNING * INTO selected_privacy_request;
        INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
        VALUES(selected_user_id, 'privacy-request.created', 'privacy_request', selected_privacy_request.id::text,
          jsonb_build_object('requestType', 'deletion', 'source', 'facebook-data-deletion-callback'));
      END IF;
      UPDATE tideway_private.facebook_data_deletion_requests
      SET privacy_request_id = selected_privacy_request.id, fallback_status = 'requested', completed_at = NULL
      WHERE id = selected_record.id
      RETURNING * INTO selected_record;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM tideway_private.facebook_data_deletion_requests item WHERE item.id = supplied_request_id) THEN
      RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='facebook-deletion-request-id-reused';
    END IF;

    IF selected_user_id IS NULL THEN
      INSERT INTO tideway_private.facebook_data_deletion_requests(
        id, provider_subject_hash, confirmation_code_hash, fallback_status, completed_at
      ) VALUES (
        supplied_request_id, supplied_subject_hash, supplied_confirmation_code_hash, 'completed', now()
      ) RETURNING * INTO selected_record;
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended(selected_user_id::text || ':deletion', 35));
      SELECT request.* INTO selected_privacy_request
      FROM privacy_requests request
      WHERE request.user_id = selected_user_id
        AND request.request_type = 'deletion'
        AND request.status IN ('requested', 'verifying', 'processing')
      ORDER BY request.created_at DESC
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO privacy_requests(id, user_id, request_type)
        VALUES(gen_random_uuid(), selected_user_id, 'deletion')
        RETURNING * INTO selected_privacy_request;
        INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
        VALUES(selected_user_id, 'privacy-request.created', 'privacy_request', selected_privacy_request.id::text,
          jsonb_build_object('requestType', 'deletion', 'source', 'facebook-data-deletion-callback'));
      END IF;

      INSERT INTO tideway_private.facebook_data_deletion_requests(
        id, provider_subject_hash, confirmation_code_hash, privacy_request_id, fallback_status
      ) VALUES (
        supplied_request_id, supplied_subject_hash, supplied_confirmation_code_hash, selected_privacy_request.id, 'requested'
      ) RETURNING * INTO selected_record;
    END IF;
  END IF;

  selected_status := selected_record.fallback_status;
  selected_completed_at := selected_record.completed_at;
  IF selected_record.privacy_request_id IS NOT NULL THEN
    SELECT request.status, request.completed_at INTO selected_status, selected_completed_at
    FROM privacy_requests request WHERE request.id = selected_record.privacy_request_id;
  END IF;

  RETURN jsonb_build_object(
    'status', selected_status,
    'requestedAt', selected_record.requested_at,
    'completedAt', selected_completed_at
  );
END;
$$;

CREATE FUNCTION tideway_private.get_facebook_data_deletion_status(supplied_confirmation_code_hash bytea)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'status', COALESCE(request.status, callback.fallback_status),
    'requestedAt', callback.requested_at,
    'completedAt', COALESCE(request.completed_at, callback.completed_at)
  )
  FROM tideway_private.facebook_data_deletion_requests callback
  LEFT JOIN privacy_requests request ON request.id = callback.privacy_request_id
  WHERE callback.confirmation_code_hash = supplied_confirmation_code_hash
    AND octet_length(supplied_confirmation_code_hash) = 32;
$$;

REVOKE ALL ON TABLE tideway_private.facebook_data_deletion_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.request_facebook_data_deletion(uuid,text,bytea,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_facebook_data_deletion_status(bytea) FROM PUBLIC;

COMMIT;
