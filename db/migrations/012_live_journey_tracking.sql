BEGIN;

ALTER TABLE bookings ADD COLUMN nearby_notified_at timestamptz;

CREATE FUNCTION tideway_private.cleaner_is_near_booking(target_booking_id uuid, candidate_latitude numeric, candidate_longitude numeric)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT 6371 * acos(LEAST(1, GREATEST(-1,
      sin(radians(property.latitude::double precision)) * sin(radians(candidate_latitude::double precision)) +
      cos(radians(property.latitude::double precision)) * cos(radians(candidate_latitude::double precision)) *
      cos(radians(candidate_longitude::double precision - property.longitude::double precision))
    ))) <= 0.5
    FROM bookings booking JOIN properties property ON property.id = booking.property_id
    WHERE booking.id = target_booking_id AND property.latitude IS NOT NULL AND property.longitude IS NOT NULL
  ), false)
$$;

CREATE FUNCTION tideway_private.get_booking_tracking(target_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  snapshot jsonb;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication-required'; END IF;
  SELECT jsonb_build_object(
    'bookingId', booking.id,
    'status', booking.status,
    'scheduledStartAt', booking.scheduled_start_at,
    'scheduledEndAt', booking.scheduled_end_at,
    'journeyStartedAt', booking.journey_started_at,
    'arrivedAt', booking.arrived_at,
    'locationConsentAt', booking.location_consent_at,
    'locationSharingStoppedAt', booking.location_sharing_stopped_at,
    'cleaner', jsonb_build_object('cleanerId', booking.cleaner_user_id, 'displayName', account.display_name, 'profilePhotoUrl', COALESCE(profile.profile_photo_url, account.avatar_url)),
    'sharingState', CASE
      WHEN booking.status = 'cleaner-arrived' THEN 'arrived'
      WHEN booking.status = 'cleaner-en-route' AND location.booking_id IS NOT NULL AND location.expires_at > now() THEN 'live'
      WHEN booking.status = 'cleaner-en-route' AND booking.location_sharing_stopped_at IS NOT NULL THEN 'stopped'
      WHEN booking.status = 'cleaner-en-route' THEN 'stale'
      WHEN booking.location_consent_at IS NOT NULL THEN 'stopped'
      ELSE 'not-started'
    END,
    'location', CASE
      WHEN booking.status = 'cleaner-en-route' AND location.expires_at > now() THEN jsonb_build_object(
        'latitude', location.latitude,
        'longitude', location.longitude,
        'accuracyMetres', location.accuracy_metres,
        'estimatedArrivalAt', location.estimated_arrival_at,
        'recordedAt', location.recorded_at,
        'expiresAt', location.expires_at
      ) ELSE NULL END
  ) INTO snapshot
  FROM bookings booking
  JOIN users account ON account.id = booking.cleaner_user_id
  JOIN cleaner_profiles profile ON profile.user_id = booking.cleaner_user_id
  LEFT JOIN cleaner_locations location ON location.booking_id = booking.id
  WHERE booking.id = target_booking_id
    AND (booking.landlord_user_id = actor_id OR booking.cleaner_user_id = actor_id OR tideway_private.has_role('administrator'));
  IF snapshot IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'booking-not-found'; END IF;
  RETURN snapshot;
END;
$$;

-- Forward declaration allows Start journey to reuse the same validated current-point path.
-- It is replaced below in this transaction before any execute grant is applied.
CREATE FUNCTION tideway_private.update_cleaner_location(
  target_booking_id uuid,
  candidate_latitude numeric,
  candidate_longitude numeric,
  candidate_accuracy_metres numeric,
  trusted_estimated_arrival_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'update_cleaner_location forward declaration was not replaced';
END;
$$;

CREATE FUNCTION tideway_private.start_cleaner_journey(
  target_booking_id uuid,
  consent_granted boolean,
  candidate_latitude numeric,
  candidate_longitude numeric,
  candidate_accuracy_metres numeric,
  trusted_estimated_arrival_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cleaner-required'; END IF;
  IF consent_granted IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'location-consent-required'; END IF;
  IF candidate_latitude IS NULL OR candidate_longitude IS NULL OR candidate_latitude NOT BETWEEN -90 AND 90 OR candidate_longitude NOT BETWEEN -180 AND 180 OR
     (candidate_accuracy_metres IS NOT NULL AND candidate_accuracy_metres NOT BETWEEN 0 AND 10000) OR
     (trusted_estimated_arrival_at IS NOT NULL AND (trusted_estimated_arrival_at < now() OR trusted_estimated_arrival_at > now() + interval '24 hours')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid-location-update';
  END IF;
  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id = target_booking_id AND booking.cleaner_user_id = actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'booking-not-found'; END IF;
  IF booking_record.status = 'cleaner-en-route' AND booking_record.location_consent_at IS NOT NULL THEN
    RETURN tideway_private.update_cleaner_location(target_booking_id, candidate_latitude, candidate_longitude, candidate_accuracy_metres, trusted_estimated_arrival_at);
  END IF;
  IF booking_record.status <> 'confirmed' OR booking_record.confirmed_at IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'journey-not-startable'; END IF;
  IF now() < booking_record.scheduled_start_at - interval '24 hours' OR now() > booking_record.scheduled_end_at + interval '4 hours' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'journey-outside-safe-window';
  END IF;

  UPDATE bookings SET status = 'cleaner-en-route', journey_started_at = now(), location_consent_at = now(),
    location_sharing_stopped_at = NULL, updated_at = now() WHERE id = booking_record.id;
  INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason, metadata)
    VALUES (booking_record.id, 'confirmed', 'cleaner-en-route', actor_id, 'Cleaner started the journey with explicit location consent.', jsonb_build_object('locationConsent', true));
  INSERT INTO cleaner_locations (booking_id, cleaner_user_id, latitude, longitude, accuracy_metres, estimated_arrival_at, consented_at, recorded_at, expires_at)
    VALUES (booking_record.id, actor_id, candidate_latitude, candidate_longitude, candidate_accuracy_metres, trusted_estimated_arrival_at, now(), now(), now() + interval '5 minutes')
    ON CONFLICT (booking_id) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude, accuracy_metres=excluded.accuracy_metres,
      estimated_arrival_at=excluded.estimated_arrival_at, consented_at=excluded.consented_at, recorded_at=excluded.recorded_at, expires_at=excluded.expires_at;
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
    VALUES (booking_record.landlord_user_id, booking_record.id, 'cleaner-started-travelling', 'in-app', jsonb_build_object('bookingId', booking_record.id), 'booking:' || booking_record.id || ':journey-started')
    ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.update_cleaner_location(target_booking_id, candidate_latitude, candidate_longitude, candidate_accuracy_metres, trusted_estimated_arrival_at);
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.update_cleaner_location(
  target_booking_id uuid,
  candidate_latitude numeric,
  candidate_longitude numeric,
  candidate_accuracy_metres numeric,
  trusted_estimated_arrival_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cleaner-required'; END IF;
  IF candidate_latitude IS NULL OR candidate_longitude IS NULL OR candidate_latitude NOT BETWEEN -90 AND 90 OR candidate_longitude NOT BETWEEN -180 AND 180 OR
     (candidate_accuracy_metres IS NOT NULL AND candidate_accuracy_metres NOT BETWEEN 0 AND 10000) OR
     (trusted_estimated_arrival_at IS NOT NULL AND (trusted_estimated_arrival_at < now() OR trusted_estimated_arrival_at > now() + interval '24 hours')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid-location-update';
  END IF;
  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id = target_booking_id AND booking.cleaner_user_id = actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'booking-not-found'; END IF;
  IF booking_record.status <> 'cleaner-en-route' OR booking_record.location_consent_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'location-sharing-inactive';
  END IF;
  IF now() > booking_record.scheduled_end_at + interval '4 hours' THEN
    DELETE FROM cleaner_locations WHERE booking_id = booking_record.id;
    UPDATE bookings SET location_sharing_stopped_at = now(), updated_at = now() WHERE id = booking_record.id;
    RETURN tideway_private.get_booking_tracking(booking_record.id);
  END IF;

  INSERT INTO cleaner_locations (booking_id, cleaner_user_id, latitude, longitude, accuracy_metres, estimated_arrival_at, consented_at, recorded_at, expires_at)
    VALUES (booking_record.id, actor_id, candidate_latitude, candidate_longitude, candidate_accuracy_metres, trusted_estimated_arrival_at, booking_record.location_consent_at, now(), now() + interval '5 minutes')
    ON CONFLICT (booking_id) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude, accuracy_metres=excluded.accuracy_metres,
      estimated_arrival_at=excluded.estimated_arrival_at, recorded_at=excluded.recorded_at, expires_at=excluded.expires_at
    WHERE cleaner_locations.cleaner_user_id = actor_id;

  IF booking_record.nearby_notified_at IS NULL AND tideway_private.cleaner_is_near_booking(booking_record.id, candidate_latitude, candidate_longitude) THEN
    UPDATE bookings SET nearby_notified_at = now(), updated_at = now() WHERE id = booking_record.id;
    INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
      VALUES (booking_record.landlord_user_id, booking_record.id, 'cleaner-nearby', 'in-app', jsonb_build_object('bookingId', booking_record.id), 'booking:' || booking_record.id || ':nearby')
      ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN tideway_private.get_booking_tracking(booking_record.id);
END;
$$;

CREATE FUNCTION tideway_private.mark_cleaner_arrived(target_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cleaner-required'; END IF;
  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id = target_booking_id AND booking.cleaner_user_id = actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'booking-not-found'; END IF;
  IF booking_record.status = 'cleaner-arrived' THEN RETURN tideway_private.get_booking_tracking(booking_record.id); END IF;
  IF booking_record.status NOT IN ('confirmed', 'cleaner-en-route') THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'arrival-not-allowed'; END IF;
  UPDATE bookings SET status = 'cleaner-arrived', arrived_at = now(), location_sharing_stopped_at = CASE WHEN location_consent_at IS NOT NULL THEN now() ELSE location_sharing_stopped_at END, updated_at = now()
    WHERE id = booking_record.id;
  INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason)
    VALUES (booking_record.id, booking_record.status, 'cleaner-arrived', actor_id, 'Cleaner marked arrival at the property.');
  DELETE FROM cleaner_locations WHERE booking_id = booking_record.id;
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key)
    VALUES (booking_record.landlord_user_id, booking_record.id, 'cleaner-arrived', 'in-app', jsonb_build_object('bookingId', booking_record.id), 'booking:' || booking_record.id || ':arrived')
    ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_booking_tracking(booking_record.id);
END;
$$;

CREATE FUNCTION tideway_private.stop_location_after_booking_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status NOT IN ('confirmed', 'cleaner-en-route') THEN
    DELETE FROM cleaner_locations WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_stop_location_after_status
AFTER UPDATE OF status ON bookings
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION tideway_private.stop_location_after_booking_status();

CREATE FUNCTION tideway_private.purge_expired_cleaner_locations(batch_limit integer DEFAULT 500)
RETURNS SETOF uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  expired_booking_id uuid;
BEGIN
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 1000 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid-location-purge-limit'; END IF;
  FOR expired_booking_id IN
    SELECT location.booking_id FROM cleaner_locations location WHERE location.expires_at <= now()
    ORDER BY location.expires_at, location.booking_id FOR UPDATE SKIP LOCKED LIMIT batch_limit
  LOOP
    DELETE FROM cleaner_locations WHERE booking_id = expired_booking_id AND expires_at <= now();
    RETURN NEXT expired_booking_id;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.cleaner_is_near_booking(uuid, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_booking_tracking(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.start_cleaner_journey(uuid, boolean, numeric, numeric, numeric, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.update_cleaner_location(uuid, numeric, numeric, numeric, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.mark_cleaner_arrived(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.stop_location_after_booking_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.purge_expired_cleaner_locations(integer) FROM PUBLIC;

COMMIT;
