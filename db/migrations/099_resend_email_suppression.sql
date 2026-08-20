BEGIN;

-- Provider callbacks are untrusted until their Svix signature has been
-- verified by the application. Store only bounded provider identifiers,
-- hashes and the matched Homle account: never the callback body or address.
CREATE TABLE tideway_private.email_delivery_suppressions (
  provider_event_id text PRIMARY KEY,
  recipient_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_email_sha256 bytea NOT NULL CHECK (octet_length(recipient_email_sha256)=32),
  provider_message_id text NOT NULL,
  suppression_reason text NOT NULL CHECK (suppression_reason IN ('bounced','complained','suppressed')),
  occurred_at timestamptz NOT NULL,
  payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256)=32),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider_event_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  CHECK (provider_message_id ~ '^[A-Za-z0-9_-]{1,200}$')
);

CREATE INDEX email_delivery_suppressions_account_email_idx
  ON tideway_private.email_delivery_suppressions(recipient_user_id,recipient_email_sha256)
  WHERE recipient_user_id IS NOT NULL;

-- Claiming the email outbox matches the current verified address by hash. A
-- dedicated hash-first index keeps that hot path bounded even when a callback
-- could not be associated with a Homle account at receipt time.
CREATE INDEX email_delivery_suppressions_email_hash_idx
  ON tideway_private.email_delivery_suppressions(recipient_email_sha256);

CREATE FUNCTION tideway_private.record_resend_email_suppression(
  selected_provider_event_id text,
  selected_recipient_email citext,
  selected_provider_message_id text,
  selected_reason text,
  selected_occurred_at timestamptz,
  selected_payload_sha256 bytea
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  normalized_email citext;
  matched_user_id uuid;
  inserted_event_id text;
  existing_payload_sha256 bytea;
  existing_user_id uuid;
BEGIN
  normalized_email:=lower(trim(selected_recipient_email::text))::citext;
  IF selected_provider_event_id IS NULL
    OR selected_provider_event_id !~ '^[A-Za-z0-9_-]{1,128}$'
    OR normalized_email IS NULL
    OR char_length(normalized_email::text)>254
    OR normalized_email::text !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR selected_provider_message_id IS NULL
    OR selected_provider_message_id !~ '^[A-Za-z0-9_-]{1,200}$'
    OR selected_reason IS NULL
    OR selected_reason NOT IN ('bounced','complained','suppressed')
    OR selected_occurred_at IS NULL
    OR selected_occurred_at>now()+interval '1 day'
    OR selected_payload_sha256 IS NULL
    OR octet_length(selected_payload_sha256)<>32
  THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-email-suppression';
  END IF;

  SELECT account.id INTO matched_user_id
  FROM users account
  WHERE account.email=normalized_email
  LIMIT 1;

  INSERT INTO tideway_private.email_delivery_suppressions(
    provider_event_id,
    recipient_user_id,
    recipient_email_sha256,
    provider_message_id,
    suppression_reason,
    occurred_at,
    payload_sha256
  )
  VALUES(
    selected_provider_event_id,
    matched_user_id,
    digest(convert_to(normalized_email::text,'UTF8'),'sha256'),
    selected_provider_message_id,
    selected_reason,
    selected_occurred_at,
    selected_payload_sha256
  )
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING provider_event_id INTO inserted_event_id;

  IF inserted_event_id IS NULL THEN
    SELECT suppression.payload_sha256,suppression.recipient_user_id
      INTO existing_payload_sha256,existing_user_id
    FROM tideway_private.email_delivery_suppressions suppression
    WHERE suppression.provider_event_id=selected_provider_event_id;
    IF existing_payload_sha256 IS DISTINCT FROM selected_payload_sha256 THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='email-webhook-event-conflict';
    END IF;
    RETURN jsonb_build_object(
      'accepted',true,
      'duplicate',true,
      'ignored',false,
      'matched',existing_user_id IS NOT NULL
    );
  END IF;

  IF matched_user_id IS NOT NULL THEN
    UPDATE notifications notification
    SET delivery_status='failed',
        last_error_code='recipient-suppressed',
        lease_token=NULL,
        leased_until=NULL
    WHERE notification.recipient_user_id=matched_user_id
      AND notification.channel='email'
      AND notification.delivery_status='pending';
  END IF;

  RETURN jsonb_build_object(
    'accepted',true,
    'duplicate',false,
    'ignored',false,
    'matched',matched_user_id IS NOT NULL
  );
END;
$$;

-- A suppression applies only while the account still owns the exact email
-- address that produced it. Changing to a newly verified address does not
-- inherit the previous address's delivery history.
CREATE OR REPLACE FUNCTION tideway_private.claim_due_email_notifications(worker_lease_token uuid,batch_limit integer DEFAULT 50,lease_seconds integer DEFAULT 120)
RETURNS TABLE(notification_id uuid,recipient_email citext,recipient_name text,event_type text,booking_id uuid,payload jsonb,attempt_number integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE due record;
BEGIN
  IF worker_lease_token IS NULL OR batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 100 OR lease_seconds IS NULL OR lease_seconds NOT BETWEEN 30 AND 600 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-email-claim'; END IF;
  UPDATE notifications notification SET delivery_status='failed',last_error_code='recipient-unavailable',lease_token=NULL,leased_until=NULL
  WHERE notification.channel='email' AND notification.delivery_status='pending' AND NOT EXISTS(
    SELECT 1 FROM users account WHERE account.id=notification.recipient_user_id AND account.account_status='active' AND account.email_verified_at IS NOT NULL
  );
  UPDATE notifications notification SET delivery_status='failed',last_error_code='recipient-suppressed',lease_token=NULL,leased_until=NULL
  FROM users account
  WHERE notification.recipient_user_id=account.id
    AND notification.channel='email'
    AND notification.delivery_status='pending'
    AND EXISTS(
      SELECT 1
      FROM tideway_private.email_delivery_suppressions suppression
      WHERE suppression.recipient_email_sha256=digest(convert_to(lower(trim(account.email::text)),'UTF8'),'sha256')
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
      AND NOT EXISTS(
        SELECT 1
        FROM tideway_private.email_delivery_suppressions suppression
        WHERE suppression.recipient_email_sha256=digest(convert_to(lower(trim(account.email::text)),'UTF8'),'sha256')
      )
    ORDER BY notification.next_attempt_at,notification.created_at,notification.id FOR UPDATE OF notification SKIP LOCKED LIMIT batch_limit
  LOOP
    UPDATE notifications SET lease_token=worker_lease_token,leased_until=now()+make_interval(secs=>lease_seconds),attempt_count=due.attempt_count+1 WHERE id=due.id;
    notification_id:=due.id;recipient_email:=due.email;recipient_name:=due.display_name;event_type:=due.event_type;booking_id:=due.booking_id;payload:=tideway_private.safe_notification_payload(due.payload);attempt_number:=due.attempt_count+1;RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON TABLE tideway_private.email_delivery_suppressions FROM PUBLIC;
REVOKE ALL ON TABLE tideway_private.email_delivery_suppressions FROM tideway_app;
REVOKE ALL ON TABLE tideway_private.email_delivery_suppressions FROM tideway_worker;
REVOKE ALL ON FUNCTION tideway_private.record_resend_email_suppression(text,citext,text,text,timestamptz,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_resend_email_suppression(text,citext,text,text,timestamptz,bytea) FROM tideway_worker;

COMMIT;
