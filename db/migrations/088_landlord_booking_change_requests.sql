-- A Landlord may ask Homle to reschedule or cancel a confirmed booking without
-- pretending that the booking, Cleaner commitment or payment changed. The
-- request reuses the private support queue, but its booking link and requested
-- change are structured and ownership-checked instead of being copied into
-- free text. Cleaner-facing tables, functions and notifications are untouched.
BEGIN;

ALTER TABLE support_requests DROP CONSTRAINT support_requests_category_check;
ALTER TABLE support_requests
  ADD CONSTRAINT support_requests_category_check
  CHECK (category IN ('account-access','property','room-scan','booking-preparation','booking-change','other'));

ALTER TABLE support_requests
  ADD COLUMN related_booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT,
  ADD COLUMN booking_change_kind text CHECK (booking_change_kind IS NULL OR booking_change_kind IN ('reschedule','cancel')),
  ADD COLUMN proposed_start_at timestamptz,
  ADD CONSTRAINT support_requests_booking_change_shape CHECK (
    (category='booking-change'
      AND related_booking_id IS NOT NULL
      AND booking_change_kind IS NOT NULL
      AND ((booking_change_kind='reschedule' AND proposed_start_at IS NOT NULL)
        OR (booking_change_kind='cancel' AND proposed_start_at IS NULL)))
    OR (category<>'booking-change'
      AND related_booking_id IS NULL
      AND booking_change_kind IS NULL
      AND proposed_start_at IS NULL)
  );

CREATE UNIQUE INDEX support_requests_one_open_booking_change_idx
  ON support_requests(account_id,related_booking_id)
  WHERE category='booking-change' AND status IN ('open','reviewing');

CREATE OR REPLACE FUNCTION tideway_private.support_request_result(request_record support_requests)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN request_record.id IS NULL THEN NULL ELSE jsonb_build_object(
    'supportRequestId',request_record.id,
    'category',request_record.category,
    'subject',request_record.subject,
    'description',request_record.description,
    'status',request_record.status,
    'resolutionSummary',request_record.resolution_summary,
    'bookingId',request_record.related_booking_id,
    'bookingChangeKind',request_record.booking_change_kind,
    'proposedStartAt',request_record.proposed_start_at,
    'createdAt',request_record.created_at,
    'updatedAt',request_record.updated_at,
    'resolvedAt',request_record.resolved_at
  ) END
$$;

CREATE FUNCTION tideway_private.create_landlord_booking_change_request(
  proposed_support_request_id uuid,
  proposed_client_request_id uuid,
  target_booking_id uuid,
  supplied_change_kind text,
  supplied_proposed_start_at timestamptz,
  supplied_description text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  normalized_kind text:=lower(trim(supplied_change_kind));
  normalized_description text:=trim(supplied_description);
  booking_record bookings%ROWTYPE;
  request_record support_requests%ROWTYPE;
  generated_subject text;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM users account WHERE account.id=actor_id AND account.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account-inactive';
  END IF;

  -- An exact retry must remain safe even if the booking moved on while the
  -- client waited for a response.
  SELECT * INTO request_record FROM support_requests request
    WHERE request.account_id=actor_id AND request.client_request_id=proposed_client_request_id;
  IF FOUND THEN RETURN tideway_private.support_request_result(request_record); END IF;

  IF proposed_support_request_id IS NULL OR proposed_client_request_id IS NULL OR target_booking_id IS NULL
    OR normalized_kind NOT IN ('reschedule','cancel')
    OR char_length(normalized_description) NOT BETWEEN 20 AND 2000
    OR replace(replace(normalized_description,E'\n',''),E'\t','') ~ '[[:cntrl:]]'
    OR normalized_description ~* '(password|passcode|door[[:space:]-]?code|alarm[[:space:]-]?code|key[[:space:]-]?safe|api[[:space:]-]?key|secret[[:space:]-]?key|card[[:space:]-]?number|cvv|cvc)'
    OR normalized_description ~ '([0-9][[:space:]-]?){13,19}'
    OR (normalized_kind='reschedule' AND (
      supplied_proposed_start_at IS NULL
      OR supplied_proposed_start_at<=now()
      OR supplied_proposed_start_at>now()+interval '365 days'))
    OR (normalized_kind='cancel' AND supplied_proposed_start_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-change-request';
  END IF;

  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id=target_booking_id AND booking.landlord_user_id=actor_id
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;
  IF booking_record.status<>'confirmed' OR booking_record.scheduled_start_at<=now() THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-change-not-requestable';
  END IF;
  IF normalized_kind='reschedule' AND supplied_proposed_start_at=booking_record.scheduled_start_at THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-change-request';
  END IF;
  IF EXISTS(SELECT 1 FROM support_requests request
      WHERE request.account_id=actor_id AND request.related_booking_id=target_booking_id
        AND request.category='booking-change' AND request.status IN ('open','reviewing')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-change-already-open';
  END IF;
  IF (SELECT count(*) FROM support_requests request
      WHERE request.account_id=actor_id AND request.status IN ('open','reviewing'))>=5 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='support-request-limit';
  END IF;

  generated_subject:=CASE normalized_kind
    WHEN 'reschedule' THEN 'Request to reschedule confirmed booking'
    ELSE 'Request to cancel confirmed booking'
  END;
  INSERT INTO support_requests(
    id,account_id,client_request_id,category,subject,description,
    related_booking_id,booking_change_kind,proposed_start_at
  ) VALUES(
    proposed_support_request_id,actor_id,proposed_client_request_id,'booking-change',generated_subject,normalized_description,
    target_booking_id,normalized_kind,CASE WHEN normalized_kind='reschedule' THEN supplied_proposed_start_at ELSE NULL END
  ) ON CONFLICT ON CONSTRAINT support_requests_retry_idempotency DO NOTHING
    RETURNING * INTO request_record;
  -- A concurrent retry may pass the early read before the first transaction
  -- commits. Return that exact request without creating a second audit entry.
  IF NOT FOUND THEN
    SELECT * INTO request_record FROM support_requests request
      WHERE request.account_id=actor_id AND request.client_request_id=proposed_client_request_id;
    IF FOUND THEN RETURN tideway_private.support_request_result(request_record); END IF;
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-change-already-open';
  END IF;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,request_id,metadata)
    VALUES(actor_id,'landlord-booking-change-request-created','support_request',request_record.id::text,proposed_client_request_id,
      jsonb_build_object('bookingId',target_booking_id,'changeKind',normalized_kind,'status',request_record.status));
  RETURN tideway_private.support_request_result(request_record);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-change-already-open';
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.list_administrator_support_requests(
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
  IF normalized_category IS NOT NULL AND normalized_category NOT IN ('account-access','property','room-scan','booking-preparation','booking-change','other') THEN
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

REVOKE ALL ON FUNCTION tideway_private.create_landlord_booking_change_request(uuid,uuid,uuid,text,timestamptz,text) FROM PUBLIC;

COMMIT;
