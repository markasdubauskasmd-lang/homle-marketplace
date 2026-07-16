BEGIN;

ALTER TABLE cleaning_requests
  ADD COLUMN automatic_dispatch_authorized_at timestamptz,
  ADD COLUMN automatic_dispatch_revoked_at timestamptz,
  ADD COLUMN automatic_dispatch_attempt_limit smallint,
  ADD COLUMN automatic_dispatch_next_attempt_at timestamptz,
  ADD COLUMN automatic_dispatch_lease_token uuid,
  ADD COLUMN automatic_dispatch_lease_expires_at timestamptz,
  ADD COLUMN automatic_dispatch_last_evaluated_at timestamptz,
  ADD COLUMN automatic_dispatch_last_result text,
  ADD CONSTRAINT cleaning_requests_dispatch_authorization_check CHECK (
    (automatic_dispatch_authorized_at IS NULL AND automatic_dispatch_attempt_limit IS NULL AND automatic_dispatch_revoked_at IS NULL)
    OR (automatic_dispatch_authorized_at IS NOT NULL AND automatic_dispatch_attempt_limit BETWEEN 1 AND 5)
  ),
  ADD CONSTRAINT cleaning_requests_dispatch_lease_check CHECK (
    (automatic_dispatch_lease_token IS NULL)=(automatic_dispatch_lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT cleaning_requests_dispatch_result_check CHECK (
    automatic_dispatch_last_result IS NULL OR automatic_dispatch_last_result IN (
      'authorized','revoked','invited','no-eligible-candidate','candidates-stale','transient-failure','attempt-limit','request-started'
    )
  );

CREATE INDEX cleaning_requests_automatic_dispatch_due_idx
  ON cleaning_requests(automatic_dispatch_next_attempt_at,requested_start_at,id)
  WHERE status='searching-for-cleaner' AND automatic_dispatch_authorized_at IS NOT NULL AND automatic_dispatch_revoked_at IS NULL;

CREATE FUNCTION tideway_private.configure_automatic_dispatch(target_request_id uuid,enabled boolean,attempt_limit smallint DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); request_record cleaning_requests%ROWTYPE; attempt_count integer;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required'; END IF;
  IF enabled IS NULL OR (enabled AND (attempt_limit IS NULL OR attempt_limit NOT BETWEEN 1 AND 5)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-automatic-dispatch-choice';
  END IF;
  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id=target_request_id AND request.landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found'; END IF;
  IF request_record.status NOT IN ('searching-for-cleaner','pending-cleaner-acceptance') OR request_record.submitted_at IS NULL OR request_record.requested_start_at<=now() THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-not-dispatch-configurable';
  END IF;

  IF enabled THEN
    UPDATE cleaning_requests SET
      automatic_dispatch_authorized_at=now(),
      automatic_dispatch_revoked_at=NULL,
      automatic_dispatch_attempt_limit=attempt_limit,
      automatic_dispatch_next_attempt_at=CASE WHEN status='searching-for-cleaner' THEN now() ELSE NULL END,
      automatic_dispatch_lease_token=NULL,
      automatic_dispatch_lease_expires_at=NULL,
      automatic_dispatch_last_result='authorized',
      updated_at=now()
    WHERE id=request_record.id RETURNING * INTO request_record;
  ELSE
    UPDATE cleaning_requests SET
      automatic_dispatch_revoked_at=CASE WHEN automatic_dispatch_authorized_at IS NULL THEN NULL ELSE COALESCE(automatic_dispatch_revoked_at,now()) END,
      automatic_dispatch_next_attempt_at=NULL,
      automatic_dispatch_lease_token=NULL,
      automatic_dispatch_lease_expires_at=NULL,
      automatic_dispatch_last_result=CASE WHEN automatic_dispatch_authorized_at IS NULL THEN automatic_dispatch_last_result ELSE 'revoked' END,
      updated_at=now()
    WHERE id=request_record.id RETURNING * INTO request_record;
  END IF;
  SELECT count(*)::integer INTO attempt_count FROM bookings booking WHERE booking.cleaning_request_id=request_record.id;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,CASE WHEN enabled THEN 'automatic-dispatch-authorized' ELSE 'automatic-dispatch-revoked' END,'cleaning-request',request_record.id::text,
      jsonb_build_object('enabled',enabled,'attemptLimit',CASE WHEN enabled THEN attempt_limit ELSE request_record.automatic_dispatch_attempt_limit END,'attemptCount',attempt_count));
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'cleaningRequestId',request_record.id,
    'enabled',request_record.automatic_dispatch_authorized_at IS NOT NULL AND request_record.automatic_dispatch_revoked_at IS NULL,
    'attemptLimit',request_record.automatic_dispatch_attempt_limit,
    'attemptCount',attempt_count,
    'authorizedAt',request_record.automatic_dispatch_authorized_at,
    'revokedAt',request_record.automatic_dispatch_revoked_at,
    'nextAttemptAt',request_record.automatic_dispatch_next_attempt_at,
    'lastResult',request_record.automatic_dispatch_last_result
  ));
