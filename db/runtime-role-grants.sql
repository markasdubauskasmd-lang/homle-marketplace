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
GRANT EXECUTE ON FUNCTION tideway_private.lookup_existing_social_identity(authentication_provider, text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.begin_pending_social_identity(authentication_provider, text, citext, text, text, jsonb, bytea, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.consume_pending_social_identity(bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_my_authentication_identities() TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.connect_social_identity(authentication_provider,text,citext,boolean,text,text,jsonb) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.verify_my_social_identity(authentication_provider,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.disconnect_my_social_identity(authentication_provider) TO tideway_app;
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
GRANT EXECUTE ON FUNCTION tideway_private.list_my_booking_summaries(integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.recommend_cleaners_for_request(uuid, integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.configure_automatic_dispatch(uuid,boolean,smallint) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.create_request_photo_upload_intent(uuid,uuid,text,text,text,text,text,integer,text,timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_request_photo_upload_for_completion(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.reject_request_photo_upload(uuid,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.complete_request_photo_upload(uuid,integer,text,integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_cleaning_request_scan(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_cleaning_request_photo_object(uuid,uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.submit_cleaning_request(uuid,boolean,boolean) TO tideway_app;
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
GRANT EXECUTE ON FUNCTION tideway_private.create_job_photo_upload_intent(uuid,uuid,uuid,text,text,text,text,integer,text,text,timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_job_photo_upload_for_completion(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.reject_job_photo_upload(uuid,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.complete_job_photo_upload(uuid,integer,text,integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_job_photo_object(uuid,uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.send_booking_message(uuid,uuid,uuid,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_booking_messages(uuid,timestamptz,uuid,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_booking_realtime_snapshot(uuid,bigint,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_my_notifications(timestamptz,uuid,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.mark_my_notification_read(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.mark_all_my_notifications_read(timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.confirm_booking_completion(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.submit_booking_review(uuid,uuid,smallint,smallint,smallint,smallint,smallint,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_booking_review(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_public_cleaner_reviews(uuid,timestamptz,uuid,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.respond_to_booking_review(uuid,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.moderate_booking_review(uuid,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.consume_rate_limit(text,bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.begin_booking_payment_authorization(uuid,uuid,text,bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_booking_payment_authorization(uuid,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.begin_booking_payment_command(uuid,uuid,text,integer,bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_booking_payment_command(uuid,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.reconcile_payment_provider_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.read_booking_payment(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.current_booking_payment_authorized(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.open_booking_dispute(uuid,uuid,uuid,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_booking_dispute(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_admin_booking_disputes(text,integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.review_booking_dispute(uuid,text,text,text) TO tideway_app;
REVOKE ALL ON FUNCTION tideway_private.provision_bootstrap_administrator(citext,uuid,text,text) FROM tideway_app;

-- Booking transitions are only writable through the audited, actor-aware functions above.
REVOKE INSERT, UPDATE, DELETE ON bookings, booking_status_history, cleaning_tasks, task_updates, job_pauses, unexpected_task_decisions, booking_progress_events, job_photos, job_photo_uploads, cleaner_locations, conversations, messages, notifications, audit_logs FROM tideway_app;
REVOKE INSERT, UPDATE, DELETE ON disputes FROM tideway_app;
-- Object keys and upload verification records are reachable only through the narrow SECURITY DEFINER projections.
REVOKE SELECT ON job_photos, job_photo_uploads FROM tideway_app;
REVOKE SELECT ON conversations, messages FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON booking_realtime_events FROM tideway_app;
REVOKE SELECT ON notifications FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON reviews FROM tideway_app;
REVOKE SELECT ON disputes FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON booking_payments, payment_commands, payment_status_history FROM tideway_app;
REVOKE ALL ON TABLE tideway_private.request_rate_limits FROM tideway_app;
REVOKE ALL ON TABLE tideway_private.pending_social_identities FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON authentication_identities FROM tideway_app;
REVOKE ALL ON TABLE tideway_private.cleaner_payout_accounts, tideway_private.payment_provider_events FROM tideway_app;
-- Sessions may be created/revoked through actor-bound application transactions, but only the restricted worker may physically purge expired rows.
REVOKE DELETE ON sessions FROM tideway_app;
-- Submitted requests may be created directly under owner RLS, but dispatch consent and lifecycle changes are function-only.
REVOKE UPDATE, DELETE ON cleaning_requests FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON cleaning_request_photos, cleaning_request_photo_uploads FROM tideway_app;

COMMIT;
