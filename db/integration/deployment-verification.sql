\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $verification$
DECLARE
  selected_name text;
  selected_role record;
  selected_table record;
  selected_function oid;
  selected_source text;
  latest_migration_installed boolean := false;
  scope_handoff_migration_installed boolean := false;
  payment_operations_migration_installed boolean := false;
  case_payment_handoff_migration_installed boolean := false;
  booking_operations_migration_installed boolean := false;
  matching_self_exclusion_migration_installed boolean := false;
  request_realtime_migration_installed boolean := false;
  session_avatar_migration_installed boolean := false;
  minimum_contribution_migration_installed boolean := false;
  public_cleaner_lookup_migration_installed boolean := false;
  automatic_dispatch_customer_cap_installed boolean := false;
  participant_response_deadline_installed boolean := false;
  apple_sign_in_migration_installed boolean := false;
  rate_limit_scope_migration_installed boolean := false;
  cleaner_verification_migration_installed boolean := false;
  apple_administrator_bootstrap_migration_installed boolean := false;
  paid_matching_payout_readiness_installed boolean := false;
  cleaner_verification_pagination_installed boolean := false;
  bookings_cleaning_request_index_installed boolean := false;
  payment_and_directory_indexes_installed boolean := false;
  account_notification_realtime_installed boolean := false;
  structured_room_scans_installed boolean := false;
  room_measurements_installed boolean := false;
  landlord_support_installed boolean := false;
  landlord_booking_changes_installed boolean := false;
  administrator_coverage_installed boolean := false;
  administrator_funnel_installed boolean := false;
  property_archiving_installed boolean := false;
  property_restoration_installed boolean := false;
  cleaner_onboarding_records_installed boolean := false;
  cleaner_address_lookup_rate_limit_installed boolean := false;
  cleaner_document_storage_installed boolean := false;
  right_to_work_alternative_evidence_installed boolean := false;
  booking_client_names_installed boolean := false;
  cleaner_final_submission_installed boolean := false;
  active_invite_function text;
  active_dispatch_function text;
  rls_tables text[] := ARRAY[
    'users','user_roles','authentication_identities','password_credentials','email_verification_tokens','password_reset_tokens','sessions',
    'cleaner_profiles','cleaner_services','cleaner_service_areas','cleaner_availability','landlord_profiles','properties','property_photos',
    'cleaning_requests','cleaning_request_tasks','cleaning_request_photos','cleaning_request_photo_uploads','cleaning_request_status_history','bookings','booking_status_history',
    'cleaning_tasks','task_updates','job_pauses','unexpected_task_decisions','booking_progress_events','job_photos','job_photo_uploads',
    'cleaner_locations','conversations','messages','booking_realtime_events','notifications','reviews','favourite_cleaners','disputes','privacy_requests','audit_logs',
    'booking_payments','payment_commands','payment_status_history'
  ];
  protected_write_tables text[] := ARRAY[
    'authentication_identities','bookings','booking_status_history','cleaning_tasks','task_updates','job_pauses','unexpected_task_decisions','booking_progress_events',
    'cleaning_request_photos','cleaning_request_photo_uploads','job_photos','job_photo_uploads','cleaner_locations','conversations','messages','booking_realtime_events','notifications','reviews','disputes','privacy_requests','audit_logs',
    'booking_payments','payment_commands','payment_status_history'
  ];
  protected_read_tables text[] := ARRAY['authentication_identities','cleaning_request_photos','cleaning_request_photo_uploads','job_photos','job_photo_uploads','conversations','messages','booking_realtime_events','notifications','reviews','disputes','privacy_requests','booking_payments','payment_commands','payment_status_history'];
  app_functions text[] := ARRAY[
    'tideway_private.lookup_session(bytea)',
    'tideway_private.resolve_social_identity(authentication_provider,text,citext,boolean,text,text,jsonb)',
    'tideway_private.search_cleaner_directory(text,text,timestamp with time zone,timestamp with time zone,numeric,integer,boolean,numeric,numeric,numeric,integer,integer)',
    'tideway_private.list_my_booking_summaries(integer)',
    'tideway_private.configure_automatic_dispatch(uuid,boolean,smallint)',
    'tideway_private.create_request_photo_upload_intent(uuid,uuid,text,text,text,text,text,integer,text,timestamp with time zone)',
    'tideway_private.get_request_photo_upload_for_completion(uuid)',
    'tideway_private.reject_request_photo_upload(uuid,text)',
    'tideway_private.complete_request_photo_upload(uuid,integer,text,integer,integer)',
    'tideway_private.get_cleaning_request_scan(uuid)',
    'tideway_private.get_cleaning_request_photo_object(uuid,uuid)',
    'tideway_private.submit_cleaning_request(uuid,boolean,boolean)',
    'tideway_private.withdraw_cleaning_request(uuid,text)',
    'tideway_private.start_cleaner_journey(uuid,boolean,numeric,numeric,numeric,timestamp with time zone)',
    'tideway_private.add_unexpected_cleaning_task(uuid,text,text,integer,boolean,text)',
    'tideway_private.confirm_unexpected_task_frozen_terms(uuid,uuid)',
    'tideway_private.decide_unexpected_cleaning_task(uuid,uuid,text,boolean,text)',
    'tideway_private.submit_booking_review(uuid,uuid,smallint,smallint,smallint,smallint,smallint,text)',
    'tideway_private.consume_rate_limit(text,bytea)',
    'tideway_private.lookup_existing_social_identity(authentication_provider,text)',
    'tideway_private.begin_pending_social_identity(authentication_provider,text,citext,text,text,jsonb,bytea,timestamp with time zone)',
    'tideway_private.consume_pending_social_identity(bytea)',
    'tideway_private.list_my_authentication_identities()',
    'tideway_private.connect_social_identity(authentication_provider,text,citext,boolean,text,text,jsonb)',
    'tideway_private.verify_my_social_identity(authentication_provider,text)',
    'tideway_private.disconnect_my_social_identity(authentication_provider)',
    'tideway_private.begin_booking_payment_authorization(uuid,uuid,text,bytea)',
    'tideway_private.record_booking_payment_authorization(uuid,text,text)',
    'tideway_private.begin_booking_payment_command(uuid,uuid,text,integer,bytea)',
    'tideway_private.record_booking_payment_command(uuid,text,text)',
    'tideway_private.reconcile_payment_provider_event(text,text,text,text,uuid,uuid,integer,character,timestamp with time zone,character)',
    'tideway_private.read_booking_payment(uuid)',
    'tideway_private.current_booking_payment_authorized(uuid)',
    'tideway_private.open_booking_dispute(uuid,uuid,uuid,text,text)',
    'tideway_private.get_booking_dispute(uuid)',
    'tideway_private.list_admin_booking_disputes(text,integer,integer)',
    'tideway_private.review_booking_dispute(uuid,text,text,text)',
    'tideway_private.request_my_privacy_action(uuid,text)',
    'tideway_private.get_my_privacy_requests()',
    'tideway_private.request_facebook_data_deletion(uuid,text,bytea,bytea)',
    'tideway_private.get_facebook_data_deletion_status(bytea)',
    'tideway_private.get_my_cleaner_payout_onboarding()',
    'tideway_private.begin_my_cleaner_payout_onboarding(uuid)',
    'tideway_private.attach_my_cleaner_payout_account(uuid,text)',
    'tideway_private.sync_my_cleaner_payout_account(text,boolean,boolean,boolean)'
  ];
  worker_functions constant text[] := ARRAY[
    'tideway_private.expire_due_cleaner_invitations(integer)',
    'tideway_private.queue_due_booking_payment_reminders(integer)',
    'tideway_private.queue_due_booking_visit_reminders(integer)',
    'tideway_private.purge_expired_cleaner_locations(integer)',
    'tideway_private.expire_due_job_photo_uploads(integer)',
    'tideway_private.expire_due_request_photo_uploads(integer)',
    'tideway_private.claim_due_email_notifications(uuid,integer,integer)',
    'tideway_private.complete_email_notification(uuid,uuid,text,text)',
    'tideway_private.purge_expired_sessions(integer)',
    'tideway_private.purge_expired_rate_limits(integer)',
    'tideway_private.purge_expired_pending_social_identities(integer)',
    'tideway_private.claim_due_automatic_dispatch(uuid,integer,integer)',
    'tideway_private.release_automatic_dispatch_lease(uuid,uuid,text,timestamp with time zone)'
  ];
