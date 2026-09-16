BEGIN;

-- A synchronous create/retrieve response may arrive after a signed webhook.
-- Attach its identity, but never overwrite authorized/completed ledger state.
CREATE OR REPLACE FUNCTION tideway_private.record_booking_payment_authorization(target_payment_id uuid, supplied_provider_payment_id text, provider_status text)
RETURNS booking_payments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  payment_row booking_payments%ROWTYPE;
  prior_status text;
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='payment-role-required'; END IF;
  IF provider_status IS NULL OR provider_status NOT IN ('requires-customer-action','processing','authorized','failed') OR char_length(COALESCE(supplied_provider_payment_id,'')) NOT BETWEEN 3 AND 255 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-provider-authorization'; END IF;
  SELECT * INTO payment_row FROM booking_payments WHERE id=target_payment_id AND (landlord_user_id=actor_id OR tideway_private.has_role('administrator')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='payment-not-found'; END IF;
  IF payment_row.provider_payment_id IS NOT NULL AND payment_row.provider_payment_id <> supplied_provider_payment_id THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='provider-payment-conflict'; END IF;
  IF payment_row.status <> 'creating' AND payment_row.provider_payment_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM tideway_private.payment_provider_events event
    WHERE event.provider=payment_row.provider AND event.payment_id=payment_row.id
      AND event.provider_object_id=supplied_provider_payment_id AND event.command_id IS NULL
      AND event.event_kind IN ('authorization-requires-action','authorization-processing','authorization-succeeded','authorization-failed')
      AND event.processed AND event.result_code='processed'
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-state-conflict'; END IF;

  IF payment_row.status IN ('authorized','captured','partially-refunded','refunded','cancelled','disputed')
    OR (payment_row.status='authorization-failed' AND payment_row.last_provider_event_at IS NOT NULL AND provider_status <> 'requires-customer-action') THEN
    UPDATE booking_payments SET provider_payment_id=COALESCE(provider_payment_id,supplied_provider_payment_id)
      WHERE id=payment_row.id RETURNING * INTO payment_row;
    RETURN payment_row;
  END IF;

  prior_status := payment_row.status;
  UPDATE booking_payments SET provider_payment_id=supplied_provider_payment_id,
    status=CASE provider_status WHEN 'failed' THEN 'authorization-failed' WHEN 'authorized' THEN 'processing' ELSE provider_status END,
    updated_at=now() WHERE id=payment_row.id RETURNING * INTO payment_row;
  IF prior_status <> payment_row.status THEN
    INSERT INTO payment_status_history(payment_id,from_status,to_status,event_source,changed_by,reason)
      VALUES(payment_row.id,prior_status,payment_row.status,CASE WHEN tideway_private.has_role('administrator') THEN 'administrator' ELSE 'landlord' END,actor_id,'Provider authorization was attached; signed events remain authoritative.');
  END IF;
  RETURN payment_row;
END;
$$;

COMMIT;
