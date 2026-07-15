BEGIN;

CREATE TABLE booking_realtime_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id),
  event_kind text NOT NULL CHECK (event_kind IN ('booking-status','journey-location','journey-location-stopped','cleaning-progress','booking-message')),
  source_key text NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_kind,source_key)
);
CREATE INDEX booking_realtime_events_booking_idx ON booking_realtime_events(booking_id,id);
ALTER TABLE booking_realtime_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_realtime_events_participants ON booking_realtime_events USING (tideway_private.booking_participant(booking_id));

CREATE FUNCTION tideway_private.emit_booking_realtime_event(target_booking_id uuid,target_actor_id uuid,target_kind text,target_source_key text)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event_id bigint;
BEGIN
  INSERT INTO booking_realtime_events(booking_id,actor_user_id,event_kind,source_key)
  VALUES(target_booking_id,target_actor_id,target_kind,target_source_key)
  ON CONFLICT(event_kind,source_key) DO NOTHING RETURNING id INTO event_id;
  IF event_id IS NOT NULL THEN
    PERFORM pg_notify('tideway_booking_events',jsonb_build_object('bookingId',target_booking_id,'eventId',event_id,'kind',target_kind)::text);
  END IF;
  RETURN event_id;
END;
$$;

CREATE FUNCTION tideway_private.realtime_from_booking_status() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM tideway_private.emit_booking_realtime_event(NEW.booking_id,NEW.changed_by,'booking-status','booking-status:'||NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_status_realtime_after_insert AFTER INSERT ON booking_status_history FOR EACH ROW EXECUTE FUNCTION tideway_private.realtime_from_booking_status();

CREATE FUNCTION tideway_private.realtime_from_cleaning_progress() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM tideway_private.emit_booking_realtime_event(NEW.booking_id,NEW.actor_user_id,'cleaning-progress','cleaning-progress:'||NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER cleaning_progress_realtime_after_insert AFTER INSERT ON booking_progress_events FOR EACH ROW EXECUTE FUNCTION tideway_private.realtime_from_cleaning_progress();

CREATE FUNCTION tideway_private.realtime_from_booking_message() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM tideway_private.emit_booking_realtime_event(NEW.booking_id,NEW.sender_user_id,'booking-message','booking-message:'||NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_message_realtime_after_insert AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION tideway_private.realtime_from_booking_message();

CREATE FUNCTION tideway_private.realtime_from_cleaner_location() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE location_record cleaner_locations%ROWTYPE; kind text; source text;
BEGIN
  IF TG_OP='DELETE' THEN location_record:=OLD; ELSE location_record:=NEW; END IF;
  kind:=CASE WHEN TG_OP='DELETE' THEN 'journey-location-stopped' ELSE 'journey-location' END;
  source:=kind||':'||location_record.booking_id||':'||extract(epoch FROM location_record.recorded_at)::numeric::text;
  PERFORM tideway_private.emit_booking_realtime_event(location_record.booking_id,location_record.cleaner_user_id,kind,source);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cleaner_location_realtime_after_change AFTER INSERT OR UPDATE OR DELETE ON cleaner_locations FOR EACH ROW EXECUTE FUNCTION tideway_private.realtime_from_cleaner_location();

CREATE FUNCTION tideway_private.get_booking_realtime_snapshot(target_booking_id uuid,after_event_id bigint DEFAULT 0,event_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE; result jsonb;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users account WHERE account.id=actor_id AND account.account_status='active') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account-inactive'; END IF;
  IF after_event_id IS NULL OR after_event_id<0 OR event_limit IS NULL OR event_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-realtime-cursor'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND (booking.landlord_user_id=actor_id OR booking.cleaner_user_id=actor_id OR tideway_private.has_role('administrator'));
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;

  WITH selected AS (
    SELECT event.id,event.actor_user_id,event.event_kind,event.created_at
    FROM booking_realtime_events event WHERE event.booking_id=booking_record.id AND event.id>after_event_id
    ORDER BY event.id LIMIT event_limit+1
  ), page AS (SELECT * FROM selected ORDER BY id LIMIT event_limit)
  SELECT jsonb_build_object(
    'bookingId',booking_record.id,
    'status',booking_record.status,
    'currentVersion',COALESCE((SELECT max(event.id) FROM booking_realtime_events event WHERE event.booking_id=booking_record.id),0),
    'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('eventId',page.id,'kind',page.event_kind,'actorUserId',page.actor_user_id,'createdAt',page.created_at) ORDER BY page.id) FROM page),'[]'::jsonb),
    'resyncRequired',(SELECT count(*)>event_limit FROM selected),
    'tracking',tideway_private.get_booking_tracking(booking_record.id),
    'progress',tideway_private.get_cleaning_progress(booking_record.id),
    'messages',tideway_private.get_booking_messages(booking_record.id,NULL,NULL,20)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.emit_booking_realtime_event(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.realtime_from_booking_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.realtime_from_cleaning_progress() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.realtime_from_booking_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.realtime_from_cleaner_location() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_booking_realtime_snapshot(uuid,bigint,integer) FROM PUBLIC;

COMMIT;
