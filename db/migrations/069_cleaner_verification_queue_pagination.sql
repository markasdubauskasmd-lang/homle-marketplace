-- Repairs pagination in tideway_private.list_cleaner_verification_queue.
--
-- Migration 063 applied LIMIT/OFFSET to a query whose select list is a single
-- jsonb_agg call. An aggregate over a non-grouped query produces exactly one
-- row, so the LIMIT and OFFSET applied to that one row, not to the cleaners
-- being aggregated. The consequences, both live:
--
--   * page 1 (OFFSET 0) kept the single aggregate row, so the caller received
--     EVERY cleaner in the queue regardless of the requested limit;
--   * page 2 (OFFSET >= 1) skipped that row, jsonb_agg returned NULL, COALESCE
--     turned it into '[]', and the Administrator saw an empty page.
--
-- So the queue looked like it had exactly one page no matter how large it grew,
-- and an Administrator paging forward found nothing there.
--
-- The fix is to select, order and slice the rows first, then aggregate the
-- resulting page. 063 is left untouched because it is checksum-locked and has
-- already been applied; this replaces the function in place.
--
-- The ORDER BY is duplicated on purpose. The inner one decides WHICH rows are on
-- the page and must match the offset the caller is paging through; the outer one
-- decides the order WITHIN the emitted array. Dropping either leaves the result
-- unordered, because a subquery's ordering is not guaranteed to survive into an
-- aggregate. Both order by updated_at DESC then user_id, exactly as 063 did, so
-- the sequence a caller pages through is unchanged and total: user_id breaks
-- ties on identical timestamps, without which rows could repeat or vanish
-- between adjacent pages.
--
-- Everything else — the administrator role check, the view and page validation,
-- the error codes, the returned shape — is carried over verbatim from 063.

BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.list_cleaner_verification_queue(selected_view text, page_limit integer, page_offset integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF selected_view IS NOT NULL AND selected_view NOT IN ('awaiting','verified','all') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-verification-view';
  END IF;
  IF page_limit NOT BETWEEN 1 AND 100 OR page_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-verification-page';
  END IF;

  SELECT jsonb_build_object(
    'cleaners', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'cleanerId', profile.user_id,
        'displayName', account.display_name,
        'identityCheckStatus', profile.identity_check_status,
        'backgroundCheckStatus', profile.background_check_status,
        'isPublic', profile.is_public,
        'updatedAt', profile.updated_at
      ) ORDER BY profile.updated_at DESC, profile.user_id)
      FROM cleaner_profiles profile
      JOIN users account ON account.id = profile.user_id
      WHERE account.account_status = 'active'
        AND CASE COALESCE(selected_view,'awaiting')
          WHEN 'awaiting' THEN profile.identity_check_status IN ('not-checked','pending') OR profile.background_check_status IN ('not-checked','pending')
          WHEN 'verified' THEN profile.identity_check_status = 'verified'
          ELSE true
        END
      LIMIT page_limit OFFSET page_offset
    ), '[]'::jsonb),
    'limit', page_limit,
    'offset', page_offset
  ) INTO result;
  RETURN result;
END;
$$;

-- CREATE OR REPLACE keeps the existing privileges, so this is belt-and-braces: it
-- matters only if the function were ever created fresh, where the default would be
-- EXECUTE to PUBLIC. The grant to tideway_app lives in db/runtime-role-grants.sql
-- and is untouched.
REVOKE ALL ON FUNCTION tideway_private.list_cleaner_verification_queue(text,integer,integer) FROM PUBLIC;

COMMIT;
