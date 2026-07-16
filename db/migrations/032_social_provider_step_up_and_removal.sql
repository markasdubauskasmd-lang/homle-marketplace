BEGIN;

CREATE FUNCTION tideway_private.verify_my_social_identity(
  asserted_provider authentication_provider,
  asserted_subject text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  identity_id uuid;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users account
    WHERE account.id = actor_id AND account.account_status = 'active' AND account.email_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='active-verified-account-required';
  END IF;
  IF asserted_provider IS NULL OR asserted_provider NOT IN ('google','facebook') OR asserted_subject IS NULL
     OR char_length(asserted_subject) NOT BETWEEN 1 AND 255 OR asserted_subject ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-step-up-invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(asserted_provider::text || ':' || asserted_subject, 21));
  SELECT identity.id INTO identity_id
  FROM authentication_identities identity
  WHERE identity.user_id = actor_id AND identity.provider = asserted_provider AND identity.provider_subject = asserted_subject
  FOR UPDATE;

  IF identity_id IS NULL THEN RETURN false; END IF;

  UPDATE authentication_identities SET last_used_at = now() WHERE id = identity_id;
  INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  VALUES(actor_id, 'authentication-provider-step-up', 'user', actor_id::text, jsonb_build_object('provider', asserted_provider));
  RETURN true;
END
$$;

CREATE FUNCTION tideway_private.disconnect_my_social_identity(selected_provider authentication_provider)
RETURNS TABLE(
  disconnected boolean,
  reason text,
  revoked_sessions integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  selected_identity_id uuid;
  identity_count integer;
  revoked_count integer := 0;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users account
    WHERE account.id = actor_id AND account.account_status = 'active' AND account.email_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='active-verified-account-required';
  END IF;
  IF selected_provider IS NULL OR selected_provider NOT IN ('google','facebook') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-disconnection-unsupported';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(actor_id::text || ':authentication-identities', 22));
  PERFORM 1 FROM authentication_identities identity WHERE identity.user_id = actor_id FOR UPDATE;
  SELECT count(*)::integer INTO identity_count
  FROM authentication_identities identity
  WHERE identity.user_id = actor_id
    AND (identity.provider IN ('google','facebook') OR (
      identity.provider = 'password' AND EXISTS (SELECT 1 FROM password_credentials credential WHERE credential.user_id = actor_id)
    ));
  SELECT identity.id INTO selected_identity_id
  FROM authentication_identities identity
  WHERE identity.user_id = actor_id AND identity.provider = selected_provider;

  IF selected_identity_id IS NULL THEN
    RETURN QUERY SELECT false, 'provider-not-connected'::text, 0;
    RETURN;
  END IF;
  IF identity_count <= 1 THEN
    RETURN QUERY SELECT false, 'last-sign-in-method'::text, 0;
    RETURN;
  END IF;

  DELETE FROM authentication_identities WHERE id = selected_identity_id;
  UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = actor_id AND revoked_at IS NULL;
  GET DIAGNOSTICS revoked_count = ROW_COUNT;
  INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  VALUES(actor_id, 'authentication-provider-disconnected', 'user', actor_id::text,
    jsonb_build_object('provider', selected_provider, 'sessionsRevoked', revoked_count));
  RETURN QUERY SELECT true, NULL::text, revoked_count;
END
$$;

REVOKE ALL ON FUNCTION tideway_private.verify_my_social_identity(authentication_provider,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.disconnect_my_social_identity(authentication_provider) FROM PUBLIC;

COMMIT;
