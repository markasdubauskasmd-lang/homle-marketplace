BEGIN;

DROP FUNCTION tideway_private.lookup_session(bytea);
CREATE FUNCTION tideway_private.lookup_session(candidate_token_hash bytea)
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  email citext,
  email_verified_at timestamptz,
  display_name text,
  avatar_url text,
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
  RETURNING s.id, u.id, u.email, u.email_verified_at, u.display_name, u.avatar_url, u.selected_role, u.account_status,
            s.csrf_secret_hash, s.expires_at,
            COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = u.id), '{}'::user_role[])
$$;
REVOKE ALL ON FUNCTION tideway_private.lookup_session(bytea) FROM PUBLIC;

COMMIT;
