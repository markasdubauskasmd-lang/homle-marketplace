BEGIN;

ALTER TABLE notifications
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 20),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_token uuid,
  ADD COLUMN leased_until timestamptz,
  ADD COLUMN last_error_code text CHECK(char_length(last_error_code) BETWEEN 1 AND 100),
  ADD CONSTRAINT notifications_lease_pair_check CHECK((lease_token IS NULL)=(leased_until IS NULL));
CREATE INDEX notifications_email_due_idx ON notifications(next_attempt_at,created_at) WHERE channel='email' AND delivery_status='pending';
CREATE INDEX notifications_inbox_cursor_idx ON notifications(recipient_user_id,created_at DESC,id DESC) WHERE channel='in-app';

CREATE FUNCTION tideway_private.safe_notification_payload(input_payload jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'bookingId',input_payload->'bookingId',
    'responseDeadline',input_payload->'responseDeadline',
    'matchingReopened',input_payload->'matchingReopened',
    'taskId',input_payload->'taskId',
    'decision',input_payload->'decision',
    'photoId',input_payload->'photoId',
    'messageId',input_payload->'messageId',
    'senderRole',input_payload->'senderRole',
    'eventId',input_payload->'eventId'
  ))
$$;

CREATE FUNCTION tideway_private.queue_email_for_in_app_notification() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.channel='in-app' AND NEW.event_type IN (
    'new-booking-request','cleaner-declined','booking-confirmed','cleaner-invitation-expired',
    'cleaner-started-travelling','cleaner-nearby','cleaner-arrived','cleaning-started',
    'cleaning-paused','cleaning-resumed','cleaning-progress-update','issue-reported',
    'job-photo-added','issue-photo-added','unexpected-task-approval-requested',
    'unexpected-task-decision','cleaning-completed','review-requested','booking-message'
  ) THEN
    INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key)
    VALUES(NEW.recipient_user_id,NEW.booking_id,NEW.event_type,'email',tideway_private.safe_notification_payload(NEW.payload),'email:'||NEW.idempotency_key)
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_email_outbox_after_insert AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION tideway_private.queue_email_for_in_app_notification();

