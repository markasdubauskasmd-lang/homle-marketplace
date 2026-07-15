BEGIN;

ALTER TABLE bookings DROP CONSTRAINT bookings_cleaning_request_id_key;
CREATE UNIQUE INDEX bookings_one_live_attempt_per_request_idx
  ON bookings(cleaning_request_id)
  WHERE cleaning_request_id IS NOT NULL AND status <> 'cancelled';

ALTER TABLE bookings
  ADD COLUMN invited_at timestamptz,
  ADD COLUMN cleaner_response_deadline timestamptz,
  ADD COLUMN responded_at timestamptz,
  ADD COLUMN decline_reason text CHECK (char_length(decline_reason) <= 1000),
  ADD COLUMN scope_fingerprint character(64),
  ADD COLUMN terms_fingerprint character(64),
  ADD COLUMN scope_snapshot jsonb,
  ADD COLUMN planned_labour_on_cost_pence integer NOT NULL DEFAULT 0 CHECK (planned_labour_on_cost_pence >= 0),
  ADD COLUMN planned_payment_fee_pence integer NOT NULL DEFAULT 0 CHECK (planned_payment_fee_pence >= 0),
  ADD COLUMN planned_travel_cost_pence integer NOT NULL DEFAULT 0 CHECK (planned_travel_cost_pence >= 0),
  ADD COLUMN planned_supplies_cost_pence integer NOT NULL DEFAULT 0 CHECK (planned_supplies_cost_pence >= 0),
  ADD COLUMN planned_other_cost_pence integer NOT NULL DEFAULT 0 CHECK (planned_other_cost_pence >= 0),
  ADD COLUMN target_margin_basis_points integer NOT NULL DEFAULT 0 CHECK (target_margin_basis_points BETWEEN 0 AND 10000),
  ADD COLUMN planned_contribution_pence integer GENERATED ALWAYS AS (
    customer_price_pence - cleaner_pay_pence - planned_labour_on_cost_pence -
    planned_payment_fee_pence - planned_travel_cost_pence - planned_supplies_cost_pence - planned_other_cost_pence
  ) STORED;

UPDATE bookings booking
SET invited_at = booking.created_at,
    cleaner_response_deadline = LEAST(booking.scheduled_start_at, booking.created_at + interval '24 hours'),
    scope_fingerprint = COALESCE(request.scope_fingerprint, encode(digest(booking.id::text, 'sha256'), 'hex')),
    terms_fingerprint = encode(digest(concat_ws('|', booking.id::text, booking.customer_price_pence::text, booking.cleaner_pay_pence::text), 'sha256'), 'hex'),
    scope_snapshot = jsonb_build_object('legacyBooking', true, 'cleaningRequestId', booking.cleaning_request_id)
FROM cleaning_requests request
WHERE request.id = booking.cleaning_request_id;

UPDATE bookings booking
SET invited_at = booking.created_at,
    cleaner_response_deadline = LEAST(booking.scheduled_start_at, booking.created_at + interval '24 hours'),
    scope_fingerprint = encode(digest(booking.id::text, 'sha256'), 'hex'),
    terms_fingerprint = encode(digest(concat_ws('|', booking.id::text, booking.customer_price_pence::text, booking.cleaner_pay_pence::text), 'sha256'), 'hex'),
    scope_snapshot = jsonb_build_object('legacyBooking', true)
WHERE booking.scope_fingerprint IS NULL;

