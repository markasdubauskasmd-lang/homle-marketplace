BEGIN;

CREATE SCHEMA IF NOT EXISTS tideway_private;
REVOKE ALL ON SCHEMA tideway_private FROM PUBLIC;

CREATE FUNCTION tideway_private.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION tideway_private.has_role(required_role user_role) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT required_role::text = ANY(string_to_array(current_setting('app.user_roles', true), ','))
$$;

CREATE FUNCTION tideway_private.booking_participant(target_booking uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = target_booking
      AND (b.landlord_user_id = tideway_private.current_user_id() OR b.cleaner_user_id = tideway_private.current_user_id())
  ) OR tideway_private.has_role('administrator')
$$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE authentication_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE landlord_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_request_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_request_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE favourite_cleaners ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_or_admin ON users USING (id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY user_roles_self_or_admin ON user_roles USING (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY identities_self_or_admin ON authentication_identities USING (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY password_credentials_self_or_admin ON password_credentials USING (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY verification_tokens_self_or_admin ON email_verification_tokens USING (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY reset_tokens_self_or_admin ON password_reset_tokens USING (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY sessions_self_or_admin ON sessions USING (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));

CREATE POLICY public_cleaner_profiles ON cleaner_profiles FOR SELECT USING (is_public OR user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY cleaner_profile_owner_write ON cleaner_profiles FOR ALL USING (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY public_cleaner_services ON cleaner_services FOR SELECT USING (is_active OR cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY cleaner_services_owner_write ON cleaner_services FOR ALL USING (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY public_cleaner_areas ON cleaner_service_areas FOR SELECT USING (true);
CREATE POLICY cleaner_areas_owner_write ON cleaner_service_areas FOR ALL USING (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY cleaner_availability_owner_or_admin ON cleaner_availability USING (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));

CREATE POLICY landlord_profiles_owner_or_admin ON landlord_profiles USING (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY properties_landlord_or_admin ON properties USING (landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY properties_confirmed_cleaner_read ON properties FOR SELECT USING (EXISTS (SELECT 1 FROM bookings b WHERE b.property_id = properties.id AND b.cleaner_user_id = tideway_private.current_user_id() AND b.status IN ('confirmed', 'cleaner-en-route', 'cleaner-arrived', 'cleaning-in-progress', 'awaiting-review', 'completed', 'disputed')));
CREATE POLICY property_photos_owner_or_admin ON property_photos USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_photos.property_id AND (p.landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'))));

CREATE POLICY requests_owner_or_admin ON cleaning_requests USING (landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY request_tasks_owner_or_admin ON cleaning_request_tasks USING (EXISTS (SELECT 1 FROM cleaning_requests r WHERE r.id = cleaning_request_tasks.cleaning_request_id AND (r.landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'))));
CREATE POLICY request_photos_owner_or_admin ON cleaning_request_photos USING (EXISTS (SELECT 1 FROM cleaning_requests r WHERE r.id = cleaning_request_photos.cleaning_request_id AND (r.landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'))));

CREATE POLICY booking_participants ON bookings USING (landlord_user_id = tideway_private.current_user_id() OR cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY booking_history_participants ON booking_status_history USING (tideway_private.booking_participant(booking_id));
CREATE POLICY tasks_booking_participants ON cleaning_tasks USING (tideway_private.booking_participant(booking_id));
CREATE POLICY task_updates_booking_participants ON task_updates USING (tideway_private.booking_participant(booking_id));
CREATE POLICY job_photos_booking_participants ON job_photos USING (tideway_private.booking_participant(booking_id));
CREATE POLICY conversations_booking_participants ON conversations USING (tideway_private.booking_participant(booking_id));
CREATE POLICY messages_booking_participants ON messages USING (tideway_private.booking_participant(booking_id));

CREATE POLICY location_booking_participants_read ON cleaner_locations FOR SELECT USING (tideway_private.booking_participant(booking_id));
CREATE POLICY location_assigned_cleaner_write ON cleaner_locations FOR ALL USING (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));

CREATE POLICY notifications_recipient_or_admin ON notifications USING (recipient_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY public_approved_reviews ON reviews FOR SELECT USING (moderation_status = 'approved' OR landlord_user_id = tideway_private.current_user_id() OR cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY completed_booking_landlord_reviews ON reviews FOR INSERT WITH CHECK (landlord_user_id = tideway_private.current_user_id() AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.landlord_user_id = tideway_private.current_user_id() AND b.cleaner_user_id = reviews.cleaner_user_id AND b.status = 'completed'));
CREATE POLICY favourite_owner ON favourite_cleaners USING (landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY disputes_booking_participants ON disputes USING (tideway_private.booking_participant(booking_id));
CREATE POLICY privacy_requests_owner_or_admin ON privacy_requests USING (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')) WITH CHECK (user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY audit_logs_admin_only ON audit_logs USING (tideway_private.has_role('administrator'));

COMMIT;
