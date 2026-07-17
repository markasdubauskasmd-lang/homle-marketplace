BEGIN;

CREATE TABLE cleaning_request_realtime_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cleaning_request_id uuid NOT NULL REFERENCES cleaning_requests(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('request-status','matching-authorization','matching-evaluation')),
  source_key text NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_kind,source_key)
);
CREATE INDEX cleaning_request_realtime_events_request_idx ON cleaning_request_realtime_events(cleaning_request_id,id);
ALTER TABLE cleaning_request_realtime_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY cleaning_request_realtime_events_owner_or_admin ON cleaning_request_realtime_events USING (
  EXISTS (
    SELECT 1 FROM cleaning_requests request
    WHERE request.id=cleaning_request_realtime_events.cleaning_request_id
      AND (request.landlord_user_id=tideway_private.current_user_id() OR tideway_private.has_role('administrator'))
  )
);

CREATE FUNCTION tideway_private.emit_cleaning_request_realtime_event(target_request_id uuid,target_actor_id uuid,target_kind text,target_source_key text)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event_id bigint;
BEGIN
  IF target_kind NOT IN ('request-status','matching-authorization','matching-evaluation') OR char_length(target_source_key) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-cleaning-request-realtime-event';
  END IF;
  INSERT INTO cleaning_request_realtime_events(cleaning_request_id,actor_user_id,event_kind,source_key)
  VALUES(target_request_id,target_actor_id,target_kind,target_source_key)
  ON CONFLICT(event_kind,source_key) DO NOTHING RETURNING id INTO event_id;
  IF event_id IS NOT NULL THEN
    PERFORM pg_notify('tideway_request_events',jsonb_build_object('requestId',target_request_id,'eventId',event_id,'kind',target_kind)::text);
  END IF;
  RETURN event_id;
END;
$$;

CREATE FUNCTION tideway_private.realtime_from_cleaning_request_status() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM tideway_private.emit_cleaning_request_realtime_event(NEW.cleaning_request_id,NEW.changed_by,'request-status','request-status:'||NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER cleaning_request_status_realtime_after_insert AFTER INSERT ON cleaning_request_status_history
FOR EACH ROW EXECUTE FUNCTION tideway_private.realtime_from_cleaning_request_status();

CREATE FUNCTION tideway_private.realtime_from_cleaning_request_matching() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event_kind text;
BEGIN
  IF ROW(NEW.automatic_dispatch_authorized_at,NEW.automatic_dispatch_revoked_at,NEW.automatic_dispatch_attempt_limit,
         NEW.automatic_dispatch_next_attempt_at,NEW.automatic_dispatch_last_evaluated_at,NEW.automatic_dispatch_last_result)
     IS NOT DISTINCT FROM
     ROW(OLD.automatic_dispatch_authorized_at,OLD.automatic_dispatch_revoked_at,OLD.automatic_dispatch_attempt_limit,
         OLD.automatic_dispatch_next_attempt_at,OLD.automatic_dispatch_last_evaluated_at,OLD.automatic_dispatch_last_result) THEN
    RETURN NEW;
  END IF;
  event_kind:=CASE WHEN ROW(NEW.automatic_dispatch_authorized_at,NEW.automatic_dispatch_revoked_at,NEW.automatic_dispatch_attempt_limit)
                           IS DISTINCT FROM ROW(OLD.automatic_dispatch_authorized_at,OLD.automatic_dispatch_revoked_at,OLD.automatic_dispatch_attempt_limit)
                   THEN 'matching-authorization' ELSE 'matching-evaluation' END;
  PERFORM tideway_private.emit_cleaning_request_realtime_event(
    NEW.id,tideway_private.current_user_id(),event_kind,
    'request-matching:'||NEW.id||':'||txid_current()||':'||extract(epoch FROM clock_timestamp())::numeric::text
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER cleaning_request_matching_realtime_after_update AFTER UPDATE ON cleaning_requests
FOR EACH ROW EXECUTE FUNCTION tideway_private.realtime_from_cleaning_request_matching();

CREATE FUNCTION tideway_private.get_cleaning_request_realtime_snapshot(target_request_id uuid,after_event_id bigint DEFAULT 0,event_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); request_record cleaning_requests%ROWTYPE; result jsonb; attempt_count integer;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users account WHERE account.id=actor_id AND account.account_status='active') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account-inactive'; END IF;
  IF after_event_id IS NULL OR after_event_id<0 OR event_limit IS NULL OR event_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-request-realtime-cursor';
  END IF;
  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id=target_request_id
      AND (request.landlord_user_id=actor_id OR tideway_private.has_role('administrator'));
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='cleaning-request-not-found'; END IF;
  SELECT count(*)::integer INTO attempt_count FROM bookings booking WHERE booking.cleaning_request_id=request_record.id;

  WITH selected AS (
    SELECT event.id,event.event_kind,event.created_at
    FROM cleaning_request_realtime_events event
    WHERE event.cleaning_request_id=request_record.id AND event.id>after_event_id
    ORDER BY event.id LIMIT event_limit+1
  ), page AS (SELECT * FROM selected ORDER BY id LIMIT event_limit)
  SELECT jsonb_build_object(
    'requestId',request_record.id,
    'status',request_record.status,
    'currentVersion',COALESCE((SELECT max(event.id) FROM cleaning_request_realtime_events event WHERE event.cleaning_request_id=request_record.id),0),
    'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('eventId',page.id,'kind',page.event_kind,'createdAt',page.created_at) ORDER BY page.id) FROM page),'[]'::jsonb),
    'resyncRequired',(SELECT count(*)>event_limit FROM selected),
    'automaticDispatch',jsonb_build_object(
      'enabled',request_record.automatic_dispatch_authorized_at IS NOT NULL AND request_record.automatic_dispatch_revoked_at IS NULL,
      'attemptLimit',request_record.automatic_dispatch_attempt_limit,
      'attemptCount',attempt_count,
      'authorizedAt',request_record.automatic_dispatch_authorized_at,
      'revokedAt',request_record.automatic_dispatch_revoked_at,
      'nextAttemptAt',request_record.automatic_dispatch_next_attempt_at,
      'lastResult',request_record.automatic_dispatch_last_result
    )
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.emit_cleaning_request_realtime_event(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.realtime_from_cleaning_request_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.realtime_from_cleaning_request_matching() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_cleaning_request_realtime_snapshot(uuid,bigint,integer) FROM PUBLIC;

COMMIT;
