-- Run as the migration owner after creating a dedicated login role named tideway_worker.
-- The worker password belongs in the deployment secret manager, never in this file.
BEGIN;

DO $$
DECLARE
  worker_role record;
BEGIN
  SELECT rolsuper, rolbypassrls INTO worker_role FROM pg_roles WHERE rolname = 'tideway_worker';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Create the restricted tideway_worker role before applying worker grants';
  END IF;
  IF worker_role.rolsuper OR worker_role.rolbypassrls THEN
    RAISE EXCEPTION 'tideway_worker must not be a superuser and must not bypass row-level security';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA tideway_private TO tideway_worker;
GRANT EXECUTE ON FUNCTION tideway_private.expire_due_cleaner_invitations(integer) TO tideway_worker;
GRANT EXECUTE ON FUNCTION tideway_private.purge_expired_cleaner_locations(integer) TO tideway_worker;
GRANT EXECUTE ON FUNCTION tideway_private.expire_due_job_photo_uploads(integer) TO tideway_worker;
GRANT EXECUTE ON FUNCTION tideway_private.claim_due_email_notifications(uuid,integer,integer) TO tideway_worker;
GRANT EXECUTE ON FUNCTION tideway_private.complete_email_notification(uuid,uuid,text,text) TO tideway_worker;
GRANT EXECUTE ON FUNCTION tideway_private.purge_expired_sessions(integer) TO tideway_worker;
GRANT EXECUTE ON FUNCTION tideway_private.purge_expired_rate_limits(integer) TO tideway_worker;
GRANT EXECUTE ON FUNCTION tideway_private.purge_expired_pending_social_identities(integer) TO tideway_worker;
REVOKE ALL ON TABLE tideway_private.request_rate_limits FROM tideway_worker;

COMMIT;
