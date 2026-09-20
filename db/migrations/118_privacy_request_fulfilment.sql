-- Make a data-protection request answerable.
--
-- Migration 035 built the intake: a customer can ask for their data or ask for
-- their account to be deleted, and a row is written. Nothing else existed.
-- There was no administrator queue, so nobody could see a request had been
-- made; no way to move it through a lifecycle; and no export. The `status`
-- column had five values and only one of them was ever used.
--
-- UK GDPR gives one month to answer a subject access request (Art. 15) or an
-- erasure request (Art. 17). A request nobody can see is a breach on a timer,
-- and the timer had been running since migration 035 shipped.
--
-- This migration adds the two things that make a request answerable: an
-- administrator queue, and a recorded progression with an audit trail. The
-- export payload itself is assembled in `privacy-request-service.mjs` from the
-- requester's own authenticated reads, so the data a person receives is exactly
-- the data the application would show them and cannot drift into a second,
-- parallel definition of "their data".
--
-- Erasure fulfilment is deliberately NOT automated here. Deleting an account is
-- not a delete: financial records are retained under UK tax law, and the other
-- party to a booking has their own record of work done which is not solely the
-- requester's personal data. Getting that wrong destroys records a business is
-- required to keep. The queue records the decision and the reason; the erasure
-- itself stays a reviewed operation until the retention policy is approved.

BEGIN;

CREATE FUNCTION tideway_private.list_privacy_requests_for_administrator(selected_view text, page_limit integer, page_offset integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF selected_view IS NOT NULL AND selected_view NOT IN ('open','completed','all') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-privacy-view';
  END IF;
  IF page_limit NOT BETWEEN 1 AND 100 OR page_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-privacy-page';
  END IF;

  SELECT jsonb_build_object(
    'requests', COALESCE((
      SELECT jsonb_agg(entry ORDER BY entry->>'createdAt')
      FROM (
        SELECT jsonb_build_object(
          'requestId', request.id,
          'accountId', request.user_id,
          -- The account's own address, because answering a subject access
          -- request means sending it to a verified address. Nothing else about
          -- the person is projected: the queue is for scheduling the work, not
          -- for browsing customers.
          'email', account.email,
          'requestType', request.request_type,
          'status', request.status,
          'createdAt', request.created_at,
          'verifiedAt', request.verified_at,
          'completedAt', request.completed_at,
          -- The deadline is the point of the whole queue. One month from the
          -- request, per UK GDPR, shown so it cannot be missed by accident.
          'dueAt', request.created_at + interval '1 month',
          'overdue', now() > request.created_at + interval '1 month' AND request.status NOT IN ('completed','rejected')
        ) AS entry
        FROM privacy_requests request
        JOIN users account ON account.id = request.user_id
        WHERE CASE COALESCE(selected_view,'open')
          WHEN 'open' THEN request.status IN ('requested','verifying','processing')
          WHEN 'completed' THEN request.status IN ('completed','rejected')
          ELSE true
        END
        ORDER BY request.created_at
        LIMIT page_limit OFFSET page_offset
      ) rows
    ), '[]'::jsonb),
    'openCount', (SELECT count(*) FROM privacy_requests WHERE status IN ('requested','verifying','processing')),
    'overdueCount', (SELECT count(*) FROM privacy_requests WHERE status IN ('requested','verifying','processing') AND now() > created_at + interval '1 month'),
    'limit', page_limit,
    'offset', page_offset
  ) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION tideway_private.record_privacy_request_progress(
  target_request_id uuid,
  next_status text,
  supplied_note text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  selected_request privacy_requests%ROWTYPE;
  selected_status privacy_request_status;
  trimmed_note text := NULLIF(btrim(supplied_note), '');
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  BEGIN
    selected_status := btrim(next_status)::privacy_request_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-privacy-status';
  END;
  IF selected_status NOT IN ('verifying','processing','completed','rejected') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-privacy-status';
  END IF;
  -- Rejecting somebody's data-protection request is a decision that has to be
  -- explained, both to them and to a regulator asking why.
  IF selected_status = 'rejected' AND trimmed_note IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='privacy-rejection-reason-required';
  END IF;

  SELECT * INTO selected_request FROM privacy_requests WHERE id = target_request_id FOR UPDATE;
  IF selected_request.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='privacy-request-not-found';
  END IF;
  -- A finished request stays finished. Reopening one would restart a statutory
  -- clock that has already been answered.
  IF selected_request.status IN ('completed','rejected') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='privacy-request-already-closed';
  END IF;

  -- No `updated_at` on this table: the audit_logs row below is the record of
  -- when and by whom it moved, which is the thing a regulator would ask for.
  UPDATE privacy_requests
    SET status = selected_status,
        verified_at = CASE WHEN selected_status = 'verifying' AND verified_at IS NULL THEN now() ELSE verified_at END,
        completed_at = CASE WHEN selected_status IN ('completed','rejected') THEN now() ELSE completed_at END
    WHERE id = selected_request.id
    RETURNING * INTO selected_request;

  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (
      actor_id,
      'privacy-request-progress',
      'privacy_request',
      selected_request.id::text,
      -- The note is the administrator's own words about their handling of the
      -- request. It is not the requester's personal data and is kept for the
      -- accountability record.
      jsonb_build_object('status', selected_status, 'note', trimmed_note)
    );

  RETURN jsonb_build_object(
    'requestId', selected_request.id,
    'requestType', selected_request.request_type,
    'status', selected_request.status,
    'createdAt', selected_request.created_at,
    'verifiedAt', selected_request.verified_at,
    'completedAt', selected_request.completed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.list_privacy_requests_for_administrator(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_privacy_request_progress(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.list_privacy_requests_for_administrator(text,integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_privacy_request_progress(uuid,text,text) TO tideway_app;

COMMIT;
