BEGIN;

ALTER TABLE messages ADD COLUMN client_message_id uuid;
UPDATE messages SET client_message_id=id WHERE client_message_id IS NULL;
ALTER TABLE messages ALTER COLUMN client_message_id SET NOT NULL;
ALTER TABLE messages ADD CONSTRAINT messages_sender_client_id_unique UNIQUE(sender_user_id,client_message_id);
CREATE INDEX messages_booking_cursor_idx ON messages(booking_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;

CREATE FUNCTION tideway_private.booking_message_body_allowed(proposed_body text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT proposed_body IS NOT NULL
    AND char_length(trim(proposed_body)) BETWEEN 1 AND 2000
    AND proposed_body !~ '[[:cntrl:]]'
    AND proposed_body !~* '[[:alnum:]._%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}'
    AND proposed_body !~* '(https?://|www\.)'
    AND proposed_body !~* '(^|[^[:alnum:]])(\+?44|0)[[:space:]().\-]*[1-9]([[:space:]().\-]*[0-9]){8,10}([^0-9]|$)'
    AND proposed_body !~* '\m(whatsapp|telegram|signal|instagram|facebook|snapchat)\M'
$$;

CREATE FUNCTION tideway_private.send_booking_message(
  target_booking_id uuid,
  proposed_message_id uuid,
  proposed_client_message_id uuid,
  proposed_body text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
  conversation_id uuid;
  message_record messages%ROWTYPE;
  recipient_id uuid;
  sender_role text;
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('cleaner') OR tideway_private.has_role('landlord')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='booking-participant-required'; END IF;
  IF target_booking_id IS NULL OR proposed_message_id IS NULL OR proposed_client_message_id IS NULL OR NOT tideway_private.booking_message_body_allowed(proposed_body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-message'; END IF;

  SELECT * INTO booking_record FROM bookings booking
  WHERE booking.id=target_booking_id AND (booking.landlord_user_id=actor_id OR booking.cleaner_user_id=actor_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;
  IF booking_record.status NOT IN ('pending-cleaner-acceptance','confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review','completed','disputed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-messaging-closed'; END IF;

  SELECT * INTO message_record FROM messages message WHERE message.sender_user_id=actor_id AND message.client_message_id=proposed_client_message_id;
  IF FOUND THEN
    IF message_record.booking_id<>booking_record.id OR message_record.body<>trim(proposed_body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='message-idempotency-conflict'; END IF;
    RETURN jsonb_build_object('messageId',message_record.id,'clientMessageId',message_record.client_message_id,'bookingId',message_record.booking_id,'senderUserId',message_record.sender_user_id,'senderRole',CASE WHEN message_record.sender_user_id=booking_record.cleaner_user_id THEN 'cleaner' ELSE 'landlord' END,'body',message_record.body,'createdAt',message_record.created_at);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(actor_id::text||':'||booking_record.id::text,0));
  IF (SELECT count(*) FROM messages message WHERE message.sender_user_id=actor_id AND message.created_at>now()-interval '1 minute')>=20
     OR (SELECT count(*) FROM messages message WHERE message.sender_user_id=actor_id AND message.created_at>now()-interval '1 hour')>=200 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='message-rate-limited';
  END IF;

  INSERT INTO conversations(booking_id) VALUES(booking_record.id)
  ON CONFLICT(booking_id) DO UPDATE SET booking_id=EXCLUDED.booking_id
  RETURNING id INTO conversation_id;

  INSERT INTO messages(id,conversation_id,booking_id,sender_user_id,client_message_id,body)
  VALUES(proposed_message_id,conversation_id,booking_record.id,actor_id,proposed_client_message_id,trim(proposed_body))
  RETURNING * INTO message_record;

  recipient_id:=CASE WHEN actor_id=booking_record.cleaner_user_id THEN booking_record.landlord_user_id ELSE booking_record.cleaner_user_id END;
  sender_role:=CASE WHEN actor_id=booking_record.cleaner_user_id THEN 'cleaner' ELSE 'landlord' END;
  INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key)
  VALUES(recipient_id,booking_record.id,'booking-message','in-app',jsonb_build_object('bookingId',booking_record.id,'messageId',message_record.id,'senderRole',sender_role),'message:'||message_record.id)
  ON CONFLICT(idempotency_key) DO NOTHING;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  VALUES(actor_id,'booking-message-sent','message',message_record.id::text,jsonb_build_object('bookingId',booking_record.id,'recipientUserId',recipient_id));

  RETURN jsonb_build_object('messageId',message_record.id,'clientMessageId',message_record.client_message_id,'bookingId',message_record.booking_id,'senderUserId',message_record.sender_user_id,'senderRole',sender_role,'body',message_record.body,'createdAt',message_record.created_at);
END;
$$;

CREATE FUNCTION tideway_private.get_booking_messages(
  target_booking_id uuid,
  before_created_at timestamptz DEFAULT NULL,
  before_message_id uuid DEFAULT NULL,
  page_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE; result jsonb;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 100 OR ((before_created_at IS NULL)<>(before_message_id IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-message-cursor'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND (booking.landlord_user_id=actor_id OR booking.cleaner_user_id=actor_id OR tideway_private.has_role('administrator'));
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;

  WITH selected AS (
    SELECT message.id,message.client_message_id,message.sender_user_id,message.body,message.created_at,
      CASE WHEN message.sender_user_id=booking_record.cleaner_user_id THEN 'cleaner' ELSE 'landlord' END sender_role
    FROM messages message
    WHERE message.booking_id=booking_record.id AND message.deleted_at IS NULL
      AND (before_created_at IS NULL OR (message.created_at,message.id)<(before_created_at,before_message_id))
    ORDER BY message.created_at DESC,message.id DESC LIMIT page_limit+1
  ), page AS (SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT page_limit), ordered AS (SELECT * FROM page ORDER BY created_at,id)
  SELECT jsonb_build_object(
    'bookingId',booking_record.id,
    'messages',COALESCE((SELECT jsonb_agg(jsonb_build_object('messageId',ordered.id,'clientMessageId',ordered.client_message_id,'senderUserId',ordered.sender_user_id,'senderRole',ordered.sender_role,'body',ordered.body,'createdAt',ordered.created_at) ORDER BY ordered.created_at,ordered.id) FROM ordered),'[]'::jsonb),
    'hasMore',(SELECT count(*)>page_limit FROM selected),
    'nextCursor',CASE WHEN (SELECT count(*)>page_limit FROM selected) THEN (SELECT jsonb_build_object('beforeCreatedAt',page.created_at,'beforeMessageId',page.id) FROM page ORDER BY page.created_at,page.id LIMIT 1) ELSE NULL END
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.booking_message_body_allowed(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.send_booking_message(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_booking_messages(uuid,timestamptz,uuid,integer) FROM PUBLIC;

COMMIT;
