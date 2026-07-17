BEGIN;

ALTER TABLE cleaning_requests DROP CONSTRAINT cleaning_requests_submission_state_check;
ALTER TABLE cleaning_requests ADD CONSTRAINT cleaning_requests_submission_state_check CHECK (
  (status='draft' AND submitted_at IS NULL)
  OR status='cancelled'
  OR (status NOT IN ('draft','cancelled') AND submitted_at IS NOT NULL)
);

CREATE OR REPLACE FUNCTION tideway_private.enforce_reviewed_request_submission()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.status NOT IN ('draft','cancelled') AND (TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.status='draft')) THEN
    IF NEW.submission_review_version IS DISTINCT FROM 1 OR NEW.customer_scope_confirmed_at IS NULL OR NEW.scan_fingerprint IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='reviewed-submission-required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tideway_private.withdraw_cleaning_request(target_request_id uuid,reason_code text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  request_record cleaning_requests%ROWTYPE;
  selected_reason text:=lower(trim(COALESCE(reason_code,'')));
  previous_status text;
  withdrawal_time timestamptz:=now();
  attempt_count integer;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  IF selected_reason NOT IN ('no-longer-needed','date-changed','created-by-mistake','other') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-request-withdrawal-reason';
  END IF;

  SELECT * INTO request_record
  FROM cleaning_requests request
  WHERE request.id=target_request_id AND request.landlord_user_id=actor_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found'; END IF;
  IF request_record.status NOT IN ('draft','searching-for-cleaner') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-not-withdrawable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bookings booking
    WHERE booking.cleaning_request_id=request_record.id AND booking.status<>'cancelled'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-live-booking';
  END IF;

  previous_status:=request_record.status;
  SELECT count(*)::integer INTO attempt_count FROM bookings booking WHERE booking.cleaning_request_id=request_record.id;
  UPDATE cleaning_requests SET
    status='cancelled',
    automatic_dispatch_revoked_at=CASE WHEN automatic_dispatch_authorized_at IS NULL THEN NULL ELSE COALESCE(automatic_dispatch_revoked_at,withdrawal_time) END,
    automatic_dispatch_next_attempt_at=NULL,
    automatic_dispatch_lease_token=NULL,
    automatic_dispatch_lease_expires_at=NULL,
    automatic_dispatch_last_result=CASE WHEN automatic_dispatch_authorized_at IS NULL THEN automatic_dispatch_last_result ELSE 'revoked' END,
    updated_at=withdrawal_time
  WHERE id=request_record.id;

  INSERT INTO cleaning_request_status_history(cleaning_request_id,from_status,to_status,changed_by,reason,metadata)
  VALUES(request_record.id,previous_status,'cancelled',actor_id,'Landlord withdrew the request before a live Cleaner invitation or booking existed.',
    jsonb_build_object('reasonCode',selected_reason,'attemptCount',attempt_count,'automaticDispatchWasEnabled',request_record.automatic_dispatch_authorized_at IS NOT NULL AND request_record.automatic_dispatch_revoked_at IS NULL));
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  VALUES(actor_id,'cleaning-request-withdrawn','cleaning-request',request_record.id::text,
    jsonb_build_object('previousStatus',previous_status,'reasonCode',selected_reason,'attemptCount',attempt_count));

  RETURN jsonb_build_object('cleaningRequestId',request_record.id,'status','cancelled','previousStatus',previous_status,'reasonCode',selected_reason,'withdrawnAt',withdrawal_time);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.withdraw_cleaning_request(uuid,text) FROM PUBLIC;

COMMIT;
