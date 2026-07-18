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
  active_invite_function text;
  active_dispatch_function text;
  rls_tables constant text[] := ARRAY[
    'users','user_roles','authentication_identities','password_credentials','email_verification_tokens','password_reset_tokens','sessions',
    'cleaner_profiles','cleaner_services','cleaner_service_areas','cleaner_availability','landlord_profiles','properties','property_photos',
    'cleaning_requests','cleaning_request_tasks','cleaning_request_photos','cleaning_request_photo_uploads','cleaning_request_status_history','bookings','booking_status_history',
    'cleaning_tasks','task_updates','job_pauses','unexpected_task_decisions','booking_progress_events','job_photos','job_photo_uploads',
    'cleaner_locations','conversations','messages','booking_realtime_events','notifications','reviews','favourite_cleaners','disputes','privacy_requests','audit_logs',
    'booking_payments','payment_commands','payment_status_history'
  ];
  protected_write_tables constant text[] := ARRAY[
    'authentication_identities','bookings','booking_status_history','cleaning_tasks','task_updates','job_pauses','unexpected_task_decisions','booking_progress_events',
    'cleaning_request_photos','cleaning_request_photo_uploads','job_photos','job_photo_uploads','cleaner_locations','conversations','messages','booking_realtime_events','notifications','reviews','disputes','privacy_requests','audit_logs',
    'booking_payments','payment_commands','payment_status_history'
  ];
  protected_read_tables constant text[] := ARRAY['authentication_identities','cleaning_request_photos','cleaning_request_photo_uploads','job_photos','job_photo_uploads','conversations','messages','booking_realtime_events','notifications','reviews','disputes','privacy_requests','booking_payments','payment_commands','payment_status_history'];
  app_functions constant text[] := ARRAY[
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
    'tideway_private.get_automatic_dispatch_candidates(uuid,uuid,integer)',
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
       OR position('participant-response-deadline-v1' IN COALESCE(selected_source,''))=0
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
    IF position('asserted_provider NOT IN (''google'',''apple'',''facebook'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0
       OR position('asserted_provider IN (''google'',''apple'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0 THEN
      RAISE EXCEPTION 'Apple provider connection does not require a verified provider email';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.verify_my_social_identity(authentication_provider,text)');
    IF position('asserted_provider NOT IN (''google'',''apple'',''facebook'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0 THEN
      RAISE EXCEPTION 'Apple provider step-up is not installed';
    END IF;
    SELECT procedure.prosrc INTO selected_source FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('tideway_private.disconnect_my_social_identity(authentication_provider)');
    IF position('selected_provider NOT IN (''google'',''apple'',''facebook'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0
       OR position('identity.provider IN (''google'',''apple'',''facebook'')' IN replace(COALESCE(selected_source,''), ' ', ''))=0 THEN
      RAISE EXCEPTION 'Apple provider removal or last-method protection is not installed';
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
  'rlsTableCount', 40,
  'appFunctionChecks', 47,
  'workerFunctionChecks', 15
) AS tideway_deployment_verification;

ROLLBACK;
