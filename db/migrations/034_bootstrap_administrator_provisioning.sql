BEGIN;

CREATE UNIQUE INDEX audit_logs_administrator_bootstrap_request_idx
ON audit_logs ((metadata->>'requestId'))
WHERE action = 'administrator.bootstrap.provisioned';

CREATE FUNCTION tideway_private.provision_bootstrap_administrator(
  supplied_email citext,
  supplied_request_id uuid,
  supplied_operator_reference text,
  supplied_reason text
)
RETURNS TABLE (
  provisioning_status text,
  target_user_id uuid,
  revoked_session_count integer,
  provisioned_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  normalized_email citext := lower(btrim(supplied_email::text))::citext;
  normalized_operator_reference text := btrim(supplied_operator_reference);
  normalized_reason text := btrim(supplied_reason);
  owner_name text;
  target_account users%ROWTYPE;
  prior_event audit_logs%ROWTYPE;
  revoked_count integer := 0;
  created_time timestamptz;
BEGIN
  SELECT pg_get_userbyid(relation.relowner) INTO owner_name
  FROM pg_class relation
  WHERE relation.oid = 'public.users'::regclass;

  IF owner_name IS NULL OR session_user::text <> owner_name THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='migration-owner-required';
  END IF;
  IF supplied_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='administrator-bootstrap-request-id-required';
  END IF;
  IF normalized_email IS NULL OR length(normalized_email::text) NOT BETWEEN 3 AND 254 OR position('@' IN normalized_email::text) <= 1 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='administrator-bootstrap-account-ineligible';
  END IF;
  IF normalized_operator_reference IS NULL OR length(normalized_operator_reference) NOT BETWEEN 6 AND 120
     OR normalized_operator_reference ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='administrator-bootstrap-operator-reference-invalid';
  END IF;
  IF normalized_reason IS NULL OR length(normalized_reason) NOT BETWEEN 20 AND 500
     OR normalized_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='administrator-bootstrap-reason-invalid';
  END IF;

  -- One global lock serializes the only bootstrap grant. The email lock keeps the
  -- target stable against authentication/account lifecycle changes in this transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('tideway-bootstrap-administrator', 34));
  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_email::text, 35));

  SELECT account.* INTO target_account
  FROM users account
  WHERE account.email = normalized_email
  FOR UPDATE;

  IF NOT FOUND OR target_account.account_status <> 'active' OR target_account.email_verified_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='administrator-bootstrap-account-ineligible';
  END IF;
  PERFORM 1 FROM authentication_identities identity
  WHERE identity.user_id = target_account.id
    AND identity.provider IN ('password','google','facebook')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='administrator-bootstrap-account-ineligible'; END IF;

  SELECT event.* INTO prior_event
  FROM audit_logs event
  WHERE event.action = 'administrator.bootstrap.provisioned'
    AND event.metadata->>'requestId' = supplied_request_id::text
  FOR UPDATE;

  IF FOUND THEN
    IF prior_event.resource_id <> target_account.id::text
       OR prior_event.metadata->>'operatorReference' <> normalized_operator_reference
       OR prior_event.metadata->>'reason' <> normalized_reason
       OR NOT EXISTS (SELECT 1 FROM user_roles assigned WHERE assigned.user_id=target_account.id AND assigned.role='administrator') THEN
      RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='administrator-bootstrap-request-reused';
    END IF;
    RETURN QUERY SELECT 'already-provisioned'::text, target_account.id,
      COALESCE((prior_event.metadata->>'sessionsRevoked')::integer,0), prior_event.created_at;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM user_roles assigned WHERE assigned.role='administrator') THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='administrator-already-provisioned';
  END IF;

  INSERT INTO user_roles(user_id,role,granted_by)
  VALUES(target_account.id,'administrator',NULL);

  UPDATE sessions
  SET revoked_at=COALESCE(revoked_at,now())
  WHERE user_id=target_account.id AND revoked_at IS NULL;
  GET DIAGNOSTICS revoked_count = ROW_COUNT;

  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  VALUES(NULL,'administrator.bootstrap.provisioned','user',target_account.id::text,jsonb_build_object(
    'requestId',supplied_request_id::text,
    'operatorReference',normalized_operator_reference,
    'reason',normalized_reason,
    'sessionsRevoked',revoked_count,
    'bootstrap',true
  ))
  RETURNING created_at INTO created_time;

  RETURN QUERY SELECT 'provisioned'::text,target_account.id,revoked_count,created_time;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.provision_bootstrap_administrator(citext,uuid,text,text) FROM PUBLIC;

COMMIT;
