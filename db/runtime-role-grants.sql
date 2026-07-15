-- Run as the migration owner after creating a role named tideway_app.
-- Supply its password through the deployment secret manager, never in this file.
BEGIN;

DO $$
DECLARE
  runtime_role record;
BEGIN
  SELECT rolsuper, rolbypassrls INTO runtime_role FROM pg_roles WHERE rolname = 'tideway_app';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Create the restricted tideway_app role before applying runtime grants';
  END IF;
  IF runtime_role.rolsuper OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION 'tideway_app must not be a superuser and must not bypass row-level security';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, tideway_private TO tideway_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tideway_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tideway_app;

GRANT EXECUTE ON FUNCTION tideway_private.lookup_password_account(citext) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.lookup_session(bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.lookup_verified_email(citext) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.resolve_social_identity(authentication_provider, text, citext, boolean, text, text, jsonb) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.complete_role_onboarding(user_role) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.register_password_account(citext, text, text, bytea, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.consume_email_verification(bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.issue_email_verification(citext, bytea, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_password_attempt(uuid, boolean) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.issue_password_reset(citext, bytea, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.consume_password_reset(bytea, text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.search_cleaner_directory(text, text, timestamptz, timestamptz, numeric, integer, boolean, numeric, numeric, numeric, integer, integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.invite_cleaner(uuid, uuid, uuid, timestamptz, integer, integer, integer, integer, integer, integer, integer, integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.respond_to_cleaner_invitation(uuid, text, text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.recommend_cleaners_for_request(uuid, integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_booking_tracking(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.start_cleaner_journey(uuid, boolean, numeric, numeric, numeric, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.update_cleaner_location(uuid, numeric, numeric, numeric, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.mark_cleaner_arrived(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_cleaning_progress(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.start_booking_cleaning(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.set_booking_cleaning_pause(uuid,boolean,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.update_booking_cleaning_task(uuid,uuid,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.add_unexpected_cleaning_task(uuid,text,text,integer,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.decide_unexpected_cleaning_task(uuid,uuid,text,boolean,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.finish_booking_cleaning(uuid) TO tideway_app;

-- Booking transitions are only writable through the audited, actor-aware functions above.
REVOKE INSERT, UPDATE, DELETE ON bookings, booking_status_history, cleaning_tasks, task_updates, job_pauses, unexpected_task_decisions, booking_progress_events, job_photos, cleaner_locations, conversations, notifications FROM tideway_app;

COMMIT;