BEGIN
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'Tideway requires PostgreSQL 16 or newer; found %', current_setting('server_version');
  END IF;

  FOREACH selected_name IN ARRAY ARRAY['pgcrypto','citext','btree_gist'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = selected_name) THEN
      RAISE EXCEPTION 'Required extension is missing: %', selected_name;
    END IF;
  END LOOP;

  FOREACH selected_name IN ARRAY ARRAY['tideway_app','tideway_worker'] LOOP
    SELECT rolsuper, rolbypassrls, rolcanlogin INTO selected_role FROM pg_roles WHERE rolname = selected_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'Required database role is missing: %', selected_name; END IF;
    IF selected_role.rolsuper OR selected_role.rolbypassrls OR NOT selected_role.rolcanlogin THEN
      RAISE EXCEPTION 'Role % must be a login role without superuser or BYPASSRLS', selected_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_class relation JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
    WHERE relation.relnamespace = 'public'::regnamespace AND relation.relkind IN ('r','p') AND owner_role.rolname IN ('tideway_app','tideway_worker')
  ) THEN
    RAISE EXCEPTION 'Runtime or worker role owns a public table and could bypass the intended privilege boundary';
  END IF;

  FOREACH selected_name IN ARRAY rls_tables LOOP
    SELECT relation.relrowsecurity AS rls_enabled, pg_get_userbyid(relation.relowner) AS owner_name
      INTO selected_table
      FROM pg_class relation
      WHERE relation.oid = to_regclass(format('public.%I', selected_name)) AND relation.relkind IN ('r','p');
    IF NOT FOUND THEN RAISE EXCEPTION 'Required RLS table is missing: %', selected_name; END IF;
    IF selected_table.rls_enabled IS NOT TRUE THEN RAISE EXCEPTION 'Row-level security is disabled on %', selected_name; END IF;
    IF selected_table.owner_name IN ('tideway_app','tideway_worker') THEN RAISE EXCEPTION 'Restricted role owns RLS table %', selected_name; END IF;
  END LOOP;

  IF to_regclass('public.sessions_expiry_purge_idx') IS NULL THEN RAISE EXCEPTION 'Expired-session purge index is missing'; END IF;
  IF to_regclass('tideway_private.request_rate_limits') IS NULL OR to_regclass('tideway_private.request_rate_limits_updated_idx') IS NULL THEN
    RAISE EXCEPTION 'Shared rate-limit storage or expiry index is missing';
  END IF;
  IF to_regclass('tideway_private.pending_social_identities') IS NULL OR to_regclass('tideway_private.pending_social_identity_retention_idx') IS NULL THEN
    RAISE EXCEPTION 'Pending social-identity storage or retention index is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.bookings'::regclass AND conname = 'bookings_no_cleaner_overlap' AND contype = 'x') THEN
    RAISE EXCEPTION 'Cleaner overlap exclusion constraint is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reviews'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (booking_id)') THEN
    RAISE EXCEPTION 'One-review-per-booking unique constraint is missing';
  END IF;
  IF to_regclass('public.bookings_one_live_attempt_per_request_idx') IS NULL THEN RAISE EXCEPTION 'One-live-invitation index is missing'; END IF;
  IF to_regclass('public.cleaning_requests_automatic_dispatch_due_idx') IS NULL THEN RAISE EXCEPTION 'Automatic-dispatch due index is missing'; END IF;
  IF to_regclass('public.cleaning_request_photo_uploads_expiry_idx') IS NULL OR to_regclass('public.cleaning_request_photos_request_created_idx') IS NULL THEN RAISE EXCEPTION 'Private request-photo lifecycle indexes are missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.cleaning_requests'::regclass AND conname='cleaning_requests_reviewed_submission_check' AND contype='c') THEN RAISE EXCEPTION 'Reviewed room-scan submission constraint is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.cleaning_requests'::regclass AND tgname='cleaning_requests_reviewed_submission_guard' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Reviewed room-scan submission guard is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.cleaning_requests'::regclass AND conname='cleaning_requests_dispatch_authorization_check' AND contype='c') THEN RAISE EXCEPTION 'Automatic-dispatch consent constraint is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.cleaning_requests'::regclass AND conname='cleaning_requests_dispatch_lease_check' AND contype='c') THEN RAISE EXCEPTION 'Automatic-dispatch lease constraint is missing'; END IF;
  IF to_regclass('public.payment_one_live_capture_idx') IS NULL OR to_regclass('public.payment_one_live_refund_idx') IS NULL OR to_regclass('public.payment_one_live_transfer_idx') IS NULL THEN RAISE EXCEPTION 'Payment command uniqueness indexes are missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.booking_payments'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (booking_id)') THEN RAISE EXCEPTION 'One-payment-per-booking constraint is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.bookings'::regclass AND tgname='bookings_require_current_payment_before_job_start' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Job-start payment-authorization trigger is missing'; END IF;
  selected_function := to_regprocedure('tideway_private.require_current_payment_before_job_start()');
  IF selected_function IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc procedure WHERE procedure.oid=selected_function AND procedure.prosecdef AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%') THEN RAISE EXCEPTION 'Job-start payment trigger function is missing or unsafe'; END IF;
  IF has_function_privilege('tideway_app', 'tideway_private.require_current_payment_before_job_start()', 'EXECUTE') THEN RAISE EXCEPTION 'App role can execute the internal job-start payment trigger directly'; END IF;
  selected_function := to_regprocedure('tideway_private.provision_bootstrap_administrator(citext,uuid,text,text)');
  IF selected_function IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc procedure WHERE procedure.oid=selected_function AND procedure.prosecdef
      AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
  ) THEN RAISE EXCEPTION 'Migration-owner Administrator bootstrap function is missing or unsafe'; END IF;
  IF has_function_privilege('tideway_app', selected_function, 'EXECUTE') OR has_function_privilege('tideway_worker', selected_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'A restricted role can execute migration-owner Administrator bootstrap';
  END IF;
  IF to_regclass('public.audit_logs_administrator_bootstrap_request_idx') IS NULL THEN RAISE EXCEPTION 'Administrator bootstrap retry index is missing'; END IF;

  IF to_regclass('tideway_private.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 48)'
      INTO latest_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 49)'
      INTO scope_handoff_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 50)'
      INTO payment_operations_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 51)'
      INTO case_payment_handoff_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 52)'
      INTO booking_operations_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 53)'
      INTO matching_self_exclusion_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 54)'
      INTO request_realtime_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 55)'
      INTO session_avatar_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 56)'
      INTO minimum_contribution_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 57)'
      INTO public_cleaner_lookup_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 58)'
      INTO automatic_dispatch_customer_cap_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 59)'
      INTO participant_response_deadline_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 60)'
      INTO apple_sign_in_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 61)'
      INTO rate_limit_scope_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 62)'
      INTO cleaner_verification_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 67)'
      INTO apple_administrator_bootstrap_migration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 68)'
      INTO paid_matching_payout_readiness_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 69)'
      INTO cleaner_verification_pagination_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 70)'
      INTO bookings_cleaning_request_index_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 71)'
      INTO payment_and_directory_indexes_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 72)'
      INTO account_notification_realtime_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 73)'
      INTO structured_room_scans_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 74)'
      INTO room_measurements_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 80)'
      INTO landlord_support_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 81)'
      INTO administrator_coverage_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 82)'
      INTO property_archiving_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 83)'
      INTO property_restoration_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 84)'
      INTO cleaner_onboarding_records_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 85)'
      INTO cleaner_address_lookup_rate_limit_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 87)'
      INTO administrator_funnel_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 88)'
      INTO landlord_booking_changes_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 89)'
      INTO cleaner_document_storage_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 90)'
      INTO booking_client_names_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 92)'
      INTO cleaner_final_submission_installed;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM tideway_private.schema_migrations WHERE migration_order = 93)'
      INTO right_to_work_alternative_evidence_installed;
  ELSE
    -- A fully manual fresh install has no private migration ledger. Detect each
    -- optional schema level from the exact object introduced by that migration
    -- so it is not mistaken for the supported historical migration-45 baseline.
    latest_migration_installed := to_regprocedure('tideway_private.activate_my_workspace(user_role)') IS NOT NULL;
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.get_cleaning_request_scan(uuid)')
        AND position('actor_has_pending_invitation' IN procedure.prosrc)>0
    ) INTO scope_handoff_migration_installed;
    payment_operations_migration_installed := to_regprocedure('tideway_private.list_administrator_payment_operations(text,integer,integer)') IS NOT NULL;
    case_payment_handoff_migration_installed := to_regprocedure('tideway_private.get_administrator_booking_payment_operation(uuid)') IS NOT NULL;
    booking_operations_migration_installed := to_regprocedure('tideway_private.list_administrator_booking_operations(text,integer,integer)') IS NOT NULL;
    matching_self_exclusion_migration_installed := to_regprocedure('tideway_private.recommend_cleaners_for_request_v2(uuid,integer)') IS NOT NULL;
    request_realtime_migration_installed := to_regclass('public.cleaning_request_realtime_events') IS NOT NULL;
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.lookup_session(bytea)')
        AND position('avatar_url' IN pg_get_function_result(procedure.oid))>0
    ) INTO session_avatar_migration_installed;
    minimum_contribution_migration_installed := to_regprocedure('tideway_private.invite_cleaner(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer,integer)') IS NOT NULL;
    public_cleaner_lookup_migration_installed := to_regprocedure('tideway_private.get_public_cleaner_profile(uuid)') IS NOT NULL;
    account_notification_realtime_installed := to_regprocedure('tideway_private.emit_account_notification_realtime_event()') IS NOT NULL;
    structured_room_scans_installed := to_regclass('public.room_scan_sessions') IS NOT NULL;
    room_measurements_installed := to_regclass('public.room_scan_measurements') IS NOT NULL;
    landlord_support_installed := to_regprocedure('tideway_private.create_landlord_support_request(uuid,uuid,text,text,text)') IS NOT NULL;
    landlord_booking_changes_installed := to_regprocedure('tideway_private.create_landlord_booking_change_request(uuid,uuid,uuid,text,timestamp with time zone,text)') IS NOT NULL;
    administrator_coverage_installed := to_regprocedure('tideway_private.get_administrator_coverage_report(integer,boolean)') IS NOT NULL;
    property_archiving_installed := to_regprocedure('tideway_private.archive_my_property(uuid)') IS NOT NULL;
    property_restoration_installed := to_regprocedure('tideway_private.restore_my_property(uuid)') IS NOT NULL;
    cleaner_onboarding_records_installed := to_regprocedure('tideway_private.save_my_cleaner_onboarding_section(text,bytea,text,smallint)') IS NOT NULL;
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid=to_regclass('public.cleaner_onboarding_sections')
        AND conname='cleaner_onboarding_sections_section_code_check'
        AND contype='c'
        AND position('review' IN pg_get_constraintdef(oid))>0
    ) INTO cleaner_final_submission_installed;
    cleaner_document_storage_installed := to_regprocedure('tideway_private.save_my_cleaner_onboarding_document(text,text,bytea,text,text,integer,text,bytea)') IS NOT NULL;
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.save_my_cleaner_onboarding_document(text,text,bytea,text,text,integer,text,bytea)')
        AND position('rightToWorkBirthCertificate' IN procedure.prosrc)>0
    ) INTO right_to_work_alternative_evidence_installed;
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.list_my_booking_summaries(integer)')
        AND position('booking-client-conversation-names-v1' IN procedure.prosrc)>0
    ) INTO booking_client_names_installed;
    administrator_funnel_installed := to_regprocedure('tideway_private.get_administrator_funnel_report(integer)') IS NOT NULL;
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer,integer)')
        AND position('automatic-dispatch-price-cap-required' IN procedure.prosrc)>0
    ) INTO automatic_dispatch_customer_cap_installed;
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.list_my_booking_summaries(integer)')
        AND position('participant-response-deadline-v1' IN procedure.prosrc)>0
    ) INTO participant_response_deadline_installed;
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.connect_social_identity(authentication_provider,text,citext,boolean,text,text,jsonb)')
        AND position('google'',''apple'',''facebook' IN replace(procedure.prosrc, ' ', ''))>0
    ) INTO apple_sign_in_migration_installed;
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.consume_rate_limit(text,bytea)')
        AND position('session-recovery' IN procedure.prosrc)>0
    ) INTO rate_limit_scope_migration_installed;
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.consume_rate_limit(text,bytea)')
        AND position('marketplace-cleaner:address-lookup' IN procedure.prosrc)>0
    ) INTO cleaner_address_lookup_rate_limit_installed;
    cleaner_verification_migration_installed := EXISTS (
      SELECT 1 FROM pg_trigger trigger_row
      WHERE trigger_row.tgrelid='public.cleaner_profiles'::regclass
        AND trigger_row.tgname='cleaner_verification_admin_only'
        AND NOT trigger_row.tgisinternal
    );
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.provision_bootstrap_administrator(citext,uuid,text,text)')
        AND position('password'',''google'',''apple'',''facebook' IN replace(procedure.prosrc, ' ', ''))>0
    ) INTO apple_administrator_bootstrap_migration_installed;
    paid_matching_payout_readiness_installed := to_regprocedure('tideway_private.recommend_cleaners_for_request_v3(uuid,integer,boolean)') IS NOT NULL;
    -- 069 replaces a function 063 already created, so the signature proves nothing. The
    -- repaired body is the only evidence: it slices inside a subquery aliased `page`
    -- before aggregating, where the broken version aggregated first.
    SELECT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.list_cleaner_verification_queue(text,integer,integer)')
        AND position('LIMIT page_limit OFFSET page_offset' IN procedure.prosrc)>0
        AND position(') page' IN procedure.prosrc)>0
    ) INTO cleaner_verification_pagination_installed;
    bookings_cleaning_request_index_installed := to_regclass('public.bookings_cleaning_request_idx') IS NOT NULL;
    payment_and_directory_indexes_installed := to_regclass('public.payment_commands_latest_by_kind_idx') IS NOT NULL
      AND to_regclass('public.cleaner_profiles_public_directory_idx') IS NOT NULL;
  END IF;

  -- This verifier runs both before and after pending migrations. Requiring
  -- migration-80 objects before the bootstrapper can apply migration 080
  -- deadlocks the upgrade. Once the ledger (or a ledger-free object probe)
  -- proves the feature is installed, every table, privilege and function
  -- boundary below becomes mandatory.
  IF landlord_support_installed THEN
    rls_tables := rls_tables || ARRAY['support_requests'];
    protected_write_tables := protected_write_tables || ARRAY['support_requests'];
    protected_read_tables := protected_read_tables || ARRAY['support_requests'];
    app_functions := app_functions || ARRAY[
      'tideway_private.create_landlord_support_request(uuid,uuid,text,text,text)',
      'tideway_private.list_my_landlord_support_requests(integer,integer)',
      'tideway_private.list_administrator_support_requests(text,text,integer,integer)',
      'tideway_private.review_landlord_support_request(uuid,text,text)'
    ];
  END IF;
  IF landlord_booking_changes_installed THEN
    app_functions := app_functions || ARRAY[
      'tideway_private.create_landlord_booking_change_request(uuid,uuid,uuid,text,timestamp with time zone,text)'
    ];
    SELECT procedure.prosrc INTO selected_source
    FROM pg_proc procedure
    WHERE procedure.oid=to_regprocedure('tideway_private.create_landlord_booking_change_request(uuid,uuid,uuid,text,timestamp with time zone,text)');
    IF to_regclass('public.support_requests_one_open_booking_change_idx') IS NULL
       OR position('booking.landlord_user_id=actor_id' IN COALESCE(selected_source,''))=0
       OR position('booking_record.status<>''confirmed''' IN COALESCE(selected_source,''))=0
       OR position('landlord-booking-change-request-created' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Landlord booking-change intake lost its owner, confirmed-booking, uniqueness or audit boundary';
    END IF;
  END IF;
  IF administrator_coverage_installed THEN
    app_functions := app_functions || ARRAY[
      'tideway_private.get_administrator_coverage_report(integer,boolean)'
    ];
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.get_administrator_coverage_report(integer,boolean)')
        AND position('has_role(''administrator'')' IN procedure.prosrc)>0
        AND position('recommend_cleaners_for_request_v3(request.id,50,require_payout_ready)' IN procedure.prosrc)>0
        AND position('Outward-postcode aggregates only' IN procedure.prosrc)>0
        AND position('outwardPostcode' IN procedure.prosrc)>0
        AND position('requestId' IN procedure.prosrc)=0
        AND position('propertyId' IN procedure.prosrc)=0
        AND position('cleanerId' IN procedure.prosrc)=0
    ) THEN
      RAISE EXCEPTION 'Administrator coverage report is missing, overprivileged or does not use the eligibility matcher';
    END IF;
  END IF;
  IF administrator_funnel_installed THEN
    app_functions := app_functions || ARRAY[
      'tideway_private.get_administrator_funnel_report(integer)'
    ];
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.get_administrator_funnel_report(integer)')
        AND position('has_role(''administrator'')' IN procedure.prosrc)>0
        AND position('interval ''24 hours''' IN procedure.prosrc)>0
        AND position('Aggregate stage counts only' IN procedure.prosrc)>0
        AND position('addressLine' IN procedure.prosrc)=0
        AND position('exactPostcode' IN procedure.prosrc)=0
        AND position('emailAddress' IN procedure.prosrc)=0
        AND position('avatarUrl' IN procedure.prosrc)=0
    ) THEN
      RAISE EXCEPTION 'Administrator funnel report is missing, overprivileged or exposes a private field';
    END IF;
  END IF;
  IF property_archiving_installed THEN
    app_functions := app_functions || ARRAY['tideway_private.archive_my_property(uuid)'];
    SELECT procedure.prosrc INTO selected_source
    FROM pg_proc procedure
    WHERE procedure.oid=to_regprocedure('tideway_private.archive_my_property(uuid)');
    IF position('property-has-active-request' IN COALESCE(selected_source,''))=0
       OR position('property-has-active-booking' IN COALESCE(selected_source,''))=0
       OR position('property-archived' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Owner property archiving lost its active-work guard or audit evidence';
    END IF;
  END IF;
  IF property_restoration_installed THEN
    app_functions := app_functions || ARRAY['tideway_private.restore_my_property(uuid)'];
    SELECT procedure.prosrc INTO selected_source
    FROM pg_proc procedure
    WHERE procedure.oid=to_regprocedure('tideway_private.restore_my_property(uuid)');
    IF position('archived_at IS NOT NULL' IN COALESCE(selected_source,''))=0
       OR position('property-restored' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Owner property restoration lost its archived-owner guard or audit evidence';
    END IF;
  END IF;
  IF cleaner_onboarding_records_installed THEN
    rls_tables := rls_tables || ARRAY['cleaner_onboarding_sections','cleaner_onboarding_documents'];
    protected_write_tables := protected_write_tables || ARRAY['cleaner_onboarding_sections','cleaner_onboarding_documents'];
    protected_read_tables := protected_read_tables || ARRAY['cleaner_onboarding_sections','cleaner_onboarding_documents'];
    app_functions := app_functions || ARRAY[
      'tideway_private.get_my_cleaner_onboarding_sections()',
      'tideway_private.save_my_cleaner_onboarding_section(text,bytea,text,smallint)'
    ];
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid='public.cleaner_onboarding_sections'::regclass
        AND attname='payload_ciphertext' AND atttypid='bytea'::regtype AND NOT attisdropped
    ) OR EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid='public.cleaner_onboarding_sections'::regclass
        AND attname IN ('payload','data') AND atttypid='jsonb'::regtype AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'Cleaner onboarding payloads are missing encrypted byte storage or expose plaintext JSON';
    END IF;
    IF cleaner_final_submission_installed AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid='public.cleaner_onboarding_sections'::regclass
        AND conname='cleaner_onboarding_sections_section_code_check'
        AND contype='c'
        AND position('review' IN pg_get_constraintdef(oid))>0
    ) THEN
      RAISE EXCEPTION 'Cleaner onboarding final review submission is not an allowed encrypted section';
    END IF;
    SELECT procedure.prosrc INTO selected_source
    FROM pg_proc procedure
    WHERE procedure.oid=to_regprocedure('tideway_private.save_my_cleaner_onboarding_section(text,bytea,text,smallint)');
    IF position('has_role(''cleaner'')' IN COALESCE(selected_source,''))=0
       OR position('cleaner-onboarding-section-saved' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Cleaner onboarding persistence lost its Cleaner-only or audit boundary';
    END IF;
  END IF;
  IF cleaner_document_storage_installed THEN
    app_functions := app_functions || ARRAY[
      'tideway_private.list_my_cleaner_onboarding_documents(text)',
      'tideway_private.save_my_cleaner_onboarding_document(text,text,bytea,text,text,integer,text,bytea)',
      'tideway_private.get_my_cleaner_onboarding_document(text,text)',
      'tideway_private.delete_my_cleaner_onboarding_document(text,text)'
    ];
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid='public.cleaner_onboarding_documents'::regclass
        AND attname='content_ciphertext' AND atttypid='bytea'::regtype AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'Cleaner onboarding documents are missing encrypted database byte storage';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
    WHERE procedure.oid=to_regprocedure('tideway_private.save_my_cleaner_onboarding_document(text,text,bytea,text,text,integer,text,bytea)');
    IF position('has_role(''cleaner'')' IN COALESCE(selected_source,''))=0
       OR position('cleaner-onboarding-document-saved' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Cleaner document storage lost its Cleaner-only or audit boundary';
    END IF;
    IF right_to_work_alternative_evidence_installed
       AND (position('rightToWorkPassport' IN COALESCE(selected_source,''))=0
         OR position('rightToWorkBirthCertificate' IN COALESCE(selected_source,''))=0) THEN
      RAISE EXCEPTION 'Right-to-work passport or birth-certificate storage is missing from the encrypted document boundary';
    END IF;
  END IF;
  IF booking_client_names_installed THEN
    SELECT procedure.prosrc INTO selected_source
    FROM pg_proc procedure
    WHERE procedure.oid=to_regprocedure('tideway_private.list_my_booking_summaries(integer)');
    IF position('booking-client-conversation-names-v1' IN COALESCE(selected_source,''))=0
       OR position('landlord_profile.organisation_name' IN COALESCE(selected_source,''))=0
       OR position('split_part(btrim(landlord_user.display_name)' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Cleaner booking conversations lost their privacy-limited client name projection';
    END IF;
  END IF;

  active_invite_function := CASE WHEN minimum_contribution_migration_installed THEN
    'tideway_private.invite_cleaner(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
  ELSE
    'tideway_private.invite_cleaner(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer)'
  END;
  active_dispatch_function := CASE WHEN minimum_contribution_migration_installed THEN
    'tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
  ELSE
    'tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer)'
  END;

  FOREACH selected_name IN ARRAY app_functions || ARRAY[active_invite_function] || worker_functions || ARRAY[active_dispatch_function] LOOP
    selected_function := to_regprocedure(selected_name);
    IF selected_function IS NULL THEN RAISE EXCEPTION 'Required protected function is missing: %', selected_name; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid = selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) THEN
      RAISE EXCEPTION 'Protected function is not SECURITY DEFINER with the trusted search path: %', selected_name;
    END IF;
  END LOOP;
  IF payment_operations_migration_installed THEN
    selected_name := 'tideway_private.list_administrator_payment_operations(text,integer,integer)';
    selected_function := to_regprocedure(selected_name);
    IF selected_function IS NULL THEN RAISE EXCEPTION 'Required protected function is missing: %', selected_name; END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('public', selected_function, 'EXECUTE')
      OR position('provider_payment_id' IN COALESCE(selected_source,''))>0
      OR position('destination_account_id' IN COALESCE(selected_source,''))>0 THEN
      RAISE EXCEPTION 'The Administrator payment queue is missing its restricted, provider-private boundary';
    END IF;
  END IF;
  IF case_payment_handoff_migration_installed THEN
    selected_name := 'tideway_private.get_administrator_booking_payment_operation(uuid)';
    selected_function := to_regprocedure(selected_name);
    IF selected_function IS NULL THEN RAISE EXCEPTION 'Required protected function is missing: %', selected_name; END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('public', selected_function, 'EXECUTE')
      OR position('payment.booking_id=selected_booking_id' IN COALESCE(selected_source,''))=0
      OR position('provider_payment_id' IN COALESCE(selected_source,''))>0
      OR position('destination_account_id' IN COALESCE(selected_source,''))>0 THEN
      RAISE EXCEPTION 'The booking-case payment handoff is missing its exact, restricted, provider-private boundary';
    END IF;
  END IF;
  IF booking_operations_migration_installed THEN
    selected_name := 'tideway_private.list_administrator_booking_operations(text,integer,integer)';
    selected_function := to_regprocedure(selected_name);
    IF selected_function IS NULL THEN RAISE EXCEPTION 'Required protected function is missing: %', selected_name; END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('public', selected_function, 'EXECUTE')
      OR position('access_instructions' IN COALESCE(selected_source,''))>0
      OR position('provider_payment_id' IN COALESCE(selected_source,''))>0
      OR position('display_name' IN COALESCE(selected_source,''))>0 THEN
      RAISE EXCEPTION 'The Administrator booking operations projection is missing its restricted, privacy-minimised boundary';
    END IF;
  END IF;
  IF matching_self_exclusion_migration_installed THEN
    selected_name := 'tideway_private.recommend_cleaners_for_request_v2(uuid,integer)';
    selected_function := to_regprocedure(selected_name);
    IF selected_function IS NULL THEN RAISE EXCEPTION 'Required protected function is missing: %', selected_name; END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('public', selected_function, 'EXECUTE')
      OR position('candidate.cleaner_id<>request_landlord_id' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'The shared matching candidate boundary is missing database-enforced self-exclusion';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
    WHERE procedure.oid=to_regprocedure('tideway_private.get_automatic_dispatch_candidates(uuid,uuid,integer)');
    IF position('recommend_cleaners_for_request_v2' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Automatic dispatch bypasses the shared self-excluding matching candidate boundary';
    END IF;
  END IF;
  IF payment_and_directory_indexes_installed THEN
    -- The Administrator payment page runs four correlated subqueries per payment row,
    -- none of which can use the partial unique indexes on this table because they carry
    -- no status predicate. Without this index that is up to 400 sequential scans of
    -- payment_commands to render one page.
    IF to_regclass('public.payment_commands_latest_by_kind_idx') IS NULL THEN
      RAISE EXCEPTION 'payment_commands has no (payment_id, command_kind, created_at) index, so the Administrator payment page scans the table once per command kind per row';
    END IF;
    -- search_cleaner_directory is reachable unauthenticated and cleaner_profiles has no
    -- index beyond its primary key, so without this every directory search scans every
    -- profile ever created.
    IF to_regclass('public.cleaner_profiles_public_directory_idx') IS NULL THEN
      RAISE EXCEPTION 'cleaner_profiles has no public-directory index, so the unauthenticated Cleaner directory scans the whole table on every search';
    END IF;
  END IF;
  IF account_notification_realtime_installed THEN
    selected_function := to_regprocedure('tideway_private.emit_account_notification_realtime_event()');
    IF selected_function IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM pg_proc procedure
        WHERE procedure.oid=selected_function
          AND procedure.prosecdef
          AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
      )
      OR has_function_privilege('public', selected_function, 'EXECUTE')
      OR has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('tideway_worker', selected_function, 'EXECUTE')
      OR NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid='public.notifications'::regclass
          AND tgname='account_notification_realtime_after_insert'
          AND NOT tgisinternal
          AND tgfoid=selected_function
      ) THEN
      RAISE EXCEPTION 'The account notification real-time trigger is missing or unsafe';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    IF position('NEW.channel = ''in-app''' IN COALESCE(selected_source,''))=0
      OR position('tideway_account_events' IN COALESCE(selected_source,''))=0
      OR position('NEW.recipient_user_id' IN COALESCE(selected_source,''))=0
      OR position('NEW.id' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'The account notification real-time trigger leaks payload data or does not emit the privacy-minimal account wake-up';
    END IF;
  END IF;
  IF structured_room_scans_installed THEN
    -- A structured scan describes the inside of a customer's home. Its entire
    -- participant boundary is the SECURITY DEFINER projection, so a deployment
    -- where the runtime role can read the tables directly has no boundary at
    -- all — the RLS policies would be the only thing left, and they were never
    -- meant to carry that weight alone.
    IF has_table_privilege('tideway_app','public.room_scan_sessions','SELECT')
      OR has_table_privilege('tideway_app','public.room_scans','SELECT')
      OR has_table_privilege('tideway_app','public.room_scan_objects','SELECT')
      OR has_table_privilege('tideway_app','public.room_scan_object_corrections','SELECT')
      OR has_table_privilege('tideway_app','public.room_scan_objects','INSERT')
      OR has_table_privilege('tideway_app','public.room_scan_objects','UPDATE')
      OR has_table_privilege('tideway_app','public.room_scan_objects','DELETE') THEN
      RAISE EXCEPTION 'The runtime role can read or write structured room scans directly, bypassing the participant-aware projection';
    END IF;
    IF has_table_privilege('tideway_app','public.room_scan_model_versions','INSERT')
      OR has_table_privilege('tideway_app','public.room_scan_model_versions','UPDATE')
      OR has_table_privilege('tideway_app','public.room_scan_model_versions','DELETE') THEN
      RAISE EXCEPTION 'The runtime role can write model attribution directly, so a stored scan cannot be trusted to name the model that read it';
    END IF;
    FOR selected_source IN SELECT unnest(ARRAY[
      'tideway_private.record_room_scan(uuid,uuid,text,timestamp with time zone,jsonb,text,text,text,smallint)',
      'tideway_private.get_room_scan(uuid)',
      'tideway_private.correct_room_scan_object(uuid,text,text,boolean)',
      'tideway_private.delete_room_scan(uuid)'
    ]) LOOP
      selected_function := to_regprocedure(selected_source);
      IF selected_function IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM pg_proc procedure
          WHERE procedure.oid=selected_function
            AND procedure.prosecdef
            AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
        )
        OR has_function_privilege('public', selected_function, 'EXECUTE') THEN
        RAISE EXCEPTION 'The room-scan function % is missing, not SECURITY DEFINER with a pinned search_path, or executable by PUBLIC', selected_source;
      END IF;
      IF NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE') THEN
        RAISE EXCEPTION 'The runtime role cannot execute the room-scan function %, so the structured scan is unreachable', selected_source;
      END IF;
    END LOOP;
    -- The detailed structured observation/pricing read is deliberately narrower
    -- than the Cleaner photo/checklist projection: only the owning Landlord and
    -- an Administrator may use it.
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.get_room_scan(uuid)');
    IF position('request_record.landlord_user_id = actor_id' IN COALESCE(selected_source,''))=0
      OR position('has_role(''administrator'')' IN COALESCE(selected_source,''))=0
      OR position('cleaner_preview_authorized' IN COALESCE(selected_source,''))>0
      OR position('cleaner_user_id' IN COALESCE(selected_source,''))>0 THEN
      RAISE EXCEPTION 'The structured room-scan read is not restricted to the owning Landlord and an Administrator';
    END IF;
    -- One scan per request. Without this, a retried save writes a second scan
    -- and every object count downstream doubles.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint constraint_entry
      WHERE constraint_entry.conrelid='public.room_scan_sessions'::regclass
        AND constraint_entry.contype='u'
        AND array_length(constraint_entry.conkey,1)=1
        AND constraint_entry.conkey[1]=(
          SELECT attribute.attnum FROM pg_attribute attribute
          WHERE attribute.attrelid='public.room_scan_sessions'::regclass AND attribute.attname='cleaning_request_id')
    ) THEN
      RAISE EXCEPTION 'room_scan_sessions does not restrict a cleaning request to one structured scan, so a retried save can duplicate every room';
    END IF;
  END IF;
  IF room_measurements_installed THEN
    -- Under the web-only decision nothing a browser produces is exact. A stored
    -- measurement with no band would read as exact for ever after, so the
    -- constraint that forbids it is verified on every deployment rather than
    -- trusted to have survived a later migration.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint constraint_entry
      WHERE constraint_entry.conrelid='public.room_scan_measurements'::regclass
        AND constraint_entry.conname='room_scan_measurements_estimate_has_band'
    ) THEN
      RAISE EXCEPTION 'room_scan_measurements does not require an estimated measurement to carry a tolerance, so an estimate can be stored looking exact';
    END IF;
    IF has_table_privilege('tideway_app','public.room_scan_measurements','SELECT')
      OR has_table_privilege('tideway_app','public.room_scan_measurements','INSERT')
      OR has_table_privilege('tideway_app','public.room_scan_measurements','UPDATE')
      OR has_table_privilege('tideway_app','public.room_scan_measurements','DELETE') THEN
      RAISE EXCEPTION 'The runtime role can reach room measurements directly, bypassing the participant-aware projection';
    END IF;
    selected_function := to_regprocedure('tideway_private.record_room_scan_measurements(uuid,jsonb)');
    IF selected_function IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM pg_proc procedure
        WHERE procedure.oid=selected_function
          AND procedure.prosecdef
          AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
      )
      OR has_function_privilege('public', selected_function, 'EXECUTE')
      OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'The room-measurement recording function is missing, unsafe, or unreachable by the runtime role';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    -- A browser cannot take a sensor reading. The enum keeps the value so a
    -- native path is a code change later, but nothing may store one now.
    IF position('room-measurement-method-unavailable' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'The room-measurement function does not refuse sensor readings, so a web client can claim an accuracy no browser delivers';
    END IF;
    -- One value per subject per room. Two floor areas for one room is an
    -- unresolved disagreement nothing downstream could act on.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint constraint_entry
      WHERE constraint_entry.conrelid='public.room_scan_measurements'::regclass
        AND constraint_entry.contype='u' AND array_length(constraint_entry.conkey,1)=2
    ) THEN
      RAISE EXCEPTION 'room_scan_measurements allows two values for one subject in one room';
    END IF;
  END IF;
  IF bookings_cleaning_request_index_installed THEN
    -- The pre-existing partial UNIQUE index on this column also carries
    -- `status <> 'cancelled'`, so the dispatch lookups that deliberately count
    -- cancelled attempts cannot use it and fall back to scanning bookings. This
    -- index must therefore exist separately and must NOT carry a status predicate,
    -- or the scans come straight back.
    IF to_regclass('public.bookings_cleaning_request_idx') IS NULL THEN
      RAISE EXCEPTION 'bookings(cleaning_request_id) has no general index, so automatic dispatch scans the whole bookings table on every attempt-limit check';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_index index_entry
      WHERE index_entry.indexrelid = to_regclass('public.bookings_cleaning_request_idx')
        AND position('cancelled' IN COALESCE(pg_get_expr(index_entry.indpred, index_entry.indrelid), ''))>0
    ) THEN
      RAISE EXCEPTION 'The general bookings(cleaning_request_id) index carries a status predicate, so the dispatch lookups that must include cancelled bookings still cannot use it';
    END IF;
  END IF;
  IF cleaner_verification_pagination_installed THEN
    selected_name := 'tideway_private.list_cleaner_verification_queue(text,integer,integer)';
    selected_function := to_regprocedure(selected_name);
    IF selected_function IS NULL THEN RAISE EXCEPTION 'Required protected function is missing: %', selected_name; END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    -- The slice has to happen inside a subquery. Applied to the outer select — whose
    -- select list is a single jsonb_agg — LIMIT and OFFSET act on the one aggregate row
    -- rather than on the Cleaners, so page 1 returns the whole queue and page 2 returns
    -- nothing. `) page` is the subquery alias that distinguishes the repaired body.
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('public', selected_function, 'EXECUTE')
      OR position(') page' IN COALESCE(selected_source,''))=0
      OR position('LIMIT page_limit OFFSET page_offset' IN COALESCE(selected_source,''))=0
      OR position('administrator-required' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'The Administrator Cleaner verification queue does not paginate, or lost its Administrator-only boundary';
    END IF;
  END IF;
  IF paid_matching_payout_readiness_installed THEN
    selected_name := 'tideway_private.recommend_cleaners_for_request_v3(uuid,integer,boolean)';
    selected_function := to_regprocedure(selected_name);
    IF selected_function IS NULL THEN RAISE EXCEPTION 'Required protected function is missing: %', selected_name; END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('public', selected_function, 'EXECUTE')
      OR position('cleaner_payout_accounts' IN COALESCE(selected_source,''))=0
      OR position('payout.details_submitted IS TRUE' IN COALESCE(selected_source,''))=0
      OR position('payout.payouts_enabled IS TRUE' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Paid matching does not enforce the private payout-readiness boundary';
    END IF;
    selected_name := 'tideway_private.cleaner_payout_ready_for_paid_booking(uuid)';
    selected_function := to_regprocedure(selected_name);
    IF selected_function IS NULL THEN RAISE EXCEPTION 'Required protected function is missing: %', selected_name; END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('public', selected_function, 'EXECUTE')
      OR position('current_user_id()' IN COALESCE(selected_source,''))=0
      OR position('has_role(''landlord'')' IN COALESCE(selected_source,''))=0
      OR position('has_role(''administrator'')' IN COALESCE(selected_source,''))=0
      OR position('cleaner_payout_accounts' IN COALESCE(selected_source,''))=0
      OR position('payout.details_submitted IS TRUE' IN COALESCE(selected_source,''))=0
      OR position('payout.payouts_enabled IS TRUE' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Direct paid Cleaner invitation payout check is missing, overprivileged or not actor-bound';
    END IF;
    selected_name := 'tideway_private.get_automatic_dispatch_candidates(uuid,uuid,integer,boolean)';
    selected_function := to_regprocedure(selected_name);
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    IF selected_function IS NULL
      OR NOT has_function_privilege('tideway_worker', selected_function, 'EXECUTE')
      OR has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR position('recommend_cleaners_for_request_v3' IN COALESCE(selected_source,''))=0
      OR has_function_privilege('tideway_worker', 'tideway_private.get_automatic_dispatch_candidates(uuid,uuid,integer)', 'EXECUTE') THEN
      RAISE EXCEPTION 'Paid automatic dispatch can bypass payout-ready Cleaner filtering';
    END IF;
  END IF;
  IF request_realtime_migration_installed THEN
    selected_function := to_regprocedure('tideway_private.get_cleaning_request_realtime_snapshot(uuid,bigint,integer)');
    IF selected_function IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_proc procedure WHERE procedure.oid=selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('public', selected_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'The private Landlord cleaning-request live snapshot boundary is missing or unsafe';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class relation WHERE relation.oid='public.cleaning_request_realtime_events'::regclass AND relation.relrowsecurity)
      OR has_table_privilege('tideway_app','public.cleaning_request_realtime_events','SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Cleaning-request live events lack RLS or can be read/forged by the app role';
    END IF;
  END IF;
  IF session_avatar_migration_installed THEN
    selected_function := to_regprocedure('tideway_private.lookup_session(bytea)');
    IF selected_function IS NULL OR position('avatar_url' IN pg_get_function_result(selected_function))=0
      OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('public', selected_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'The authenticated session projection does not expose the stored account avatar safely';
    END IF;
  END IF;
  IF minimum_contribution_migration_installed THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute attribute
      WHERE attribute.attrelid='public.bookings'::regclass AND attribute.attname='target_contribution_pence'
        AND attribute.attnotnull AND NOT attribute.attisdropped
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_constraint constraint_record
      WHERE constraint_record.conrelid='public.bookings'::regclass AND constraint_record.conname='bookings_target_contribution_check'
    ) THEN RAISE EXCEPTION 'Bookings do not freeze and constrain the minimum contribution target'; END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.invite_cleaner(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer,integer)');
    IF position('planned_contribution<proposed_target_contribution_pence' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Direct Cleaner invitations do not enforce the minimum contribution target';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer,integer)');
    IF position('planned_contribution<proposed_target_contribution_pence' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Automatic dispatch does not enforce the minimum contribution target';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.list_administrator_booking_operations(text,integer,integer)');
    IF position('targetContributionPence' IN COALESCE(selected_source,''))=0 OR position('target_contribution_pence' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Administrator booking operations omit the frozen minimum contribution target';
    END IF;
  END IF;
  IF public_cleaner_lookup_migration_installed THEN
    selected_function := to_regprocedure('tideway_private.get_public_cleaner_profile(uuid)');
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    IF selected_function IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_proc procedure WHERE procedure.oid=selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) OR NOT has_function_privilege('tideway_app', selected_function, 'EXECUTE')
      OR has_function_privilege('public', selected_function, 'EXECUTE')
      OR position('account.account_status = ''active''' IN COALESCE(selected_source,''))=0
      OR position('profile.is_public' IN COALESCE(selected_source,''))=0
      OR position('profile.profile_completion_percent = 100' IN COALESCE(selected_source,''))=0
      OR position('account.email' IN COALESCE(selected_source,''))>0
      OR position('phone' IN COALESCE(selected_source,''))>0 THEN
      RAISE EXCEPTION 'Direct public Cleaner lookup is missing, unsafe or overexposed';
    END IF;
  END IF;
  IF automatic_dispatch_customer_cap_installed THEN
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer,integer)');
    IF position('approved_maximum_customer_price_pence' IN COALESCE(selected_source,''))=0
       OR position('proposed_customer_price_pence>approved_maximum_customer_price_pence' IN COALESCE(selected_source,''))=0
       OR position('automatic-dispatch-price-cap-required' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'Automatic dispatch does not enforce the Landlord-approved maximum total';
    END IF;
  END IF;
  IF participant_response_deadline_installed THEN
    selected_function := to_regprocedure('tideway_private.list_my_booking_summaries(integer)');
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure WHERE procedure.oid=selected_function;
    IF selected_function IS NULL
       OR (
         position('participant-response-deadline-v1' IN COALESCE(selected_source,''))=0
         AND position('booking-client-conversation-names-v1' IN COALESCE(selected_source,''))=0
       )
       OR position('WHEN booking.status = ''pending-cleaner-acceptance'' THEN booking.cleaner_response_deadline' IN COALESCE(selected_source,''))=0
       OR position('''canRespond'', booking.cleaner_user_id = actor_id' IN COALESCE(selected_source,''))=0
       OR position('access_instructions' IN COALESCE(selected_source,''))>0
       OR position('property.address' IN COALESCE(selected_source,''))>0 THEN
      RAISE EXCEPTION 'Participant booking summaries do not expose the pending response deadline safely';
    END IF;
  END IF;
  IF apple_sign_in_migration_installed THEN
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.consume_rate_limit(text,bytea)');
    IF position('(''apple-start'',20,900)' IN replace(COALESCE(selected_source,''), ' ', ''))=0
       OR position('(''apple-callback'',30,900)' IN replace(COALESCE(selected_source,''), ' ', ''))=0
       OR NOT EXISTS (
         SELECT 1 FROM pg_constraint constraint_record
         WHERE constraint_record.conrelid='tideway_private.request_rate_limits'::regclass
           AND constraint_record.conname='request_rate_limits_scope_check'
           AND position('apple-start' IN pg_get_constraintdef(constraint_record.oid))>0
           AND position('apple-callback' IN pg_get_constraintdef(constraint_record.oid))>0
       ) THEN
      RAISE EXCEPTION 'Apple sign-in rate limits are missing or unsafe';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.connect_social_identity(authentication_provider,text,citext,boolean,text,text,jsonb)');
    IF position('asserted_providerNOTIN(''google'',''apple'',''facebook'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0
       OR position('asserted_providerIN(''google'',''apple'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0 THEN
      RAISE EXCEPTION 'Apple provider connection does not require a verified provider email';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.verify_my_social_identity(authentication_provider,text)');
    IF position('asserted_providerNOTIN(''google'',''apple'',''facebook'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0 THEN
      RAISE EXCEPTION 'Apple provider step-up is not installed';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.disconnect_my_social_identity(authentication_provider)');
    IF position('selected_providerNOTIN(''google'',''apple'',''facebook'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0
       OR position('identity.providerIN(''google'',''apple'',''facebook'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0 THEN
      RAISE EXCEPTION 'Apple provider removal or last-method protection is not installed';
    END IF;
  END IF;
  IF rate_limit_scope_migration_installed THEN
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.consume_rate_limit(text,bytea)');
    IF position('(''session-recovery'',30,900)' IN replace(COALESCE(selected_source,''), ' ', ''))=0
       OR position('(''marketplace-public:cleaner-profile'',120,60)' IN replace(COALESCE(selected_source,''), ' ', ''))=0
       OR position('(''apple-start'',20,900)' IN replace(COALESCE(selected_source,''), ' ', ''))=0 THEN
      RAISE EXCEPTION 'Shared rate limiter is missing the session-recovery, public Cleaner profile or Apple sign-in policy';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint constraint_record
      WHERE constraint_record.conrelid='tideway_private.request_rate_limits'::regclass
        AND constraint_record.conname='request_rate_limits_scope_check'
        AND position('session-recovery' IN pg_get_constraintdef(constraint_record.oid))>0
        AND position('marketplace-public:cleaner-profile' IN pg_get_constraintdef(constraint_record.oid))>0
    ) THEN
      RAISE EXCEPTION 'Shared rate-limit scope CHECK constraint does not admit the session-recovery or public Cleaner profile scope';
    END IF;
  END IF;
  IF cleaner_address_lookup_rate_limit_installed THEN
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.consume_rate_limit(text,bytea)');
    IF position('(''marketplace-cleaner:address-lookup'',40,900)' IN replace(COALESCE(selected_source,''), ' ', ''))=0 THEN
      RAISE EXCEPTION 'Shared rate limiter is missing the Cleaner address-lookup policy';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint constraint_record
      WHERE constraint_record.conrelid='tideway_private.request_rate_limits'::regclass
        AND constraint_record.conname='request_rate_limits_scope_check'
        AND position('marketplace-cleaner:address-lookup' IN pg_get_constraintdef(constraint_record.oid))>0
    ) THEN
      RAISE EXCEPTION 'Shared rate-limit scope CHECK constraint does not admit Cleaner address lookup';
    END IF;
  END IF;
  IF cleaner_verification_migration_installed THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger trigger_row
      WHERE trigger_row.tgrelid='public.cleaner_profiles'::regclass
        AND trigger_row.tgname='cleaner_verification_admin_only'
        AND NOT trigger_row.tgisinternal
    ) THEN
      RAISE EXCEPTION 'Cleaner verification-authority trigger is missing';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.enforce_cleaner_verification_authority()');
    IF selected_source IS NULL
       OR position('identity_check_status' IN selected_source)=0
       OR position('background_check_status' IN selected_source)=0
       OR position('has_role(''administrator'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0 THEN
      RAISE EXCEPTION 'Cleaner verification-authority guard does not restrict identity/background status to Administrators';
    END IF;
  END IF;
  IF apple_administrator_bootstrap_migration_installed THEN
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.provision_bootstrap_administrator(citext,uuid,text,text)');
    IF position('identity.providerIN(''password'',''google'',''apple'',''facebook'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0 THEN
      RAISE EXCEPTION 'Administrator bootstrap does not admit verified Apple identities';
    END IF;
  END IF;
  IF scope_handoff_migration_installed THEN
    SELECT procedure.prosrc INTO selected_source
    FROM pg_proc procedure
    WHERE procedure.oid=to_regprocedure('tideway_private.get_cleaning_request_scan(uuid)');
    IF position('cleaning_request_tasks' IN COALESCE(selected_source,''))=0
       OR position('pending-cleaner-acceptance' IN COALESCE(selected_source,''))=0
       OR position('actor_has_pending_invitation AND request_record.cleaner_preview_authorized' IN COALESCE(selected_source,''))=0 THEN
      RAISE EXCEPTION 'The pending-Cleaner checklist and photo-consent handoff is not installed';
    END IF;
  END IF;
  IF latest_migration_installed THEN
    selected_name := 'tideway_private.activate_my_workspace(user_role)';
    selected_function := to_regprocedure(selected_name);
    IF selected_function IS NULL THEN RAISE EXCEPTION 'Required protected function is missing: %', selected_name; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
      WHERE procedure.oid=selected_function AND procedure.prosecdef
        AND array_to_string(procedure.proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) THEN
      RAISE EXCEPTION 'Protected function is not SECURITY DEFINER with the trusted search path: %', selected_name;
    END IF;
    IF NOT has_function_privilege('tideway_app', selected_name, 'EXECUTE') THEN
      RAISE EXCEPTION 'App role is missing required function execution: %', selected_name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bookings'::regclass AND conname='bookings_distinct_participants' AND contype='c') THEN
      RAISE EXCEPTION 'Dual-workspace self-booking constraint is missing';
    END IF;
    SELECT procedure.prosrc INTO selected_source
    FROM pg_proc procedure
    WHERE procedure.oid = to_regprocedure('tideway_private.resolve_social_identity(authentication_provider,text,citext,boolean,text,text,jsonb)');
    IF position('#variable_conflict error' IN COALESCE(selected_source, '')) = 0
       OR position('UPDATE users AS u' IN COALESCE(selected_source, '')) = 0 THEN
      RAISE EXCEPTION 'The migration-46 social identity repair is not installed';
    END IF;
    IF has_table_privilege('tideway_app', to_regclass('tideway_private.schema_migrations'), 'SELECT') IS TRUE
       OR has_table_privilege('tideway_worker', to_regclass('tideway_private.schema_migrations'), 'SELECT') IS TRUE THEN
      RAISE EXCEPTION 'A restricted role can read the private migration ledger';
    END IF;
  END IF;

  FOREACH selected_name IN ARRAY app_functions || ARRAY[active_invite_function] LOOP
    IF NOT has_function_privilege('tideway_app', selected_name, 'EXECUTE') THEN RAISE EXCEPTION 'App role is missing required function execution: %', selected_name; END IF;
  END LOOP;
  FOREACH selected_name IN ARRAY ARRAY[
    'tideway_private.invite_cleaner_before_eligibility_hardening(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer)',
    'tideway_private.respond_to_cleaner_invitation_before_eligibility_hardening(uuid,text,text)',
    'tideway_private.respond_to_cleaner_invitation_core(uuid,text,text)'
  ] LOOP
    IF to_regprocedure(selected_name) IS NULL THEN RAISE EXCEPTION 'Superseded booking function is missing: %', selected_name; END IF;
    IF has_function_privilege('tideway_app', selected_name, 'EXECUTE') OR has_function_privilege('tideway_worker', selected_name, 'EXECUTE') THEN
      RAISE EXCEPTION 'Restricted role can bypass the current booking eligibility wrapper: %', selected_name;
    END IF;
  END LOOP;
  IF minimum_contribution_migration_installed THEN
    FOREACH selected_name IN ARRAY ARRAY[
      'tideway_private.invite_cleaner(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer)',
      'tideway_private.complete_automatic_dispatch(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,integer,integer,integer,integer,integer)'
    ] LOOP
      IF to_regprocedure(selected_name) IS NULL THEN RAISE EXCEPTION 'Superseded minimum-contribution function is missing: %', selected_name; END IF;
      IF has_function_privilege('tideway_app', selected_name, 'EXECUTE') OR has_function_privilege('tideway_worker', selected_name, 'EXECUTE') THEN
        RAISE EXCEPTION 'Restricted role can bypass the minimum-contribution booking wrapper: %', selected_name;
      END IF;
    END LOOP;
  END IF;
  FOREACH selected_name IN ARRAY worker_functions || ARRAY[active_dispatch_function] LOOP
    IF NOT has_function_privilege('tideway_worker', selected_name, 'EXECUTE') THEN RAISE EXCEPTION 'Worker role is missing required function execution: %', selected_name; END IF;
    IF has_function_privilege('tideway_app', selected_name, 'EXECUTE') THEN RAISE EXCEPTION 'App role can execute worker-only function: %', selected_name; END IF;
  END LOOP;

  FOREACH selected_name IN ARRAY protected_write_tables LOOP
    IF has_table_privilege('tideway_app', format('public.%I', selected_name), 'INSERT')
       OR has_table_privilege('tideway_app', format('public.%I', selected_name), 'UPDATE')
       OR has_table_privilege('tideway_app', format('public.%I', selected_name), 'DELETE') THEN
      RAISE EXCEPTION 'App role has direct mutation privilege on protected table %', selected_name;
    END IF;
  END LOOP;
  FOREACH selected_name IN ARRAY protected_read_tables LOOP
    IF has_table_privilege('tideway_app', format('public.%I', selected_name), 'SELECT') THEN
      RAISE EXCEPTION 'App role has direct read privilege on protected table %', selected_name;
    END IF;
  END LOOP;
  IF has_table_privilege('tideway_app', 'public.sessions', 'DELETE') OR has_function_privilege('tideway_app', 'tideway_private.purge_expired_sessions(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'App role can physically purge sessions';
  END IF;
  IF NOT has_table_privilege('tideway_app', 'public.cleaning_requests', 'INSERT')
     OR has_table_privilege('tideway_app', 'public.cleaning_requests', 'UPDATE')
     OR has_table_privilege('tideway_app', 'public.cleaning_requests', 'DELETE') THEN
    RAISE EXCEPTION 'App role can bypass function-only cleaning-request lifecycle or cannot create an owner-bound request';
  END IF;
  IF has_table_privilege('tideway_app', 'tideway_private.request_rate_limits', 'SELECT')
     OR has_table_privilege('tideway_app', 'tideway_private.request_rate_limits', 'INSERT')
     OR has_table_privilege('tideway_app', 'tideway_private.request_rate_limits', 'UPDATE')
     OR has_table_privilege('tideway_app', 'tideway_private.request_rate_limits', 'DELETE')
     OR has_table_privilege('tideway_worker', 'tideway_private.request_rate_limits', 'SELECT')
     OR has_table_privilege('tideway_worker', 'tideway_private.request_rate_limits', 'INSERT')
     OR has_table_privilege('tideway_worker', 'tideway_private.request_rate_limits', 'UPDATE')
     OR has_table_privilege('tideway_worker', 'tideway_private.request_rate_limits', 'DELETE') THEN
    RAISE EXCEPTION 'Restricted roles have direct access to private rate-limit keys';
  END IF;
  IF has_table_privilege('tideway_app', 'tideway_private.pending_social_identities', 'SELECT')
     OR has_table_privilege('tideway_app', 'tideway_private.pending_social_identities', 'INSERT')
     OR has_table_privilege('tideway_app', 'tideway_private.pending_social_identities', 'UPDATE')
     OR has_table_privilege('tideway_app', 'tideway_private.pending_social_identities', 'DELETE')
     OR has_table_privilege('tideway_worker', 'tideway_private.pending_social_identities', 'SELECT')
     OR has_table_privilege('tideway_worker', 'tideway_private.pending_social_identities', 'INSERT')
     OR has_table_privilege('tideway_worker', 'tideway_private.pending_social_identities', 'UPDATE')
     OR has_table_privilege('tideway_worker', 'tideway_private.pending_social_identities', 'DELETE') THEN
    RAISE EXCEPTION 'Restricted roles have direct access to pending social identity material';
  END IF;
  IF has_table_privilege('tideway_app', 'tideway_private.facebook_data_deletion_requests', 'SELECT')
     OR has_table_privilege('tideway_app', 'tideway_private.facebook_data_deletion_requests', 'INSERT')
     OR has_table_privilege('tideway_app', 'tideway_private.facebook_data_deletion_requests', 'UPDATE')
     OR has_table_privilege('tideway_app', 'tideway_private.facebook_data_deletion_requests', 'DELETE')
     OR has_table_privilege('tideway_worker', 'tideway_private.facebook_data_deletion_requests', 'SELECT')
     OR has_table_privilege('tideway_worker', 'tideway_private.facebook_data_deletion_requests', 'INSERT')
     OR has_table_privilege('tideway_worker', 'tideway_private.facebook_data_deletion_requests', 'UPDATE')
     OR has_table_privilege('tideway_worker', 'tideway_private.facebook_data_deletion_requests', 'DELETE') THEN
    RAISE EXCEPTION 'Restricted roles have direct access to Facebook deletion confirmation material';
  END IF;
  IF has_table_privilege('tideway_app', 'tideway_private.cleaner_payout_accounts', 'SELECT')
     OR has_table_privilege('tideway_app', 'tideway_private.cleaner_payout_accounts', 'INSERT')
     OR has_table_privilege('tideway_app', 'tideway_private.cleaner_payout_accounts', 'UPDATE')
     OR has_table_privilege('tideway_app', 'tideway_private.cleaner_payout_accounts', 'DELETE')
     OR has_table_privilege('tideway_app', 'tideway_private.payment_provider_events', 'SELECT')
     OR has_table_privilege('tideway_app', 'tideway_private.payment_provider_events', 'INSERT')
     OR has_table_privilege('tideway_app', 'tideway_private.payment_provider_events', 'UPDATE')
     OR has_table_privilege('tideway_app', 'tideway_private.payment_provider_events', 'DELETE')
     OR has_table_privilege('tideway_worker', 'tideway_private.cleaner_payout_accounts', 'SELECT')
     OR has_table_privilege('tideway_app', 'tideway_private.cleaner_payout_onboarding', 'SELECT')
     OR has_table_privilege('tideway_app', 'tideway_private.cleaner_payout_onboarding', 'INSERT')
     OR has_table_privilege('tideway_app', 'tideway_private.cleaner_payout_onboarding', 'UPDATE')
     OR has_table_privilege('tideway_app', 'tideway_private.cleaner_payout_onboarding', 'DELETE')
     OR has_table_privilege('tideway_worker', 'tideway_private.cleaner_payout_onboarding', 'SELECT')
     OR has_table_privilege('tideway_worker', 'tideway_private.payment_provider_events', 'SELECT') THEN
    RAISE EXCEPTION 'Restricted roles have direct access to private payment provider material';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class relation
    WHERE relation.relnamespace = 'public'::regnamespace AND relation.relkind IN ('r','p')
      AND (has_table_privilege('tideway_worker', relation.oid, 'SELECT') OR has_table_privilege('tideway_worker', relation.oid, 'INSERT')
        OR has_table_privilege('tideway_worker', relation.oid, 'UPDATE') OR has_table_privilege('tideway_worker', relation.oid, 'DELETE')
        OR has_table_privilege('tideway_worker', relation.oid, 'TRUNCATE'))
  ) THEN
    RAISE EXCEPTION 'Worker role has direct public-table privileges';
  END IF;
END
$verification$;

SELECT json_build_object(
  'verified', true,
  'postgresqlVersion', current_setting('server_version'),
  'rlsTableCount', 39 + CASE WHEN to_regclass('public.support_requests') IS NULL THEN 0 ELSE 1 END
    + CASE WHEN to_regclass('public.cleaner_onboarding_sections') IS NULL THEN 0 ELSE 2 END,
  'appFunctionChecks', 48
    + CASE WHEN to_regclass('public.support_requests') IS NULL THEN 0 ELSE 4 END
    + CASE WHEN to_regprocedure('tideway_private.create_landlord_booking_change_request(uuid,uuid,uuid,text,timestamp with time zone,text)') IS NULL THEN 0 ELSE 1 END
    + CASE WHEN to_regprocedure('tideway_private.get_administrator_coverage_report(integer,boolean)') IS NULL THEN 0 ELSE 1 END
    + CASE WHEN to_regprocedure('tideway_private.get_administrator_funnel_report(integer)') IS NULL THEN 0 ELSE 1 END
    + CASE WHEN to_regprocedure('tideway_private.archive_my_property(uuid)') IS NULL THEN 0 ELSE 1 END
    + CASE WHEN to_regprocedure('tideway_private.restore_my_property(uuid)') IS NULL THEN 0 ELSE 1 END
    + CASE WHEN to_regprocedure('tideway_private.save_my_cleaner_onboarding_section(text,bytea,text,smallint)') IS NULL THEN 0 ELSE 2 END
    + CASE WHEN to_regprocedure('tideway_private.save_my_cleaner_onboarding_document(text,text,bytea,text,text,integer,text,bytea)') IS NULL THEN 0 ELSE 4 END,
  'workerFunctionChecks', 14
) AS tideway_deployment_verification;

ROLLBACK;