END;
$$;

CREATE FUNCTION tideway_private.claim_due_automatic_dispatch(lease_token uuid,batch_limit integer DEFAULT 10,lease_seconds integer DEFAULT 120)
RETURNS TABLE(cleaning_request_id uuid,lease_expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE selected_id uuid; selected_expiry timestamptz;
BEGIN
  IF lease_token IS NULL OR batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 50 OR lease_seconds IS NULL OR lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-automatic-dispatch-claim';
  END IF;

  UPDATE cleaning_requests request SET automatic_dispatch_next_attempt_at=NULL,automatic_dispatch_last_result='attempt-limit',automatic_dispatch_last_evaluated_at=now(),updated_at=now()
    WHERE request.status='searching-for-cleaner' AND request.automatic_dispatch_authorized_at IS NOT NULL AND request.automatic_dispatch_revoked_at IS NULL
      AND request.automatic_dispatch_attempt_limit IS NOT NULL
      AND (SELECT count(*) FROM bookings booking WHERE booking.cleaning_request_id=request.id)>=request.automatic_dispatch_attempt_limit;
  UPDATE cleaning_requests request SET automatic_dispatch_next_attempt_at=NULL,automatic_dispatch_last_result='request-started',automatic_dispatch_last_evaluated_at=now(),updated_at=now()
    WHERE request.status='searching-for-cleaner' AND request.automatic_dispatch_authorized_at IS NOT NULL AND request.automatic_dispatch_revoked_at IS NULL
      AND request.requested_start_at<=now();

  FOR selected_id IN
    SELECT request.id FROM cleaning_requests request
    WHERE request.status='searching-for-cleaner' AND request.submitted_at IS NOT NULL
      AND request.automatic_dispatch_authorized_at IS NOT NULL AND request.automatic_dispatch_revoked_at IS NULL
      AND request.automatic_dispatch_attempt_limit IS NOT NULL
      AND COALESCE(request.automatic_dispatch_next_attempt_at,request.automatic_dispatch_authorized_at)<=now()
      AND (request.automatic_dispatch_lease_expires_at IS NULL OR request.automatic_dispatch_lease_expires_at<=now())
      AND request.requested_start_at>now()+interval '15 minutes'
      AND (SELECT count(*) FROM bookings booking WHERE booking.cleaning_request_id=request.id)<request.automatic_dispatch_attempt_limit
    ORDER BY COALESCE(request.automatic_dispatch_next_attempt_at,request.automatic_dispatch_authorized_at),request.requested_start_at,request.id
    FOR UPDATE SKIP LOCKED LIMIT batch_limit
  LOOP
    selected_expiry:=now()+make_interval(secs=>lease_seconds);
    UPDATE cleaning_requests SET automatic_dispatch_lease_token=lease_token,automatic_dispatch_lease_expires_at=selected_expiry,
      automatic_dispatch_last_evaluated_at=now(),updated_at=now() WHERE id=selected_id;
    cleaning_request_id:=selected_id; lease_expires_at:=selected_expiry; RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

CREATE FUNCTION tideway_private.get_automatic_dispatch_candidates(target_request_id uuid,lease_token uuid,result_limit integer DEFAULT 25)
RETURNS SETOF jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_record cleaning_requests%ROWTYPE; candidate_record record;
BEGIN
  IF lease_token IS NULL OR result_limit IS NULL OR result_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-automatic-dispatch-candidate-request';
  END IF;
  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id=target_request_id AND request.status='searching-for-cleaner'
      AND request.automatic_dispatch_authorized_at IS NOT NULL AND request.automatic_dispatch_revoked_at IS NULL
      AND request.automatic_dispatch_lease_token=lease_token AND request.automatic_dispatch_lease_expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='automatic-dispatch-lease-not-found'; END IF;
  PERFORM set_config('app.user_id',request_record.landlord_user_id::text,true);
  PERFORM set_config('app.user_roles','landlord',true);
  FOR candidate_record IN
    SELECT candidate.* FROM tideway_private.recommend_cleaners_for_request(request_record.id,50) candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM bookings prior WHERE prior.cleaning_request_id=request_record.id AND prior.cleaner_user_id=candidate.cleaner_id
    )
    LIMIT result_limit
  LOOP RETURN NEXT to_jsonb(candidate_record); END LOOP;
  RETURN;
END;
$$;

