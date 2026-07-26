BEGIN;

-- Notification rows are durable. This trigger emits only a commit-bound signal
-- so an authenticated account stream knows to reread its own protected inbox.
-- The browser never receives another account id, notification payload or email.
CREATE OR REPLACE FUNCTION tideway_private.emit_account_notification_realtime_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.channel = 'in-app' THEN
    PERFORM pg_notify(
      'tideway_account_events',
      jsonb_build_object(
        'accountId', NEW.recipient_user_id,
        'notificationId', NEW.id
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS account_notification_realtime_after_insert ON notifications;
CREATE TRIGGER account_notification_realtime_after_insert
AFTER INSERT ON notifications
FOR EACH ROW
EXECUTE FUNCTION tideway_private.emit_account_notification_realtime_event();

REVOKE ALL ON FUNCTION tideway_private.emit_account_notification_realtime_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.emit_account_notification_realtime_event() FROM tideway_app;
REVOKE ALL ON FUNCTION tideway_private.emit_account_notification_realtime_event() FROM tideway_worker;

COMMIT;
