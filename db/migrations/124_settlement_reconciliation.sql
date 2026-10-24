-- Prove the platform fee actually landed.
--
-- Homle's fee is an arithmetic residual. There is no `application_fee_amount`
-- anywhere: the customer's money is captured to the platform balance, the
-- cleaner's share is transferred out, and whatever remains is the fee. That is
-- a legitimate way to run separate charges and transfers, but it means the fee
-- is only correct if the transfer was correct, and nothing ever checked.
--
-- It mattered less while an administrator pressed both buttons by hand and
-- could see the numbers. Automatic settlement removes that person from the
-- loop, which makes an unattended arithmetic check the thing that replaces
-- them.
--
-- This function reports drift. It deliberately moves no money and corrects
-- nothing: an accounting discrepancy is exactly the situation where an
-- automatic correction turns one wrong number into two.
--
-- It also does not assert `captured - transferred = planned contribution`,
-- because a refund legitimately breaks that equality and an alert that fires
-- on normal refunds is an alert everybody learns to ignore. It reports the
-- states that are wrong under any policy:
--
--   over-transferred   the cleaner received more than the customer paid, net
--                      of refunds -- Homle is out of pocket on this booking.
--                      This is the same condition as "the platform kept less
--                      than nothing", so it is reported once rather than twice
--   awaiting-transfer  money captured days ago with no transfer, so a cleaner
--                      has done the work and not been paid
--
-- Refunds exceeding the captured amount is deliberately NOT reported: a table
-- constraint on booking_payments already makes it impossible, and a drift kind
-- that can never fire is noise in a report people need to trust.

BEGIN;

CREATE FUNCTION tideway_private.settlement_reconciliation(stale_transfer_hours integer DEFAULT 72, page_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF stale_transfer_hours NOT BETWEEN 1 AND 8760 OR page_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-reconciliation-window';
  END IF;

  WITH settled AS (
    SELECT
      payment.id AS payment_id,
      payment.booking_id,
      payment.status,
      payment.amount_captured_pence,
      payment.amount_refunded_pence,
      payment.captured_at,
      booking.cleaner_pay_pence,
      booking.planned_contribution_pence,
      -- Only a reconciled transfer has actually moved. A command still pending
      -- with the provider has not left the platform balance yet, and counting
      -- it would report a shortfall that does not exist.
      COALESCE((
        SELECT sum(command.amount_pence)
        FROM payment_commands command
        WHERE command.payment_id = payment.id
          AND command.command_kind = 'transfer'
          AND command.status = 'reconciled'
      ), 0)::integer AS transferred_pence
    FROM booking_payments payment
    JOIN bookings booking ON booking.id = payment.booking_id
    WHERE payment.status IN ('captured','partially-refunded','refunded')
  ),
  assessed AS (
    SELECT
      settled.*,
      settled.amount_captured_pence - settled.amount_refunded_pence AS net_customer_pence,
      settled.amount_captured_pence - settled.amount_refunded_pence - settled.transferred_pence AS platform_take_pence,
      CASE
        WHEN settled.transferred_pence > settled.amount_captured_pence - settled.amount_refunded_pence THEN 'over-transferred'
        WHEN settled.transferred_pence = 0
          AND settled.status = 'captured'
          AND settled.captured_at IS NOT NULL
          AND settled.captured_at < now() - make_interval(hours => stale_transfer_hours)
          THEN 'awaiting-transfer'
        ELSE NULL
      END AS drift
    FROM settled
  )
  SELECT jsonb_build_object(
    'drift', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'paymentId', reported.payment_id,
        'bookingId', reported.booking_id,
        'kind', reported.drift,
        'paymentStatus', reported.status,
        'capturedPence', reported.amount_captured_pence,
        'refundedPence', reported.amount_refunded_pence,
        'transferredPence', reported.transferred_pence,
        'netCustomerPence', reported.net_customer_pence,
        'platformTakePence', reported.platform_take_pence,
        'plannedContributionPence', reported.planned_contribution_pence,
        'capturedAt', reported.captured_at
      ) ORDER BY reported.captured_at)
      FROM (SELECT * FROM assessed WHERE drift IS NOT NULL ORDER BY captured_at LIMIT page_limit) reported
    ), '[]'::jsonb),
    'driftCount', (SELECT count(*) FROM assessed WHERE drift IS NOT NULL),
    'settledCount', (SELECT count(*) FROM assessed),
    -- Totals across every settled booking, so the residual can be checked
    -- against the platform's actual balance rather than trusted row by row.
    'totalCapturedPence', COALESCE((SELECT sum(amount_captured_pence) FROM assessed), 0),
    'totalRefundedPence', COALESCE((SELECT sum(amount_refunded_pence) FROM assessed), 0),
    'totalTransferredPence', COALESCE((SELECT sum(transferred_pence) FROM assessed), 0),
    'totalPlatformTakePence', COALESCE((SELECT sum(platform_take_pence) FROM assessed), 0),
    'staleTransferHours', stale_transfer_hours
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.settlement_reconciliation(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.settlement_reconciliation(integer,integer) TO tideway_app;

COMMIT;
