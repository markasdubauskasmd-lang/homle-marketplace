BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE user_role AS ENUM ('cleaner', 'landlord', 'administrator');
CREATE TYPE authentication_provider AS ENUM ('password', 'google', 'apple', 'facebook');
CREATE TYPE booking_status AS ENUM ('draft', 'searching-for-cleaner', 'cleaner-invited', 'pending-cleaner-acceptance', 'confirmed', 'cleaner-en-route', 'cleaner-arrived', 'cleaning-in-progress', 'awaiting-review', 'completed', 'cancelled', 'disputed');
CREATE TYPE cleaning_task_status AS ENUM ('not-started', 'in-progress', 'completed', 'skipped', 'issue-reported');
CREATE TYPE review_moderation_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE notification_delivery_status AS ENUM ('pending', 'sent', 'failed', 'read');
CREATE TYPE privacy_request_type AS ENUM ('export', 'deletion');
CREATE TYPE privacy_request_status AS ENUM ('requested', 'verifying', 'processing', 'completed', 'rejected');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  email_verified_at timestamptz,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  avatar_url text,
  account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'deletion-pending', 'deleted')),
  selected_role user_role CHECK (selected_role IN ('cleaner', 'landlord')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE authentication_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider authentication_provider NOT NULL,
  provider_subject text NOT NULL CHECK (char_length(provider_subject) BETWEEN 1 AND 255),
  provider_email citext,
  provider_email_verified boolean NOT NULL DEFAULT false,
  profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider)
);

CREATE INDEX authentication_identities_verified_email_idx ON authentication_identities(provider_email) WHERE provider_email_verified;

CREATE TABLE password_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz
);

CREATE TABLE email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  csrf_secret_hash bytea NOT NULL,
  user_agent_hash bytea,
  last_ip_hash bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX sessions_active_user_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE cleaner_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  public_slug citext NOT NULL UNIQUE,
  biography text NOT NULL DEFAULT '' CHECK (char_length(biography) <= 1200),
  profile_photo_url text,
  hourly_rate_pence integer CHECK (hourly_rate_pence BETWEEN 1 AND 1000000),
  fixed_price_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  travel_radius_km numeric(6,2) CHECK (travel_radius_km > 0 AND travel_radius_km <= 500),
  years_experience integer CHECK (years_experience BETWEEN 0 AND 80),
  languages text[] NOT NULL DEFAULT '{}',
  equipment_supplied text[] NOT NULL DEFAULT '{}',
  products_supplied text[] NOT NULL DEFAULT '{}',
  residential_preference boolean NOT NULL DEFAULT true,
  commercial_preference boolean NOT NULL DEFAULT false,
  identity_check_status text NOT NULL DEFAULT 'not-checked' CHECK (identity_check_status IN ('not-checked', 'pending', 'verified', 'failed', 'expired')),
  background_check_status text NOT NULL DEFAULT 'not-checked' CHECK (background_check_status IN ('not-checked', 'pending', 'verified', 'failed', 'expired', 'not-required')),
  average_rating numeric(3,2) NOT NULL DEFAULT 0 CHECK (average_rating BETWEEN 0 AND 5),
  review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  completed_job_count integer NOT NULL DEFAULT 0 CHECK (completed_job_count >= 0),
  acceptance_rate numeric(5,2) CHECK (acceptance_rate BETWEEN 0 AND 100),
  profile_completion_percent integer NOT NULL DEFAULT 0 CHECK (profile_completion_percent BETWEEN 0 AND 100),
  current_availability_status text NOT NULL DEFAULT 'unavailable' CHECK (current_availability_status IN ('available', 'limited', 'unavailable')),
  verified_badges text[] NOT NULL DEFAULT '{}',
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cleaner_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  service_code text NOT NULL CHECK (char_length(service_code) BETWEEN 1 AND 80),
  pricing_model text NOT NULL CHECK (pricing_model IN ('hourly', 'fixed', 'quote')),
  price_pence integer CHECK (price_pence BETWEEN 1 AND 1000000),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (cleaner_user_id, service_code)
);

CREATE TABLE cleaner_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  outward_postcode text NOT NULL CHECK (outward_postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$'),
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cleaner_user_id, outward_postcode)
);

CREATE INDEX cleaner_service_areas_postcode_idx ON cleaner_service_areas(outward_postcode);

CREATE TABLE cleaner_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  recurrence_rule text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'unavailable', 'withdrawn')),
  source text NOT NULL DEFAULT 'cleaner',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX cleaner_availability_lookup_idx ON cleaner_availability(cleaner_user_id, starts_at, ends_at) WHERE status = 'available';

