BEGIN;

CREATE FUNCTION tideway_private.list_administrator_booking_operations(selected_view text, page_limit integer, page_offset integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF selected_view IS NOT NULL AND selected_view NOT IN ('attention','active','finished') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-booking-operation-view';
  END IF;
  IF page_limit NOT BETWEEN 1 AND 100 OR page_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-booking-operation-page';
  END IF;

  WITH request_operations AS (
    SELECT request.id AS request_id, NULL::uuid AS booking_id, 'request'::text AS operation_kind,
      request.status, request.requested_start_at AS scheduled_start_at, request.requested_end_at AS scheduled_end_at,
      request.cleaning_type, cardinality(request.required_services) AS service_count,
      (SELECT count(*)::integer FROM cleaning_request_tasks task WHERE task.cleaning_request_id=request.id) AS task_count,
      0::integer AS completed_task_count,
      NULL::integer AS customer_price_pence, NULL::integer AS cleaner_pay_pence,
      NULL::integer AS planned_costs_pence, NULL::integer AS planned_contribution_pence,
      NULL::integer AS target_margin_basis_points, NULL::text AS payment_status, NULL::text AS case_status,
      request.updated_at,
      CASE request.status
        WHEN 'searching-for-cleaner' THEN 'Find one eligible Cleaner for the reviewed scope.'
        WHEN 'pending-cleaner-acceptance' THEN 'Wait for the invited Cleaner decision or expiry.'
        WHEN 'cancelled' THEN 'No action. The Landlord withdrew this request.'
        ELSE 'Review the submitted request state.'
      END AS next_action,
      request.status IN ('searching-for-cleaner','cleaner-invited','pending-cleaner-acceptance') AS needs_attention,
      request.status NOT IN ('cancelled','matched') AS is_active,
      request.status IN ('cancelled','matched') AS is_finished
    FROM cleaning_requests request
    WHERE request.submitted_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM bookings booking WHERE booking.cleaning_request_id=request.id AND booking.status<>'cancelled')
  ), booking_operations AS (
    SELECT booking.cleaning_request_id AS request_id, booking.id AS booking_id, 'booking'::text AS operation_kind,
      booking.status::text, booking.scheduled_start_at, booking.scheduled_end_at,
      COALESCE(booking.scope_snapshot->>'cleaningType', request.cleaning_type, 'Cleaning') AS cleaning_type,
      COALESCE(cardinality(request.required_services),0) AS service_count,
      (SELECT count(*)::integer FROM cleaning_tasks task WHERE task.booking_id=booking.id) AS task_count,
      (SELECT count(*)::integer FROM cleaning_tasks task WHERE task.booking_id=booking.id AND task.status='completed') AS completed_task_count,
      booking.customer_price_pence, booking.cleaner_pay_pence,
      booking.planned_labour_on_cost_pence + booking.planned_payment_fee_pence + booking.planned_travel_cost_pence + booking.planned_supplies_cost_pence + booking.planned_other_cost_pence AS planned_costs_pence,
      booking.planned_contribution_pence, booking.target_margin_basis_points,
      payment.status AS payment_status,
      dispute.status AS case_status,
      GREATEST(booking.updated_at, COALESCE(payment.updated_at, booking.updated_at), COALESCE(dispute.created_at, booking.updated_at)) AS updated_at,
      CASE
        WHEN dispute.status IN ('open','reviewing') OR booking.status='disputed' THEN 'Review the booking case evidence.'
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
        ELSE 'No booking action is currently required.'
      END AS next_action,
      (dispute.status IN ('open','reviewing') OR booking.status='disputed'
        OR booking.status='pending-cleaner-acceptance'
        OR booking.status='confirmed' AND (payment.id IS NULL OR payment.status IN ('creating','requires-customer-action','processing','authorization-failed'))
        OR booking.status='completed' AND payment.status IN ('authorized','captured')
        OR booking.status='cancelled' AND payment.status IN ('authorized','captured','partially-refunded')) AS needs_attention,
      booking.status NOT IN ('completed','cancelled') AS is_active,
      booking.status IN ('completed','cancelled') AS is_finished
    FROM bookings booking
    LEFT JOIN cleaning_requests request ON request.id=booking.cleaning_request_id
    LEFT JOIN booking_payments payment ON payment.booking_id=booking.id
    LEFT JOIN LATERAL (
      SELECT item.status, item.created_at FROM disputes item
      WHERE item.booking_id=booking.id ORDER BY item.created_at DESC, item.id DESC LIMIT 1
    ) dispute ON true
  ), operations AS (
    SELECT * FROM request_operations UNION ALL SELECT * FROM booking_operations
  ), selected AS (
    SELECT * FROM operations item
    WHERE selected_view IS NULL OR selected_view='attention' AND item.needs_attention
      OR selected_view='active' AND item.is_active OR selected_view='finished' AND item.is_finished
    ORDER BY item.needs_attention DESC, item.is_active DESC, item.scheduled_start_at ASC, item.updated_at DESC,
      COALESCE(item.booking_id,item.request_id)
    LIMIT page_limit OFFSET page_offset
  )
  SELECT jsonb_build_object(
    'operations', COALESCE(jsonb_agg(jsonb_build_object(
      'operationKind', selected.operation_kind,
      'requestId', selected.request_id,
      'bookingId', selected.booking_id,
      'status', selected.status,
      'scheduledStartAt', selected.scheduled_start_at,
      'scheduledEndAt', selected.scheduled_end_at,
      'cleaningType', selected.cleaning_type,
      'serviceCount', selected.service_count,
      'taskCount', selected.task_count,
      'completedTaskCount', selected.completed_task_count,
      'customerPricePence', selected.customer_price_pence,
      'cleanerPayPence', selected.cleaner_pay_pence,
      'plannedCostsPence', selected.planned_costs_pence,
      'plannedContributionPence', selected.planned_contribution_pence,
      'targetMarginBasisPoints', selected.target_margin_basis_points,
      'paymentStatus', selected.payment_status,
      'caseStatus', selected.case_status,
      'needsAttention', selected.needs_attention,
      'nextAction', selected.next_action,
      'updatedAt', selected.updated_at
    ) ORDER BY selected.needs_attention DESC, selected.is_active DESC, selected.scheduled_start_at ASC, selected.updated_at DESC), '[]'::jsonb),
    'limit', page_limit,
    'offset', page_offset
  ) INTO result FROM selected;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.list_administrator_booking_operations(text,integer,integer) FROM PUBLIC;

COMMIT;
