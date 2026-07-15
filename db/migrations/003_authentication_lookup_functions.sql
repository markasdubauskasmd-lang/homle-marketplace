BEGIN;

CREATE FUNCTION tideway_private.lookup_password_account(candidate_email citext)
RETURNS TABLE (
  user_id uuid,
  email citext,
  email_verified_at timestamptz,
  display_name text,
  selected_role user_role,
  account_status text,
  password_hash text,
  failed_attempts integer,
  locked_until timestamptz,
  roles user_role[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email, u.email_verified_at, u.display_name, u.selected_role, u.account_status,
         p.password_hash, p.failed_attempts, p.locked_until,
         COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}'::user_role[])
  FROM users u
  JOIN password_credentials p ON p.user_id = u.id
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  WHERE u.email = candidate_email AND u.account_status = 'active'
  GROUP BY u.id, p.user_id
$$;

CREATE FUNCTION tideway_private.lookup_session(candidate_token_hash bytea)
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  email citext,
  email_verified_at timestamptz,
  display_name text,
  selected_role user_role,
  account_status text,
  csrf_secret_hash bytea,
  expires_at timestamptz,
  roles user_role[]
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions s
  SET last_seen_at = now()
  FROM users u
  WHERE s.token_hash = candidate_token_hash
    AND s.user_id = u.id
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND u.account_status = 'active'
  RETURNING s.id, u.id, u.email, u.email_verified_at, u.display_name, u.selected_role, u.account_status,
            s.csrf_secret_hash, s.expires_at,
            COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = u.id), '{}'::user_role[])
$$;

CREATE FUNCTION tideway_private.lookup_verified_email(candidate_email citext)
RETURNS TABLE (user_id uuid, email citext, account_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email, u.account_status
  FROM users u
  WHERE u.email = candidate_email
    AND u.email_verified_at IS NOT NULL
    AND u.account_status = 'active'
$$;

REVOKE ALL ON FUNCTION tideway_private.lookup_password_account(citext) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.lookup_session(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.lookup_verified_email(citext) FROM PUBLIC;

-- After creating the restricted runtime database role, grant only these lookups:
-- GRANT USAGE ON SCHEMA tideway_private TO tideway_app;
-- GRANT EXECUTE ON FUNCTION tideway_private.lookup_password_account(citext) TO tideway_app;
-- GRANT EXECUTE ON FUNCTION tideway_private.lookup_session(bytea) TO tideway_app;
-- GRANT EXECUTE ON FUNCTION tideway_private.lookup_verified_email(citext) TO tideway_app;

COMMIT;
