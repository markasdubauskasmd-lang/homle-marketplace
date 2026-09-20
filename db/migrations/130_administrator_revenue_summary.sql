-- Add up the money.
--
-- Every number needed to answer "is this business making anything" already
-- exists per booking: what the customer was charged, what was actually
-- captured, what was refunded, what was transferred to the Cleaner, and the
-- contribution planned when the booking was priced. Nothing summed them. The
-- funnel report states outright that it excludes monetary data, and the
-- reconciliation view in migration 121 is a per-payment exception list rather
-- than a total. So the platform could tell you how many bookings completed and
-- not what they were worth.
--
-- This sums exactly what migration 121 already derives per payment, using the
-- same definitions, because two ways of computing "what the platform kept" is
-- how a business ends up with two answers and trusts neither:
--
--   net customer   = captured - refunded
--   transferred    = reconciled transfer commands only
--   platform take  = net customer - transferred
--
-- "Reconciled only" is the important one. A transfer command still pending
-- with the provider has not left the platform balance, and counting it would
-- report money as gone before it went.
--
-- What this is NOT: profit. It is contribution before every cost that does not
-- pass through this ledger -- the provider's own fees, the AI provider, the
-- hosting, and anybody's time. `plannedContributionPence` is carried alongside
-- so the two can be compared, because a persistent gap between what pricing
-- intended and what the ledger holds is the number that actually matters.
--
-- Aggregate only, and deliberately so: no booking id, no account, no property,
-- no postcode. An operator asking what the month was worth does not need a
-- list of who paid what, and the per-payment desk already exists for the cases
-- that do.

BEGIN;

CREATE FUNCTION tideway_private.get_administrator_revenue(window_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF window_days IS NULL OR window_days NOT IN (7,30,90,365) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-revenue-window';
  END IF;

  WITH settled AS (
    SELECT
      payment.id AS payment_id,
      payment.amount_captured_pence,
      payment.amount_refunded_pence,
      booking.planned_contribution_pence,
      COALESCE((
        SELECT sum(command.amount_pence)
        FROM payment_commands command
        WHERE command.payment_id = payment.id
          AND command.command_kind = 'transfer'
          AND command.status = 'reconciled'
      ), 0)::bigint AS transferred_pence
    FROM booking_payments payment
    JOIN bookings booking ON booking.id = payment.booking_id
    WHERE payment.status IN ('captured','partially-refunded','refunded')
      -- Dated by when the money was taken, not when the booking was made. A
      -- month's revenue is what was captured in it.
      AND payment.captured_at IS NOT NULL
      AND payment.captured_at >= now() - make_interval(days => window_days)
  )
  SELECT jsonb_build_object(
    'windowDays', window_days,
    'generatedAt', now(),
    'capturedCount', count(*),
    'capturedPence', COALESCE(sum(amount_captured_pence), 0),
    'refundedPence', COALESCE(sum(amount_refunded_pence), 0),
    'netCustomerPence', COALESCE(sum(amount_captured_pence - amount_refunded_pence), 0),
    'transferredPence', COALESCE(sum(transferred_pence), 0),
    'platformTakePence', COALESCE(sum(amount_captured_pence - amount_refunded_pence - transferred_pence), 0),
    -- What pricing intended to keep, for the bookings in this window. A
    -- persistent gap between this and platformTakePence is the number worth
    -- acting on; a single booking's gap usually is not.
    'plannedContributionPence', COALESCE(sum(planned_contribution_pence), 0),
    -- Counted rather than inferred from the totals, because "some money is
    -- still owed to Cleaners" and "the fee was small this month" look
    -- identical in a single figure.
    'awaitingTransferCount', COALESCE(sum(CASE WHEN transferred_pence = 0 THEN 1 ELSE 0 END), 0),
    'refundedCount', COALESCE(sum(CASE WHEN amount_refunded_pence > 0 THEN 1 ELSE 0 END), 0)
  ) INTO result FROM settled;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_administrator_revenue(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.get_administrator_revenue(integer) TO tideway_app;

COMMIT;
