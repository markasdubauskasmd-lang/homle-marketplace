BEGIN;

CREATE INDEX sessions_expiry_purge_idx ON sessions(expires_at, id);

CREATE FUNCTION tideway_private.purge_expired_sessions(batch_limit integer DEFAULT 500)
RETURNS TABLE (deleted_count integer, batch_full boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  affected_count integer := 0;
BEGIN
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 5000 THEN
    RAISE EXCEPTION 'Session purge batch limit must be between 1 and 5000';
  END IF;

  WITH due_session AS (
    SELECT candidate.id
    FROM sessions candidate
    WHERE candidate.expires_at <= now()
    ORDER BY candidate.expires_at, candidate.id
    FOR UPDATE OF candidate SKIP LOCKED
    LIMIT batch_limit
  ), deleted_session AS (
    DELETE FROM sessions expired
    USING due_session
    WHERE expired.id = due_session.id
    RETURNING expired.id
  )
  SELECT count(*)::integer INTO affected_count FROM deleted_session;

  RETURN QUERY SELECT affected_count, affected_count = batch_limit;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.purge_expired_sessions(integer) FROM PUBLIC;

COMMIT;
