-- Tell the customer about a refund that arrived through the observation ledger.
--
-- Migration 126 sends a payment-outcome notice only when the status-history
-- row names the provider event kind that caused it, so a status reached by any
-- other route stays silent. Migration 117 then routed every refund event --
-- Homle's own and one made outside Homle -- through
-- `reconcile_payment_observation`, which records the history row with the
-- signed event's id but not its kind. The effect: no refund told the customer
-- anything, by email or in the inbox.
--
-- The kind is resolved from the signed event the row names, never from the
-- status. Rows naming no event, including the dispute path, stay silent as
-- before; an unknown event id stays silent too.

BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.queue_payment_outcome_notice() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  payment_record booking_payments%ROWTYPE;
  causing_event text := NEW.metadata->>'eventKind';
  selected_event text;
BEGIN
  IF causing_event IS NULL AND NEW.event_source = 'provider' AND NEW.metadata ? 'eventId' THEN
    SELECT event.event_kind INTO causing_event
    FROM tideway_private.payment_provider_events event
    WHERE event.provider_event_id = NEW.metadata->>'eventId' AND event.payment_id = NEW.payment_id
    LIMIT 1;
  END IF;

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
