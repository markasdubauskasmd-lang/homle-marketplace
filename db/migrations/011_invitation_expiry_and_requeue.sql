BEGIN;

ALTER TABLE bookings ADD COLUMN expired_at timestamptz;

ALTER TABLE booking_status_history
  ALTER COLUMN changed_by DROP NOT NULL,
  ADD COLUMN change_source text NOT NULL DEFAULT 'user' CHECK (change_source IN ('user', 'system')),
  ADD CONSTRAINT booking_history_actor_source_check CHECK (
    (change_source = 'user' AND changed_by IS NOT NULL) OR
    (change_source = 'system' AND changed_by IS NULL)
  );

ALTER TABLE cleaning_request_status_history
  ALTER COLUMN changed_by DROP NOT NULL,
  ADD COLUMN change_source text NOT NULL DEFAULT 'user' CHECK (change_source IN ('user', 'system')),
  ADD CONSTRAINT request_history_actor_source_check CHECK (
    (change_source = 'user' AND changed_by IS NOT NULL) OR
    (change_source = 'system' AND changed_by IS NULL)
  );

CREATE FUNCTION tideway_private.expire_cleaner_invitation(target_booking_id uuid)
RETURNS bookings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  booking_record bookings%ROWTYPE;
  request_record cleaning_requests%ROWTYPE;
BEGIN
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id = target_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'booking-not-found'; END IF;
  IF booking_record.status = 'cancelled' AND booking_record.expired_at IS NOT NULL THEN RETURN booking_record; END IF;
  IF booking_record.status <> 'pending-cleaner-acceptance' OR booking_record.cleaner_response_deadline > now() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invitation-not-expirable';
  END IF;

  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id = booking_record.cleaning_request_id FOR UPDATE;
  UPDATE bookings SET status = 'cancelled', expired_at = now(), cancelled_at = now(), updated_at = now()
    WHERE id = booking_record.id RETURNING * INTO booking_record;
  INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, change_source, reason, metadata)
    VALUES (booking_record.id, 'pending-cleaner-acceptance', 'cancelled', NULL, 'system', 'Cleaner invitation expired without a response.', jsonb_build_object('responseDeadline', booking_record.cleaner_response_deadline, 'expiredAt', booking_record.expired_at));

  IF request_record.id IS NOT NULL AND request_record.status = 'pending-cleaner-acceptance' THEN
    UPDATE cleaning_requests SET status = 'searching-for-cleaner', updated_at = now() WHERE id = request_record.id;
    INSERT INTO cleaning_request_status_history (cleaning_request_id, from_status, to_status, changed_by, change_source, reason, metadata)
      VALUES (request_record.id, request_record.status, 'searching-for-cleaner', NULL, 'system', 'Cleaner invitation expired; matching reopened.', jsonb_build_object('bookingId', booking_record.id));
  END IF;

  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
    VALUES
      (booking_record.landlord_user_id, booking_record.id, 'cleaner-invitation-expired', 'in-app', jsonb_build_object('bookingId', booking_record.id, 'matchingReopened', true), 'booking:' || booking_record.id || ':expired:landlord'),
      (booking_record.cleaner_user_id, booking_record.id, 'cleaner-invitation-expired', 'in-app', jsonb_build_object('bookingId', booking_record.id), 'booking:' || booking_record.id || ':expired:cleaner')
    ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN booking_record;
END;
$$;

CREATE FUNCTION tideway_private.expire_due_cleaner_invitations(batch_limit integer DEFAULT 100)
RETURNS SETOF uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  due_booking_id uuid;
BEGIN
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid-expiry-batch-limit';
  END IF;
  FOR due_booking_id IN
    SELECT booking.id FROM bookings booking
    WHERE booking.status = 'pending-cleaner-acceptance'
      AND booking.cleaner_response_deadline <= now()
    ORDER BY booking.cleaner_response_deadline, booking.id
    FOR UPDATE SKIP LOCKED
    LIMIT batch_limit
  LOOP
    PERFORM tideway_private.expire_cleaner_invitation(due_booking_id);
    RETURN NEXT due_booking_id;
  END LOOP;
  RETURN;
END;
$$;

ALTER FUNCTION tideway_private.respond_to_cleaner_invitation(uuid, text, text)
  RENAME TO respond_to_cleaner_invitation_core;

CREATE FUNCTION tideway_private.respond_to_cleaner_invitation(target_booking_id uuid, decision text, supplied_reason text DEFAULT NULL)
RETURNS bookings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cleaner-required';
  END IF;
  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id = target_booking_id AND booking.cleaner_user_id = actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'booking-not-found'; END IF;
  IF booking_record.status = 'cancelled' AND booking_record.expired_at IS NOT NULL THEN RETURN booking_record; END IF;
  IF booking_record.status = 'pending-cleaner-acceptance' AND booking_record.cleaner_response_deadline <= now() THEN
    RETURN tideway_private.expire_cleaner_invitation(booking_record.id);
  END IF;
  RETURN tideway_private.respond_to_cleaner_invitation_core(target_booking_id, decision, supplied_reason);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.expire_cleaner_invitation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.expire_due_cleaner_invitations(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.respond_to_cleaner_invitation_core(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.respond_to_cleaner_invitation(uuid, text, text) FROM PUBLIC;

COMMIT;
