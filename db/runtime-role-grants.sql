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
GRANT EXECUTE ON FUNCTION tideway_private.activate_my_workspace(user_role) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.register_password_account(citext, text, text, bytea, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.consume_email_verification(bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.issue_email_verification(citext, bytea, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_password_attempt(uuid, boolean) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.issue_password_reset(citext, bytea, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.consume_password_reset(bytea, text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.search_cleaner_directory(text, text, timestamptz, timestamptz, numeric, integer, boolean, numeric, numeric, numeric, integer, integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_public_cleaner_profile(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.invite_cleaner(uuid, uuid, uuid, timestamptz, integer, integer, integer, integer, integer, integer, integer, integer, integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.respond_to_cleaner_invitation(uuid, text, text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_my_booking_summaries(integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.recommend_cleaners_for_request(uuid, integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.recommend_cleaners_for_request_v2(uuid, integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.recommend_cleaners_for_request_v3(uuid, integer, boolean) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.cleaner_payout_ready_for_paid_booking(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.configure_automatic_dispatch(uuid,boolean,smallint) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.create_request_photo_upload_intent(uuid,uuid,text,text,text,text,text,integer,text,timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_request_photo_upload_for_completion(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.reject_request_photo_upload(uuid,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.complete_request_photo_upload(uuid,integer,text,integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_cleaning_request_scan(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_room_scan(uuid,uuid,text,timestamptz,jsonb,text,text,text,smallint) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_room_scan(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.correct_room_scan_object(uuid,text,text,boolean) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.delete_room_scan(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_room_scan_measurements(uuid,jsonb) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_active_scan_pricing_ruleset(text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.publish_scan_pricing_ruleset(text,jsonb,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_scan_pricing_rulesets(text,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_scan_estimate_observation(uuid,text,integer,integer,smallint,integer,boolean,integer,integer,integer,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.scan_estimate_shadow_report(text,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_request_voice_instructions(uuid,jsonb) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_request_voice_instructions(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_scan_pricing_addons() TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.upsert_scan_pricing_addon(text,text,integer,integer,boolean) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.set_scan_retention_policy(integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_scan_retention_policy() TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.record_scan_ground_truth(uuid,text,jsonb,boolean,text,boolean) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_scan_ground_truth_queue(integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.scan_ground_truth_report() TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_cleaning_request_photo_object(uuid,uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.submit_cleaning_request(uuid,boolean,boolean) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.withdraw_cleaning_request(uuid,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_booking_tracking(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.start_cleaner_journey(uuid, boolean, numeric, numeric, numeric, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.update_cleaner_location(uuid, numeric, numeric, numeric, timestamptz) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.mark_cleaner_arrived(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_cleaning_progress(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.start_booking_cleaning(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.set_booking_cleaning_pause(uuid,boolean,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.update_booking_cleaning_task(uuid,uuid,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.add_unexpected_cleaning_task(uuid,text,text,integer,boolean,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.confirm_unexpected_task_frozen_terms(uuid,uuid) TO tideway_app;
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
GRANT EXECUTE ON FUNCTION tideway_private.get_cleaning_request_realtime_snapshot(uuid,bigint,integer) TO tideway_app;
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
GRANT EXECUTE ON FUNCTION tideway_private.list_administrator_payment_operations(text,integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_administrator_booking_payment_operation(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_administrator_booking_operations(text,integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_cleaner_verification_queue(text,integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.set_cleaner_verification(uuid,text,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.current_booking_payment_authorized(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.open_booking_dispute(uuid,uuid,uuid,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_booking_dispute(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_admin_booking_disputes(text,integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.review_booking_dispute(uuid,text,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.create_landlord_support_request(uuid,uuid,text,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_my_landlord_support_requests(integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.list_administrator_support_requests(text,text,integer,integer) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.review_landlord_support_request(uuid,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_administrator_coverage_report(integer,boolean) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.archive_my_property(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.restore_my_property(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.request_my_privacy_action(uuid,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_my_privacy_requests() TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.request_facebook_data_deletion(uuid,text,bytea,bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_facebook_data_deletion_status(bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.get_my_cleaner_payout_onboarding() TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.begin_my_cleaner_payout_onboarding(uuid) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.attach_my_cleaner_payout_account(uuid,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.sync_my_cleaner_payout_account(text,boolean,boolean,boolean) TO tideway_app;
REVOKE ALL ON FUNCTION tideway_private.provision_bootstrap_administrator(citext,uuid,text,text) FROM tideway_app;

-- Roles and account state are only writable through the onboarding and administrator
-- functions above, which restrict what may be granted. The row-level policies on these
-- two tables scope writes to the caller's *own* row but say nothing about the value
-- being written, so an ownership check alone would let a session insert
-- ('my user id', 'administrator') into user_roles, or mark its own email verified —
-- which gates password reset, social-identity linking and administrator bootstrap.
-- No application code writes either table directly, so removing the privilege costs
-- nothing and closes the gap regardless of code path. This is the same reasoning
-- migration 062 applied to cleaner self-verification.
REVOKE INSERT, UPDATE, DELETE ON user_roles FROM tideway_app;
REVOKE INSERT, UPDATE, DELETE ON users FROM tideway_app;

-- Booking transitions are only writable through the audited, actor-aware functions above.
REVOKE INSERT, UPDATE, DELETE ON bookings, booking_status_history, cleaning_tasks, task_updates, job_pauses, unexpected_task_decisions, booking_progress_events, job_photos, job_photo_uploads, cleaner_locations, conversations, messages, notifications, audit_logs FROM tideway_app;
REVOKE INSERT, UPDATE, DELETE ON disputes FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON support_requests FROM tideway_app;
-- Object keys and upload verification records are reachable only through the narrow SECURITY DEFINER projections.
REVOKE SELECT ON job_photos, job_photo_uploads FROM tideway_app;
REVOKE SELECT ON conversations, messages FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON booking_realtime_events FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON cleaning_request_realtime_events FROM tideway_app;
REVOKE SELECT ON notifications FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON reviews FROM tideway_app;
REVOKE SELECT ON disputes FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON privacy_requests FROM tideway_app;
REVOKE ALL ON TABLE tideway_private.facebook_data_deletion_requests FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON booking_payments, payment_commands, payment_status_history FROM tideway_app;
REVOKE ALL ON TABLE tideway_private.request_rate_limits FROM tideway_app;
REVOKE ALL ON TABLE tideway_private.pending_social_identities FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON authentication_identities FROM tideway_app;
REVOKE ALL ON TABLE tideway_private.cleaner_payout_accounts, tideway_private.cleaner_payout_onboarding, tideway_private.payment_provider_events FROM tideway_app;
-- Sessions may be created/revoked through actor-bound application transactions, but only the restricted worker may physically purge expired rows.
REVOKE DELETE ON sessions FROM tideway_app;
-- Submitted requests may be created directly under owner RLS, but dispatch consent and lifecycle changes are function-only.
REVOKE UPDATE, DELETE ON cleaning_requests FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON cleaning_request_photos, cleaning_request_photo_uploads FROM tideway_app;
-- A structured scan is a description of the inside of someone's home. It is
-- reachable only through the participant-aware projections above, so no future
-- direct query can widen the audience by accident. The model-version table is
-- readable because attributing a reading to a model discloses nothing about a
-- customer, and the projection needs it to report which model produced a scan.
REVOKE SELECT, INSERT, UPDATE, DELETE ON room_scan_sessions, room_scans, room_scan_objects, room_scan_object_corrections FROM tideway_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON room_scan_measurements FROM tideway_app;
-- These numbers decide what customers are charged, and the table is append-only
-- so an estimate can always be recomputed from the rules that produced it. A
-- direct UPDATE would silently rewrite the past.
REVOKE SELECT, INSERT, UPDATE, DELETE ON scan_pricing_rulesets FROM tideway_app;
-- Individual observations carry a request id. The reporting function returns
-- statistics instead, because an error distribution discloses nothing while a
-- list of requests and agreed prices is a list of what customers paid.
REVOKE SELECT, INSERT, UPDATE, DELETE ON scan_estimate_observations FROM tideway_app;
-- Spoken instructions are the customer's own words about their home, reachable
-- only through the participant-aware projection. Rates, add-ons and the retention
-- policy stay readable because a customer is entitled to see what they are
-- quoted from and how long their scan is kept.
REVOKE SELECT, INSERT, UPDATE, DELETE ON cleaning_request_voice_instructions FROM tideway_app;
REVOKE INSERT, UPDATE, DELETE ON scan_pricing_addons, scan_retention_policy FROM tideway_app;
-- Reviewer verdicts about the inside of homes: function-only, like the scans
-- they describe. The report function returns counts, never rows.
REVOKE SELECT, INSERT, UPDATE, DELETE ON room_scan_ground_truth FROM tideway_app;
REVOKE INSERT, UPDATE, DELETE ON room_scan_model_versions FROM tideway_app;

COMMIT;