CREATE FUNCTION tideway_private.complete_automatic_dispatch(
  target_request_id uuid,lease_token uuid,proposed_booking_id uuid,target_cleaner_id uuid,response_deadline timestamptz,
  proposed_customer_price_pence integer,proposed_cleaner_pay_pence integer,proposed_labour_on_cost_pence integer,
  proposed_payment_fee_pence integer,proposed_travel_cost_pence integer,proposed_supplies_cost_pence integer,
  proposed_other_cost_pence integer,proposed_target_margin_basis_points integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_record cleaning_requests%ROWTYPE; booking_record bookings%ROWTYPE; attempt_count integer;
BEGIN
  IF lease_token IS NULL OR proposed_booking_id IS NULL OR target_cleaner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-automatic-dispatch-completion';
  END IF;
  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id=target_request_id AND request.status='searching-for-cleaner'
      AND request.automatic_dispatch_authorized_at IS NOT NULL AND request.automatic_dispatch_revoked_at IS NULL
      AND request.automatic_dispatch_lease_token=lease_token AND request.automatic_dispatch_lease_expires_at>now()
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='automatic-dispatch-lease-not-found'; END IF;
  SELECT count(*)::integer INTO attempt_count FROM bookings booking WHERE booking.cleaning_request_id=request_record.id;
  IF attempt_count>=request_record.automatic_dispatch_attempt_limit THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='automatic-dispatch-attempt-limit'; END IF;
  IF EXISTS(SELECT 1 FROM bookings prior WHERE prior.cleaning_request_id=request_record.id AND prior.cleaner_user_id=target_cleaner_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='automatic-dispatch-cleaner-already-tried';
  END IF;
  PERFORM set_config('app.user_id',request_record.landlord_user_id::text,true);
  PERFORM set_config('app.user_roles','landlord',true);
  SELECT * INTO booking_record FROM tideway_private.invite_cleaner(
    proposed_booking_id,request_record.id,target_cleaner_id,response_deadline,
    proposed_customer_price_pence,proposed_cleaner_pay_pence,proposed_labour_on_cost_pence,
    proposed_payment_fee_pence,proposed_travel_cost_pence,proposed_supplies_cost_pence,
    proposed_other_cost_pence,proposed_target_margin_basis_points
  );
  UPDATE booking_status_history SET changed_by=NULL,change_source='system',reason='Cleaner invited by Landlord-authorized automatic dispatch.',
    metadata=metadata||jsonb_build_object('automaticDispatch',true,'authorizedBy',request_record.landlord_user_id)
    WHERE booking_id=booking_record.id AND to_status='pending-cleaner-acceptance' AND change_source='user';
  UPDATE cleaning_request_status_history SET changed_by=NULL,change_source='system',reason='Landlord-authorized automatic dispatch created one Cleaner invitation.',
    metadata=metadata||jsonb_build_object('automaticDispatch',true,'authorizedBy',request_record.landlord_user_id)
    WHERE cleaning_request_id=request_record.id AND to_status='pending-cleaner-acceptance' AND metadata->>'bookingId'=booking_record.id::text AND change_source='user';
  UPDATE cleaning_requests SET automatic_dispatch_lease_token=NULL,automatic_dispatch_lease_expires_at=NULL,
    automatic_dispatch_next_attempt_at=NULL,automatic_dispatch_last_evaluated_at=now(),automatic_dispatch_last_result='invited',updated_at=now()
    WHERE id=request_record.id;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(request_record.landlord_user_id,'automatic-dispatch-invited','booking',booking_record.id::text,
      jsonb_build_object('cleaningRequestId',request_record.id,'cleanerUserId',target_cleaner_id,'attemptNumber',attempt_count+1));
  RETURN jsonb_build_object('cleaningRequestId',request_record.id,'bookingId',booking_record.id,'cleanerId',booking_record.cleaner_user_id,
    'status',booking_record.status,'attemptNumber',attempt_count+1,'responseDeadline',booking_record.cleaner_response_deadline);
END;
$$;

CREATE FUNCTION tideway_private.release_automatic_dispatch_lease(target_request_id uuid,lease_token uuid,outcome text,retry_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_record cleaning_requests%ROWTYPE;
BEGIN
  IF lease_token IS NULL OR outcome NOT IN ('no-eligible-candidate','candidates-stale','transient-failure')
    OR retry_at IS NULL OR retry_at<now()+interval '1 minute' OR retry_at>now()+interval '24 hours' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-automatic-dispatch-release';
  END IF;
  UPDATE cleaning_requests SET automatic_dispatch_lease_token=NULL,automatic_dispatch_lease_expires_at=NULL,
    automatic_dispatch_next_attempt_at=retry_at,automatic_dispatch_last_evaluated_at=now(),automatic_dispatch_last_result=outcome,updated_at=now()
    WHERE id=target_request_id AND automatic_dispatch_lease_token=lease_token
    RETURNING * INTO request_record;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='automatic-dispatch-lease-not-found'; END IF;
  RETURN jsonb_build_object('cleaningRequestId',request_record.id,'outcome',outcome,'nextAttemptAt',request_record.automatic_dispatch_next_attempt_at);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.configure_automatic_dispatch(uuid,boolean,smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.claim_due_automatic_dispatch(uuid,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_automatic_dispatch_candidates(uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.release_automatic_dispatch_lease(uuid,uuid,text,timestamptz) FROM PUBLIC;

COMMIT;