CREATE TABLE landlord_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organisation_name text,
  biography text NOT NULL DEFAULT '' CHECK (char_length(biography) <= 1200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_user_id uuid NOT NULL REFERENCES landlord_profiles(user_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  address_line_1 text NOT NULL,
  address_line_2 text,
  locality text NOT NULL,
  postcode text NOT NULL,
  property_type text NOT NULL,
  bedrooms numeric(4,1) CHECK (bedrooms >= 0 AND bedrooms <= 200),
  bathrooms numeric(4,1) CHECK (bathrooms >= 0 AND bathrooms <= 200),
  approximate_size_sq_m integer CHECK (approximate_size_sq_m > 0 AND approximate_size_sq_m <= 1000000),
  access_instructions_ciphertext bytea,
  parking_instructions text CHECK (char_length(parking_instructions) <= 1200),
  cleaning_preferences text CHECK (char_length(cleaning_preferences) <= 3000),
  saved_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  special_notes text CHECK (char_length(special_notes) <= 3000),
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX properties_landlord_idx ON properties(landlord_user_id) WHERE archived_at IS NULL;
CREATE INDEX properties_postcode_idx ON properties(postcode) WHERE archived_at IS NULL;

CREATE TABLE property_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 15000000),
  caption text CHECK (char_length(caption) <= 500),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cleaning_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_user_id uuid NOT NULL REFERENCES landlord_profiles(user_id),
  property_id uuid NOT NULL REFERENCES properties(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'searching', 'invited', 'matched', 'closed')),
  requested_start_at timestamptz NOT NULL,
  requested_end_at timestamptz NOT NULL,
  cleaning_type text NOT NULL,
  required_services text[] NOT NULL DEFAULT '{}',
  special_instructions text CHECK (char_length(special_instructions) <= 5000),
  budget_pence integer CHECK (budget_pence BETWEEN 1 AND 10000000),
  recurrence_rule text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requested_end_at > requested_start_at)
);

CREATE INDEX cleaning_requests_marketplace_idx ON cleaning_requests(status, requested_start_at);
CREATE INDEX cleaning_requests_landlord_idx ON cleaning_requests(landlord_user_id, created_at DESC);

CREATE TABLE cleaning_request_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_request_id uuid NOT NULL REFERENCES cleaning_requests(id) ON DELETE CASCADE,
  room_name text NOT NULL,
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cleaning_request_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_request_id uuid NOT NULL REFERENCES cleaning_requests(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  room_name text NOT NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
  mime_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 20000000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_request_id uuid REFERENCES cleaning_requests(id),
  landlord_user_id uuid NOT NULL REFERENCES landlord_profiles(user_id),
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id),
  property_id uuid NOT NULL REFERENCES properties(id),
  status booking_status NOT NULL DEFAULT 'draft',
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  customer_price_pence integer NOT NULL CHECK (customer_price_pence BETWEEN 1 AND 10000000),
  cleaner_pay_pence integer NOT NULL CHECK (cleaner_pay_pence BETWEEN 1 AND 10000000),
  recurrence_instance_key text,
  accepted_by_cleaner_at timestamptz,
  confirmed_at timestamptz,
  journey_started_at timestamptz,
  arrived_at timestamptz,
  cleaning_started_at timestamptz,
  cleaning_finished_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  location_consent_at timestamptz,
  location_sharing_stopped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_end_at > scheduled_start_at),
  CHECK (customer_price_pence >= cleaner_pay_pence),
  UNIQUE (cleaning_request_id)
);

ALTER TABLE bookings ADD CONSTRAINT bookings_no_cleaner_overlap
  EXCLUDE USING gist (
    cleaner_user_id WITH =,
    tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
  ) WHERE (status IN ('confirmed', 'cleaner-en-route', 'cleaner-arrived', 'cleaning-in-progress', 'awaiting-review'))
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX bookings_landlord_schedule_idx ON bookings(landlord_user_id, scheduled_start_at DESC);
CREATE INDEX bookings_cleaner_schedule_idx ON bookings(cleaner_user_id, scheduled_start_at DESC);
CREATE INDEX bookings_active_status_idx ON bookings(status, scheduled_start_at) WHERE status NOT IN ('completed', 'cancelled');

