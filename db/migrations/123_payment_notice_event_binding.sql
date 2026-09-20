-- Stop a chargeback telling the customer their payment was taken.
--
-- Migration 117 decided which notice to send from `to_status` alone. That was
-- wrong, and wrong in the most expensive direction: arriving at `captured` or
-- `refunded` does not only happen when money moves.
--
-- Dispute reconciliation recomputes the payment's status from the captured and
-- refunded totals and writes a history row whose own reason says it changed
-- neither (migration 112). So closing a chargeback in Homle's favour produces
-- `disputed -> captured`, and migration 117 emailed the customer "Payment taken
-- for your clean. Your receipt is on the booking" — weeks after the charge,
-- in the middle of a dispute, which is the worst possible moment to tell
-- somebody their money has just been taken. Closing one against Homle produces
-- `disputed -> refunded` and emailed "A refund was issued... it can take a few
-- days to reach your account", when no refund was issued: the bank pulled the
-- money. Both are materially false statements about somebody's money, sent by
-- email, and unrecallable.
--
-- The fix binds each notice to the provider event that caused the transition
-- rather than to the status it produced. A genuine capture or refund records
-- `eventKind` in the history metadata; the dispute path records `disputeId` and
-- no `eventKind`. Requiring the exact event kind means a status that arrives by
-- any other route stays silent, including routes added later — silence being
-- the correct default for a message about somebody's money.

BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.queue_payment_outcome_notice() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  payment_record booking_payments%ROWTYPE;
  causing_event text := NEW.metadata->>'eventKind';
  selected_event text;
BEGIN
  -- No causing provider event means this transition was not a capture, refund
  -- or authorization failure, whatever status it landed on.
  IF causing_event IS NULL OR NEW.to_status IS NOT DISTINCT FROM NEW.from_status THEN
    RETURN NEW;
  END IF;

  selected_event := CASE
    WHEN NEW.to_status = 'captured' AND causing_event = 'capture-succeeded' THEN 'payment-captured'
    WHEN NEW.to_status IN ('refunded','partially-refunded') AND causing_event = 'refund-succeeded' THEN 'payment-refunded'
    WHEN NEW.to_status = 'authorization-failed' AND causing_event = 'authorization-failed' THEN 'payment-failed'
    ELSE NULL
  END;
  IF selected_event IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO payment_record FROM booking_payments WHERE id = NEW.payment_id;
  IF payment_record.id IS NULL OR payment_record.landlord_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Keyed on the history row, which is unique by construction. A partial refund
  -- can legitimately happen more than once on one payment, so keying on the
  -- payment and status would silently drop the second notice.
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
    VALUES (
      payment_record.landlord_user_id,
      payment_record.booking_id,
      selected_event,
      'in-app',
      jsonb_build_object('bookingId', payment_record.booking_id),
      'payment-status:' || NEW.id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMIT;
