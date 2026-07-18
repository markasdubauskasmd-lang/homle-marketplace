BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.complete_automatic_dispatch(
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
  approved_maximum_customer_price_pence integer;
BEGIN
  SELECT request.budget_pence INTO approved_maximum_customer_price_pence
    FROM cleaning_requests request WHERE request.id=target_request_id;
  IF approved_maximum_customer_price_pence IS NULL
     OR proposed_customer_price_pence IS NULL
     OR proposed_customer_price_pence>approved_maximum_customer_price_pence THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='automatic-dispatch-price-cap-required';
  END IF;
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
  UPDATE audit_logs SET metadata=metadata||jsonb_build_object('approvedMaximumCustomerPricePence',approved_maximum_customer_price_pence)
    WHERE action='automatic-dispatch-invited' AND resource_type='booking' AND resource_id=booking_record.id::text;
  RETURN dispatch_result||jsonb_build_object(
    'targetContributionPence',proposed_target_contribution_pence,
    'maximumCustomerPricePence',approved_maximum_customer_price_pence
  );
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer,integer) FROM PUBLIC;

COMMIT;
