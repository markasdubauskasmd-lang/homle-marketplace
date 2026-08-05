-- Private, in-app support for Landlord accounts.
--
-- Booking disputes remain attached to a confirmed booking and can change that
-- booking's recorded outcome. This table is deliberately separate: it covers
-- account, property, scanner and pre-booking problems without inventing a
-- booking, exposing a home address, or changing money.
BEGIN;

CREATE TABLE support_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('account-access','property','room-scan','booking-preparation','other')),
  subject text NOT NULL CHECK (char_length(trim(subject)) BETWEEN 10 AND 120),
  description text NOT NULL CHECK (char_length(trim(description)) BETWEEN 20 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved')),
  assigned_admin_user_id uuid REFERENCES users(id),
  resolution_summary text CHECK (resolution_summary IS NULL OR char_length(trim(resolution_summary)) BETWEEN 20 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT support_requests_retry_idempotency UNIQUE (account_id, client_request_id),
  CONSTRAINT support_requests_resolution_state CHECK (
    (status IN ('open','reviewing') AND resolution_summary IS NULL AND resolved_at IS NULL)
    OR (status='resolved' AND resolution_summary IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX support_requests_account_history_idx
  ON support_requests(account_id,created_at DESC,id DESC);
CREATE INDEX support_requests_admin_queue_idx
  ON support_requests(status,created_at,id);

ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;
-- No policy on purpose. The application role cannot read or write a row
-- directly; the four SECURITY DEFINER functions below are the only boundary.

CREATE FUNCTION tideway_private.support_request_result(request_record support_requests)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN request_record.id IS NULL THEN NULL ELSE jsonb_build_object(
    'supportRequestId',request_record.id,
    'category',request_record.category,
    'subject',request_record.subject,
    'description',request_record.description,
    'status',request_record.status,
    'resolutionSummary',request_record.resolution_summary,
    'createdAt',request_record.created_at,
    'updatedAt',request_record.updated_at,
    'resolvedAt',request_record.resolved_at
  ) END
$$;

CREATE FUNCTION tideway_private.create_landlord_support_request(
  proposed_support_request_id uuid,
  proposed_client_request_id uuid,
  supplied_category text,
  supplied_subject text,
  supplied_description text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  normalized_category text:=lower(trim(supplied_category));
  normalized_subject text:=trim(supplied_subject);
  normalized_description text:=trim(supplied_description);
  request_record support_requests%ROWTYPE;
  combined_text text;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM users account WHERE account.id=actor_id AND account.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account-inactive';
  END IF;
  combined_text:=normalized_subject||E'\n'||normalized_description;
  IF proposed_support_request_id IS NULL OR proposed_client_request_id IS NULL
    OR normalized_category NOT IN ('account-access','property','room-scan','booking-preparation','other')
    OR char_length(normalized_subject) NOT BETWEEN 10 AND 120
    OR char_length(normalized_description) NOT BETWEEN 20 AND 2000
    OR replace(replace(combined_text,E'\n',''),E'\t','') ~ '[[:cntrl:]]'
    OR combined_text ~* '(password|passcode|door[[:space:]-]?code|alarm[[:space:]-]?code|key[[:space:]-]?safe|api[[:space:]-]?key|secret[[:space:]-]?key|card[[:space:]-]?number|cvv|cvc)'
    -- A card-like sequence may contain spaces or hyphens. Do not reject an
    -- otherwise harmless collection of dates, booking references and room
    -- numbers spread throughout the request.
    OR combined_text ~ '([0-9][[:space:]-]?){13,19}' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-support-request';
  END IF;

  SELECT * INTO request_record FROM support_requests request
    WHERE request.account_id=actor_id AND request.client_request_id=proposed_client_request_id;
  IF FOUND THEN RETURN tideway_private.support_request_result(request_record); END IF;

  IF (SELECT count(*) FROM support_requests request
      WHERE request.account_id=actor_id AND request.status IN ('open','reviewing')) >= 5 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='support-request-limit';
  END IF;

  INSERT INTO support_requests(id,account_id,client_request_id,category,subject,description)
    VALUES(proposed_support_request_id,actor_id,proposed_client_request_id,normalized_category,normalized_subject,normalized_description)
    RETURNING * INTO request_record;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,request_id,metadata)
    VALUES(actor_id,'landlord-support-request-created','support_request',request_record.id::text,proposed_client_request_id,
      jsonb_build_object('category',request_record.category,'status',request_record.status));
  RETURN tideway_private.support_request_result(request_record);
END;
$$;

CREATE FUNCTION tideway_private.list_my_landlord_support_requests(
  page_limit integer DEFAULT 25,
  page_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); result jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-support-page';
  END IF;
  WITH selected AS (
    SELECT request.* FROM support_requests request
    WHERE request.account_id=actor_id
    ORDER BY request.created_at DESC,request.id DESC
    LIMIT page_limit OFFSET page_offset
  )
  SELECT jsonb_build_object(
    'supportRequests',COALESCE(jsonb_agg(tideway_private.support_request_result(selected)
      ORDER BY selected.created_at DESC,selected.id DESC),'[]'::jsonb),
    'limit',page_limit,
    'offset',page_offset
  ) INTO result FROM selected;
  RETURN result;
END;
$$;

CREATE FUNCTION tideway_private.list_administrator_support_requests(
  status_filter text DEFAULT NULL,
  category_filter text DEFAULT NULL,
  page_limit integer DEFAULT 50,
  page_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  normalized_status text:=NULLIF(lower(trim(status_filter)),'');
  normalized_category text:=NULLIF(lower(trim(category_filter)),'');
  result jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required';
  END IF;
  IF normalized_status IS NOT NULL AND normalized_status NOT IN ('open','reviewing','resolved') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-support-status';
  END IF;
  IF normalized_category IS NOT NULL AND normalized_category NOT IN ('account-access','property','room-scan','booking-preparation','other') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-support-category';
  END IF;
  IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 100 OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-support-page';
  END IF;
  WITH selected AS (
    SELECT request.* FROM support_requests request
    WHERE (normalized_status IS NULL OR request.status=normalized_status)
      AND (normalized_category IS NULL OR request.category=normalized_category)
    ORDER BY CASE request.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
      request.created_at,request.id
    LIMIT page_limit OFFSET page_offset
  )
  SELECT jsonb_build_object(
    'supportRequests',COALESCE(jsonb_agg(tideway_private.support_request_result(selected)
      ORDER BY CASE selected.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
        selected.created_at,selected.id),'[]'::jsonb),
    'limit',page_limit,
    'offset',page_offset
  ) INTO result FROM selected;
  RETURN result;
END;
$$;

CREATE FUNCTION tideway_private.review_landlord_support_request(
  target_support_request_id uuid,
  target_status text,
  supplied_resolution_summary text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  normalized_status text:=lower(trim(target_status));
  normalized_summary text:=NULLIF(trim(supplied_resolution_summary),'');
  request_record support_requests%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required';
  END IF;
  IF normalized_status NOT IN ('reviewing','resolved')
    OR (normalized_status='reviewing' AND normalized_summary IS NOT NULL)
    OR (normalized_status='resolved' AND (
      normalized_summary IS NULL OR char_length(normalized_summary) NOT BETWEEN 20 AND 2000
      OR replace(replace(normalized_summary,E'\n',''),E'\t','') ~ '[[:cntrl:]]'
      OR normalized_summary ~* '(password|passcode|door[[:space:]-]?code|alarm[[:space:]-]?code|key[[:space:]-]?safe|api[[:space:]-]?key|secret[[:space:]-]?key|card[[:space:]-]?number|cvv|cvc)'
      OR normalized_summary ~ '([0-9][[:space:]-]?){13,19}'
    )) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-support-review';
  END IF;

  SELECT * INTO request_record FROM support_requests request
    WHERE request.id=target_support_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='support-request-not-found'; END IF;
  IF request_record.status='resolved' THEN
    IF normalized_status='resolved' AND request_record.resolution_summary=normalized_summary THEN
      RETURN tideway_private.support_request_result(request_record);
    END IF;
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='support-request-already-final';
  END IF;

  IF normalized_status='reviewing' THEN
    IF request_record.status='reviewing' THEN RETURN tideway_private.support_request_result(request_record); END IF;
    UPDATE support_requests SET status='reviewing',assigned_admin_user_id=actor_id,updated_at=now()
      WHERE id=request_record.id RETURNING * INTO request_record;
    INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
      VALUES(actor_id,'landlord-support-review-started','support_request',request_record.id::text,
        jsonb_build_object('category',request_record.category));
    RETURN tideway_private.support_request_result(request_record);
  END IF;

  UPDATE support_requests SET status='resolved',assigned_admin_user_id=actor_id,
    resolution_summary=normalized_summary,updated_at=now(),resolved_at=now()
    WHERE id=request_record.id RETURNING * INTO request_record;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'landlord-support-request-resolved','support_request',request_record.id::text,
      jsonb_build_object('category',request_record.category));
  RETURN tideway_private.support_request_result(request_record);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.support_request_result(support_requests) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.create_landlord_support_request(uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.list_my_landlord_support_requests(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.list_administrator_support_requests(text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.review_landlord_support_request(uuid,text,text) FROM PUBLIC;

COMMIT;
