BEGIN;

ALTER TABLE bookings
  ADD COLUMN target_contribution_pence integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT bookings_target_contribution_value_check
    CHECK (target_contribution_pence BETWEEN 1 AND 10000000),
  ADD CONSTRAINT bookings_target_contribution_check
    CHECK (planned_contribution_pence >= target_contribution_pence) NOT VALID;

CREATE FUNCTION tideway_private.invite_cleaner(
  proposed_booking_id uuid,
  target_request_id uuid,
  target_cleaner_id uuid,
  response_deadline timestamptz,
  proposed_customer_price_pence integer,
  proposed_cleaner_pay_pence integer,
  proposed_labour_on_cost_pence integer,
  proposed_payment_fee_pence integer,
  proposed_travel_cost_pence integer,
  proposed_supplies_cost_pence integer,
  proposed_other_cost_pence integer,
  proposed_target_margin_basis_points integer,
  proposed_target_contribution_pence integer
) RETURNS bookings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  booking_record bookings%ROWTYPE;
  frozen_terms character(64);
  planned_contribution bigint;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  planned_contribution:=proposed_customer_price_pence::bigint-proposed_cleaner_pay_pence::bigint-
    COALESCE(proposed_labour_on_cost_pence,0)-COALESCE(proposed_payment_fee_pence,0)-
    COALESCE(proposed_travel_cost_pence,0)-COALESCE(proposed_supplies_cost_pence,0)-COALESCE(proposed_other_cost_pence,0);
  IF proposed_target_contribution_pence IS NULL OR proposed_target_contribution_pence NOT BETWEEN 1 AND 10000000
     OR planned_contribution<proposed_target_contribution_pence THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-economics';
  END IF;

  SELECT * INTO booking_record FROM tideway_private.invite_cleaner(
    proposed_booking_id,target_request_id,target_cleaner_id,response_deadline,
    proposed_customer_price_pence,proposed_cleaner_pay_pence,proposed_labour_on_cost_pence,
    proposed_payment_fee_pence,proposed_travel_cost_pence,proposed_supplies_cost_pence,
    proposed_other_cost_pence,proposed_target_margin_basis_points
  );
  frozen_terms:=encode(digest(concat_ws('|',proposed_booking_id::text,booking_record.scope_fingerprint,target_cleaner_id::text,
    proposed_customer_price_pence::text,proposed_cleaner_pay_pence::text,proposed_labour_on_cost_pence::text,
    proposed_payment_fee_pence::text,proposed_travel_cost_pence::text,proposed_supplies_cost_pence::text,
    proposed_other_cost_pence::text,proposed_target_margin_basis_points::text,proposed_target_contribution_pence::text),'sha256'),'hex');
  UPDATE bookings SET target_contribution_pence=proposed_target_contribution_pence,terms_fingerprint=frozen_terms,updated_at=now()
    WHERE id=booking_record.id RETURNING * INTO booking_record;
  UPDATE booking_status_history SET metadata=jsonb_set(metadata,'{termsFingerprint}',to_jsonb(frozen_terms::text),true)
    WHERE booking_id=booking_record.id AND to_status='pending-cleaner-acceptance';
  RETURN booking_record;
END;
$$;