ALTER TABLE bookings
  ALTER COLUMN invited_at SET NOT NULL,
  ALTER COLUMN cleaner_response_deadline SET NOT NULL,
  ALTER COLUMN scope_fingerprint SET NOT NULL,
  ALTER COLUMN terms_fingerprint SET NOT NULL,
  ALTER COLUMN scope_snapshot SET NOT NULL,
  ADD CONSTRAINT bookings_scope_fingerprint_check CHECK (scope_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT bookings_terms_fingerprint_check CHECK (terms_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT bookings_response_window_check CHECK (cleaner_response_deadline <= scheduled_start_at),
  ADD CONSTRAINT bookings_positive_contribution_check CHECK (planned_contribution_pence > 0) NOT VALID,
  ADD CONSTRAINT bookings_target_margin_check CHECK (planned_contribution_pence::bigint * 10000 >= customer_price_pence::bigint * target_margin_basis_points) NOT VALID;

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
  proposed_target_margin_basis_points integer
) RETURNS bookings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  request_record cleaning_requests%ROWTYPE;
  booking_record bookings%ROWTYPE;
  frozen_scope jsonb;
  frozen_terms character(64);
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'landlord-required';
  END IF;

  SELECT * INTO request_record FROM cleaning_requests request
  WHERE request.id = target_request_id
    AND (request.landlord_user_id = actor_id OR tideway_private.has_role('administrator'))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'request-not-found'; END IF;
  IF request_record.status <> 'searching-for-cleaner' OR request_record.submitted_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'request-not-matchable';
  END IF;
  IF request_record.requested_start_at <= now() OR response_deadline <= now() OR response_deadline > request_record.requested_start_at THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid-response-window';
  END IF;
  IF proposed_customer_price_pence IS NULL OR proposed_cleaner_pay_pence IS NULL OR
     proposed_customer_price_pence < 1 OR proposed_cleaner_pay_pence < 1 OR
     proposed_customer_price_pence > 10000000 OR proposed_cleaner_pay_pence > 10000000 OR
     COALESCE(proposed_labour_on_cost_pence, -1) < 0 OR COALESCE(proposed_payment_fee_pence, -1) < 0 OR
     COALESCE(proposed_travel_cost_pence, -1) < 0 OR COALESCE(proposed_supplies_cost_pence, -1) < 0 OR
     COALESCE(proposed_other_cost_pence, -1) < 0 OR COALESCE(proposed_target_margin_basis_points, -1) NOT BETWEEN 0 AND 10000 OR
     (request_record.budget_pence IS NOT NULL AND proposed_customer_price_pence > request_record.budget_pence) OR
     proposed_customer_price_pence - proposed_cleaner_pay_pence - proposed_labour_on_cost_pence -
       proposed_payment_fee_pence - proposed_travel_cost_pence - proposed_supplies_cost_pence - proposed_other_cost_pence <= 0 OR
     (proposed_customer_price_pence - proposed_cleaner_pay_pence - proposed_labour_on_cost_pence -
       proposed_payment_fee_pence - proposed_travel_cost_pence - proposed_supplies_cost_pence - proposed_other_cost_pence)::bigint * 10000 <
       proposed_customer_price_pence::bigint * proposed_target_margin_basis_points THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid-booking-economics';
  END IF;

  PERFORM 1 FROM cleaner_profiles profile
  WHERE profile.user_id = target_cleaner_id AND profile.is_public
    AND profile.profile_completion_percent = 100 AND profile.current_availability_status <> 'unavailable'
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cleaner-not-eligible'; END IF;
  IF EXISTS (
    SELECT required.service_code FROM unnest(request_record.required_services) AS required(service_code)
    EXCEPT SELECT service.service_code FROM cleaner_services service
      WHERE service.cleaner_user_id = target_cleaner_id AND service.is_active
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cleaner-services-mismatch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cleaner_availability availability
    WHERE availability.cleaner_user_id = target_cleaner_id AND availability.status = 'available'
      AND availability.starts_at <= request_record.requested_start_at
      AND availability.ends_at >= request_record.requested_end_at
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cleaner-unavailable'; END IF;

  SELECT jsonb_build_object(
    'scopeFingerprint', request_record.scope_fingerprint,
    'propertyId', request_record.property_id,
    'requestedStartAt', request_record.requested_start_at,
    'requestedEndAt', request_record.requested_end_at,
    'cleaningType', request_record.cleaning_type,
    'requiredServices', request_record.required_services,
    'specialInstructions', request_record.special_instructions,
    'tasks', COALESCE(jsonb_agg(jsonb_build_object('roomName', task.room_name, 'description', task.description, 'sortOrder', task.sort_order) ORDER BY task.sort_order) FILTER (WHERE task.id IS NOT NULL), '[]'::jsonb)
  ) INTO frozen_scope
  FROM cleaning_request_tasks task WHERE task.cleaning_request_id = request_record.id;
  frozen_terms := encode(digest(concat_ws('|', proposed_booking_id::text, request_record.scope_fingerprint, target_cleaner_id::text,
    proposed_customer_price_pence::text, proposed_cleaner_pay_pence::text, proposed_labour_on_cost_pence::text,
    proposed_payment_fee_pence::text, proposed_travel_cost_pence::text, proposed_supplies_cost_pence::text,
    proposed_other_cost_pence::text, proposed_target_margin_basis_points::text), 'sha256'), 'hex');

  INSERT INTO bookings (
    id, cleaning_request_id, landlord_user_id, cleaner_user_id, property_id, status,
    scheduled_start_at, scheduled_end_at, customer_price_pence, cleaner_pay_pence,
    invited_at, cleaner_response_deadline, scope_fingerprint, terms_fingerprint, scope_snapshot,
    planned_labour_on_cost_pence, planned_payment_fee_pence, planned_travel_cost_pence,
    planned_supplies_cost_pence, planned_other_cost_pence, target_margin_basis_points
  ) VALUES (
    proposed_booking_id, request_record.id, request_record.landlord_user_id, target_cleaner_id, request_record.property_id,
    'pending-cleaner-acceptance', request_record.requested_start_at, request_record.requested_end_at,
    proposed_customer_price_pence, proposed_cleaner_pay_pence, now(), response_deadline,
    request_record.scope_fingerprint, frozen_terms, frozen_scope, proposed_labour_on_cost_pence,
    proposed_payment_fee_pence, proposed_travel_cost_pence, proposed_supplies_cost_pence,
    proposed_other_cost_pence, proposed_target_margin_basis_points
  ) RETURNING * INTO booking_record;

  INSERT INTO cleaning_tasks (booking_id, room_name, description, sort_order)
    SELECT booking_record.id, task.room_name, task.description, task.sort_order
    FROM cleaning_request_tasks task WHERE task.cleaning_request_id = request_record.id ORDER BY task.sort_order;
  INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason, metadata)
    VALUES (booking_record.id, NULL, 'pending-cleaner-acceptance', actor_id, 'Cleaner invited with frozen scope and terms.', jsonb_build_object('scopeFingerprint', request_record.scope_fingerprint, 'termsFingerprint', frozen_terms));
  UPDATE cleaning_requests SET status = 'pending-cleaner-acceptance', updated_at = now() WHERE id = request_record.id;
  INSERT INTO cleaning_request_status_history (cleaning_request_id, from_status, to_status, changed_by, reason, metadata)
    VALUES (request_record.id, request_record.status, 'pending-cleaner-acceptance', actor_id, 'Cleaner invitation created.', jsonb_build_object('bookingId', booking_record.id));
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
    VALUES (target_cleaner_id, booking_record.id, 'new-booking-request', 'in-app', jsonb_build_object('bookingId', booking_record.id, 'responseDeadline', response_deadline), 'booking:' || booking_record.id || ':invited')
    ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN booking_record;
END;
$$;

CREATE FUNCTION tideway_private.respond_to_cleaner_invitation(target_booking_id uuid, decision text, supplied_reason text DEFAULT NULL)
RETURNS bookings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
  request_record cleaning_requests%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cleaner-required';
  END IF;
  IF decision NOT IN ('accept', 'decline') OR char_length(COALESCE(supplied_reason, '')) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid-invitation-response';
  END IF;
  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id = target_booking_id AND booking.cleaner_user_id = actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'booking-not-found'; END IF;
  IF booking_record.status = 'confirmed' AND decision = 'accept' THEN RETURN booking_record; END IF;
  IF booking_record.status = 'cancelled' AND booking_record.responded_at IS NOT NULL AND decision = 'decline' THEN RETURN booking_record; END IF;
  IF booking_record.status <> 'pending-cleaner-acceptance' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invitation-not-pending';
  END IF;
  SELECT * INTO request_record FROM cleaning_requests request WHERE request.id = booking_record.cleaning_request_id FOR UPDATE;

  IF decision = 'decline' THEN
    UPDATE bookings SET status = 'cancelled', responded_at = now(), decline_reason = NULLIF(trim(supplied_reason), ''), cancelled_at = now(), updated_at = now()
      WHERE id = booking_record.id RETURNING * INTO booking_record;
    UPDATE cleaning_requests SET status = 'searching-for-cleaner', updated_at = now() WHERE id = request_record.id;
    INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason)
      VALUES (booking_record.id, 'pending-cleaner-acceptance', 'cancelled', actor_id, COALESCE(NULLIF(trim(supplied_reason), ''), 'Cleaner declined invitation.'));
    INSERT INTO cleaning_request_status_history (cleaning_request_id, from_status, to_status, changed_by, reason, metadata)
      VALUES (request_record.id, request_record.status, 'searching-for-cleaner', actor_id, 'Cleaner declined; matching reopened.', jsonb_build_object('bookingId', booking_record.id));
    INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
      VALUES (booking_record.landlord_user_id, booking_record.id, 'cleaner-declined', 'in-app', jsonb_build_object('bookingId', booking_record.id), 'booking:' || booking_record.id || ':declined')
      ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN booking_record;
  END IF;

  IF now() >= booking_record.cleaner_response_deadline OR request_record.requested_start_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invitation-expired';
  END IF;
  IF request_record.status <> 'pending-cleaner-acceptance' OR request_record.scope_fingerprint <> booking_record.scope_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'booking-scope-changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cleaner_profiles profile WHERE profile.user_id = actor_id AND profile.is_public
      AND profile.profile_completion_percent = 100 AND profile.current_availability_status <> 'unavailable'
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cleaner-not-eligible'; END IF;
  IF EXISTS (
    SELECT required.service_code FROM unnest(request_record.required_services) AS required(service_code)
    EXCEPT SELECT service.service_code FROM cleaner_services service WHERE service.cleaner_user_id = actor_id AND service.is_active
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cleaner-services-mismatch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cleaner_availability availability WHERE availability.cleaner_user_id = actor_id AND availability.status = 'available'
      AND availability.starts_at <= booking_record.scheduled_start_at AND availability.ends_at >= booking_record.scheduled_end_at
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cleaner-unavailable'; END IF;

  UPDATE bookings SET status = 'confirmed', responded_at = now(), accepted_by_cleaner_at = now(), confirmed_at = now(), updated_at = now()
    WHERE id = booking_record.id RETURNING * INTO booking_record;
  INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason, metadata)
    VALUES (booking_record.id, 'pending-cleaner-acceptance', 'confirmed', actor_id, 'Cleaner accepted frozen booking terms.', jsonb_build_object('scopeFingerprint', booking_record.scope_fingerprint, 'termsFingerprint', booking_record.terms_fingerprint));
  UPDATE cleaning_requests SET status = 'matched', updated_at = now() WHERE id = request_record.id;
  INSERT INTO cleaning_request_status_history (cleaning_request_id, from_status, to_status, changed_by, reason, metadata)
    VALUES (request_record.id, request_record.status, 'matched', actor_id, 'Cleaner accepted invitation.', jsonb_build_object('bookingId', booking_record.id));
  INSERT INTO conversations (booking_id) VALUES (booking_record.id) ON CONFLICT (booking_id) DO NOTHING;
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
    VALUES (booking_record.landlord_user_id, booking_record.id, 'booking-confirmed', 'in-app', jsonb_build_object('bookingId', booking_record.id), 'booking:' || booking_record.id || ':confirmed')
    ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN booking_record;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION USING ERRCODE = '23P01', MESSAGE = 'cleaner-schedule-conflict';
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.invite_cleaner(uuid, uuid, uuid, timestamptz, integer, integer, integer, integer, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.respond_to_cleaner_invitation(uuid, text, text) FROM PUBLIC;

COMMIT;