CREATE TABLE booking_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status booking_status,
  to_status booking_status NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id),
  reason text CHECK (char_length(reason) <= 2000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX booking_status_history_booking_idx ON booking_status_history(booking_id, created_at);

CREATE TABLE cleaning_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_name text NOT NULL,
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  status cleaning_task_status NOT NULL DEFAULT 'not-started',
  unexpected boolean NOT NULL DEFAULT false,
  landlord_approval_status text CHECK (landlord_approval_status IN ('pending', 'approved', 'declined')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cleaning_tasks_booking_idx ON cleaning_tasks(booking_id, sort_order);

CREATE TABLE task_updates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES cleaning_tasks(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  from_status cleaning_task_status,
  to_status cleaning_task_status NOT NULL,
  note text CHECK (char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_updates_booking_idx ON task_updates(booking_id, created_at);

CREATE TABLE job_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  task_id uuid REFERENCES cleaning_tasks(id) ON DELETE SET NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  photo_type text NOT NULL CHECK (photo_type IN ('before', 'after', 'issue')),
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 15000000),
  note text CHECK (char_length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cleaner_locations (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id),
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_metres numeric(8,2) CHECK (accuracy_metres >= 0),
  estimated_arrival_at timestamptz,
  consented_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > recorded_at)
);

CREATE INDEX cleaner_locations_expiry_idx ON cleaner_locations(expires_at);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in-app', 'email')),
  delivery_status notification_delivery_status NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  read_at timestamptz
);

CREATE INDEX notifications_recipient_idx ON notifications(recipient_user_id, created_at DESC);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  landlord_user_id uuid NOT NULL REFERENCES landlord_profiles(user_id),
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  quality_rating smallint CHECK (quality_rating BETWEEN 1 AND 5),
  punctuality_rating smallint CHECK (punctuality_rating BETWEEN 1 AND 5),
  communication_rating smallint CHECK (communication_rating BETWEEN 1 AND 5),
  professionalism_rating smallint CHECK (professionalism_rating BETWEEN 1 AND 5),
  written_review text CHECK (char_length(written_review) <= 3000),
  moderation_status review_moderation_status NOT NULL DEFAULT 'pending',
  moderation_note text CHECK (char_length(moderation_note) <= 2000),
  moderated_by uuid REFERENCES users(id),
  moderated_at timestamptz,
  cleaner_response text CHECK (char_length(cleaner_response) <= 2000),
  cleaner_responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reviews_public_cleaner_idx ON reviews(cleaner_user_id, created_at DESC) WHERE moderation_status = 'approved';

CREATE TABLE favourite_cleaners (
  landlord_user_id uuid NOT NULL REFERENCES landlord_profiles(user_id) ON DELETE CASCADE,
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (landlord_user_id, cleaner_user_id)
);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL REFERENCES users(id),
  category text NOT NULL,
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 5000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'closed')),
  assigned_admin_user_id uuid REFERENCES users(id),
  resolution_note text CHECK (char_length(resolution_note) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX disputes_admin_queue_idx ON disputes(status, created_at);

CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type privacy_request_type NOT NULL,
  status privacy_request_status NOT NULL DEFAULT 'requested',
  verified_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX privacy_requests_queue_idx ON privacy_requests(status, created_at);

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  request_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_resource_idx ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_user_id, created_at DESC);

CREATE FUNCTION enforce_completed_booking_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_booking bookings;
BEGIN
  SELECT * INTO target_booking FROM bookings WHERE id = NEW.booking_id FOR SHARE;
  IF target_booking.id IS NULL OR target_booking.status <> 'completed' THEN
    RAISE EXCEPTION 'Reviews require a completed booking';
  END IF;
  IF target_booking.landlord_user_id <> NEW.landlord_user_id OR target_booking.cleaner_user_id <> NEW.cleaner_user_id THEN
    RAISE EXCEPTION 'Review participants must match the completed booking';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reviews_completed_booking_only
  BEFORE INSERT OR UPDATE OF booking_id, landlord_user_id, cleaner_user_id ON reviews
  FOR EACH ROW EXECUTE FUNCTION enforce_completed_booking_review();

CREATE FUNCTION refresh_cleaner_rating() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  affected_cleaner uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_cleaner := OLD.cleaner_user_id;
  ELSE
    affected_cleaner := NEW.cleaner_user_id;
  END IF;
  UPDATE cleaner_profiles
  SET average_rating = COALESCE((SELECT round(avg(rating)::numeric, 2) FROM reviews WHERE cleaner_user_id = affected_cleaner AND moderation_status = 'approved'), 0),
      review_count = (SELECT count(*) FROM reviews WHERE cleaner_user_id = affected_cleaner AND moderation_status = 'approved'),
      updated_at = now()
  WHERE user_id = affected_cleaner;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reviews_refresh_cleaner_rating
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION refresh_cleaner_rating();

COMMIT;
