BEGIN;

CREATE UNIQUE INDEX privacy_requests_one_active_type_per_user_idx
ON privacy_requests(user_id, request_type)
WHERE status IN ('requested', 'verifying', 'processing');

CREATE FUNCTION tideway_private.request_my_privacy_action(
  supplied_request_id uuid,
  supplied_request_type text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  selected_type privacy_request_type;
  selected_request privacy_requests%ROWTYPE;
  was_created boolean := false;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not-authenticated'; END IF;
  IF supplied_request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-privacy-request'; END IF;
  BEGIN
    selected_type := btrim(supplied_request_type)::privacy_request_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-privacy-request';
  END;
  IF selected_type IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-privacy-request'; END IF;

  PERFORM 1 FROM users account
  WHERE account.id = actor_id AND account.account_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='account-not-active'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(actor_id::text || ':' || selected_type::text, 35));

  SELECT request.* INTO selected_request
  FROM privacy_requests request
  WHERE request.id = supplied_request_id AND request.user_id = actor_id AND request.request_type = selected_type;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM privacy_requests request WHERE request.id = supplied_request_id) THEN
      RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='privacy-request-id-reused';
    END IF;
    SELECT request.* INTO selected_request
    FROM privacy_requests request
    WHERE request.user_id = actor_id
      AND request.request_type = selected_type
      AND request.status IN ('requested', 'verifying', 'processing')
    ORDER BY request.created_at DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO privacy_requests(id, user_id, request_type)
    VALUES(supplied_request_id, actor_id, selected_type)
    RETURNING * INTO selected_request;
    was_created := true;
    INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
    VALUES(actor_id, 'privacy-request.created', 'privacy_request', selected_request.id::text,
      jsonb_build_object('requestType', selected_type::text));
  END IF;

  RETURN jsonb_build_object(
    'requestId', selected_request.id,
    'requestType', selected_request.request_type,
    'status', selected_request.status,
    'createdAt', selected_request.created_at,
    'verifiedAt', selected_request.verified_at,
    'completedAt', selected_request.completed_at,
    'created', was_created
  );
END;
$$;

CREATE FUNCTION tideway_private.get_my_privacy_requests()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'requestId', request.id,
    'requestType', request.request_type,
    'status', request.status,
    'createdAt', request.created_at,
    'verifiedAt', request.verified_at,
    'completedAt', request.completed_at
  ) ORDER BY request.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT item.* FROM privacy_requests item
    WHERE item.user_id = tideway_private.current_user_id()
    ORDER BY item.created_at DESC
    LIMIT 20
  ) request;
$$;

REVOKE ALL ON FUNCTION tideway_private.request_my_privacy_action(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_my_privacy_requests() FROM PUBLIC;

COMMIT;
