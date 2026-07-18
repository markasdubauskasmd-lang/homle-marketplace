BEGIN;

CREATE FUNCTION tideway_private.get_administrator_booking_payment_operation(selected_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF selected_booking_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-operation-booking';
  END IF;

  WITH payment_state AS (
    SELECT payment.id AS payment_id,
      payment.booking_id,
      payment.status AS payment_status,
      booking.status AS booking_status,
      booking.journey_started_at,
      booking.scheduled_start_at,
      booking.scheduled_end_at,
      payment.amount_pence,
      payment.currency,
      payment.amount_captured_pence,
      payment.amount_refunded_pence,
      booking.cleaner_pay_pence,
      payment.updated_at,
      payout.payouts_enabled IS TRUE AND payout.details_submitted IS TRUE AS payout_ready,
      capture_command.status AS capture_status,
      refund_command.status AS refund_status,
      transfer_command.status AS transfer_status,
      cancel_command.status AS cancel_status
    FROM booking_payments payment
    JOIN bookings booking ON booking.id=payment.booking_id
    LEFT JOIN tideway_private.cleaner_payout_accounts payout
      ON payout.cleaner_user_id=payment.cleaner_user_id AND payout.provider=payment.provider
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='capture'
      ORDER BY command.created_at DESC LIMIT 1
    ) capture_command ON true
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='refund'
      ORDER BY command.created_at DESC LIMIT 1
    ) refund_command ON true
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='transfer'
      ORDER BY command.created_at DESC LIMIT 1
    ) transfer_command ON true
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='cancel'
      ORDER BY command.created_at DESC LIMIT 1
    ) cancel_command ON true
    WHERE payment.booking_id=selected_booking_id
  ), projected AS (
    SELECT state.*,
      state.booking_status='completed' AND state.payment_status='authorized'
        AND (state.capture_status IS NULL OR state.capture_status='provider-failed') AS can_capture,
      state.booking_status='confirmed' AND state.payment_status IN ('creating','requires-customer-action','processing','authorized')
        AND state.journey_started_at IS NULL AND (state.cancel_status IS NULL OR state.cancel_status='provider-failed') AS can_cancel,
      state.booking_status IN ('completed','cancelled','disputed') AND state.payment_status IN ('captured','partially-refunded')
        AND state.amount_captured_pence>state.amount_refunded_pence
        AND state.refund_status IS DISTINCT FROM 'created' AND state.refund_status IS DISTINCT FROM 'provider-pending'
        AND (state.transfer_status IS NULL OR state.transfer_status='provider-failed') AS can_refund,
      state.booking_status='completed' AND state.payment_status='captured'
        AND state.amount_captured_pence=state.amount_pence AND state.payout_ready
        AND state.refund_status IS DISTINCT FROM 'created' AND state.refund_status IS DISTINCT FROM 'provider-pending'
        AND (state.transfer_status IS NULL OR state.transfer_status='provider-failed') AS can_transfer,
      state.capture_status IN ('created','provider-pending') OR state.refund_status IN ('created','provider-pending')
        OR state.transfer_status IN ('created','provider-pending') OR state.cancel_status IN ('created','provider-pending') AS awaiting_provider
    FROM payment_state state
  )
  SELECT jsonb_build_object(
    'paymentId', selected.payment_id,
    'bookingId', selected.booking_id,
    'paymentStatus', selected.payment_status,
    'bookingStatus', selected.booking_status,
    'scheduledStartAt', selected.scheduled_start_at,
    'scheduledEndAt', selected.scheduled_end_at,
    'amountPence', selected.amount_pence,
    'currency', selected.currency,
    'amountCapturedPence', selected.amount_captured_pence,
    'amountRefundedPence', selected.amount_refunded_pence,
    'cleanerPayPence', selected.cleaner_pay_pence,
    'payoutReady', selected.payout_ready,
    'canCapture', selected.can_capture,
    'canCancel', selected.can_cancel,
    'canRefund', selected.can_refund,
    'canTransfer', selected.can_transfer,
    'awaitingProvider', selected.awaiting_provider,
    'captureStatus', selected.capture_status,
    'cancelStatus', selected.cancel_status,
    'refundStatus', selected.refund_status,
    'transferStatus', selected.transfer_status,
    'updatedAt', selected.updated_at
  ) INTO result
  FROM projected selected
  LIMIT 1;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_administrator_booking_payment_operation(uuid) FROM PUBLIC;

COMMIT;
