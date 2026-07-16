BEGIN;

ALTER TABLE disputes
  ADD COLUMN client_request_id uuid,
  ADD COLUMN resolution_outcome text CHECK (resolution_outcome IN ('completed','cancelled'));

UPDATE disputes SET client_request_id=gen_random_uuid() WHERE client_request_id IS NULL;
UPDATE disputes SET category='other' WHERE category NOT IN ('quality','damage','access','safety','conduct','payment','other');

ALTER TABLE disputes
  ALTER COLUMN client_request_id SET NOT NULL,
  ADD CONSTRAINT disputes_category_check CHECK (category IN ('quality','damage','access','safety','conduct','payment','other')),
  ADD CONSTRAINT disputes_resolution_evidence_check CHECK (
    (status IN ('open','reviewing') AND resolved_at IS NULL AND resolution_note IS NULL AND resolution_outcome IS NULL)
    OR (status IN ('resolved','closed') AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL AND char_length(trim(resolution_note)) BETWEEN 20 AND 5000 AND resolution_outcome IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT disputes_request_idempotency UNIQUE (booking_id,opened_by,client_request_id);

CREATE UNIQUE INDEX disputes_one_active_per_booking_idx ON disputes(booking_id) WHERE status IN ('open','reviewing');

CREATE FUNCTION tideway_private.dispute_result(dispute_record disputes)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN dispute_record.id IS NULL THEN NULL ELSE jsonb_build_object(
    'disputeId',dispute_record.id,
    'bookingId',dispute_record.booking_id,
    'category',dispute_record.category,
    'description',dispute_record.description,
    'status',dispute_record.status,
    'resolutionNote',dispute_record.resolution_note,
    'resolutionOutcome',dispute_record.resolution_outcome,
    'createdAt',dispute_record.created_at,
    'resolvedAt',dispute_record.resolved_at
  ) END
$$;

CREATE FUNCTION tideway_private.open_booking_dispute(target_booking_id uuid,proposed_dispute_id uuid,proposed_request_id uuid,supplied_category text,supplied_description text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
  dispute_record disputes%ROWTYPE;
  normalized_category text:=lower(trim(supplied_category));
  normalized_description text:=trim(supplied_description);
  other_participant uuid;
  previous_status booking_status;
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('cleaner')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='booking-participant-required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users account WHERE account.id=actor_id AND account.account_status='active') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account-inactive'; END IF;
  IF proposed_dispute_id IS NULL OR proposed_request_id IS NULL OR normalized_category NOT IN ('quality','damage','access','safety','conduct','payment','other')
    OR normalized_description IS NULL OR char_length(normalized_description) NOT BETWEEN 20 AND 5000
    OR replace(replace(normalized_description,E'\n',''),E'\t','') ~ '[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-dispute'; END IF;

  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id=target_booking_id AND (booking.landlord_user_id=actor_id OR booking.cleaner_user_id=actor_id)
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;

  SELECT * INTO dispute_record FROM disputes dispute
    WHERE dispute.booking_id=booking_record.id AND dispute.opened_by=actor_id AND dispute.client_request_id=proposed_request_id;
  IF FOUND THEN RETURN tideway_private.dispute_result(dispute_record); END IF;

  SELECT * INTO dispute_record FROM disputes dispute
    WHERE dispute.booking_id=booking_record.id AND dispute.status IN ('open','reviewing') FOR UPDATE;
  IF FOUND THEN RETURN tideway_private.dispute_result(dispute_record); END IF;

  IF booking_record.status NOT IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review','completed') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-not-disputable';
  END IF;

  previous_status:=booking_record.status;
  INSERT INTO disputes(id,booking_id,opened_by,client_request_id,category,description)
    VALUES(proposed_dispute_id,booking_record.id,actor_id,proposed_request_id,normalized_category,normalized_description)
    RETURNING * INTO dispute_record;
  UPDATE bookings SET status='disputed',updated_at=now() WHERE id=booking_record.id;
  INSERT INTO booking_status_history(booking_id,from_status,to_status,changed_by,reason,metadata)
    VALUES(booking_record.id,previous_status,'disputed',actor_id,'A booking participant opened a private Tideway case.',jsonb_build_object('disputeId',dispute_record.id,'category',dispute_record.category));

  other_participant:=CASE WHEN actor_id=booking_record.landlord_user_id THEN booking_record.cleaner_user_id ELSE booking_record.landlord_user_id END;
  INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key) VALUES
    (actor_id,booking_record.id,'dispute-opened','in-app',jsonb_build_object('bookingId',booking_record.id,'disputeId',dispute_record.id,'status','open'),'dispute:'||dispute_record.id||':opened:actor'),
    (other_participant,booking_record.id,'dispute-opened','in-app',jsonb_build_object('bookingId',booking_record.id,'disputeId',dispute_record.id,'status','open'),'dispute:'||dispute_record.id||':opened:participant')
    ON CONFLICT(idempotency_key) DO NOTHING;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,request_id,metadata)
    VALUES(actor_id,'booking-dispute-opened','dispute',dispute_record.id::text,proposed_request_id,jsonb_build_object('bookingId',booking_record.id,'category',dispute_record.category,'previousStatus',previous_status));
  RETURN tideway_private.dispute_result(dispute_record);
END;
$$;

CREATE FUNCTION tideway_private.get_booking_dispute(target_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE; dispute_record disputes%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id
    AND (booking.landlord_user_id=actor_id OR booking.cleaner_user_id=actor_id OR tideway_private.has_role('administrator'));
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;
  SELECT * INTO dispute_record FROM disputes dispute WHERE dispute.booking_id=booking_record.id
    ORDER BY CASE WHEN dispute.status IN ('open','reviewing') THEN 0 ELSE 1 END,dispute.created_at DESC,dispute.id DESC LIMIT 1;
  RETURN tideway_private.dispute_result(dispute_record);
END;
$$;

CREATE FUNCTION tideway_private.list_admin_booking_disputes(status_filter text DEFAULT NULL,page_limit integer DEFAULT 50,page_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); normalized_status text:=NULLIF(lower(trim(status_filter)),''); result jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required'; END IF;
  IF normalized_status IS NOT NULL AND normalized_status NOT IN ('open','reviewing','resolved','closed') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-dispute-status'; END IF;
  IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 100 OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-dispute-page'; END IF;
  WITH selected AS (
    SELECT dispute.*,CASE WHEN dispute.opened_by=booking.landlord_user_id THEN 'landlord' ELSE 'cleaner' END opened_by_role
    FROM disputes dispute JOIN bookings booking ON booking.id=dispute.booking_id
    WHERE normalized_status IS NULL OR dispute.status=normalized_status
    ORDER BY CASE dispute.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,dispute.created_at,dispute.id
    LIMIT page_limit OFFSET page_offset
  )
  SELECT jsonb_build_object('disputes',COALESCE(jsonb_agg(jsonb_build_object(
    'disputeId',selected.id,'bookingId',selected.booking_id,'category',selected.category,'description',selected.description,
    'status',selected.status,'openedByRole',selected.opened_by_role,'resolutionNote',selected.resolution_note,
    'resolutionOutcome',selected.resolution_outcome,'createdAt',selected.created_at,'resolvedAt',selected.resolved_at
  ) ORDER BY CASE selected.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,selected.created_at,selected.id),'[]'::jsonb),'limit',page_limit,'offset',page_offset)
    INTO result FROM selected;
  RETURN result;
END;
$$;

CREATE FUNCTION tideway_private.review_booking_dispute(target_dispute_id uuid,target_status text,supplied_resolution_note text DEFAULT NULL,supplied_booking_outcome text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id(); dispute_record disputes%ROWTYPE; booking_record bookings%ROWTYPE;
  normalized_status text:=lower(trim(target_status)); normalized_note text:=NULLIF(trim(supplied_resolution_note),''); normalized_outcome text:=NULLIF(lower(trim(supplied_booking_outcome)),'');
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required'; END IF;
  IF normalized_status NOT IN ('reviewing','resolved') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-dispute-decision'; END IF;
  IF normalized_status='reviewing' AND (normalized_note IS NOT NULL OR normalized_outcome IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-dispute-decision'; END IF;
  IF normalized_status='resolved' AND (normalized_note IS NULL OR char_length(normalized_note) NOT BETWEEN 20 AND 5000 OR normalized_outcome NOT IN ('completed','cancelled') OR replace(replace(normalized_note,E'\n',''),E'\t','') ~ '[[:cntrl:]]') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-dispute-resolution'; END IF;
  SELECT * INTO dispute_record FROM disputes dispute WHERE dispute.id=target_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='dispute-not-found'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=dispute_record.booking_id FOR UPDATE;

  IF dispute_record.status IN ('resolved','closed') THEN
    IF normalized_status='resolved' AND dispute_record.resolution_note=normalized_note AND dispute_record.resolution_outcome=normalized_outcome THEN RETURN tideway_private.dispute_result(dispute_record); END IF;
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='dispute-already-final';
  END IF;
  IF normalized_status='reviewing' THEN
    IF dispute_record.status='reviewing' THEN RETURN tideway_private.dispute_result(dispute_record); END IF;
    UPDATE disputes SET status='reviewing',assigned_admin_user_id=actor_id WHERE id=dispute_record.id RETURNING * INTO dispute_record;
    INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key) VALUES
      (booking_record.landlord_user_id,booking_record.id,'dispute-reviewing','in-app',jsonb_build_object('bookingId',booking_record.id,'disputeId',dispute_record.id,'status','reviewing'),'dispute:'||dispute_record.id||':reviewing:landlord'),
      (booking_record.cleaner_user_id,booking_record.id,'dispute-reviewing','in-app',jsonb_build_object('bookingId',booking_record.id,'disputeId',dispute_record.id,'status','reviewing'),'dispute:'||dispute_record.id||':reviewing:cleaner')
      ON CONFLICT(idempotency_key) DO NOTHING;
    INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES(actor_id,'booking-dispute-review-started','dispute',dispute_record.id::text,jsonb_build_object('bookingId',booking_record.id));
    RETURN tideway_private.dispute_result(dispute_record);
  END IF;

  IF booking_record.status<>'disputed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-dispute-state-invalid'; END IF;
  UPDATE disputes SET status='resolved',assigned_admin_user_id=actor_id,resolution_note=normalized_note,resolution_outcome=normalized_outcome,resolved_at=now() WHERE id=dispute_record.id RETURNING * INTO dispute_record;
  UPDATE bookings SET status=normalized_outcome::booking_status,
    completed_at=CASE WHEN normalized_outcome='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END,
    cancelled_at=CASE WHEN normalized_outcome='cancelled' THEN COALESCE(cancelled_at,now()) ELSE cancelled_at END,
    updated_at=now() WHERE id=booking_record.id;
  INSERT INTO booking_status_history(booking_id,from_status,to_status,changed_by,reason,metadata)
    VALUES(booking_record.id,'disputed',normalized_outcome::booking_status,actor_id,'Tideway resolved the private booking case.',jsonb_build_object('disputeId',dispute_record.id,'outcome',normalized_outcome));
  INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key) VALUES
    (booking_record.landlord_user_id,booking_record.id,'dispute-resolved','in-app',jsonb_build_object('bookingId',booking_record.id,'disputeId',dispute_record.id,'status','resolved','outcome',normalized_outcome),'dispute:'||dispute_record.id||':resolved:landlord'),
    (booking_record.cleaner_user_id,booking_record.id,'dispute-resolved','in-app',jsonb_build_object('bookingId',booking_record.id,'disputeId',dispute_record.id,'status','resolved','outcome',normalized_outcome),'dispute:'||dispute_record.id||':resolved:cleaner')
    ON CONFLICT(idempotency_key) DO NOTHING;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES(actor_id,'booking-dispute-resolved','dispute',dispute_record.id::text,jsonb_build_object('bookingId',booking_record.id,'outcome',normalized_outcome));
  RETURN tideway_private.dispute_result(dispute_record);
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.safe_notification_payload(input_payload jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'bookingId',input_payload->'bookingId','responseDeadline',input_payload->'responseDeadline','matchingReopened',input_payload->'matchingReopened',
    'taskId',input_payload->'taskId','decision',input_payload->'decision','photoId',input_payload->'photoId','messageId',input_payload->'messageId',
    'reviewId',input_payload->'reviewId','senderRole',input_payload->'senderRole','eventId',input_payload->'eventId',
    'disputeId',input_payload->'disputeId','status',input_payload->'status','outcome',input_payload->'outcome'
  ))
$$;

CREATE OR REPLACE FUNCTION tideway_private.queue_email_for_in_app_notification() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.channel='in-app' AND NEW.event_type IN (
    'new-booking-request','cleaner-declined','booking-confirmed','cleaner-invitation-expired','cleaner-started-travelling','cleaner-nearby','cleaner-arrived','cleaning-started',
    'cleaning-paused','cleaning-resumed','cleaning-progress-update','issue-reported','job-photo-added','issue-photo-added','unexpected-task-approval-requested',
    'unexpected-task-decision','cleaning-completed','booking-completed','review-requested','review-submitted','booking-message','dispute-opened','dispute-reviewing','dispute-resolved'
  ) THEN
    INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key)
    VALUES(NEW.recipient_user_id,NEW.booking_id,NEW.event_type,'email',tideway_private.safe_notification_payload(NEW.payload),'email:'||NEW.idempotency_key)
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.dispute_result(disputes) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.open_booking_dispute(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_booking_dispute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.list_admin_booking_disputes(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.review_booking_dispute(uuid,text,text,text) FROM PUBLIC;

COMMIT;