CREATE FUNCTION tideway_private.get_my_notifications(before_created_at timestamptz DEFAULT NULL,before_notification_id uuid DEFAULT NULL,page_limit integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); result jsonb;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 100 OR ((before_created_at IS NULL)<>(before_notification_id IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-notification-cursor'; END IF;
  WITH selected AS (
    SELECT notification.id,notification.booking_id,notification.event_type,tideway_private.safe_notification_payload(notification.payload) payload,notification.created_at,notification.read_at
    FROM notifications notification
    WHERE notification.recipient_user_id=actor_id AND notification.channel='in-app'
      AND (before_created_at IS NULL OR (notification.created_at,notification.id)<(before_created_at,before_notification_id))
    ORDER BY notification.created_at DESC,notification.id DESC LIMIT page_limit+1
  ), page AS (SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT page_limit)
  SELECT jsonb_build_object(
    'notifications',COALESCE((SELECT jsonb_agg(jsonb_build_object('notificationId',page.id,'bookingId',page.booking_id,'eventType',page.event_type,'payload',page.payload,'createdAt',page.created_at,'readAt',page.read_at) ORDER BY page.created_at DESC,page.id DESC) FROM page),'[]'::jsonb),
    'unreadCount',(SELECT count(*) FROM notifications notification WHERE notification.recipient_user_id=actor_id AND notification.channel='in-app' AND notification.read_at IS NULL),
    'hasMore',(SELECT count(*)>page_limit FROM selected),
    'nextCursor',CASE WHEN (SELECT count(*)>page_limit FROM selected) THEN (SELECT jsonb_build_object('beforeCreatedAt',page.created_at,'beforeNotificationId',page.id) FROM page ORDER BY page.created_at,page.id LIMIT 1) ELSE NULL END
  ) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION tideway_private.mark_my_notification_read(target_notification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); notification_record notifications%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  SELECT * INTO notification_record FROM notifications notification WHERE notification.id=target_notification_id AND notification.recipient_user_id=actor_id AND notification.channel='in-app' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='notification-not-found'; END IF;
  IF notification_record.read_at IS NULL THEN
    UPDATE notifications SET read_at=now(),delivery_status='read' WHERE id=notification_record.id RETURNING * INTO notification_record;
  END IF;
  RETURN jsonb_build_object('notificationId',notification_record.id,'readAt',notification_record.read_at);
END;
$$;

CREATE FUNCTION tideway_private.mark_all_my_notifications_read(cutoff_created_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); affected integer;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  IF cutoff_created_at IS NULL OR cutoff_created_at>now()+interval '1 minute' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-notification-cutoff'; END IF;
  UPDATE notifications SET read_at=now(),delivery_status='read'
  WHERE recipient_user_id=actor_id AND channel='in-app' AND read_at IS NULL AND created_at<=cutoff_created_at;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN jsonb_build_object('markedRead',affected,'cutoffCreatedAt',cutoff_created_at);
END;
$$;

CREATE FUNCTION tideway_private.claim_due_email_notifications(worker_lease_token uuid,batch_limit integer DEFAULT 50,lease_seconds integer DEFAULT 120)
RETURNS TABLE(notification_id uuid,recipient_email citext,recipient_name text,event_type text,booking_id uuid,payload jsonb,attempt_number integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE due record;
BEGIN
  IF worker_lease_token IS NULL OR batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 100 OR lease_seconds IS NULL OR lease_seconds NOT BETWEEN 30 AND 600 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-email-claim'; END IF;
  UPDATE notifications notification SET delivery_status='failed',last_error_code='recipient-unavailable',lease_token=NULL,leased_until=NULL
  WHERE notification.channel='email' AND notification.delivery_status='pending' AND NOT EXISTS(
    SELECT 1 FROM users account WHERE account.id=notification.recipient_user_id AND account.account_status='active' AND account.email_verified_at IS NOT NULL
  );
  UPDATE notifications notification SET delivery_status='failed',last_error_code='attempt-limit',lease_token=NULL,leased_until=NULL
  WHERE notification.channel='email' AND notification.delivery_status='pending' AND notification.attempt_count>=5
    AND (notification.leased_until IS NULL OR notification.leased_until<=now());
  FOR due IN
    SELECT notification.id,account.email,account.display_name,notification.event_type,notification.booking_id,notification.payload,notification.attempt_count
    FROM notifications notification JOIN users account ON account.id=notification.recipient_user_id
    WHERE notification.channel='email' AND notification.delivery_status='pending' AND notification.next_attempt_at<=now()
      AND notification.attempt_count<5
      AND (notification.leased_until IS NULL OR notification.leased_until<=now())
      AND account.account_status='active' AND account.email_verified_at IS NOT NULL
    ORDER BY notification.next_attempt_at,notification.created_at,notification.id FOR UPDATE OF notification SKIP LOCKED LIMIT batch_limit
  LOOP
    UPDATE notifications SET lease_token=worker_lease_token,leased_until=now()+make_interval(secs=>lease_seconds),attempt_count=due.attempt_count+1 WHERE id=due.id;
    notification_id:=due.id;recipient_email:=due.email;recipient_name:=due.display_name;event_type:=due.event_type;booking_id:=due.booking_id;payload:=tideway_private.safe_notification_payload(due.payload);attempt_number:=due.attempt_count+1;RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

CREATE FUNCTION tideway_private.complete_email_notification(target_notification_id uuid,worker_lease_token uuid,outcome text,error_code text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE notification_record notifications%ROWTYPE; retry_seconds integer;
BEGIN
  IF worker_lease_token IS NULL OR outcome IS NULL OR outcome NOT IN('sent','retry','permanent-failure') OR char_length(COALESCE(error_code,''))>100 OR (outcome<>'sent' AND NULLIF(trim(error_code),'') IS NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-email-completion'; END IF;
  SELECT * INTO notification_record FROM notifications notification WHERE notification.id=target_notification_id AND notification.channel='email' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='email-notification-not-found'; END IF;
  IF notification_record.delivery_status='sent' AND outcome='sent' THEN RETURN; END IF;
  IF notification_record.delivery_status<>'pending' OR notification_record.lease_token IS DISTINCT FROM worker_lease_token OR notification_record.leased_until IS NULL OR notification_record.leased_until<=now() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='email-notification-lease-lost'; END IF;
  IF outcome='sent' THEN
    UPDATE notifications SET delivery_status='sent',sent_at=now(),lease_token=NULL,leased_until=NULL,last_error_code=NULL WHERE id=notification_record.id;
  ELSIF outcome='permanent-failure' OR notification_record.attempt_count>=5 THEN
    UPDATE notifications SET delivery_status='failed',lease_token=NULL,leased_until=NULL,last_error_code=trim(error_code) WHERE id=notification_record.id;
  ELSE
    retry_seconds:=LEAST(21600,60*power(4,GREATEST(0,notification_record.attempt_count-1))::integer);
    UPDATE notifications SET next_attempt_at=now()+make_interval(secs=>retry_seconds),lease_token=NULL,leased_until=NULL,last_error_code=trim(error_code) WHERE id=notification_record.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.safe_notification_payload(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.queue_email_for_in_app_notification() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_my_notifications(timestamptz,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.mark_my_notification_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.mark_all_my_notifications_read(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.claim_due_email_notifications(uuid,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.complete_email_notification(uuid,uuid,text,text) FROM PUBLIC;

COMMIT;
