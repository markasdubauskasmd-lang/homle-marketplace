BEGIN;

-- A Landlord may move an open, reviewed request without cloning it. The
-- duration is deliberately preserved: changing it would invalidate the saved
-- platform quote and the reviewed cleaning scope.
CREATE FUNCTION tideway_private.reschedule_open_cleaning_request(target_request_id uuid,new_requested_start_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  request_record cleaning_requests%ROWTYPE;
  new_requested_end_at timestamptz;
  new_scope_fingerprint character(64);
  changed_at timestamptz:=now();
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;

  SELECT * INTO request_record
  FROM cleaning_requests request
  WHERE request.id=target_request_id AND request.landlord_user_id=actor_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found'; END IF;
  IF request_record.status<>'searching-for-cleaner' OR request_record.submitted_at IS NULL OR request_record.customer_scope_confirmed_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-not-reschedulable';
  END IF;
  IF new_requested_start_at IS NULL OR new_requested_start_at<=changed_at OR new_requested_start_at>changed_at+interval '366 days' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-request-reschedule-window';
  END IF;
  IF request_record.requested_end_at<=request_record.requested_start_at
    OR request_record.requested_end_at-request_record.requested_start_at<interval '30 minutes'
    OR request_record.requested_end_at-request_record.requested_start_at>interval '16 hours' THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-not-reschedulable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bookings booking
    WHERE booking.cleaning_request_id=request_record.id AND booking.status<>'cancelled'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-live-booking';
  END IF;

  new_requested_end_at:=new_requested_start_at+(request_record.requested_end_at-request_record.requested_start_at);
  IF new_requested_start_at=request_record.requested_start_at THEN
    RETURN jsonb_build_object(
      'cleaningRequestId',request_record.id,
      'status',request_record.status,
      'requestedStartAt',request_record.requested_start_at,
      'requestedEndAt',request_record.requested_end_at,
      'scopeFingerprint',request_record.scope_fingerprint,
      'rescheduledAt',changed_at
    );
  END IF;

  new_scope_fingerprint:=encode(digest(concat_ws('|',request_record.scope_fingerprint,'rescheduled',new_requested_start_at::text,new_requested_end_at::text),'sha256'),'hex');
  UPDATE cleaning_requests SET
    requested_start_at=new_requested_start_at,
    requested_end_at=new_requested_end_at,
    scope_fingerprint=new_scope_fingerprint,
    customer_scope_confirmed_at=changed_at,
    automatic_dispatch_next_attempt_at=CASE
      WHEN automatic_dispatch_authorized_at IS NOT NULL AND automatic_dispatch_revoked_at IS NULL THEN changed_at
      ELSE NULL
    END,
    automatic_dispatch_lease_token=NULL,
    automatic_dispatch_lease_expires_at=NULL,
    automatic_dispatch_last_evaluated_at=NULL,
    automatic_dispatch_last_result=CASE
      WHEN automatic_dispatch_authorized_at IS NOT NULL AND automatic_dispatch_revoked_at IS NULL THEN 'authorized'
      ELSE automatic_dispatch_last_result
    END,
    updated_at=changed_at
  WHERE id=request_record.id;

  INSERT INTO cleaning_request_status_history(cleaning_request_id,from_status,to_status,changed_by,reason,metadata)
  VALUES(request_record.id,'searching-for-cleaner','searching-for-cleaner',actor_id,'Landlord changed the requested start time before a live Cleaner invitation or booking existed.',jsonb_build_object(
    'previousRequestedStartAt',request_record.requested_start_at,
    'previousRequestedEndAt',request_record.requested_end_at,
    'requestedStartAt',new_requested_start_at,
    'requestedEndAt',new_requested_end_at,
    'previousScopeFingerprint',request_record.scope_fingerprint,
    'scopeFingerprint',new_scope_fingerprint
  ));
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  VALUES(actor_id,'cleaning-request-rescheduled','cleaning-request',request_record.id::text,jsonb_build_object(
    'previousRequestedStartAt',request_record.requested_start_at,
    'previousRequestedEndAt',request_record.requested_end_at,
    'requestedStartAt',new_requested_start_at,
    'requestedEndAt',new_requested_end_at,
    'scopeFingerprint',new_scope_fingerprint
  ));

  RETURN jsonb_build_object(
    'cleaningRequestId',request_record.id,
    'status','searching-for-cleaner',
    'requestedStartAt',new_requested_start_at,
    'requestedEndAt',new_requested_end_at,
    'scopeFingerprint',new_scope_fingerprint,
    'rescheduledAt',changed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.reschedule_open_cleaning_request(uuid,timestamptz) FROM PUBLIC;

COMMIT;