CREATE FUNCTION tideway_private.complete_automatic_dispatch(
  target_request_id uuid,lease_token uuid,proposed_booking_id uuid,target_cleaner_id uuid,response_deadline timestamptz,
  proposed_customer_price_pence integer,proposed_cleaner_pay_pence integer,proposed_labour_on_cost_pence integer,
  proposed_payment_fee_pence integer,proposed_travel_cost_pence integer,proposed_supplies_cost_pence integer,
  proposed_other_cost_pence integer,proposed_target_margin_basis_points integer,proposed_target_contribution_pence integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  dispatch_result jsonb;
  booking_record bookings%ROWTYPE;
  frozen_terms character(64);
  planned_contribution bigint;
BEGIN
  planned_contribution:=proposed_customer_price_pence::bigint-proposed_cleaner_pay_pence::bigint-
    COALESCE(proposed_labour_on_cost_pence,0)-COALESCE(proposed_payment_fee_pence,0)-
    COALESCE(proposed_travel_cost_pence,0)-COALESCE(proposed_supplies_cost_pence,0)-COALESCE(proposed_other_cost_pence,0);
  IF proposed_target_contribution_pence IS NULL OR proposed_target_contribution_pence NOT BETWEEN 1 AND 10000000
     OR planned_contribution<proposed_target_contribution_pence THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-economics';
  END IF;
  dispatch_result:=tideway_private.complete_automatic_dispatch(
    target_request_id,lease_token,proposed_booking_id,target_cleaner_id,response_deadline,
    proposed_customer_price_pence,proposed_cleaner_pay_pence,proposed_labour_on_cost_pence,
    proposed_payment_fee_pence,proposed_travel_cost_pence,proposed_supplies_cost_pence,
    proposed_other_cost_pence,proposed_target_margin_basis_points
  );
  SELECT * INTO booking_record FROM bookings WHERE id=(dispatch_result->>'bookingId')::uuid FOR UPDATE;
  frozen_terms:=encode(digest(concat_ws('|',proposed_booking_id::text,booking_record.scope_fingerprint,target_cleaner_id::text,
    proposed_customer_price_pence::text,proposed_cleaner_pay_pence::text,proposed_labour_on_cost_pence::text,
    proposed_payment_fee_pence::text,proposed_travel_cost_pence::text,proposed_supplies_cost_pence::text,
    proposed_other_cost_pence::text,proposed_target_margin_basis_points::text,proposed_target_contribution_pence::text),'sha256'),'hex');
  UPDATE bookings SET target_contribution_pence=proposed_target_contribution_pence,terms_fingerprint=frozen_terms,updated_at=now()
    WHERE id=booking_record.id;
  UPDATE booking_status_history SET metadata=jsonb_set(metadata,'{termsFingerprint}',to_jsonb(frozen_terms::text),true)
    WHERE booking_id=booking_record.id AND to_status='pending-cleaner-acceptance';
  RETURN dispatch_result||jsonb_build_object('targetContributionPence',proposed_target_contribution_pence);
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.list_administrator_booking_operations(selected_view text,page_limit integer,page_offset integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required';
  END IF;
  IF selected_view IS NOT NULL AND selected_view NOT IN ('attention','active','finished') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-operation-view';
  END IF;
  IF page_limit NOT BETWEEN 1 AND 100 OR page_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-operation-page';
  END IF;

  WITH request_operations AS (
    SELECT request.id AS request_id,NULL::uuid AS booking_id,'request'::text AS operation_kind,
      request.status,request.requested_start_at AS scheduled_start_at,request.requested_end_at AS scheduled_end_at,
      request.cleaning_type,cardinality(request.required_services) AS service_count,
      (SELECT count(*)::integer FROM cleaning_request_tasks task WHERE task.cleaning_request_id=request.id) AS task_count,
      0::integer AS completed_task_count,NULL::integer AS customer_price_pence,NULL::integer AS cleaner_pay_pence,
      NULL::integer AS planned_costs_pence,NULL::integer AS planned_contribution_pence,
      NULL::integer AS target_margin_basis_points,NULL::integer AS target_contribution_pence,
      NULL::text AS payment_status,NULL::text AS case_status,request.updated_at,
      CASE request.status WHEN 'searching-for-cleaner' THEN 'Find one eligible Cleaner for the reviewed scope.'
        WHEN 'pending-cleaner-acceptance' THEN 'Wait for the invited Cleaner decision or expiry.'
        WHEN 'cancelled' THEN 'No action. The Landlord withdrew this request.' ELSE 'Review the submitted request state.' END AS next_action,
      request.status IN ('searching-for-cleaner','cleaner-invited','pending-cleaner-acceptance') AS needs_attention,
      request.status NOT IN ('cancelled','matched') AS is_active,request.status IN ('cancelled','matched') AS is_finished
    FROM cleaning_requests request WHERE request.submitted_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM bookings booking WHERE booking.cleaning_request_id=request.id AND booking.status<>'cancelled')
  ),booking_operations AS (
    SELECT booking.cleaning_request_id AS request_id,booking.id AS booking_id,'booking'::text AS operation_kind,
      booking.status::text,booking.scheduled_start_at,booking.scheduled_end_at,
      COALESCE(booking.scope_snapshot->>'cleaningType',request.cleaning_type,'Cleaning') AS cleaning_type,
      COALESCE(cardinality(request.required_services),0) AS service_count,
      (SELECT count(*)::integer FROM cleaning_tasks task WHERE task.booking_id=booking.id) AS task_count,
      (SELECT count(*)::integer FROM cleaning_tasks task WHERE task.booking_id=booking.id AND task.status='completed') AS completed_task_count,
      booking.customer_price_pence,booking.cleaner_pay_pence,
      booking.planned_labour_on_cost_pence+booking.planned_payment_fee_pence+booking.planned_travel_cost_pence+booking.planned_supplies_cost_pence+booking.planned_other_cost_pence AS planned_costs_pence,
      booking.planned_contribution_pence,booking.target_margin_basis_points,booking.target_contribution_pence,
      payment.status AS payment_status,dispute.status AS case_status,
      GREATEST(booking.updated_at,COALESCE(payment.updated_at,booking.updated_at),COALESCE(dispute.created_at,booking.updated_at)) AS updated_at,
      CASE WHEN dispute.status IN ('open','reviewing') OR booking.status='disputed' THEN 'Review the booking case evidence.'
        WHEN booking.status='pending-cleaner-acceptance' THEN 'Wait for the Cleaner decision before the response deadline.'
        WHEN booking.status='confirmed' AND payment.id IS NULL THEN 'Landlord payment authorization has not started.'
        WHEN booking.status='confirmed' AND payment.status IN ('creating','requires-customer-action','processing','authorization-failed') THEN 'Landlord payment authorization needs attention.'
        WHEN booking.status='confirmed' THEN 'Cleaner starts the journey at the agreed time.'
        WHEN booking.status IN ('cleaner-en-route','cleaner-arrived','cleaning-in-progress') THEN 'Monitor the live visit; intervene only if a case is raised.'
        WHEN booking.status='awaiting-review' THEN 'Landlord confirms completion and can leave a verified review.'
        WHEN booking.status='completed' AND payment.status='authorized' THEN 'Review capture readiness in test payments.'
        WHEN booking.status='completed' AND payment.status='captured' THEN 'Review Cleaner payout readiness in test payments.'
        WHEN booking.status='completed' THEN 'No booking action; verify settlement evidence separately.'
        WHEN booking.status='cancelled' AND payment.status IN ('authorized','captured','partially-refunded') THEN 'Review the separate test-payment remedy.'
        ELSE 'No booking action is currently required.' END AS next_action,
      (dispute.status IN ('open','reviewing') OR booking.status='disputed' OR booking.status='pending-cleaner-acceptance'
        OR booking.status='confirmed' AND (payment.id IS NULL OR payment.status IN ('creating','requires-customer-action','processing','authorization-failed'))
        OR booking.status='completed' AND payment.status IN ('authorized','captured')
        OR booking.status='cancelled' AND payment.status IN ('authorized','captured','partially-refunded')) AS needs_attention,
      booking.status NOT IN ('completed','cancelled') AS is_active,booking.status IN ('completed','cancelled') AS is_finished
    FROM bookings booking LEFT JOIN cleaning_requests request ON request.id=booking.cleaning_request_id
    LEFT JOIN booking_payments payment ON payment.booking_id=booking.id
    LEFT JOIN LATERAL (SELECT item.status,item.created_at FROM disputes item WHERE item.booking_id=booking.id ORDER BY item.created_at DESC,item.id DESC LIMIT 1) dispute ON true
  ),operations AS (SELECT * FROM request_operations UNION ALL SELECT * FROM booking_operations),selected AS (
    SELECT * FROM operations item WHERE selected_view IS NULL OR selected_view='attention' AND item.needs_attention
      OR selected_view='active' AND item.is_active OR selected_view='finished' AND item.is_finished
    ORDER BY item.needs_attention DESC,item.is_active DESC,item.scheduled_start_at,item.updated_at DESC,COALESCE(item.booking_id,item.request_id)
    LIMIT page_limit OFFSET page_offset
  )
  SELECT jsonb_build_object('operations',COALESCE(jsonb_agg(jsonb_build_object(
    'operationKind',selected.operation_kind,'requestId',selected.request_id,'bookingId',selected.booking_id,'status',selected.status,
    'scheduledStartAt',selected.scheduled_start_at,'scheduledEndAt',selected.scheduled_end_at,'cleaningType',selected.cleaning_type,
    'serviceCount',selected.service_count,'taskCount',selected.task_count,'completedTaskCount',selected.completed_task_count,
    'customerPricePence',selected.customer_price_pence,'cleanerPayPence',selected.cleaner_pay_pence,
    'plannedCostsPence',selected.planned_costs_pence,'plannedContributionPence',selected.planned_contribution_pence,
    'targetMarginBasisPoints',selected.target_margin_basis_points,'targetContributionPence',selected.target_contribution_pence,
    'paymentStatus',selected.payment_status,'caseStatus',selected.case_status,'needsAttention',selected.needs_attention,
    'nextAction',selected.next_action,'updatedAt',selected.updated_at
  ) ORDER BY selected.needs_attention DESC,selected.is_active DESC,selected.scheduled_start_at,selected.updated_at DESC),'[]'::jsonb),
  'limit',page_limit,'offset',page_offset) INTO result FROM selected;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.invite_cleaner(uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer) FROM tideway_app;
REVOKE ALL ON FUNCTION tideway_private.invite_cleaner(uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.invite_cleaner(uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer) FROM tideway_worker;
REVOKE ALL ON FUNCTION tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.list_administrator_booking_operations(text,integer,integer) FROM PUBLIC;

COMMIT;
